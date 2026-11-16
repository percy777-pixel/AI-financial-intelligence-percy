import Decimal from 'decimal.js';
import {
  calculateDRE,
  calculateIndicators,
  compareFinancialRecords,
  explainCalculation,
  parseDecimal,
  parseFinancialValueStrict,
  parseOptionalDecimal,
  validateFinancialInput,
} from './services/financialEngine.js';
import { parseFrontendImportRow } from '../src/utils/financialParser.js';
import {
  extractAndValidateImportRow,
  parseCsvBuffer,
  suggestColumnMapping,
} from './services/importService.js';
import {
  buildScenarioComparisonSuite,
  computeLucroRealStatutoryMonthlyTax,
  simulateInterestRateWithFacilities,
  simulateScenario,
} from './services/scenarioService.js';
import {
  compareMacroPeriods,
  fetchAndSyncMacroData,
  getLatestMacroIndicators,
  getMacroHistory,
  getMacroPublicationMetadata,
  parseBcbSgsResponse,
  resetMemoryMacroToLocalReference,
  SERIES_CATALOG,
} from './services/macroService.js';
import { analyzeDebtAndEconomicContext } from './services/economicContextService.js';
import {
  addDebtFacility,
  createCompany,
  createOperationalMemory,
  deleteCompanyById,
  deleteOperationalMemory,
  getCompanyById,
  getCompanyPeriods,
  getDebtFacilities,
  listAnalysisReports,
  listAutomationRuns,
  listCompanies,
  listOperationalMemory,
  saveAnalysisReport,
  saveFinancialPeriodVersion,
  ensureDemoCompaniesInDb,
} from './services/dataStore.js';
import {
  AGENT_FUNCTION_DECLARATIONS,
  executeAgentTool,
} from './services/agentTools.js';
import { runFinancialAgent } from './services/agentService.js';
import {
  clearGeminiCooldownsForTesting,
  validateControlledGeminiIntegration,
} from './services/aiService.js';
import {
  dispatchWebhookEvent,
  getWebhookStatus,
  resetWebhookTestStateForTesting,
  runAutomatedImportPipeline,
  testWebhookConnection,
} from './services/automationService.js';
import { runAgentEvaluationSuite } from './services/evaluationService.js';
import {
  getPersistenceState,
  getSchemaMigrationSummary,
  inspectDatabaseSchemaCompatibility,
  isValidPostgresUrl,
  normalizePostgresUrl,
  prisma,
  sanitizeDatabaseErrorMessage,
  setPersistenceStateForTesting,
} from './prisma.js';
import {
  createConfiguredApp,
  createSessionToken,
  resetAuthStateForTesting,
  resolveFrontendDistPath,
} from '../server.js';

// Prevent accidental external paid Gemini calls during automated test suite runs
process.env.DISABLE_EXTERNAL_AI = 'true';
process.env.SKIP_SERVER_LISTEN = 'true';

let totalTests = 0;
let passedTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`[PASS] (${passedTests}/${totalTests}) ${name}`);
  } catch (err: any) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

function assertEqual(actual: any, expected: any, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: esperado "${expected}", recebido "${actual}"`);
  }
}

async function runAllTests() {
  console.log('Running AI Financial Intelligence Comprehensive Test Suite (P0 + P1 + P2 + Neon PostgreSQL)...\n');

  const initialRuntimeState = getPersistenceState();
  const realPrismaClient = prisma;

  // Run unit tests 1-12 in isolated MEMORY_DEMO mode so mock tests never pollute real PostgreSQL
  setPersistenceStateForTesting({
    mode: 'MEMORY_DEMO',
    client: null,
    isConnected: false,
    lastWriteError: null,
  });

  // ============================================================================
  // 1. P0 — INICIALIZAÇÃO DE PRODUÇÃO & RESOLUÇÃO DE CAMINHOS (3.1)
  // ============================================================================
  await test('3.1 resolveFrontendDistPath avoids dist/dist in compiled production', () => {
    const fromRoot = resolveFrontendDistPath('/app/applet');
    if (fromRoot.endsWith('/dist/dist')) {
      throw new Error(`Caminho inválido com dist/dist: ${fromRoot}`);
    }
  });

  // ============================================================================
  // 2. P0 — PARSER FINANCEIRO & PARIDADE FRONTEND/BACKEND (3.2)
  // ============================================================================
  await test('3.2 parseFinancialValueStrict handles all mandatory Brazilian and US formats', () => {
    const mandatoryInputs = [
      '1.250,50',
      '1250,50',
      '1250.50',
      '1250',
      'R$ 1.250,50',
    ];
    for (const input of mandatoryInputs) {
      const res = parseFinancialValueStrict(input);
      if (res.status !== 'VALID' || !res.decimal) {
        throw new Error(`Falha ao interpretar "${input}": ${res.reason}`);
      }
      const expected = input === '1250' ? new Decimal('1250') : new Decimal('1250.50');
      if (!res.decimal.equals(expected)) {
        throw new Error(`Valor incorreto para "${input}": esperado ${expected.toFixed(2)}, recebido ${res.decimal.toFixed(2)}`);
      }
    }
    // Critical regression check: 1250.50 must NEVER become 125050
    const usDec = parseFinancialValueStrict('1250.50');
    if (usDec.decimal?.equals(125050) || !usDec.decimal?.equals('1250.50')) {
      throw new Error(`Regressão crítica: 1250.50 transformado em ${usDec.normalizedString}`);
    }
  });

  await test('3.2 parseFinancialValueStrict handles negative, empty, null, undefined, and ambiguous/invalid values', () => {
    const negBr = parseFinancialValueStrict('-R$ 1.250,50');
    if (negBr.status !== 'VALID' || !negBr.decimal?.equals('-1250.50')) {
      throw new Error('Falha em negativo BR');
    }
    const negUs = parseFinancialValueStrict('-1250.50');
    if (negUs.status !== 'VALID' || !negUs.decimal?.equals('-1250.50')) {
      throw new Error('Falha em negativo US');
    }

    for (const emptyVal of [null, undefined, '', '   ']) {
      const emptyRes = parseFinancialValueStrict(emptyVal);
      if (emptyRes.status !== 'EMPTY' || emptyRes.decimal !== null) {
        throw new Error(`Valor vazio deveria retornar status=EMPTY e decimal=null: ${JSON.stringify(emptyRes)}`);
      }
    }

    const invalidOrAmbiguous = ['1.250', '1.25,50', '1,25.50', 'abc', 'R$ --'];
    for (const bad of invalidOrAmbiguous) {
      const badRes = parseFinancialValueStrict(bad);
      if (badRes.status === 'VALID' || badRes.status === 'EMPTY') {
        throw new Error(`Valor ambíguo ou inválido "${bad}" deveria ser rejeitado, mas retornou ${badRes.normalizedString}`);
      }
    }
  });

  await test('3.2 Frontend parser (parseFrontendImportRow) and Backend parser (extractAndValidateImportRow) produce identical results', () => {
    const sampleRow = {
      'Receita Bruta': 'R$ 1.250,50',
      'Deduções': '125,05',
      'CMV': '500.20',
      'Despesas Fixas': '300',
      'Estoque': '',
    };
    const mapping = {
      grossRevenue: 'Receita Bruta',
      deductions: 'Deduções',
      cmv: 'CMV',
      fixedExpenses: 'Despesas Fixas',
      inventory: 'Estoque',
    };

    const fe = parseFrontendImportRow(sampleRow, mapping);
    const be = extractAndValidateImportRow(sampleRow, mapping, 'Simples Nacional');

    if (fe.errors.length > 0 || !be.validation.valid) {
      throw new Error(`Erro inesperado em linha válida: FE=${fe.errors.join(',')} BE=${be.validation.errors.join(',')}`);
    }
    assertEqual(fe.financialData.grossRevenue, be.financialData.grossRevenue, 'grossRevenue parity');
    assertEqual(fe.financialData.deductions, be.financialData.deductions, 'deductions parity');
    assertEqual(fe.financialData.cmv, be.financialData.cmv, 'cmv parity');
    assertEqual(fe.financialData.fixedExpenses, be.financialData.fixedExpenses, 'fixedExpenses parity');
    assertEqual(fe.financialData.grossRevenue, '1250.5', 'normalized Decimal string');
  });

  // ============================================================================
  // 3. P0 — ESCUDO FISCAL POR REGIME TRIBUTÁRIO (3.3)
  // ============================================================================
  await test('3.3 Simples Nacional: no IRPJ/CSLL tax shield on financial expense shock (positive profit & loss)', () => {
    const dreProfit = calculateDRE({
      grossRevenue: 200000,
      deductions: 19000,
      cmv: 80000,
      variableExpenses: 10000,
      fixedExpenses: 50000,
      financialExpenses: 5000,
      taxRegime: 'Simples Nacional',
    });
    const simProfit = simulateScenario(dreProfit, {
      selicShockPercent: 2,
      debtExposureValue: 600000, // +12.000/yr = +1.000/mo interest
      taxRegime: 'Simples Nacional',
    });
    assertEqual(simProfit.simulatedTaxes, '0.00', 'Simples Nacional taxes');
    assertEqual(simProfit.estimatedTaxEffect, '0.00', 'Simples Nacional tax shield must be 0');
    assertEqual(simProfit.grossFinancialImpact, '-1000.00', 'Gross monthly interest impact');
    assertEqual(simProfit.netProfitDiff, '-1000.00', 'Net profit diff equals gross interest impact');
    assertEqual(simProfit.taxEffectStatus, 'NAO_APLICAVEL_SIMPLES', 'Simples taxEffectStatus');

    // Loss scenario in Simples Nacional
    const dreLoss = calculateDRE({
      grossRevenue: 100000,
      deductions: 9500,
      cmv: 60000,
      fixedExpenses: 50000,
      financialExpenses: 5000,
      taxRegime: 'Simples Nacional',
    });
    const simLoss = simulateScenario(dreLoss, {
      selicShockPercent: 2,
      debtExposureValue: 600000,
      taxRegime: 'Simples Nacional',
    });
    assertEqual(simLoss.estimatedTaxEffect, '0.00', 'Simples loss tax shield must be 0');
    assertEqual(simLoss.netProfitDiff, '-1000.00', 'Simples loss netProfitDiff');
  });

  await test('3.3 Lucro Presumido: no fictitious tax shield on LAIR when financial expenses increase (positive profit & loss)', () => {
    const drePresumido = calculateDRE({
      grossRevenue: 1500000,
      deductions: 180000,
      cmv: 620000,
      variableExpenses: 95000,
      fixedExpenses: 390000,
      depreciation: 28000,
      financialRevenues: 4500,
      financialExpenses: 21000,
      taxes: 24500,
      taxRegime: 'Lucro Presumido',
    });

    // Interest shock of +2 p.p. on R$ 1.100.000 = R$ 22.000/year = R$ 1.833,33/month
    const simPresumido = simulateScenario(drePresumido, {
      selicShockPercent: 2,
      debtExposureValue: 1100000,
      taxRegime: 'Lucro Presumido',
    });
    assertEqual(simPresumido.simulatedTaxes, '24500.00', 'Lucro Presumido taxes must NOT drop when interest rises');
    assertEqual(simPresumido.estimatedTaxEffect, '0.00', 'Lucro Presumido tax shield on interest must be 0');
    assertEqual(simPresumido.grossFinancialImpact, '-1833.33', 'Lucro Presumido gross interest impact');
    assertEqual(simPresumido.netProfitDiff, '-1833.33', 'Lucro Presumido netProfitDiff must equal gross interest impact');
    assertEqual(simPresumido.taxEffectStatus, 'NAO_APLICAVEL_PRESUMIDO', 'Lucro Presumido taxEffectStatus');

    // Loss scenario in Lucro Presumido
    const drePresumidoLoss = calculateDRE({
      grossRevenue: 500000,
      deductions: 60000,
      cmv: 300000,
      fixedExpenses: 250000,
      financialExpenses: 20000,
      taxes: 8000,
      taxRegime: 'Lucro Presumido',
    });
    const simPresumidoLoss = simulateScenario(drePresumidoLoss, {
      selicShockPercent: 2,
      debtExposureValue: 600000,
      taxRegime: 'Lucro Presumido',
    });
    assertEqual(simPresumidoLoss.simulatedTaxes, '8000.00', 'Lucro Presumido loss still pays presumed tax on revenue');
    assertEqual(simPresumidoLoss.estimatedTaxEffect, '0.00', 'Lucro Presumido loss tax shield is 0');
  });

  await test('3.3 Lucro Real: differentiates IRPJ 15%, Additional 10% (>20k/mo), CSLL 9%, and does not invent LALUR', () => {
    // 1. Statutory calculation below R$ 20k/month (no 10% additional -> 24% total, not 34%)
    const taxBelow20k = computeLucroRealStatutoryMonthlyTax(new Decimal(15000));
    assertEqual(taxBelow20k.irpjBasic.toFixed(2), '2250.00', 'IRPJ 15% on 15k');
    assertEqual(taxBelow20k.irpjAdditional.toFixed(2), '0.00', 'Additional IRPJ on 15k');
    assertEqual(taxBelow20k.csll.toFixed(2), '1350.00', 'CSLL 9% on 15k');
    assertEqual(taxBelow20k.totalTax.toFixed(2), '3600.00', 'Total tax on 15k (24%)');

    // 2. Statutory calculation above R$ 20k/month (50k -> 15% of 50k + 10% of 30k + 9% of 50k = 15.000)
    const taxAbove20k = computeLucroRealStatutoryMonthlyTax(new Decimal(50000));
    assertEqual(taxAbove20k.irpjBasic.toFixed(2), '7500.00', 'IRPJ 15% on 50k');
    assertEqual(taxAbove20k.irpjAdditional.toFixed(2), '3000.00', 'Additional IRPJ 10% on (50k - 20k)');
    assertEqual(taxAbove20k.csll.toFixed(2), '4500.00', 'CSLL 9% on 50k');
    assertEqual(taxAbove20k.totalTax.toFixed(2), '15000.00', 'Total tax on 50k');

    // 3. Without LALUR input: does not assume 34% shield, keeps gross impact and marks NAO_MODELADO_SEM_LALUR
    const dreReal = calculateDRE({
      grossRevenue: 1000000,
      deductions: 100000,
      cmv: 500000,
      fixedExpenses: 300000,
      depreciation: 20000,
      financialExpenses: 10000,
      taxes: 18400,
      taxRegime: 'Lucro Real',
    });
    const simWithoutLalur = simulateScenario(dreReal, {
      selicShockPercent: 2,
      debtExposureValue: 600000, // +1.000/month interest
      taxRegime: 'Lucro Real',
    });
    assertEqual(simWithoutLalur.taxEffectStatus, 'NAO_MODELADO_SEM_LALUR', 'Without LALUR must be NAO_MODELADO_SEM_LALUR');
    assertEqual(simWithoutLalur.grossFinancialImpact, '-1000.00', 'Gross impact preserved');
    assertEqual(simWithoutLalur.estimatedTaxEffect, '0.00', 'No invented tax effect without LALUR');

    // 4. With explicit LALUR taxable income (R$ 50.000/mo -> R$ 49.000/mo after +1.000 interest):
    const simWithLalur = simulateScenario(dreReal, {
      selicShockPercent: 2,
      debtExposureValue: 600000,
      taxRegime: 'Lucro Real',
      lalurTaxableIncome: 50000,
      allowLucroRealTaxShieldEstimate: true,
    });
    assertEqual(simWithLalur.taxEffectStatus, 'ESTIMADO_LALUR_ESTATUTARIO', 'With LALUR must be ESTIMADO_LALUR_ESTATUTARIO');
    assertEqual(simWithLalur.grossFinancialImpact, '-1000.00', 'Gross impact -1000');
    assertEqual(simWithLalur.estimatedTaxEffect, '340.00', 'Statutory marginal tax reduction on bracket >20k');
    assertEqual(simWithLalur.netFinancialImpact, '-660.00', 'Defensible net impact -660');

    // 5. Loss scenario in Lucro Real (LALUR = -10.000): zero tax shield
    const simRealLoss = simulateScenario(dreReal, {
      selicShockPercent: 2,
      debtExposureValue: 600000,
      taxRegime: 'Lucro Real',
      lalurTaxableIncome: -10000,
      allowLucroRealTaxShieldEstimate: true,
    });
    assertEqual(simRealLoss.estimatedTaxEffect, '0.00', 'Lucro Real in loss has 0 immediate tax shield');
  });

  // ============================================================================
  // 4. P2 — SIMULADOR FINANCEIRO & EXPOSIÇÃO DE DÍVIDAS (8)
  // ============================================================================
  await test('8. Simulator calculates exact R$ 1.100.000 floating exposure (+2 p.p. = R$ 22.000/yr, R$ 1.833,33/mo) and 0 when debt is 0', async () => {
    const vanguardaDebts = await getDebtFacilities('demo-company-1');
    const cdiSum = vanguardaDebts.filter(d => d.indexer === 'CDI').reduce((s, d) => s + d.outstandingBalance, 0);
    const selicSum = vanguardaDebts.filter(d => d.indexer === 'SELIC').reduce((s, d) => s + d.outstandingBalance, 0);
    const fixedSum = vanguardaDebts.filter(d => d.indexer === 'PRE_FIXADO').reduce((s, d) => s + d.outstandingBalance, 0);

    assertEqual(cdiSum, 750000, 'Comercial Vanguarda CDI debt');
    assertEqual(selicSum, 350000, 'Comercial Vanguarda Selic debt');
    assertEqual(fixedSum, 400000, 'Comercial Vanguarda Fixed debt');
    assertEqual(cdiSum + selicSum, 1100000, 'Total floating exposure (CDI + Selic)');

    const periods = await getCompanyPeriods('demo-company-1');
    const dre = calculateDRE({
      ...periods[0].versions[0].rawData,
      taxRegime: 'Lucro Presumido',
    });

    const sim = simulateInterestRateWithFacilities(dre, vanguardaDebts, 11.25, 13.25);
    assertEqual(sim.exposedFloatingDebt, '1100000.00', 'Exposed floating debt');
    assertEqual(sim.unaffectedFixedOrIpcaDebt, '400000.00', 'Unaffected fixed debt');
    assertEqual(sim.annualizedInterestImpact, '22000.00', 'Annualized interest impact for +2 p.p. on 1.1M');
    assertEqual(sim.grossFinancialImpact, '-1833.33', 'Monthly gross interest impact (-1833.33)');

    // Company with 0 floating debt must have 0 exposure (never 500.000!)
    const zeroDebtSim = simulateInterestRateWithFacilities(dre, [], 11.25, 13.25);
    assertEqual(zeroDebtSim.exposedFloatingDebt, '0.00', 'Zero debt company must have 0.00 exposure');
    assertEqual(zeroDebtSim.annualizedInterestImpact, '0.00', 'Zero debt company must have 0.00 interest impact');
  });

  // ============================================================================
  // 5. P1 — PERSISTÊNCIA, MODO EM MEMÓRIA E FALHA DE ESCRITA (4.1)
  // ============================================================================
  await test('4.1 Persistence explicitly distinguishes MEMORY_DEMO from POSTGRESQL and blocks silent fallback on write failure', async () => {
    const initialState = getPersistenceState();
    assertEqual(initialState.mode, 'MEMORY_DEMO', 'Default test runtime mode');

    // Create and read company in MEMORY_DEMO
    const createdComp = await createCompany({
      name: 'Metalúrgica Teste Persistência Ltda',
      cnpj: '11.222.333/0001-44',
      industry: 'Indústria',
      taxRegime: 'Lucro Real',
    });
    assertEqual(createdComp.persistenceMode, 'MEMORY_DEMO', 'Company persistenceMode tag');
    assertEqual(createdComp.isPersisted, false, 'Company isPersisted tag in memory mode');

    const fetchedComp = await getCompanyById(createdComp.id);
    if (!fetchedComp || fetchedComp.name !== 'Metalúrgica Teste Persistência Ltda') {
      throw new Error('Falha ao ler empresa recém-criada');
    }

    // Create and read financial period + test duplicate detection
    const savedPer1 = await saveFinancialPeriodVersion({
      companyId: createdComp.id,
      year: 2026,
      month: 11,
      periodType: 'MONTHLY',
      financialData: {
        grossRevenue: '500000.00',
        deductions: '50000.00',
        cmv: '200000.00',
        fixedExpenses: '120000.00',
        taxRegime: 'Lucro Real',
      },
      changeReason: 'Carga inicial de teste',
    });
    assertEqual(savedPer1.versionNumber, 1, 'First version number');
    assertEqual(savedPer1.isPersisted, false, 'Period version isPersisted=false in memory mode');

    // Duplicate import detection
    const dupRes = await saveFinancialPeriodVersion({
      companyId: createdComp.id,
      year: 2026,
      month: 11,
      periodType: 'MONTHLY',
      financialData: {
        grossRevenue: '500000.00',
        deductions: '50000.00',
        cmv: '200000.00',
        fixedExpenses: '120000.00',
        taxRegime: 'Lucro Real',
      },
      changeReason: 'Carga duplicada',
    });
    assertEqual(dupRes.duplicateDetected, true, 'Duplicate import should be detected without creating v2');
    assertEqual(dupRes.versionNumber, 1, 'Version number stays 1 on duplicate');

    // Simulate POSTGRESQL mode with write failure: must throw and NEVER fall back to memory!
    setPersistenceStateForTesting({ mode: 'POSTGRESQL', isConnected: false, lastWriteError: null });
    let writeFailedAsExpected = false;
    try {
      await createCompany({
        name: 'Empresa Que Não Deve Cair Em Memória',
        taxRegime: 'Simples Nacional',
      });
    } catch (err: any) {
      writeFailedAsExpected = true;
      if (!err.message.includes('Falha de persistência no PostgreSQL')) {
        throw new Error(`Mensagem de erro inesperada: ${err.message}`);
      }
    } finally {
      setPersistenceStateForTesting({ mode: 'MEMORY_DEMO', isConnected: false, lastWriteError: null });
    }
    if (!writeFailedAsExpected) {
      throw new Error('Escrita com falha no modo POSTGRESQL não lançou erro!');
    }
    const allComps = await listCompanies();
    if (allComps.some(c => c.name === 'Empresa Que Não Deve Cair Em Memória')) {
      throw new Error('CRÍTICO: Empresa gravada silenciosamente em memória após falha do PostgreSQL!');
    }
  });

  // ============================================================================
  // 6. P1 — INTEGRIDADE POR EMPRESA, ROTAS HTTP E SESSÃO COMPLETA (ETAPA 2)
  // ============================================================================
  await test('4.2 HTTP Routes enforce server-side DRE recalculation, X-Company-Context isolation, HttpOnly session cookie, CSRF, expiration, logout & rate limiting', async () => {
    const prevSessionSecret = process.env.SESSION_SECRET;
    const prevAdminPassword = process.env.APP_ADMIN_PASSWORD;
    delete process.env.SESSION_SECRET;
    delete process.env.APP_ADMIN_PASSWORD;
    resetAuthStateForTesting();

    const app = await createConfiguredApp();
    const server = app.listen(0);
    const address = server.address() as any;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1. Diagnostic recalculates DRE on server, ignoring spoofed client DRE
      const diagRes = await fetch(`${baseUrl}/api/companies/demo-company-1/diagnostic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': 'demo-company-1',
        },
        body: JSON.stringify({
          dre: { netRevenue: '999999999.99', netProfit: '888888888.88' },
        }),
      });
      const diagData = (await diagRes.json()) as any;
      if (!diagRes.ok) throw new Error(`Diagnostic route failed: ${diagData.error}`);
      if (diagData.authoritativeDre?.netRevenue === '999999999.99') {
        throw new Error('Vulnerabilidade: rota /diagnostic confiou no DRE falso enviado pelo cliente!');
      }
      assertEqual(diagData.authoritativeDre?.netRevenue, '1300000.00', 'Server recalculated netRevenue for demo-company-1');

      // 2. Cross-company isolation via X-Company-Context
      const crossRes = await fetch(`${baseUrl}/api/companies/demo-company-2/context`, {
        headers: { 'X-Company-Context': 'demo-company-1' },
      });
      assertEqual(crossRes.status, 403, 'Cross-company request with mismatched X-Company-Context must return 403');

      // 3. /api/agent/logs requires companyId
      const logsNoComp = await fetch(`${baseUrl}/api/agent/logs`);
      assertEqual(logsNoComp.status, 400, '/api/agent/logs without companyId must return 400');

      // 4. Full Security Suite when SESSION_SECRET & APP_ADMIN_PASSWORD are active
      process.env.SESSION_SECRET = 'test_session_secret_with_at_least_32_chars_long';
      process.env.APP_ADMIN_PASSWORD = 'correct_admin_password';
      resetAuthStateForTesting();

      // 4a. Private GET and POST routes blocked without session (even if X-Company-Context is sent!)
      const unauthGet = await fetch(`${baseUrl}/api/companies`, {
        headers: { 'X-Company-Context': 'demo-company-1' },
      });
      assertEqual(unauthGet.status, 401, 'Private GET /api/companies without session must return 401');

      const unauthContext = await fetch(`${baseUrl}/api/companies/demo-company-1/context`, {
        headers: { 'X-Company-Context': 'demo-company-1' },
      });
      assertEqual(unauthContext.status, 401, 'X-Company-Context alone must NEVER grant access without valid session (401)');

      const unauthPost = await fetch(`${baseUrl}/api/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bloqueada Sem Sessão' }),
      });
      assertEqual(unauthPost.status, 401, 'Mutating route must return 401 when session auth is enforced and no cookie is sent');

      // 4b. Invalid login returns 401
      const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong_password_123' }),
      });
      assertEqual(badLogin.status, 401, 'Login with invalid password must return 401');

      // 4c. Valid login returns 200, HttpOnly + SameSite=Strict cookie, and csrfToken
      resetAuthStateForTesting();
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'correct_admin_password' }),
      });
      assertEqual(loginRes.status, 200, 'Login with valid password must succeed');
      const loginData = (await loginRes.json()) as any;
      const setCookie = loginRes.headers.get('set-cookie') || '';
      if (!setCookie.includes('afi_session=') || !setCookie.includes('HttpOnly') || !setCookie.includes('SameSite=Strict')) {
        throw new Error(`Cookie HttpOnly/SameSite=Strict ausente no login: ${setCookie}`);
      }
      if (!loginData.csrfToken) {
        throw new Error('csrfToken ausente na resposta de login');
      }
      const cookiePair = setCookie.split(';')[0];

      // 4d. Authenticated GET succeeds
      const authGet = await fetch(`${baseUrl}/api/companies`, {
        headers: { Cookie: cookiePair },
      });
      assertEqual(authGet.status, 200, 'Private GET /api/companies with valid session cookie must return 200');

      // 4e. Mutating POST with session cookie but WITHOUT X-CSRF-Token returns 403
      const postNoCsrf = await fetch(`${baseUrl}/api/companies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookiePair,
        },
        body: JSON.stringify({ name: 'Sem Token CSRF', taxRegime: 'Simples Nacional' }),
      });
      assertEqual(postNoCsrf.status, 403, 'Mutating route without X-CSRF-Token must return 403');

      // 4f. Mutating POST with session cookie AND valid X-CSRF-Token returns 201
      const authPost = await fetch(`${baseUrl}/api/companies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookiePair,
          'X-CSRF-Token': loginData.csrfToken,
        },
        body: JSON.stringify({ name: 'Autorizada Com Sessão HttpOnly + CSRF', taxRegime: 'Simples Nacional' }),
      });
      assertEqual(authPost.status, 201, 'Mutating route with valid HttpOnly session cookie + X-CSRF-Token must return 201');

      // 4g. Expired session token returns 401
      const expiredToken = createSessionToken(process.env.SESSION_SECRET, -1000);
      const expiredRes = await fetch(`${baseUrl}/api/companies`, {
        headers: { Cookie: `afi_session=${encodeURIComponent(expiredToken)}` },
      });
      assertEqual(expiredRes.status, 401, 'Expired session token must return 401');

      // 4h. Logout revokes session server-side so old cookie is immediately rejected
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookiePair, 'X-CSRF-Token': loginData.csrfToken },
      });
      assertEqual(logoutRes.status, 200, 'Logout must return 200');

      const afterLogoutGet = await fetch(`${baseUrl}/api/companies`, {
        headers: { Cookie: cookiePair },
      });
      assertEqual(afterLogoutGet.status, 401, 'Revoked session cookie after logout must return 401');

      // 4i. Rate limiting on login (5 failed attempts -> 6th returns 429)
      resetAuthStateForTesting();
      for (let i = 0; i < 5; i++) {
        const r = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: `wrong_pass_${i}` }),
        });
        assertEqual(r.status, 401, `Failed login attempt #${i + 1}`);
      }
      const rateLimitedRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'correct_admin_password' }),
      });
      assertEqual(rateLimitedRes.status, 429, '6th login attempt after 5 failures must return 429 Too Many Requests');
    } finally {
      resetAuthStateForTesting();
      if (prevSessionSecret === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prevSessionSecret;
      if (prevAdminPassword === undefined) delete process.env.APP_ADMIN_PASSWORD;
      else process.env.APP_ADMIN_PASSWORD = prevAdminPassword;
      server.close();
    }
  });

  // ============================================================================
  // 7. P1 — INTEGRAÇÃO N8N WEBHOOK & HEADER AUTH (5)
  // ============================================================================
  await test('5. n8n Webhook sends X-N8N-Webhook-Secret header, handles 200/500/timeout, and records AutomationJobRun without exposing secret', async () => {
    const prevUrl = process.env.N8N_WEBHOOK_URL;
    const prevSecret = process.env.N8N_WEBHOOK_SECRET;
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example.internal/webhook/financial-intelligence';
    process.env.N8N_WEBHOOK_SECRET = 'super_secret_n8n_header_token_123';
    resetWebhookTestStateForTesting();

    try {
      // Status before real execution must have tested=false
      const statusBefore = getWebhookStatus();
      assertEqual(statusBefore.configured, true, 'Webhook configured');
      assertEqual(statusBefore.secretConfigured, true, 'Secret configured');
      assertEqual(statusBefore.tested, false, 'Webhook must NOT be marked tested before execution');

      // 1. Successful HTTP 200 delivery + Header verification
      let capturedHeaders: Record<string, string> = {};
      const res200 = await dispatchWebhookEvent(
        'test.event',
        { companyId: 'demo-company-1', reportId: 'rep-1' },
        {
          companyId: 'demo-company-1',
          fetchImpl: async (_url, init: any) => {
            capturedHeaders = init.headers;
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
          },
        }
      );
      assertEqual(res200.dispatched, true, '200 dispatch');
      assertEqual(res200.status, 'DELIVERED', '200 status');
      assertEqual(capturedHeaders['X-N8N-Webhook-Secret'], 'super_secret_n8n_header_token_123', 'X-N8N-Webhook-Secret header value');
      if (JSON.stringify(res200).includes('super_secret_n8n_header_token_123')) {
        throw new Error('Segredo do webhook vazou no retorno de dispatchWebhookEvent!');
      }

      // 2. HTTP 500 error handling
      const res500 = await dispatchWebhookEvent(
        'test.fail',
        { companyId: 'demo-company-1' },
        {
          companyId: 'demo-company-1',
          fetchImpl: async () => new Response('Internal Server Error', { status: 500 }),
        }
      );
      assertEqual(res500.dispatched, false, '500 dispatched=false');
      assertEqual(res500.status, 'HTTP_500', '500 status');

      // 3. Timeout handling
      const resTimeout = await dispatchWebhookEvent(
        'test.timeout',
        { companyId: 'demo-company-1' },
        {
          companyId: 'demo-company-1',
          timeoutMs: 20,
          fetchImpl: async () => {
            const err: any = new Error('The operation was aborted due to timeout');
            err.name = 'TimeoutError';
            throw err;
          },
        }
      );
      assertEqual(resTimeout.dispatched, false, 'Timeout dispatched=false');
      assertEqual(resTimeout.status, 'TIMEOUT', 'Timeout status');

      const runs = await listAutomationRuns('demo-company-1', 10);
      if (!runs.some(r => r.workflowType === 'N8N_WEBHOOK_DISPATCH')) {
        throw new Error('Execução de webhook não foi registrada em AutomationJobRun');
      }
    } finally {
      if (prevUrl === undefined) delete process.env.N8N_WEBHOOK_URL;
      else process.env.N8N_WEBHOOK_URL = prevUrl;
      if (prevSecret === undefined) delete process.env.N8N_WEBHOOK_SECRET;
      else process.env.N8N_WEBHOOK_SECRET = prevSecret;
      resetWebhookTestStateForTesting();
    }
  });

  // ============================================================================
  // 8. P1 — GEMINI FUNCTION CALLING COM CLIENTE MOCKADO (6)
  // ============================================================================
  await test('6. Gemini Function Calling: single tool call, sequential multi-tool calls, iteration limit, and 429/timeout handling', async () => {
    clearGeminiCooldownsForTesting();

    // Case A: Single tool call (get_dre -> final synthesis)
    let callCountA = 0;
    const mockSingleToolClient = {
      models: {
        generateContent: async () => {
          callCountA++;
          if (callCountA === 1) {
            return {
              functionCalls: [{ id: 'fc-1', name: 'get_dre', args: { year: 2026, month: 10 } }],
              candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_dre', args: { year: 2026, month: 10 } } }] } }],
              usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25 },
            };
          }
          return {
            text: 'Fatos Observados: A DRE de 10/2026 da Comercial Vanguarda apresenta Receita Líquida de R$ 1.300.000,00.',
            usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 40 },
          };
        },
      },
    };

    const resSingle = await runFinancialAgent({
      companyId: 'demo-company-1',
      question: 'Qual a receita líquida na DRE de outubro de 2026?',
      aiClientOverride: mockSingleToolClient,
    });
    assertEqual(resSingle.provider, 'GEMINI', 'Single tool provider');
    assertEqual(resSingle.toolsCalled.length, 1, 'Single tool call count');
    assertEqual(resSingle.toolsCalled[0].toolName, 'get_dre', 'Single tool name');

    // Case B: Sequential multi-tool calls (get_company_profile -> get_debt_exposure -> simulate_interest_rate_scenario)
    let callCountB = 0;
    const mockMultiToolClient = {
      models: {
        generateContent: async () => {
          callCountB++;
          if (callCountB === 1) {
            return {
              functionCalls: [
                { id: 'fc-b1', name: 'get_company_profile', args: {} },
                { id: 'fc-b2', name: 'get_debt_exposure', args: {} },
              ],
            };
          }
          if (callCountB === 2) {
            return {
              functionCalls: [
                { id: 'fc-b3', name: 'simulate_interest_rate_scenario', args: { currentSelicPct: 11.25, targetSelicPct: 13.25 } },
              ],
            };
          }
          return {
            text: 'Síntese multi-ferramenta concluída com impacto anual de R$ 22.000,00.',
          };
        },
      },
    };

    const resMulti = await runFinancialAgent({
      companyId: 'demo-company-1',
      question: 'Analise o perfil, a exposição de dívidas e simule alta de 2 p.p. na Selic.',
      aiClientOverride: mockMultiToolClient,
    });
    assertEqual(resMulti.provider, 'GEMINI', 'Multi-tool provider');
    assertEqual(resMulti.toolsCalled.length, 3, 'Sequential multi-tool count');

    // Case C: Iteration limit reached (maxIterationsOverride = 2)
    let callCountC = 0;
    const mockLoopClient = {
      models: {
        generateContent: async () => {
          callCountC++;
          if (callCountC <= 2) {
            return {
              functionCalls: [{ id: `fc-loop-${callCountC}`, name: 'get_macro_indicators', args: {} }],
            };
          }
          return {
            text: 'Síntese consolidada após atingir limite de iterações.',
          };
        },
      },
    };
    const resIterLimit = await runFinancialAgent({
      companyId: 'demo-company-1',
      question: 'Teste de limite de iterações.',
      aiClientOverride: mockLoopClient,
      maxIterationsOverride: 2,
    });
    assertEqual(resIterLimit.provider, 'GEMINI', 'Iteration limit still consolidates final turn');
    if (!resIterLimit.answer.includes('Síntese consolidada')) {
      throw new Error('Iteration limit final turn was not invoked');
    }

    // Case D: 429 Quota Error & Timeout fallback
    const mock429Client = {
      models: {
        generateContent: async () => {
          const err: any = new Error('429 RESOURCE_EXHAUSTED: Quota exceeded');
          err.status = 429;
          throw err;
        },
      },
    };
    const res429 = await runFinancialAgent({
      companyId: 'demo-company-1',
      question: 'Como está minha empresa?',
      aiClientOverride: mock429Client,
    });
    assertEqual(res429.provider, 'LOCAL_FALLBACK', '429 falls back cleanly to LOCAL_FALLBACK');
    clearGeminiCooldownsForTesting();
  });

  // ============================================================================
  // 9. P1 — DADOS MACROECONÔMICOS & PARSER BCB/SGS (7)
  // ============================================================================
  await test('7. macroService parses BCB SGS JSON accurately and preserves null publicationDate for LIVE_API', async () => {
    // 1. Catalog completeness check for all 6 required series
    const requiredSeriesIds = [432, 4389, 1, 13522, 433, 1455];
    for (const sId of requiredSeriesIds) {
      if (!SERIES_CATALOG.some(s => s.bcbSgsId === sId)) {
        throw new Error(`Série BCB/SGS ${sId} ausente do catálogo`);
      }
    }

    // 2. Unit test parseBcbSgsResponse
    const parsedSgs = parseBcbSgsResponse([
      { data: '01/10/2026', valor: '11.25' },
      { data: '05/11/2026', valor: '11,50' },
    ]);
    if (!parsedSgs || parsedSgs.length !== 2 || parsedSgs[1].referenceDate !== '2026-11-05' || parsedSgs[1].value !== 11.5) {
      throw new Error(`Falha no parse de resposta SGS: ${JSON.stringify(parsedSgs)}`);
    }

    // 3. Mock live sync: verify LIVE_API sets publicationDate = null (never fetchedAt!)
    const syncRes = await fetchAndSyncMacroData({
      fetchImpl: async () =>
        new Response(JSON.stringify([{ data: '05/11/2026', valor: '11.25' }]), { status: 200 }),
    });
    assertEqual(syncRes.success, true, 'Mock macro sync success');
    assertEqual(syncRes.liveSeriesCount, 6, 'All 6 series synced from mock live API');

    const latestLive = await getLatestMacroIndicators();
    const selicLive = latestLive.find(m => m.code === 'SELIC');
    if (!selicLive) throw new Error('SELIC not found');
    assertEqual(selicLive.syncSource, 'LIVE_API', 'SELIC syncSource is LIVE_API');
    assertEqual(selicLive.publicationDate, null, 'LIVE_API publicationDate must be null, never fetchedAt');

    // Restore local reference cache after test
    resetMemoryMacroToLocalReference();
    const latestRef = await getLatestMacroIndicators();
    const selicRef = latestRef.find(m => m.code === 'SELIC');
    assertEqual(selicRef?.syncSource, 'LOCAL_REFERENCE', 'Restored LOCAL_REFERENCE syncSource');
  });

  // ============================================================================
  // 10. P2 — EXECUÇÃO DIRETA DAS 26 FERRAMENTAS DO AGENTE & VALIDAÇÕES (9)
  // ============================================================================
  await test('9. All 26 Agent Tools execute directly, respect year/month, reject non-existent periods, and validate enums', async () => {
    assertEqual(AGENT_FUNCTION_DECLARATIONS.length, 26, 'Total registered agent tools');

    const ctx = { authorizedCompanyId: 'demo-company-1' };
    const toolArgsMap: Record<string, any> = {
      get_company_profile: {},
      get_financial_context: { year: 2026, month: 10 },
      get_dre: { year: 2026, month: 10 },
      get_financial_indicators: { year: 2026, month: 10 },
      get_cash_flow_context: { year: 2026, month: 10 },
      get_debt_exposure: { year: 2026, month: 10 },
      get_financial_history: { limit: 6 },
      compare_financial_periods: { baseYear: 2026, baseMonth: 9, targetYear: 2026, targetMonth: 10 },
      get_macro_indicators: {},
      get_macro_history: { code: 'SELIC', limit: 4 },
      get_macro_publication_metadata: { code: 'CDI' },
      compare_macro_periods: { code: 'IPCA', periodsBack: 3 },
      simulate_interest_rate_scenario: { targetSelicPct: 13.25, currentSelicPct: 11.25, year: 2026, month: 10 },
      simulate_revenue_scenario: { revenueChangePercent: -10, driver: 'VOLUME', year: 2026, month: 10 },
      simulate_price_scenario: { priceChangePercent: 5, year: 2026, month: 10 },
      simulate_demand_scenario: { demandChangePercent: -10, year: 2026, month: 10 },
      simulate_combined_scenario: { priceChangePercent: 2, demandChangePercent: -5, selicShockPercent: 1, year: 2026, month: 10 },
      generate_financial_diagnostic: { year: 2026, month: 10 },
      generate_executive_report: { year: 2026, month: 10 },
      identify_financial_risks: { year: 2026, month: 10 },
      prioritize_management_actions: { year: 2026, month: 10 },
      validate_financial_data: { year: 2026, month: 10 },
      identify_missing_information: { year: 2026, month: 10 },
      explain_calculation: { metric: 'ebitda', year: 2026, month: 10 },
      compare_data_versions: { year: 2026, month: 10 },
      query_operational_memory: { memoryType: 'DECISION' },
    };

    for (const decl of AGENT_FUNCTION_DECLARATIONS) {
      const name = decl.name!;
      const env = await executeAgentTool(name, toolArgsMap[name] || {}, ctx);
      if (!env.ok) {
        throw new Error(`Ferramenta "${name}" falhou na execução direta: ${env.error}`);
      }
    }

    // Verify year/month parameter is honored (09/2026 vs 10/2026)
    const dreSep = await executeAgentTool('get_dre', { year: 2026, month: 9 }, ctx);
    const dreOct = await executeAgentTool('get_dre', { year: 2026, month: 10 }, ctx);
    if (dreSep.data?.dre?.grossRevenue === dreOct.data?.dre?.grossRevenue) {
      throw new Error('get_dre ignorou os parâmetros year/month (09/2026 == 10/2026)');
    }

    // Verify non-existent period is rejected (never silently returns periods[0])
    const nonExistentPeriod = await executeAgentTool('get_dre', { year: 2022, month: 5 }, ctx);
    if (nonExistentPeriod.ok) {
      throw new Error('Período inexistente (05/2022) deveria falhar, mas retornou sucesso silenciosamente');
    }

    // Verify unknown metric in explain_calculation is rejected (never falls back to contributionMargin)
    const unknownMetric = await executeAgentTool('explain_calculation', { metric: 'metrica_inexistente' }, ctx);
    if (unknownMetric.ok) {
      throw new Error('explain_calculation com métrica desconhecida deveria falhar, mas retornou sucesso');
    }

    // Verify invalid enum values for code, driver, and memoryType are rejected
    const badCode = await executeAgentTool('get_macro_history', { code: 'INVALID_MACRO' }, ctx);
    if (badCode.ok) throw new Error('get_macro_history aceitou code inválido');

    const badDriver = await executeAgentTool('simulate_revenue_scenario', { revenueChangePercent: 10, driver: 'INVALID_DRIVER' }, ctx);
    if (badDriver.ok) throw new Error('simulate_revenue_scenario aceitou driver inválido');

    const badMemType = await executeAgentTool('query_operational_memory', { memoryType: 'INVALID_TYPE' }, ctx);
    if (badMemType.ok) throw new Error('query_operational_memory aceitou memoryType inválido');
  });

  // ============================================================================
  // 11. AUTOMAÇÃO PONTA A PONTA, MEMÓRIA E SUITE DE AVALIAÇÃO (10, 12)
  // ============================================================================
  await test('10. runAutomatedImportPipeline executes CSV -> DRE -> Version -> Executive Report without unsolicited webhook dispatch', async () => {
    const csv = Buffer.from(
      'Receita Bruta,Deduções,CMV,Despesas Variáveis,Despesas Fixas,Estoque,Contas a Receber,Contas a Pagar\n210000,19950,90000,16000,53000,110000,40000,45000',
      'utf-8'
    );
    const res = await runAutomatedImportPipeline({
      companyId: 'demo-company-2',
      fileBuffer: csv,
      fileName: 'teste_horizonte_dez.csv',
      year: 2026,
      month: 12,
    });
    if (res.needsCorrection || res.run.status !== 'COMPLETED') {
      throw new Error(`Expected COMPLETED automation run, got ${res.run.status}`);
    }
    assertEqual(res.webhookResult?.status, 'SKIPPED_BY_DEFAULT', 'Webhook skipped by default unless authorized');
  });

  await test('12. Operational memory CRUD & 11-Case Agent Evaluation Benchmark Suite pass 100%', async () => {
    const created = await createOperationalMemory({
      companyId: 'demo-company-1',
      memoryType: 'DECISION',
      title: 'Teste Memória',
      summary: 'Registro de teste automatizado.',
      createdBy: 'testRunner',
    });
    const listed = await listOperationalMemory('demo-company-1');
    if (!listed.some(m => m.id === created.id)) throw new Error('Created memory not found');
    const deleted = await deleteOperationalMemory('demo-company-1', created.id);
    if (!deleted) throw new Error('Failed to delete created memory');

    const evalRun = await runAgentEvaluationSuite('demo-company-1');
    if (evalRun.passedCases !== evalRun.totalCases) {
      const failed = evalRun.results
        .filter((r: any) => !r.passed)
        .map((r: any) => `${r.id}: ${JSON.stringify(r.checks)}`);
      throw new Error(`Evaluation failed ${evalRun.totalCases - evalRun.passedCases} case(s): ${failed.join(' | ')}`);
    }
  });

  // ============================================================================
  // 12. VALIDAÇÃO DE URL JDBC/POSTGRESQL & PERSISTÊNCIA REAL NEON (13)
  // ============================================================================
  await test('13. normalizePostgresUrl converts Neon JDBC URLs to standard postgresql:// and scrubs secrets', () => {
    const sampleJdbc =
      'jdbc:postgresql://ep-sample-pooler.us-east-1.aws.neon.tech/neondb?user=test_user&password=test_secret_123&sslmode=require&channelBinding=require';
    const normalized = normalizePostgresUrl(sampleJdbc);
    if (!normalized.startsWith('postgresql://test_user:test_secret_123@')) {
      throw new Error('Falha ao normalizar credenciais de query-string do JDBC para authority URI');
    }
    if (normalized.includes('user=') || normalized.includes('password=') || normalized.includes('channelBinding=')) {
      throw new Error('Parâmetros JDBC legados permaneceram na query string após normalização');
    }
    if (!normalized.includes('channel_binding=require')) {
      throw new Error('channelBinding não foi convertido para channel_binding');
    }
    assertEqual(isValidPostgresUrl(sampleJdbc), true, 'isValidPostgresUrl must accept valid Neon JDBC URL');

    const scrubbed = sanitizeDatabaseErrorMessage(`Connection failed for ${sampleJdbc}`);
    if (
      scrubbed.includes('test_secret_123') ||
      scrubbed.includes('test_user') ||
      scrubbed.includes('neon.tech')
    ) {
      throw new Error(`Segredo ou host Neon vazou na sanitização: ${scrubbed}`);
    }
  });

  if (realPrismaClient && initialRuntimeState.mode === 'POSTGRESQL') {
    await test('14. Real Neon PostgreSQL Controlled Persistence & Full Integration Verification (zero data loss)', async () => {
      // Restore real PostgreSQL persistence state
      setPersistenceStateForTesting({
        mode: 'POSTGRESQL',
        client: realPrismaClient,
        isConnected: true,
        lastWriteError: null,
      });

      const schemaMode = await inspectDatabaseSchemaCompatibility();
      if (schemaMode !== 'LEGACY_COMPATIBLE_NEON' && schemaMode !== 'FULL_PRISMA_SCHEMA') {
        throw new Error(`SchemaMode inesperado no PostgreSQL: ${schemaMode}`);
      }

      // 1. Snapshot pre-existing row counts in Neon PostgreSQL before test
      const beforeCounts = (await realPrismaClient.$queryRaw`
        SELECT
          (SELECT COUNT(*)::int FROM "Company") as companies,
          (SELECT COUNT(*)::int FROM "FinancialPeriod") as periods,
          (SELECT COUNT(*)::int FROM "FinancialPeriodVersion") as versions,
          (SELECT COUNT(*)::int FROM "MacroIndicator") as macro_indicators,
          (SELECT COUNT(*)::int FROM "MacroObservation") as macro_observations,
          (SELECT COUNT(*)::int FROM "MacroSyncLog") as macro_sync_logs
      `) as Array<any>;
      const pre = beforeCounts[0];

      let testCompanyId: string | null = null;
      try {
        // 2. Create controlled test company in PostgreSQL
        const testCnpj = `99.${Math.floor(100 + Math.random() * 899)}.${Math.floor(100 + Math.random() * 899)}/0001-99`;
        const createdCompany = await createCompany({
          name: 'Empresa Teste Controlado Validação Neon [TESTE_PERSISTENCIA_REAL]',
          cnpj: testCnpj,
          industry: 'Varejo de Vestuário',
          taxRegime: 'Lucro Presumido',
          monthlyRevenueTier: 'R$ 500k - 1M/mês',
        });
        testCompanyId = createdCompany.id;

        assertEqual(createdCompany.persistenceMode, 'POSTGRESQL', 'Company persistenceMode must be POSTGRESQL');
        assertEqual(createdCompany.isPersisted, true, 'Company isPersisted must be true');

        // 3. Query back via Prisma (getCompanyById and raw SQL check)
        const fetchedCompany = await getCompanyById(testCompanyId);
        if (!fetchedCompany || fetchedCompany.id !== testCompanyId) {
          throw new Error('Empresa de teste não foi encontrada no PostgreSQL via getCompanyById');
        }
        assertEqual(fetchedCompany.persistenceMode, 'POSTGRESQL', 'Fetched company persistenceMode');
        assertEqual(fetchedCompany.isPersisted, true, 'Fetched company isPersisted');

        // 4. Persist financial period & version (import + DRE + indicators)
        const savedPeriod = await saveFinancialPeriodVersion({
          companyId: testCompanyId,
          year: 2026,
          month: 11,
          periodType: 'MONTHLY',
          financialData: {
            grossRevenue: '850000.00',
            deductions: '85000.00',
            cmv: '340000.00',
            variableExpenses: '55000.00',
            fixedExpenses: '210000.00',
            depreciation: '15000.00',
            financialRevenues: '4000.00',
            financialExpenses: '14000.00',
            taxes: '18500.00',
            taxRegime: 'Lucro Presumido',
            cashAndEquivalents: '160000.00',
            accountsReceivable: '220000.00',
            inventory: '310000.00',
            accountsPayable: '180000.00',
            currentAssets: '690000.00',
            currentLiabilities: '410000.00',
            totalAssets: '1650000.00',
            totalDebt: '600000.00',
            equity: '1050000.00',
          },
          changeReason: 'Teste controlado de persistência no PostgreSQL Neon',
        });
        assertEqual(savedPeriod.persistenceMode, 'POSTGRESQL', 'Saved period persistenceMode');
        assertEqual(savedPeriod.isPersisted, true, 'Saved period isPersisted');
        assertEqual(savedPeriod.dre.netRevenue, '765000.00', 'Calculated DRE netRevenue persisted');

        const periods = await getCompanyPeriods(testCompanyId);
        assertEqual(periods.length, 1, 'Company periods count in PostgreSQL');
        assertEqual(periods[0].versions.length, 1, 'Period version count in PostgreSQL');
        assertEqual(periods[0].versions[0].netRevenue, 765000, 'Retrieved period netRevenue from PostgreSQL');

        // 5. Persist & retrieve Debt Facility in PostgreSQL
        const savedDebt = await addDebtFacility(testCompanyId, {
          name: 'Capital de Giro Teste Controlado',
          lender: 'Banco Teste',
          principal: 400000,
          outstandingBalance: 350000,
          indexer: 'CDI',
          spreadAnnualPct: 3.8,
          monthlyPayment: 14500,
          maturityDate: '2028-01-15',
          notes: 'Contrato de teste controlado',
        });
        assertEqual(savedDebt.persistenceMode, 'POSTGRESQL', 'Saved debt persistenceMode');
        assertEqual(savedDebt.isPersisted, true, 'Saved debt isPersisted');
        const debts = await getDebtFacilities(testCompanyId);
        assertEqual(debts.length, 1, 'Retrieved debt facilities count');

        // 6. Persist & retrieve Analysis Report in PostgreSQL
        const savedReport = await saveAnalysisReport({
          companyId: testCompanyId,
          reportType: 'EXECUTIVE_REPORT',
          provider: 'LOCAL_FALLBACK',
          response: JSON.stringify({ summary: 'Relatório executivo de teste controlado persistido no Neon PostgreSQL' }),
          metadata: { periodRef: '11/2026', controlledTest: true },
        });
        assertEqual(savedReport.persistenceMode, 'POSTGRESQL', 'Saved report persistenceMode');
        assertEqual(savedReport.isPersisted, true, 'Saved report isPersisted');
        const reports = await listAnalysisReports(testCompanyId);
        assertEqual(reports.length, 1, 'Retrieved analysis reports count from PostgreSQL');

        // 7. Persist & retrieve Financial Scenario in Operational Memory in PostgreSQL
        const savedScenario = await createOperationalMemory({
          companyId: testCompanyId,
          memoryType: 'SCENARIO',
          title: 'Cenário Teste Controlado (+2 p.p. Selic)',
          summary: 'Simulação de teste controlado gravada no PostgreSQL Neon.',
          structuredData: { selicShockPercent: 2, exposedDebt: 350000 },
          periodRef: '11/2026 (v1)',
          dataVersionRef: 'v1',
          createdBy: 'Verificador Técnico',
        });
        assertEqual(savedScenario.persistenceMode, 'POSTGRESQL', 'Saved scenario persistenceMode');
        assertEqual(savedScenario.isPersisted, true, 'Saved scenario isPersisted');
        const scenarios = await listOperationalMemory(testCompanyId, 'SCENARIO');
        assertEqual(scenarios.length, 1, 'Retrieved scenario count from PostgreSQL');
      } finally {
        // 8. Safely delete ONLY the controlled test company (cascades to test period & version)
        if (testCompanyId) {
          const deleted = await deleteCompanyById(testCompanyId);
          assertEqual(deleted, true, 'Controlled test company deleted cleanly');
          const afterDelete = await getCompanyById(testCompanyId);
          assertEqual(afterDelete, null, 'Controlled test company no longer exists after deletion');
        }
      }

      // 9. Verify pre-existing row counts in Neon PostgreSQL were NOT altered
      const afterCounts = (await realPrismaClient.$queryRaw`
        SELECT
          (SELECT COUNT(*)::int FROM "Company") as companies,
          (SELECT COUNT(*)::int FROM "FinancialPeriod") as periods,
          (SELECT COUNT(*)::int FROM "FinancialPeriodVersion") as versions,
          (SELECT COUNT(*)::int FROM "MacroIndicator") as macro_indicators,
          (SELECT COUNT(*)::int FROM "MacroObservation") as macro_observations,
          (SELECT COUNT(*)::int FROM "MacroSyncLog") as macro_sync_logs
      `) as Array<any>;
      const post = afterCounts[0];

      assertEqual(post.companies, pre.companies, 'Pre-existing Company count unchanged');
      assertEqual(post.periods, pre.periods, 'Pre-existing FinancialPeriod count unchanged');
      assertEqual(post.versions, pre.versions, 'Pre-existing FinancialPeriodVersion count unchanged');
      assertEqual(post.macro_indicators, pre.macro_indicators, 'Pre-existing MacroIndicator count unchanged');
      assertEqual(post.macro_observations, pre.macro_observations, 'Pre-existing MacroObservation count unchanged');
      assertEqual(post.macro_sync_logs, pre.macro_sync_logs, 'Pre-existing MacroSyncLog count unchanged');
    });

    // ============================================================================
    // 15. ETAPA 7 — CASO ESPECÍFICO: DÍVIDA PÓS-FIXADA CDI R$ 350.000 + CHOQUE +2 p.p.
    // ============================================================================
    await test('15. ETAPA 7 Specific Case: R$ 350.000 CDI-linked floating debt with +2 p.p. interest shock yields R$ 7.000,00/yr and R$ 583,33/mo gross impact', async () => {
      const dreBase = calculateDRE({
        grossRevenue: 850000,
        deductions: 85000,
        cmv: 340000,
        variableExpenses: 55000,
        fixedExpenses: 210000,
        depreciation: 15000,
        financialRevenues: 4000,
        financialExpenses: 14000,
        taxes: 18500,
        taxRegime: 'Lucro Presumido',
      });

      const cdi350kFacilities = [
        {
          id: 'ref-cdi-350k',
          companyId: 'demo-company-1',
          name: 'Capital de Giro Pós-Fixado CDI Referência',
          lender: 'Banco Referência S.A.',
          principal: 400000,
          outstandingBalance: 350000,
          indexer: 'CDI' as const,
          spreadAnnualPct: 3.8,
          monthlyPayment: 14500,
          maturityDate: '2028-01-15',
        },
        {
          id: 'ref-fixed-150k',
          companyId: 'demo-company-1',
          name: 'FINAME Pré-Fixado Imune no CP',
          lender: 'BNDES',
          principal: 200000,
          outstandingBalance: 150000,
          indexer: 'PRE_FIXADO' as const,
          spreadAnnualPct: 9.5,
          monthlyPayment: 5200,
          maturityDate: '2029-06-01',
        },
      ];

      const simRef = simulateInterestRateWithFacilities(dreBase, cdi350kFacilities, 10.75, 12.75);
      assertEqual(simRef.exposedFloatingDebt, '350000.00', 'Exposed CDI floating debt must be 350000.00');
      assertEqual(simRef.unaffectedFixedOrIpcaDebt, '150000.00', 'Unaffected fixed debt must be 150000.00');
      assertEqual(simRef.annualizedInterestImpact, '7000.00', 'Annualized gross interest impact on R$ 350k (+2 p.p.) must be R$ 7.000,00');
      assertEqual(simRef.annualizedGrossInterestImpact, '-7000.00', 'Signed annualized gross interest impact must be -7000.00');
      assertEqual(simRef.grossFinancialImpact, '-583.33', 'Monthly gross interest impact on R$ 350k (+2 p.p.) must be -583.33');
      if (!simRef.assumptions || simRef.assumptions.length === 0 || !simRef.limitations || simRef.limitations.length === 0) {
        throw new Error('Premissas e limitações explícitas ausentes no caso de R$ 350.000 CDI');
      }
    });

    // ============================================================================
    // 16. ETAPAS 1, 3, 4 e 5 — VALIDAÇÃO REAL INTEGRADA (NEON + BCB + GEMINI + N8N)
    // ============================================================================
    await test('16. Real End-to-End Infrastructure Validation: Unified Neon Schema (13/13 tables), Live BCB/IBGE Sync, Controlled Gemini API Call & Live n8n Webhook', async () => {
      await ensureDemoCompaniesInDb();

      // 16a. Verify unified FULL_PRISMA_SCHEMA on Neon PostgreSQL
      const detectedMode = await inspectDatabaseSchemaCompatibility();
      const migSummary = getSchemaMigrationSummary();
      assertEqual(detectedMode, 'FULL_PRISMA_SCHEMA', 'Neon schema mode must be FULL_PRISMA_SCHEMA');
      assertEqual(migSummary?.compatibleWithDirectPrismaModels, true, 'Direct Prisma models compatibility');
      assertEqual(migSummary?.pendingLocalMigrations.length, 0, 'Zero pending local migrations');
      assertEqual(migSummary?.missingTablesFromLocalSchema.length, 0, 'Zero missing tables from local schema');

      // 16b. Live BCB/IBGE Macroeconomic Sync persisted in Neon PostgreSQL
      const liveMacroSync = await fetchAndSyncMacroData();
      assertEqual(liveMacroSync.success, true, 'Live BCB/IBGE macro sync success');
      if (liveMacroSync.liveSeriesCount < 5) {
        throw new Error(`Esperado pelo menos 5 séries ao vivo do BCB/SGS, obtido: ${liveMacroSync.liveSeriesCount}`);
      }

      const macroCounts = (await realPrismaClient.$queryRaw`
        SELECT
          (SELECT COUNT(*)::int FROM "MacroIndicator") as indicators,
          (SELECT COUNT(*)::int FROM "MacroObservation") as observations
      `) as Array<any>;
      if (macroCounts[0].indicators < 11) {
        throw new Error(`Indicadores macroeconômicos reduzidos indevidamente: ${macroCounts[0].indicators}`);
      }
      if (macroCounts[0].observations < 120) {
        throw new Error(`Observações macroeconômicas reduzidas indevidamente: ${macroCounts[0].observations}`);
      }

      // 16c. Real n8n Webhook Delivery & 5-Dimension Diagnostics
      const whStatus = getWebhookStatus();
      if (whStatus.configured) {
        const whTest = await testWebhookConnection('demo-company-1');
        assertEqual(whTest.diagnostics?.webhookConfigured, true, 'n8n webhookConfigured');
        assertEqual(whTest.diagnostics?.executionPerformed, true, 'n8n executionPerformed');
        assertEqual(whTest.diagnostics?.webhookReachable, true, 'n8n webhookReachable');
        assertEqual(whTest.diagnostics?.authApproved, true, 'n8n authApproved');
        assertEqual(whTest.diagnostics?.executionSucceeded, true, 'n8n executionSucceeded');
      }

      // 16d. Single Controlled Real Gemini Call with Fictitious Data
      if (process.env.GEMINI_API_KEY) {
        const prevDisable = process.env.DISABLE_EXTERNAL_AI;
        process.env.DISABLE_EXTERNAL_AI = 'false';
        try {
          const geminiValidation = await validateControlledGeminiIntegration();
          assertEqual(geminiValidation.configured, true, 'Gemini API key configured');
          assertEqual(geminiValidation.reachable, true, 'Controlled Gemini API reachable');
          assertEqual(geminiValidation.succeeded, true, 'Controlled Gemini call succeeded');
          assertEqual(geminiValidation.structuredOutputValid, true, 'Controlled Gemini structured JSON output valid');
          if (!geminiValidation.modelUsed) {
            throw new Error('modelUsed ausente na validação controlada do Gemini');
          }
        } finally {
          process.env.DISABLE_EXTERNAL_AI = prevDisable;
        }
      }
    });
  }

  console.log(`\nTest Execution Summary: ${passedTests}/${totalTests} tests passed successfully.`);
}

runAllTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
