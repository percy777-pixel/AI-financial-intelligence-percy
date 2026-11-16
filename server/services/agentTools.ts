import { FunctionDeclaration, Type } from '@google/genai';
import {
  calculateDRE,
  calculateIndicators,
  compareFinancialRecords,
  explainCalculation,
  RawFinancialInput,
  serializeDRE,
  serializeIndicators,
  validateFinancialInput,
} from './financialEngine.js';
import {
  getCompanyById,
  getCompanyPeriods,
  getDebtFacilities,
  listOperationalMemory,
  StoredPeriod,
} from './dataStore.js';
import {
  compareMacroPeriods,
  getLatestMacroIndicators,
  getMacroHistory,
  getMacroPublicationMetadata,
} from './macroService.js';
import { analyzeDebtAndEconomicContext } from './economicContextService.js';
import {
  buildScenarioComparisonSuite,
  simulateInterestRateWithFacilities,
  simulateScenario,
} from './scenarioService.js';
import { generateFinancialDiagnosticAndRecommendations } from './aiService.js';
import { generateExecutiveReport } from './reportService.js';

export interface ToolContext {
  authorizedCompanyId: string;
  requestedYear?: number;
  requestedMonth?: number;
}

export interface ToolExecutionEnvelope {
  ok: boolean;
  toolName: string;
  data?: any;
  error?: string;
  source: string;
  dataVersions: string[];
  limitations?: string[];
  durationMs: number;
}

const SUSPICIOUS_PATTERN = /(\b(SELECT|DROP|DELETE|INSERT|UPDATE|ALTER|EXEC)\b\s+(FROM|TABLE|INTO)|;|--\s|\/\*|\*\/|<script)/i;

export const VALID_MACRO_CODES = ['SELIC', 'CDI', 'IPCA', 'IPCA_MENSAL', 'PTAX', 'PMC'] as const;
export const VALID_REVENUE_DRIVERS = ['VOLUME', 'PRICE'] as const;
export const VALID_MEMORY_TYPES = ['SCENARIO', 'DIAGNOSTIC', 'DECISION', 'REPORT', 'INSIGHT', 'RISK_ALERT'] as const;
export const VALID_EXPLAIN_METRICS = [
  'netRevenue',
  'contributionMargin',
  'operatingResult',
  'ebitda',
  'ebit',
  'netProfit',
  'operatingBreakEven',
  'financialBreakEven',
  'currentLiquidity',
  'cashConversionCycle',
] as const;

function assertSafeString(val: unknown, fieldName: string): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string') throw new Error(`Argumento inválido "${fieldName}": esperado texto.`);
  if (val.length > 300) throw new Error(`Argumento "${fieldName}" excede limite de tamanho.`);
  if (SUSPICIOUS_PATTERN.test(val)) {
    throw new Error(`Argumento "${fieldName}" bloqueado pela política de segurança de entrada.`);
  }
  return val.trim();
}

function assertValidEnum<T extends string>(
  val: unknown,
  fieldName: string,
  allowedValues: readonly T[],
  caseInsensitive = true
): T {
  const str = assertSafeString(val, fieldName);
  if (!str) {
    throw new Error(
      `Argumento obrigatório "${fieldName}" ausente. Valores permitidos: ${allowedValues.join(', ')}.`
    );
  }
  const match = allowedValues.find(item =>
    caseInsensitive ? item.toLowerCase() === str.toLowerCase() : item === str
  );
  if (!match) {
    throw new Error(
      `Valor inválido "${str}" para "${fieldName}". Valores permitidos: ${allowedValues.join(', ')}.`
    );
  }
  return match;
}

function assertBoundedNumber(val: unknown, fieldName: string, min: number, max: number): number | undefined {
  if (val === undefined || val === null) return undefined;
  const num = Number(val);
  if (!Number.isFinite(num)) throw new Error(`Argumento inválido "${fieldName}": esperado número finito.`);
  if (num < min || num > max) {
    throw new Error(`Argumento "${fieldName}" fora dos limites permitidos (${min} a ${max}).`);
  }
  return num;
}

function assertAuthorizedCompany(args: any, ctx: ToolContext): string {
  if (args?.companyId && typeof args.companyId === 'string' && args.companyId !== ctx.authorizedCompanyId) {
    throw new Error(
      `Acesso negado: tentativa de consultar empresa "${args.companyId}" fora do escopo autorizado "${ctx.authorizedCompanyId}".`
    );
  }
  return ctx.authorizedCompanyId;
}

function findPeriodOrThrow(
  periods: StoredPeriod[],
  companyName: string,
  year?: number,
  month?: number
): StoredPeriod {
  if (year === undefined && month === undefined) {
    return periods[0];
  }
  const found = periods.find(
    p => (year === undefined || p.year === year) && (month === undefined || p.month === month)
  );
  if (!found) {
    const available = periods
      .map(p => `${p.month ? `${String(p.month).padStart(2, '0')}/` : ''}${p.year}`)
      .join(', ');
    throw new Error(
      `Período solicitado (${month ? `${String(month).padStart(2, '0')}/` : ''}${year ?? '*'}) não encontrado para "${companyName}". Períodos disponíveis: ${available}.`
    );
  }
  return found;
}

async function resolveCompanyPeriod(
  companyId: string,
  year?: number,
  month?: number
): Promise<{ company: any; periods: StoredPeriod[]; period: StoredPeriod; version: any; rawInput: RawFinancialInput }> {
  const company = await getCompanyById(companyId);
  if (!company) throw new Error(`Empresa "${companyId}" não encontrada.`);
  const periods = await getCompanyPeriods(companyId);
  if (periods.length === 0) throw new Error(`Nenhum período financeiro encontrado para "${company.name}".`);

  const period = findPeriodOrThrow(periods, company.name, year, month);
  const version = period.versions[0];
  if (!version) throw new Error(`Versão não encontrada para o período ${period.month || ''}/${period.year}.`);

  const rawInput: RawFinancialInput = {
    ...version.rawData,
    taxRegime: version.rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
  };

  return { company, periods, period, version, rawInput };
}

function formatPeriodTag(p: StoredPeriod, v?: { versionNumber: number }): string {
  const pLabel = `${p.month ? `${String(p.month).padStart(2, '0')}/` : ''}${p.year}`;
  return v ? `${pLabel} (v${v.versionNumber})` : pLabel;
}

export const AGENT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  // Dados financeiros
  {
    name: 'get_company_profile',
    description: 'Consulta o perfil cadastral, setor, CNPJ e regime tributário (Simples Nacional, Lucro Presumido ou Lucro Real) da empresa selecionada.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        companyId: { type: Type.STRING, description: 'ID opcional da empresa (deve corresponder à empresa autorizada).' },
      },
    },
  },
  {
    name: 'get_financial_context',
    description: 'Retorna o contexto financeiro consolidado da empresa para o período (DRE, indicadores principais, completude dos dados e resumo de dívidas).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano de referência opcional.' },
        month: { type: Type.INTEGER, description: 'Mês de referência opcional (1-12).' },
      },
    },
  },
  {
    name: 'get_dre',
    description: 'Obtém a DRE gerencial completa calculada em Decimal.js pelo motor determinístico do backend.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano de referência opcional.' },
        month: { type: Type.INTEGER, description: 'Mês de referência opcional (1-12).' },
      },
    },
  },
  {
    name: 'get_financial_indicators',
    description: 'Calcula e retorna margens, liquidez (corrente/seca/imediata), endividamento, cobertura de juros, ROE, ROA e ciclo financeiro.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano de referência opcional.' },
        month: { type: Type.INTEGER, description: 'Mês de referência opcional (1-12).' },
      },
    },
  },
  {
    name: 'get_cash_flow_context',
    description: 'Consulta disponibilidade de caixa, capital de giro (recebíveis, estoques, fornecedores), ciclo financeiro e resultado operacional de caixa.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano de referência opcional.' },
        month: { type: Type.INTEGER, description: 'Mês de referência opcional (1-12).' },
      },
    },
  },
  {
    name: 'get_debt_exposure',
    description: 'Consulta contratos de dívida da empresa, indexadores (SELIC, CDI, IPCA, PRE_FIXADO), taxas efetivas e parcela exposta a juros flutuantes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano de referência opcional para cálculo de cobertura na DRE.' },
        month: { type: Type.INTEGER, description: 'Mês de referência opcional (1-12).' },
      },
    },
  },
  {
    name: 'get_financial_history',
    description: 'Lista todos os períodos financeiros disponíveis da empresa e evolução de receita, margem e lucro.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: { type: Type.INTEGER, description: 'Quantidade máxima de períodos a retornar.' },
      },
    },
  },
  {
    name: 'compare_financial_periods',
    description: 'Compara dois períodos financeiros da empresa (ex.: mês atual vs mês anterior) mostrando variações absolutas e percentuais.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        baseYear: { type: Type.INTEGER, description: 'Ano do período anterior/base.' },
        baseMonth: { type: Type.INTEGER, description: 'Mês do período anterior/base.' },
        targetYear: { type: Type.INTEGER, description: 'Ano do período atual/alvo.' },
        targetMonth: { type: Type.INTEGER, description: 'Mês do período atual/alvo.' },
      },
    },
  },
  // Inteligência macroeconômica
  {
    name: 'get_macro_indicators',
    description: 'Obtém os indicadores macroeconômicos oficiais mais recentes (SELIC, CDI, IPCA, IPCA_MENSAL, PTAX, PMC) com fonte e data.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_macro_history',
    description: 'Consulta a série histórica de um indicador macroeconômico específico (SELIC, CDI, IPCA, IPCA_MENSAL, PTAX ou PMC).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        code: { type: Type.STRING, description: 'Código do indicador: SELIC, CDI, IPCA, IPCA_MENSAL, PTAX ou PMC.' },
        limit: { type: Type.INTEGER, description: 'Número de observações recentes (padrão 6).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_macro_publication_metadata',
    description: 'Consulta metadados oficiais de publicação, código da série, frequência, fonte e metodologia de cálculo dos indicadores macro.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        code: { type: Type.STRING, description: 'Código opcional do indicador (SELIC, CDI, IPCA, IPCA_MENSAL, PTAX, PMC).' },
      },
    },
  },
  {
    name: 'compare_macro_periods',
    description: 'Compara a evolução de um indicador macroeconômico ao longo dos últimos N registros.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        code: { type: Type.STRING, description: 'Código do indicador (SELIC, CDI, IPCA, IPCA_MENSAL, PTAX, PMC).' },
        periodsBack: { type: Type.INTEGER, description: 'Quantidade de observações anteriores para comparar.' },
      },
      required: ['code'],
    },
  },
  // Simulação
  {
    name: 'simulate_interest_rate_scenario',
    description: 'Simula impacto determinístico de uma mudança na taxa Selic sobre as dívidas pós-fixadas (SELIC/CDI) reais da empresa, preservando dívidas pré-fixadas.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetSelicPct: { type: Type.NUMBER, description: 'Nova taxa Selic alvo em % a.a. (ex.: 15).' },
        currentSelicPct: { type: Type.NUMBER, description: 'Taxa Selic atual opcional em % a.a. (usa a oficial se omitida).' },
        year: { type: Type.INTEGER, description: 'Ano opcional do período base.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período base (1-12).' },
      },
      required: ['targetSelicPct'],
    },
  },
  {
    name: 'simulate_revenue_scenario',
    description: 'Simula variação percentual de receita (ex.: queda de 10% nas vendas) recalculando deduções, CMV/variáveis (em modo volume) e lucro.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        revenueChangePercent: { type: Type.NUMBER, description: 'Variação percentual na receita (ex.: -10 para queda de 10%).' },
        driver: { type: Type.STRING, description: 'VOLUME (altera CMV proporcionalmente) ou PRICE (mantém CMV físico constante).' },
        year: { type: Type.INTEGER, description: 'Ano opcional do período base.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período base (1-12).' },
      },
      required: ['revenueChangePercent'],
    },
  },
  {
    name: 'simulate_price_scenario',
    description: 'Simula aumento ou redução de preço de venda mantendo volume físico constante (ou aplicando hipótese explícita de elasticidade informada pelo usuário).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        priceChangePercent: { type: Type.NUMBER, description: 'Variação percentual no preço (ex.: 5 para +5%).' },
        priceElasticityHypothesis: { type: Type.NUMBER, description: 'Hipótese opcional de elasticidade-preço da demanda (ex.: -0.5).' },
        year: { type: Type.INTEGER, description: 'Ano opcional do período base.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período base (1-12).' },
      },
      required: ['priceChangePercent'],
    },
  },
  {
    name: 'simulate_demand_scenario',
    description: 'Simula variação percentual na demanda/volume vendido ajustando receita, deduções, CMV e despesas variáveis proporcionalmente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        demandChangePercent: { type: Type.NUMBER, description: 'Variação percentual no volume de vendas (ex.: -15 ou +10).' },
        year: { type: Type.INTEGER, description: 'Ano opcional do período base.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período base (1-12).' },
      },
      required: ['demandChangePercent'],
    },
  },
  {
    name: 'simulate_combined_scenario',
    description: 'Executa simulação combinada envolvendo preço, demanda, custos variáveis, despesas fixas e choque de Selic.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        priceChangePercent: { type: Type.NUMBER },
        demandChangePercent: { type: Type.NUMBER },
        variableCostChangePercent: { type: Type.NUMBER },
        fixedExpenseChangePercent: { type: Type.NUMBER },
        selicShockPercent: { type: Type.NUMBER },
        year: { type: Type.INTEGER, description: 'Ano opcional do período base.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período base (1-12).' },
      },
    },
  },
  // Diagnóstico e relatórios
  {
    name: 'generate_financial_diagnostic',
    description: 'Executa diagnóstico financeiro estruturado separando fatos, hipóteses, estimativas e riscos.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano opcional do período.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período (1-12).' },
      },
    },
  },
  {
    name: 'generate_executive_report',
    description: 'Gera relatório executivo completo e rastreável com DRE, evolução, riscos, cenários, recomendações e dados ausentes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano opcional do período.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período (1-12).' },
      },
    },
  },
  {
    name: 'identify_financial_risks',
    description: 'Identifica riscos financeiros objetivos (liquidez, margem de segurança, alavancagem, exposição a Selic, queda de receita).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano opcional do período.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período (1-12).' },
      },
    },
  },
  {
    name: 'prioritize_management_actions',
    description: 'Prioriza ações gerenciais por horizonte (0-30 dias, 30-60 dias, >60 dias) com base em evidências da DRE e dívidas.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano opcional do período.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período (1-12).' },
      },
    },
  },
  // Dados e qualidade
  {
    name: 'validate_financial_data',
    description: 'Valida consistência contábil, erros, alertas tributários e grau de completude dos dados da empresa.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano opcional do período.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período (1-12).' },
      },
    },
  },
  {
    name: 'identify_missing_information',
    description: 'Lista exatamente quais informações financeiras ou de balanço/capital de giro estão ausentes e quais análises ficam bloqueadas por essa falta.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER, description: 'Ano opcional do período.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período (1-12).' },
      },
    },
  },
  {
    name: 'explain_calculation',
    description: 'Explica fórmula, dados de entrada, arredondamento e limitações de um indicador ou linha da DRE.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        metric: {
          type: Type.STRING,
          description: 'Métrica a explicar: netRevenue, contributionMargin, operatingResult, ebitda, ebit, netProfit, operatingBreakEven, financialBreakEven, currentLiquidity ou cashConversionCycle.',
        },
        year: { type: Type.INTEGER, description: 'Ano opcional do período.' },
        month: { type: Type.INTEGER, description: 'Mês opcional do período (1-12).' },
      },
      required: ['metric'],
    },
  },
  {
    name: 'compare_data_versions',
    description: 'Compara duas versões de um mesmo período financeiro (ex.: v1 vs v2) para auditar alterações.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        year: { type: Type.INTEGER },
        month: { type: Type.INTEGER },
      },
    },
  },
  {
    name: 'query_operational_memory',
    description: 'Consulta decisões registradas, diagnósticos, alertas setoriais têxteis (RISK_ALERT) e cenários anteriores armazenados na memória operacional da empresa.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memoryType: { type: Type.STRING, description: 'Opcional: SCENARIO, DIAGNOSTIC, DECISION, REPORT, INSIGHT, RISK_ALERT.' },
      },
    },
  },
];

export async function executeAgentTool(
  toolName: string,
  rawArgs: any,
  ctx: ToolContext
): Promise<ToolExecutionEnvelope> {
  const started = Date.now();
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};

  try {
    const companyId = assertAuthorizedCompany(args, ctx);
    const reqYear = assertBoundedNumber(args.year, 'year', 2000, 2100);
    const reqMonth = assertBoundedNumber(args.month, 'month', 1, 12);
    const effectiveYear = reqYear ?? ctx.requestedYear;
    const effectiveMonth = reqMonth ?? ctx.requestedMonth;

    switch (toolName) {
      case 'get_company_profile': {
        const company = await getCompanyById(companyId);
        if (!company) throw new Error('Empresa não encontrada.');
        const periods = await getCompanyPeriods(companyId);
        return {
          ok: true,
          toolName,
          data: {
            ...company,
            availablePeriodsCount: periods.length,
            latestPeriod: periods[0] ? formatPeriodTag(periods[0], periods[0].versions[0]) : null,
          },
          source: `Cadastro Corporativo (${company.isDemo ? 'Dados de Demonstração' : 'Banco'})`,
          dataVersions: periods[0]?.versions[0] ? [formatPeriodTag(periods[0], periods[0].versions[0])] : [],
          durationMs: Date.now() - started,
        };
      }

      case 'get_financial_context': {
        const { company, period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const indicators = calculateIndicators(dre, rawInput);
        const validation = validateFinancialInput(rawInput);
        const debts = await getDebtFacilities(companyId);
        const macro = await getLatestMacroIndicators();
        const econ = analyzeDebtAndEconomicContext(dre, debts, macro, company.industry);
        return {
          ok: true,
          toolName,
          data: {
            company: { id: company.id, name: company.name, taxRegime: company.taxRegime, industry: company.industry },
            period: formatPeriodTag(period, version),
            dre: serializeDRE(dre),
            indicators: serializeIndicators(indicators),
            completenessPct: validation.completenessPct,
            debtSummary: econ.debtExposureSummary,
          },
          source: 'Motor Determinístico Decimal.js + Cadastro de Dívidas',
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'get_dre': {
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        return {
          ok: true,
          toolName,
          data: { period: formatPeriodTag(period, version), dre: serializeDRE(dre) },
          source: 'Motor Determinístico Decimal.js (calculateDRE)',
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'get_financial_indicators': {
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const indicators = calculateIndicators(dre, rawInput);
        return {
          ok: true,
          toolName,
          data: { period: formatPeriodTag(period, version), indicators: serializeIndicators(indicators) },
          source: 'Motor Determinístico Decimal.js (calculateIndicators)',
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'get_cash_flow_context': {
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const indicators = calculateIndicators(dre, rawInput);
        const serializedInd = serializeIndicators(indicators);
        return {
          ok: true,
          toolName,
          data: {
            period: formatPeriodTag(period, version),
            operatingCashResult: dre.operatingResult.toFixed(2),
            ebitda: dre.ebitda.toFixed(2),
            cashAndEquivalents: rawInput.cashAndEquivalents ?? null,
            accountsReceivable: rawInput.accountsReceivable ?? null,
            inventory: rawInput.inventory ?? null,
            accountsPayable: rawInput.accountsPayable ?? null,
            currentLiquidity: serializedInd.currentLiquidity,
            quickLiquidity: serializedInd.quickLiquidity,
            cashRatio: serializedInd.cashRatio,
            inventoryTurnoverDays: serializedInd.inventoryTurnoverDays,
            receivablesDays: serializedInd.receivablesDays,
            payablesDays: serializedInd.payablesDays,
            cashConversionCycle: serializedInd.cashConversionCycle,
            missingWorkingCapitalFields: serializedInd.missingInformation,
          },
          source: 'Motor Determinístico + Dados de Balanço do Período',
          dataVersions: [formatPeriodTag(period, version)],
          limitations: ['O fluxo de caixa operacional gerencial na DRE não inclui amortização de principal ou CAPEX; consulte o Ciclo Financeiro para necessidade de capital de giro.'],
          durationMs: Date.now() - started,
        };
      }

      case 'get_debt_exposure': {
        const { company, period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const debts = await getDebtFacilities(companyId);
        const macro = await getLatestMacroIndicators();
        const econ = analyzeDebtAndEconomicContext(dre, debts, macro, company.industry);
        const drePeriodRef = formatPeriodTag(period, version);
        return {
          ok: true,
          toolName,
          data: {
            ...econ.debtExposureSummary,
            drePeriodRef,
            debtPortfolioScope: 'CARTEIRA_ATIVA_ATUAL_DA_EMPRESA',
            temporalReferenceNote: `Os indicadores de cobertura de juros utilizam a DRE do período ${drePeriodRef}, enquanto os contratos de dívida refletem a carteira cadastral ativa da empresa.`,
          },
          source: 'Cadastro de Contratos de Dívida + Indicadores BCB',
          dataVersions: [drePeriodRef],
          limitations: econ.limitations,
          durationMs: Date.now() - started,
        };
      }

      case 'get_financial_history': {
        const limit = assertBoundedNumber(args.limit, 'limit', 1, 24) ?? 12;
        const periods = await getCompanyPeriods(companyId);
        const history = periods.slice(0, limit).map(p => {
          const v = p.versions[0];
          return {
            period: formatPeriodTag(p, v),
            year: p.year,
            month: p.month,
            grossRevenue: v?.grossRevenue,
            netRevenue: v?.netRevenue,
            contributionMargin: v?.contributionMargin,
            operatingResult: v?.operatingResult,
            ebitda: v?.ebitda,
            netProfit: v?.netProfit,
            netMarginPct: v?.netRevenue ? Number(((v.netProfit / v.netRevenue) * 100).toFixed(2)) : 0,
            versionsCount: p.versions.length,
          };
        });
        return {
          ok: true,
          toolName,
          data: { periodsCount: history.length, history },
          source: 'Histórico de Períodos Financeiros Auditados',
          dataVersions: history.map(h => h.period),
          durationMs: Date.now() - started,
        };
      }

      case 'compare_financial_periods': {
        const company = await getCompanyById(companyId);
        if (!company) throw new Error('Empresa não encontrada.');
        const periods = await getCompanyPeriods(companyId);
        if (periods.length < 2) {
          return {
            ok: true,
            toolName,
            data: { comparable: false, message: 'A empresa possui apenas 1 período registrado; são necessários ao menos 2 períodos para comparação.' },
            source: 'Histórico de Períodos',
            dataVersions: periods[0] ? [formatPeriodTag(periods[0], periods[0].versions[0])] : [],
            durationMs: Date.now() - started,
          };
        }
        const targetY = assertBoundedNumber(args.targetYear, 'targetYear', 2000, 2100);
        const targetM = assertBoundedNumber(args.targetMonth, 'targetMonth', 1, 12);
        const baseY = assertBoundedNumber(args.baseYear, 'baseYear', 2000, 2100);
        const baseM = assertBoundedNumber(args.baseMonth, 'baseMonth', 1, 12);

        const targetPeriod =
          targetY !== undefined || targetM !== undefined
            ? findPeriodOrThrow(periods, company.name, targetY, targetM)
            : periods[0];

        const basePeriod =
          baseY !== undefined || baseM !== undefined
            ? findPeriodOrThrow(periods, company.name, baseY, baseM)
            : periods.find(p => p.id !== targetPeriod.id) || periods[1];

        const baseRaw: RawFinancialInput = {
          ...basePeriod.versions[0].rawData,
          taxRegime: basePeriod.versions[0].rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
        };
        const targetRaw: RawFinancialInput = {
          ...targetPeriod.versions[0].rawData,
          taxRegime: targetPeriod.versions[0].rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
        };

        const dreBase = calculateDRE(baseRaw);
        const dreTarget = calculateDRE(targetRaw);
        const comparison = compareFinancialRecords(
          formatPeriodTag(basePeriod, basePeriod.versions[0]),
          dreBase,
          formatPeriodTag(targetPeriod, targetPeriod.versions[0]),
          dreTarget
        );
        return {
          ok: true,
          toolName,
          data: {
            comparable: true,
            taxRegime: company.taxRegime || 'Simples Nacional',
            comparison,
          },
          source: 'Comparador Determinístico de Períodos',
          dataVersions: [formatPeriodTag(basePeriod, basePeriod.versions[0]), formatPeriodTag(targetPeriod, targetPeriod.versions[0])],
          durationMs: Date.now() - started,
        };
      }

      case 'get_macro_indicators': {
        const indicators = await getLatestMacroIndicators();
        return {
          ok: true,
          toolName,
          data: indicators,
          source: 'BCB/SGS & IBGE/SIDRA',
          dataVersions: indicators.map(i => `${i.code}:${i.referenceDate}`),
          durationMs: Date.now() - started,
        };
      }

      case 'get_macro_history': {
        const code = assertValidEnum(args.code ?? 'SELIC', 'code', VALID_MACRO_CODES);
        const limit = assertBoundedNumber(args.limit, 'limit', 1, 24) ?? 6;
        const history = await getMacroHistory(code, limit);
        return {
          ok: true,
          toolName,
          data: { code, observations: history },
          source: history[0]?.source || 'BCB/IBGE',
          dataVersions: history.map(h => `${h.code}:${h.referenceDate}`),
          durationMs: Date.now() - started,
        };
      }

      case 'get_macro_publication_metadata': {
        const code = args.code !== undefined && args.code !== null
          ? assertValidEnum(args.code, 'code', VALID_MACRO_CODES)
          : undefined;
        const meta = await getMacroPublicationMetadata(code);
        return {
          ok: true,
          toolName,
          data: meta,
          source: 'Catálogo Oficial de Séries Macroeconômicas',
          dataVersions: meta.map(m => `${m.code}:${m.seriesCode}`),
          durationMs: Date.now() - started,
        };
      }

      case 'compare_macro_periods': {
        const code = assertValidEnum(args.code ?? 'SELIC', 'code', VALID_MACRO_CODES);
        const periodsBack = assertBoundedNumber(args.periodsBack, 'periodsBack', 1, 24) ?? 3;
        const comp = await compareMacroPeriods(code, periodsBack);
        return {
          ok: true,
          toolName,
          data: comp,
          source: comp.source || 'BCB/IBGE',
          dataVersions: [code],
          durationMs: Date.now() - started,
        };
      }

      case 'simulate_interest_rate_scenario': {
        const targetSelic = assertBoundedNumber(args.targetSelicPct, 'targetSelicPct', 0, 50);
        if (targetSelic === undefined) throw new Error('targetSelicPct é obrigatório.');
        const macro = await getLatestMacroIndicators();
        const officialSelic = macro.find(m => m.code === 'SELIC')?.value ?? 11.25;
        const currentSelic = assertBoundedNumber(args.currentSelicPct, 'currentSelicPct', 0, 50) ?? officialSelic;

        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const debts = await getDebtFacilities(companyId);
        const sim = simulateInterestRateWithFacilities(dre, debts, currentSelic, targetSelic);

        return {
          ok: true,
          toolName,
          data: {
            ...sim,
            period: formatPeriodTag(period, version),
          },
          source: 'Simulador Determinístico de Juros sobre Contratos Pós-Fixados',
          dataVersions: [formatPeriodTag(period, version), `SELIC:${currentSelic}%->${targetSelic}%`],
          limitations: sim.limitations,
          durationMs: Date.now() - started,
        };
      }

      case 'simulate_revenue_scenario': {
        const revChange = assertBoundedNumber(args.revenueChangePercent, 'revenueChangePercent', -90, 200);
        if (revChange === undefined) throw new Error('revenueChangePercent é obrigatório.');
        const driver = assertValidEnum(args.driver ?? 'VOLUME', 'driver', VALID_REVENUE_DRIVERS);
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const sim = simulateScenario(dre, {
          scenarioLabel: `Simulação de Receita (${revChange > 0 ? '+' : ''}${revChange}% via ${driver})`,
          demandChangePercent: driver === 'VOLUME' ? revChange : 0,
          priceChangePercent: driver === 'PRICE' ? revChange : 0,
          taxRegime: rawInput.taxRegime,
        });
        return {
          ok: true,
          toolName,
          data: { ...sim, period: formatPeriodTag(period, version) },
          source: 'Simulador Determinístico Decimal.js',
          dataVersions: [formatPeriodTag(period, version)],
          limitations: sim.limitations,
          durationMs: Date.now() - started,
        };
      }

      case 'simulate_price_scenario': {
        const pricePct = assertBoundedNumber(args.priceChangePercent, 'priceChangePercent', -80, 200);
        if (pricePct === undefined) throw new Error('priceChangePercent é obrigatório.');
        const elasticity = assertBoundedNumber(args.priceElasticityHypothesis, 'priceElasticityHypothesis', -5, 5);
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const sim = simulateScenario(dre, {
          scenarioLabel: `Simulação de Preço (${pricePct > 0 ? '+' : ''}${pricePct}%)`,
          priceChangePercent: pricePct,
          priceElasticityHypothesis: elasticity,
          taxRegime: rawInput.taxRegime,
        });
        return {
          ok: true,
          toolName,
          data: { ...sim, period: formatPeriodTag(period, version) },
          source: 'Simulador Determinístico de Precificação',
          dataVersions: [formatPeriodTag(period, version)],
          limitations: sim.limitations,
          durationMs: Date.now() - started,
        };
      }

      case 'simulate_demand_scenario': {
        const demandPct = assertBoundedNumber(args.demandChangePercent, 'demandChangePercent', -90, 200);
        if (demandPct === undefined) throw new Error('demandChangePercent é obrigatório.');
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const sim = simulateScenario(dre, {
          scenarioLabel: `Simulação de Demanda (${demandPct > 0 ? '+' : ''}${demandPct}%)`,
          demandChangePercent: demandPct,
          taxRegime: rawInput.taxRegime,
        });
        return {
          ok: true,
          toolName,
          data: { ...sim, period: formatPeriodTag(period, version) },
          source: 'Simulador Determinístico de Volume/Demanda',
          dataVersions: [formatPeriodTag(period, version)],
          limitations: sim.limitations,
          durationMs: Date.now() - started,
        };
      }

      case 'simulate_combined_scenario': {
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const debts = await getDebtFacilities(companyId);
        const floatingDebt = debts
          .filter(f => f.indexer === 'SELIC' || f.indexer === 'CDI')
          .reduce((acc, f) => acc + f.outstandingBalance, 0);

        const sim = simulateScenario(dre, {
          scenarioLabel: 'Cenário Combinado Personalizado',
          priceChangePercent: assertBoundedNumber(args.priceChangePercent, 'priceChangePercent', -80, 200) ?? 0,
          demandChangePercent: assertBoundedNumber(args.demandChangePercent, 'demandChangePercent', -90, 200) ?? 0,
          variableCostChangePercent: assertBoundedNumber(args.variableCostChangePercent, 'variableCostChangePercent', -80, 200) ?? 0,
          fixedExpenseChangePercent: assertBoundedNumber(args.fixedExpenseChangePercent, 'fixedExpenseChangePercent', -80, 200) ?? 0,
          selicShockPercent: assertBoundedNumber(args.selicShockPercent, 'selicShockPercent', -20, 30) ?? 0,
          debtExposureValue: floatingDebt,
          taxRegime: rawInput.taxRegime,
          debtFacilities: debts,
        });
        return {
          ok: true,
          toolName,
          data: { ...sim, period: formatPeriodTag(period, version) },
          source: 'Simulador Combinado Determinístico',
          dataVersions: [formatPeriodTag(period, version)],
          limitations: sim.limitations,
          durationMs: Date.now() - started,
        };
      }

      case 'generate_financial_diagnostic': {
        const { company, period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const indicators = calculateIndicators(dre, rawInput);
        const macro = await getLatestMacroIndicators();
        const debts = await getDebtFacilities(companyId);
        const econ = analyzeDebtAndEconomicContext(dre, debts, macro, company.industry);
        const diag = await generateFinancialDiagnosticAndRecommendations({
          companyName: company.name,
          industry: company.industry || undefined,
          taxRegime: company.taxRegime || undefined,
          dre: serializeDRE(dre),
          indicators: serializeIndicators(indicators),
          macroIndicators: macro,
          debtSummary: econ.debtExposureSummary,
          periodLabel: formatPeriodTag(period, version),
        });
        return {
          ok: true,
          toolName,
          data: { ...diag, period: formatPeriodTag(period, version) },
          source: `Diagnóstico (${diag.provider})`,
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'generate_executive_report': {
        const report = await generateExecutiveReport(companyId, effectiveYear, effectiveMonth);
        return {
          ok: true,
          toolName,
          data: {
            reportId: report.reportId,
            periodRef: report.periodRef,
            dataVersionRef: report.dataVersionRef,
            provider: report.provider,
            summary: report.diagnosticAndRecommendations.diagnostic,
            risks: report.diagnosticAndRecommendations.risks,
            missingData: report.missingData,
            markdownPreview: report.markdown.slice(0, 1800),
          },
          source: 'Gerador de Relatório Executivo Rastreável',
          dataVersions: [`${report.periodRef} (${report.dataVersionRef})`],
          durationMs: Date.now() - started,
        };
      }

      case 'identify_financial_risks': {
        const { company, period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const indicators = calculateIndicators(dre, rawInput);
        const debts = await getDebtFacilities(companyId);
        const macro = await getLatestMacroIndicators();
        const econ = analyzeDebtAndEconomicContext(dre, debts, macro, company.industry);

        const risks: Array<{ category: string; severity: string; indicator: string; detail: string }> = [];
        if (dre.operatingResult.lte(0)) {
          risks.push({
            category: 'Caixa Operacional',
            severity: 'ALTA',
            indicator: `Resultado Operacional R$ ${dre.operatingResult.toFixed(2)}`,
            detail: 'Operação não gera caixa suficiente para cobrir despesas fixas operacionais.',
          });
        }
        if (dre.safetyMargin.lt(20)) {
          risks.push({
            category: 'Margem de Segurança / Ponto de Equilíbrio',
            severity: dre.safetyMargin.lt(10) ? 'ALTA' : 'MÉDIA',
            indicator: `Margem de Segurança ${dre.safetyMargin.toFixed(2)}%`,
            detail: `Uma queda de receita superior a ${dre.safetyMargin.toFixed(1)}% leva o resultado operacional para prejuízo.`,
          });
        }
        if (indicators.currentLiquidity !== null && indicators.currentLiquidity.lt(1.2)) {
          risks.push({
            category: 'Liquidez de Curto Prazo',
            severity: indicators.currentLiquidity.lt(1) ? 'ALTA' : 'MÉDIA',
            indicator: `Liquidez Corrente ${indicators.currentLiquidity.toFixed(2)}x`,
            detail: 'Folga financeira limitada frente aos passivos circulantes.',
          });
        }
        if (Number(econ.debtExposureSummary.floatingSharePct) > 40) {
          risks.push({
            category: 'Exposição a Juros Pós-Fixados',
            severity: 'MÉDIA',
            indicator: `${econ.debtExposureSummary.floatingSharePct}% da dívida em SELIC/CDI/IPCA`,
            detail: `R$ ${econ.debtExposureSummary.floatingRateDebt} expostos a choques de juros.`,
          });
        }
        return {
          ok: true,
          toolName,
          data: { company: company.name, period: formatPeriodTag(period, version), risks },
          source: 'Motor Determinístico de Riscos Financeiros',
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'prioritize_management_actions': {
        const { company, period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const indicators = calculateIndicators(dre, rawInput);
        const debts = await getDebtFacilities(companyId);
        const suite = buildScenarioComparisonSuite(dre, debts);
        const actions = [
          {
            priority: 1,
            horizon: '0-30 dias',
            action: 'Revisar estrutura de despesas fixas e contratos recorrentes',
            justification: `Despesas fixas representam ${dre.netRevenue.gt(0) ? dre.fixedExpenses.dividedBy(dre.netRevenue).times(100).toFixed(1) : 'N/A'}% da receita líquida.`,
          },
          {
            priority: 2,
            horizon: '0-30 dias',
            action: 'Monitorar exposição pós-fixada (Selic/CDI) e priorizar amortização de spreads maiores',
            justification: `Contratos ativos de dívida em carteira somam ${debts.length} linhas monitoradas.`,
          },
          {
            priority: 3,
            horizon: '30-60 dias',
            action: 'Otimizar giro de estoque e ciclo financeiro no varejo',
            justification: indicators.cashConversionCycle
              ? `Ciclo financeiro atual de ${indicators.cashConversionCycle.toFixed(1)} dias.`
              : 'Completar dados de recebíveis e fornecedores para medir ciclo financeiro.',
          },
        ];
        return {
          ok: true,
          toolName,
          data: { company: company.name, period: formatPeriodTag(period, version), actions, scenarioReference: suite.scenarios.adverse },
          source: 'Priorizador Determinístico de Ações',
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'validate_financial_data': {
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const validation = validateFinancialInput(rawInput);
        return {
          ok: true,
          toolName,
          data: { period: formatPeriodTag(period, version), ...validation },
          source: 'Validador Contábil e de Integridade',
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'identify_missing_information': {
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const indicators = calculateIndicators(dre, rawInput);
        const validation = validateFinancialInput(rawInput);
        return {
          ok: true,
          toolName,
          data: {
            period: formatPeriodTag(period, version),
            completenessPct: validation.completenessPct,
            missingFields: validation.missingFields,
            blockedIndicators: indicators.missingInformation,
          },
          source: 'Auditor de Completude de Dados',
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'explain_calculation': {
        const metric = assertValidEnum(args.metric, 'metric', VALID_EXPLAIN_METRICS, true);
        const { period, version, rawInput } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        const dre = calculateDRE(rawInput);
        const indicators = calculateIndicators(dre, rawInput);
        const explanation = explainCalculation(metric, dre, indicators, rawInput);
        return {
          ok: true,
          toolName,
          data: { period: formatPeriodTag(period, version), explanation },
          source: 'Explicador de Fórmulas do Motor Decimal.js',
          dataVersions: [formatPeriodTag(period, version)],
          durationMs: Date.now() - started,
        };
      }

      case 'compare_data_versions': {
        const { company, period: target } = await resolveCompanyPeriod(
          companyId,
          effectiveYear,
          effectiveMonth
        );
        if (!target || target.versions.length < 2) {
          return {
            ok: true,
            toolName,
            data: {
              comparable: false,
              period: target ? formatPeriodTag(target) : null,
              message: 'O período selecionado possui apenas 1 versão registrada.',
            },
            source: 'Controle de Versionamento',
            dataVersions: target?.versions[0] ? [formatPeriodTag(target, target.versions[0])] : [],
            durationMs: Date.now() - started,
          };
        }
        const latest = target.versions[0];
        const prev = target.versions[1];
        const prevRaw: RawFinancialInput = {
          ...prev.rawData,
          taxRegime: prev.rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
        };
        const latestRaw: RawFinancialInput = {
          ...latest.rawData,
          taxRegime: latest.rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
        };
        const diff = compareFinancialRecords(
          `v${prev.versionNumber} (${prev.changeReason || ''})`,
          calculateDRE(prevRaw),
          `v${latest.versionNumber} (${latest.changeReason || ''})`,
          calculateDRE(latestRaw)
        );
        return {
          ok: true,
          toolName,
          data: {
            comparable: true,
            period: formatPeriodTag(target),
            taxRegime: company.taxRegime || 'Simples Nacional',
            versionComparison: diff,
          },
          source: 'Auditoria de Versões',
          dataVersions: [`v${prev.versionNumber}`, `v${latest.versionNumber}`],
          durationMs: Date.now() - started,
        };
      }

      case 'query_operational_memory': {
        const memoryType =
          args.memoryType !== undefined && args.memoryType !== null
            ? assertValidEnum(args.memoryType, 'memoryType', VALID_MEMORY_TYPES)
            : undefined;
        const memories = await listOperationalMemory(companyId, memoryType);
        return {
          ok: true,
          toolName,
          data: { count: memories.length, items: memories.slice(0, 10) },
          source: 'Memória Operacional Controlada',
          dataVersions: memories.slice(0, 5).map(m => `${m.periodRef || 'N/A'}:${m.dataVersionRef || 'N/A'}`),
          durationMs: Date.now() - started,
        };
      }

      default:
        return {
          ok: false,
          toolName,
          error: `Ferramenta desconhecida ou não autorizada: "${toolName}".`,
          source: 'Agent Tool Registry',
          dataVersions: [],
          durationMs: Date.now() - started,
        };
    }
  } catch (err: any) {
    return {
      ok: false,
      toolName,
      error: err.message || 'Erro ao executar ferramenta.',
      source: 'Agent Tool Registry',
      dataVersions: [],
      durationMs: Date.now() - started,
    };
  }
}
