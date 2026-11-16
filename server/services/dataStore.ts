import crypto from 'crypto';
import {
  connectionError,
  getDatabaseSchemaMode,
  getPersistenceMode,
  inspectDatabaseSchemaCompatibility,
  PersistenceMode,
  prisma,
  recordWriteError,
  sanitizeDatabaseErrorMessage,
  switchToMemoryDemoAtStartup,
} from '../prisma.js';
import {
  calculateDRE,
  calculateIndicators,
  RawFinancialInput,
  serializeDRE,
  serializeIndicators,
  validateFinancialInput,
} from './financialEngine.js';
import { DebtFacilityRecord } from './economicContextService.js';

export type AuthUserRole = 'USER' | 'ADMIN';

export interface UserAccessScope {
  userId: string;
  role: AuthUserRole;
}

export interface StoredCompany {
  id: string;
  ownerUserId?: string | null;
  name: string;
  cnpj?: string | null;
  industry?: string | null;
  taxRegime?: string | null;
  monthlyRevenueTier?: string | null;
  createdAt: string;
  isDemo?: boolean;
  persistenceMode: PersistenceMode;
  isPersisted: boolean;
}

export interface StoredPeriodVersion {
  id: string;
  financialPeriodId: string;
  versionNumber: number;
  grossRevenue: number;
  netRevenue: number;
  cmv: number;
  variableExpenses: number;
  contributionMargin: number;
  fixedExpenses: number;
  operatingResult: number;
  depreciation: number;
  ebit: number;
  ebitda: number;
  financialResult: number;
  lair: number;
  netProfit: number;
  operatingBreakEven: number;
  financialBreakEven: number;
  rawData: RawFinancialInput;
  validationSummary?: any;
  changeReason?: string | null;
  createdAt: string;
  persistenceMode?: PersistenceMode;
  isPersisted?: boolean;
}

export interface StoredPeriod {
  id: string;
  companyId: string;
  year: number;
  month: number | null;
  periodType: string;
  status: string;
  createdAt: string;
  versions: StoredPeriodVersion[];
  persistenceMode: PersistenceMode;
  isPersisted: boolean;
}

export interface StoredOperationalMemory {
  id: string;
  companyId: string;
  memoryType: 'SCENARIO' | 'DIAGNOSTIC' | 'DECISION' | 'REPORT' | 'INSIGHT' | 'RISK_ALERT';
  title: string;
  summary: string;
  structuredData?: any;
  periodRef?: string | null;
  dataVersionRef?: string | null;
  createdBy?: string | null;
  createdAt: string;
  persistenceMode?: PersistenceMode;
  isPersisted?: boolean;
  duplicatePrevented?: boolean;
}

export interface StoredAgentLog {
  id: string;
  executionId: string;
  companyId?: string | null;
  question: string;
  periodRef?: string | null;
  dataVersionsUsed?: any;
  toolsCalled: string[];
  validatedArgs?: any;
  toolResults?: any;
  modelUsed: string;
  provider: 'GEMINI' | 'LOCAL_FALLBACK';
  tokenUsage?: any;
  durationMs: number;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  error?: string | null;
  finalResponse?: string | null;
  createdAt: string;
  persistenceMode?: PersistenceMode;
  isPersisted?: boolean;
}

export interface StoredAutomationRun {
  id: string;
  companyId?: string | null;
  workflowType: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'NEEDS_CORRECTION';
  steps: Array<{
    step: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
    detail?: string;
    durationMs?: number;
  }>;
  metrics?: any;
  errorMessage?: string | null;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  persistenceMode?: PersistenceMode;
  isPersisted?: boolean;
}

export interface StoredBusinessBaseline {
  id: string;
  companyId: string;
  manualSpreadsheetMinutes: number;
  manualDiagnosticMinutes: number;
  manualReportMinutes: number;
  notes?: string | null;
  recordedAt: string;
  persistenceMode?: PersistenceMode;
  isPersisted?: boolean;
}

export interface StoredEvaluationRun {
  id: string;
  suiteName: string;
  modelUsed: string;
  provider: string;
  totalCases: number;
  passedCases: number;
  scorePct: number;
  results: any[];
  durationMs: number;
  createdAt: string;
  persistenceMode?: PersistenceMode;
  isPersisted?: boolean;
}

export interface StoredReport {
  id: string;
  companyId: string;
  reportType: string;
  provider: string;
  prompt?: string | null;
  response: string;
  metadata?: any;
  createdAt: string;
  persistenceMode?: PersistenceMode;
  isPersisted?: boolean;
}

// In-memory repository strictly used when getPersistenceMode() === 'MEMORY_DEMO'
const memCompanies: StoredCompany[] = [];
const memPeriods: StoredPeriod[] = [];
const memDebts: Map<string, DebtFacilityRecord[]> = new Map();
const memMemories: StoredOperationalMemory[] = [];
const memAgentLogs: StoredAgentLog[] = [];
const memAutomationRuns: StoredAutomationRun[] = [];
const memBaselines: StoredBusinessBaseline[] = [];
const memEvaluationRuns: StoredEvaluationRun[] = [];
const memReports: StoredReport[] = [];

let memorySeeded = false;

function makeVersionFromInput(
  id: string,
  periodId: string,
  versionNumber: number,
  rawData: RawFinancialInput,
  changeReason: string,
  createdAt: string,
  mode: PersistenceMode = 'MEMORY_DEMO'
): StoredPeriodVersion {
  const dre = calculateDRE(rawData);
  const validationSummary = validateFinancialInput(rawData);
  return {
    id,
    financialPeriodId: periodId,
    versionNumber,
    grossRevenue: dre.grossRevenue.toNumber(),
    netRevenue: dre.netRevenue.toNumber(),
    cmv: dre.cmv.toNumber(),
    variableExpenses: dre.variableExpenses.toNumber(),
    contributionMargin: dre.contributionMargin.toNumber(),
    fixedExpenses: dre.fixedExpenses.toNumber(),
    operatingResult: dre.operatingResult.toNumber(),
    depreciation: dre.depreciation.toNumber(),
    ebit: dre.ebit.toNumber(),
    ebitda: dre.ebitda.toNumber(),
    financialResult: dre.financialResult.toNumber(),
    lair: dre.lair.toNumber(),
    netProfit: dre.netProfit.toNumber(),
    operatingBreakEven: dre.operatingBreakEven.toNumber(),
    financialBreakEven: dre.financialBreakEven.toNumber(),
    rawData,
    validationSummary,
    changeReason,
    createdAt,
    persistenceMode: mode,
    isPersisted: mode === 'POSTGRESQL',
  };
}

function seedInMemoryDemoData() {
  if (memorySeeded) return;
  memorySeeded = true;

  const alphaId = 'demo-company-1';
  const horizonteId = 'demo-company-2';

  memCompanies.push(
    {
      id: alphaId,
      ownerUserId: null,
      name: 'Varejo Alpha Vestuário Ltda [DEMONSTRAÇÃO]',
      cnpj: '12.345.678/0001-99',
      industry: 'Varejo de Vestuário',
      taxRegime: 'Lucro Real',
      monthlyRevenueTier: 'R$ 1,3M - 1,6M/mês',
      createdAt: '2026-08-01T10:00:00.000Z',
      isDemo: true,
      persistenceMode: 'MEMORY_DEMO',
      isPersisted: false,
    },
    {
      id: horizonteId,
      ownerUserId: null,
      name: 'Boutique Horizonte Moda Ltda [DEMONSTRAÇÃO - Simples]',
      cnpj: '98.765.432/0001-10',
      industry: 'Varejo de Vestuário (Micro/Pequena Empresa)',
      taxRegime: 'Simples Nacional',
      monthlyRevenueTier: 'R$ 160k - 220k/mês',
      createdAt: '2026-08-05T10:00:00.000Z',
      isDemo: true,
      persistenceMode: 'MEMORY_DEMO',
      isPersisted: false,
    }
  );

  // Alpha multi-period history (Ago, Set, Out 2026) with Out/2026 having v1 & v2
  const alphaPeriods: Array<{ id: string; year: number; month: number; versions: StoredPeriodVersion[] }> = [
    {
      id: 'demo-alpha-2026-10',
      year: 2026,
      month: 10,
      versions: [
        makeVersionFromInput(
          'demo-alpha-2026-10-v2',
          'demo-alpha-2026-10',
          2,
          {
            grossRevenue: 1500000,
            deductions: 200000,
            cmv: 550000,
            variableExpenses: 100000,
            fixedExpenses: 400000,
            depreciation: 40000,
            financialRevenues: 10000,
            financialExpenses: 25000,
            taxes: 29250,
            taxRegime: 'Lucro Real',
            cashAndEquivalents: 240000,
            accountsReceivable: 410000,
            inventory: 550000,
            accountsPayable: 310000,
            currentAssets: 1200000,
            currentLiabilities: 800000,
            totalAssets: 3500000,
            totalDebt: 1500000,
            equity: 2000000,
            salesVolume: 6250,
            averageTicket: 240,
          },
          'Fechamento revisado Out/2026 (v2 - inclusão de conciliação de estoques e recebíveis)',
          '2026-11-05T14:30:00.000Z'
        ),
        makeVersionFromInput(
          'demo-alpha-2026-10-v1',
          'demo-alpha-2026-10',
          1,
          {
            grossRevenue: 1500000,
            deductions: 200000,
            cmv: 565000,
            variableExpenses: 105000,
            fixedExpenses: 405000,
            depreciation: 40000,
            financialRevenues: 10000,
            financialExpenses: 25000,
            taxes: 24500,
            taxRegime: 'Lucro Real',
            currentAssets: 1180000,
            currentLiabilities: 800000,
            totalAssets: 3480000,
            totalDebt: 1500000,
            equity: 1980000,
          },
          'Pré-fechamento Out/2026 (v1)',
          '2026-11-02T09:15:00.000Z'
        ),
      ],
    },
    {
      id: 'demo-alpha-2026-09',
      year: 2026,
      month: 9,
      versions: [
        makeVersionFromInput(
          'demo-alpha-2026-09-v1',
          'demo-alpha-2026-09',
          1,
          {
            grossRevenue: 1620000,
            deductions: 216000,
            cmv: 575000,
            variableExpenses: 108000,
            fixedExpenses: 392000,
            depreciation: 40000,
            financialRevenues: 11000,
            financialExpenses: 23500,
            taxes: 40000,
            taxRegime: 'Lucro Real',
            cashAndEquivalents: 290000,
            accountsReceivable: 430000,
            inventory: 520000,
            accountsPayable: 300000,
            currentAssets: 1240000,
            currentLiabilities: 770000,
            totalAssets: 3560000,
            totalDebt: 1530000,
            equity: 2030000,
            salesVolume: 6612,
            averageTicket: 245,
          },
          'Fechamento Set/2026 (dados fictícios de demonstração)',
          '2026-10-06T11:00:00.000Z'
        ),
      ],
    },
    {
      id: 'demo-alpha-2026-08',
      year: 2026,
      month: 8,
      versions: [
        makeVersionFromInput(
          'demo-alpha-2026-08-v1',
          'demo-alpha-2026-08',
          1,
          {
            grossRevenue: 1560000,
            deductions: 208000,
            cmv: 560000,
            variableExpenses: 102000,
            fixedExpenses: 388000,
            depreciation: 40000,
            financialRevenues: 10500,
            financialExpenses: 22800,
            taxes: 37500,
            taxRegime: 'Lucro Real',
            cashAndEquivalents: 275000,
            accountsReceivable: 405000,
            inventory: 505000,
            accountsPayable: 295000,
            currentAssets: 1185000,
            currentLiabilities: 760000,
            totalAssets: 3510000,
            totalDebt: 1560000,
            equity: 1950000,
            salesVolume: 6420,
            averageTicket: 243,
          },
          'Fechamento Ago/2026 (dados fictícios de demonstração)',
          '2026-09-05T10:20:00.000Z'
        ),
      ],
    },
  ];

  // Horizonte (Simples Nacional SME Clothing Retail) multi-period
  const horizontePeriods: Array<{ id: string; year: number; month: number; versions: StoredPeriodVersion[] }> = [
    {
      id: 'demo-horizonte-2026-10',
      year: 2026,
      month: 10,
      versions: [
        makeVersionFromInput(
          'demo-horizonte-2026-10-v1',
          'demo-horizonte-2026-10',
          1,
          {
            grossRevenue: 185000,
            deductions: 17575,
            cmv: 81400,
            variableExpenses: 14800,
            fixedExpenses: 52000,
            depreciation: 2500,
            financialRevenues: 600,
            financialExpenses: 4800,
            taxes: 0,
            taxRegime: 'Simples Nacional',
            cashAndEquivalents: 28000,
            inventory: 115000,
            currentAssets: 182000,
            currentLiabilities: 138000,
            totalAssets: 340000,
            totalDebt: 145000,
            equity: 195000,
            salesVolume: 880,
            averageTicket: 210.23,
          },
          'Fechamento Out/2026 - Simples Nacional (faltam recebíveis/fornecedores para ciclo financeiro)',
          '2026-11-04T16:00:00.000Z'
        ),
      ],
    },
    {
      id: 'demo-horizonte-2026-09',
      year: 2026,
      month: 9,
      versions: [
        makeVersionFromInput(
          'demo-horizonte-2026-09-v1',
          'demo-horizonte-2026-09',
          1,
          {
            grossRevenue: 205000,
            deductions: 19475,
            cmv: 86100,
            variableExpenses: 16400,
            fixedExpenses: 51200,
            depreciation: 2500,
            financialRevenues: 700,
            financialExpenses: 4600,
            taxes: 0,
            taxRegime: 'Simples Nacional',
            cashAndEquivalents: 36000,
            accountsReceivable: 42000,
            inventory: 108000,
            accountsPayable: 49000,
            currentAssets: 186000,
            currentLiabilities: 130000,
            totalAssets: 350000,
            totalDebt: 150000,
            equity: 200000,
            salesVolume: 960,
            averageTicket: 213.54,
          },
          'Fechamento Set/2026 - Simples Nacional',
          '2026-10-04T12:00:00.000Z'
        ),
      ],
    },
  ];

  for (const p of [...alphaPeriods, ...horizontePeriods]) {
    memPeriods.push({
      id: p.id,
      companyId: p.id.includes('alpha') ? alphaId : horizonteId,
      year: p.year,
      month: p.month,
      periodType: 'MONTHLY',
      status: 'VALIDATED',
      createdAt: p.versions[0].createdAt,
      versions: p.versions,
      persistenceMode: 'MEMORY_DEMO',
      isPersisted: false,
    });
  }

  memDebts.set(alphaId, [
    {
      id: 'debt-alpha-1',
      name: 'Capital de Giro Bancário',
      lender: 'Banco Comercial A',
      principal: 900000,
      outstandingBalance: 750000,
      indexer: 'CDI',
      spreadAnnualPct: 4.2,
      monthlyPayment: 28500,
      maturityDate: '2028-06-15',
      notes: 'Linha pós-fixada sujeita a variações de CDI/Selic',
    },
    {
      id: 'debt-alpha-2',
      name: 'Pronampe Giro',
      lender: 'Banco Público B',
      principal: 450000,
      outstandingBalance: 350000,
      indexer: 'SELIC',
      spreadAnnualPct: 6.0,
      monthlyPayment: 14200,
      maturityDate: '2027-11-30',
      notes: 'Indexado à taxa Selic + 6% a.a.',
    },
    {
      id: 'debt-alpha-3',
      name: 'Financiamento Mobiliário & PDV (Pré-fixado)',
      lender: 'Financeira C',
      principal: 500000,
      outstandingBalance: 400000,
      indexer: 'PRE_FIXADO',
      spreadAnnualPct: 14.5,
      monthlyPayment: 15900,
      maturityDate: '2028-03-01',
      notes: 'Taxa pré-fixada: não sofre choque direto imediato da Selic',
    },
  ]);

  memDebts.set(horizonteId, [
    {
      id: 'debt-horizonte-1',
      name: 'Pronampe Varejo',
      lender: 'Banco Público B',
      principal: 120000,
      outstandingBalance: 95000,
      indexer: 'SELIC',
      spreadAnnualPct: 6.0,
      monthlyPayment: 3900,
      maturityDate: '2028-04-20',
      notes: 'Pós-fixado Selic + 6% a.a.',
    },
    {
      id: 'debt-horizonte-2',
      name: 'Parcelamento Cartão / Equipamentos (Pré-fixado)',
      lender: 'Fintech D',
      principal: 65000,
      outstandingBalance: 50000,
      indexer: 'PRE_FIXADO',
      spreadAnnualPct: 16.8,
      monthlyPayment: 2450,
      maturityDate: '2027-08-10',
      notes: 'Contrato com parcela fixa mensal',
    },
  ]);

  memMemories.push({
    id: 'mem-demo-1',
    companyId: alphaId,
    memoryType: 'DECISION',
    title: 'Meta de Redução de Despesas Fixas em 5%',
    summary: 'Diretoria registrou meta de renegociar contratos de loja e logística para reduzir despesas fixas de R$ 400 mil para R$ 380 mil até Q1/2027.',
    structuredData: { targetFixedExpenses: 380000, horizon: 'Q1 2027' },
    periodRef: '2026-10',
    dataVersionRef: 'v2',
    createdBy: 'Gestor Financeiro',
    createdAt: '2026-11-06T11:00:00.000Z',
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
  });
}

seedInMemoryDemoData();

function isPostgresActive(): boolean {
  return getPersistenceMode() === 'POSTGRESQL';
}

interface LegacyCompanyNotesEnvelope {
  _afiEnvelope: true;
  debts: DebtFacilityRecord[];
  reports: StoredReport[];
  memories: StoredOperationalMemory[];
  agentLogs: StoredAgentLog[];
  automationRuns: StoredAutomationRun[];
  baselines: StoredBusinessBaseline[];
  evaluationRuns?: StoredEvaluationRun[];
}

function parseLegacyNotesEnvelope(rawNotes?: string | null): LegacyCompanyNotesEnvelope {
  const empty: LegacyCompanyNotesEnvelope = {
    _afiEnvelope: true,
    debts: [],
    reports: [],
    memories: [],
    agentLogs: [],
    automationRuns: [],
    baselines: [],
    evaluationRuns: [],
  };
  if (!rawNotes || typeof rawNotes !== 'string') return empty;
  try {
    const parsed = JSON.parse(rawNotes);
    if (parsed && typeof parsed === 'object' && parsed._afiEnvelope) {
      return {
        _afiEnvelope: true,
        debts: Array.isArray(parsed.debts) ? parsed.debts : [],
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        agentLogs: Array.isArray(parsed.agentLogs) ? parsed.agentLogs : [],
        automationRuns: Array.isArray(parsed.automationRuns) ? parsed.automationRuns : [],
        baselines: Array.isArray(parsed.baselines) ? parsed.baselines : [],
        evaluationRuns: Array.isArray(parsed.evaluationRuns) ? parsed.evaluationRuns : [],
      };
    }
  } catch {
    // Non-JSON legacy note
  }
  return empty;
}

async function getLegacyCompanyEnvelope(companyId: string): Promise<LegacyCompanyNotesEnvelope> {
  if (!prisma) throw new Error('Conexão com PostgreSQL indisponível.');
  const rows = (await prisma.$queryRaw`
    SELECT "id", "notes" FROM "Company" WHERE "id" = ${companyId} LIMIT 1
  `) as Array<{ id: string; notes: string | null }>;
  if (!rows[0]) {
    throw new Error(`Empresa (${companyId}) não encontrada no PostgreSQL.`);
  }
  return parseLegacyNotesEnvelope(rows[0].notes);
}

async function saveLegacyCompanyEnvelope(companyId: string, env: LegacyCompanyNotesEnvelope): Promise<void> {
  if (!prisma) throw new Error('Conexão com PostgreSQL indisponível.');
  const serialized = JSON.stringify(env);
  await prisma.$executeRaw`
    UPDATE "Company"
    SET "notes" = ${serialized}, "updatedAt" = NOW()
    WHERE "id" = ${companyId}
  `;
}

async function ensureSchemaInspected() {
  if (!isPostgresActive() || !prisma) return 'UNVERIFIED';
  const current = getDatabaseSchemaMode();
  if (current === 'UNVERIFIED') {
    return await inspectDatabaseSchemaCompatibility();
  }
  return current;
}

export async function ensureDemoCompaniesInDb() {
  if (!isPostgresActive() || !prisma) return;
  try {
    await inspectDatabaseSchemaCompatibility();
    if (process.env.SKIP_DEMO_COMPANIES_SEED === 'true') {
      return;
    }
    const existing = await listCompanies();
    const demoTemplates = memCompanies.filter(
      comp => comp.id === 'demo-company-1' || comp.id === 'demo-company-2'
    );
    for (const comp of demoTemplates) {
      const alreadyExists = existing.some(
        c => c.id === comp.id || (comp.cnpj && c.cnpj === comp.cnpj) || c.name === comp.name
      );
      if (alreadyExists) continue;

      const createdComp = await createCompany({
        id: comp.id,
        name: comp.name,
        cnpj: comp.cnpj || undefined,
        industry: comp.industry || undefined,
        taxRegime: comp.taxRegime || 'Lucro Real',
        monthlyRevenueTier: comp.monthlyRevenueTier || undefined,
      });

      const periods = memPeriods.filter(p => p.companyId === comp.id);
      for (const p of [...periods].reverse()) {
        for (const v of [...p.versions].reverse()) {
          await saveFinancialPeriodVersion({
            companyId: createdComp.id,
            year: p.year,
            month: p.month,
            periodType: p.periodType,
            financialData: v.rawData,
            changeReason: v.changeReason || undefined,
          });
        }
      }

      const debts = memDebts.get(comp.id) || [];
      for (const d of debts) {
        await addDebtFacility(createdComp.id, d);
      }

      const memories = memMemories.filter(m => m.companyId === comp.id);
      for (const m of memories) {
        await createOperationalMemory({
          companyId: createdComp.id,
          memoryType: m.memoryType,
          title: m.title,
          summary: m.summary,
          structuredData: m.structuredData,
          periodRef: m.periodRef || undefined,
          dataVersionRef: m.dataVersionRef || undefined,
          createdBy: m.createdBy || 'Gestor Financeiro',
        });
      }
    }
  } catch (err: any) {
    const safeReason = sanitizeDatabaseErrorMessage(err);
    console.warn(`[PERSISTENCE_STARTUP] Aviso ao verificar schema inicial no PostgreSQL: ${safeReason}`);
  }
}

export function canUserAccessCompany(
  company: Pick<StoredCompany, 'ownerUserId'> | null | undefined,
  scope?: UserAccessScope
): boolean {
  if (!company) return false;
  if (!scope) return true;
  if (scope.role === 'ADMIN') {
    // ADMIN can access their own companies plus legacy/pre-migration unassigned records (ownerUserId == null)
    return !company.ownerUserId || company.ownerUserId === scope.userId;
  }
  // Standard USER can ONLY access companies explicitly owned by their userId
  return Boolean(company.ownerUserId && company.ownerUserId === scope.userId);
}

export async function listCompanies(scope?: UserAccessScope): Promise<StoredCompany[]> {
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível no momento.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const rows = (await prisma.$queryRaw`
          SELECT "id", "ownerUserId", "tradeName", "cnpj", "sector", "taxRegime", "annualRevenueBand", "isDemonstration", "createdAt"
          FROM "Company"
          ORDER BY "createdAt" DESC
        `) as Array<{
          id: string;
          ownerUserId?: string | null;
          tradeName: string;
          cnpj: string | null;
          sector: string | null;
          taxRegime: string | null;
          annualRevenueBand: string | null;
          isDemonstration: boolean;
          createdAt: Date;
        }>;

        const filteredRows = scope ? rows.filter(r => canUserAccessCompany(r, scope)) : rows;
        const result: any[] = [];
        for (const r of filteredRows) {
          const periods = await getCompanyPeriods(r.id);
          result.push({
            id: r.id,
            ownerUserId: r.ownerUserId ?? null,
            name: r.tradeName,
            cnpj: r.cnpj,
            industry: r.sector,
            taxRegime: r.taxRegime,
            monthlyRevenueTier: r.annualRevenueBand,
            createdAt: new Date(r.createdAt).toISOString(),
            isDemo: Boolean(r.isDemonstration || r.tradeName.includes('DEMONSTRAÇÃO')),
            persistenceMode: 'POSTGRESQL',
            isPersisted: true,
            periods,
          });
        }
        return result;
      }

      const whereClause = scope
        ? scope.role === 'ADMIN'
          ? { OR: [{ ownerUserId: scope.userId }, { ownerUserId: null }] }
          : { ownerUserId: scope.userId }
        : undefined;

      const rows = await prisma.company.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        include: {
          periods: {
            include: {
              versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
            },
          },
        },
      });
      return rows.map(r => ({
        ...r,
        ownerUserId: r.ownerUserId ?? null,
        createdAt: r.createdAt.toISOString(),
        isDemo: r.name.includes('DEMONSTRAÇÃO'),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      })) as any;
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      console.error(`[POSTGRESQL_READ_ERROR] Falha ao listar empresas: ${safeMsg}`);
      throw new Error(`Falha ao consultar empresas no PostgreSQL: ${safeMsg}`);
    }
  }
  const filteredMem = scope ? memCompanies.filter(c => canUserAccessCompany(c, scope)) : memCompanies;
  return filteredMem.map(c => ({
    ...c,
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
    periods: memPeriods
      .filter(p => p.companyId === c.id)
      .sort((a, b) => b.year - a.year || (b.month || 0) - (a.month || 0)),
  })) as any;
}

export async function getCompanyById(companyId: string, scope?: UserAccessScope): Promise<StoredCompany | null> {
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível no momento.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const rows = (await prisma.$queryRaw`
          SELECT "id", "ownerUserId", "tradeName", "cnpj", "sector", "taxRegime", "annualRevenueBand", "isDemonstration", "createdAt"
          FROM "Company"
          WHERE "id" = ${companyId}
          LIMIT 1
        `) as Array<{
          id: string;
          ownerUserId?: string | null;
          tradeName: string;
          cnpj: string | null;
          sector: string | null;
          taxRegime: string | null;
          annualRevenueBand: string | null;
          isDemonstration: boolean;
          createdAt: Date;
        }>;
        const r = rows[0];
        if (!r) return null;
        const comp: StoredCompany = {
          id: r.id,
          ownerUserId: r.ownerUserId ?? null,
          name: r.tradeName,
          cnpj: r.cnpj,
          industry: r.sector,
          taxRegime: r.taxRegime,
          monthlyRevenueTier: r.annualRevenueBand,
          createdAt: new Date(r.createdAt).toISOString(),
          isDemo: Boolean(r.isDemonstration || r.tradeName.includes('DEMONSTRAÇÃO')),
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        };
        return canUserAccessCompany(comp, scope) ? comp : null;
      }

      const comp = await prisma.company.findUnique({ where: { id: companyId } });
      if (!comp) return null;
      const mapped: StoredCompany = {
        ...comp,
        ownerUserId: comp.ownerUserId ?? null,
        createdAt: comp.createdAt.toISOString(),
        isDemo: comp.name.includes('DEMONSTRAÇÃO'),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      };
      return canUserAccessCompany(mapped, scope) ? mapped : null;
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      console.error(`[POSTGRESQL_READ_ERROR] Falha ao buscar empresa ${companyId}: ${safeMsg}`);
      throw new Error(`Falha ao buscar empresa no PostgreSQL: ${safeMsg}`);
    }
  }
  const found = memCompanies.find(c => c.id === companyId) || null;
  return canUserAccessCompany(found, scope) ? found : null;
}

export async function getCompanyAccessCheck(
  companyId: string,
  scope?: UserAccessScope
): Promise<{ exists: boolean; authorized: boolean; company: StoredCompany | null }> {
  const rawCompany = await getCompanyById(companyId);
  if (!rawCompany) {
    return { exists: false, authorized: false, company: null };
  }
  const authorized = canUserAccessCompany(rawCompany, scope);
  return {
    exists: true,
    authorized,
    company: authorized ? rawCompany : null,
  };
}

export async function claimLegacyCompaniesForAdmin(adminUserId: string): Promise<number> {
  if (!adminUserId) return 0;
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível.');
    }
    try {
      const res = await prisma.company.updateMany({
        where: { ownerUserId: null },
        data: { ownerUserId: adminUserId },
      });
      return res.count;
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao vincular empresas existentes ao administrador: ${safeMsg}`);
    }
  }
  let count = 0;
  for (const c of memCompanies) {
    if (!c.ownerUserId) {
      c.ownerUserId = adminUserId;
      count++;
    }
  }
  return count;
}

export async function createCompany(data: {
  id?: string;
  ownerUserId?: string | null;
  name: string;
  cnpj?: string;
  industry?: string;
  taxRegime?: string;
  monthlyRevenueTier?: string;
}): Promise<StoredCompany> {
  const normalizedCnpj = data.cnpj && data.cnpj.trim() ? data.cnpj.trim() : null;
  if (isPostgresActive()) {
    try {
      if (!prisma) {
        throw new Error('Conexão com PostgreSQL indisponível no momento.');
      }
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const newId = data.id || crypto.randomUUID();
        const industryVal = data.industry || 'Geral';
        const regimeVal = data.taxRegime || 'Simples Nacional';
        const tierVal = data.monthlyRevenueTier || null;
        const ownerVal = data.ownerUserId ?? null;
        const isDemo = data.name.includes('DEMONSTRAÇÃO');
        const initialEnvelope = JSON.stringify({
          _afiEnvelope: true,
          debts: [],
          reports: [],
          memories: [],
          agentLogs: [],
          automationRuns: [],
          baselines: [],
          evaluationRuns: [],
        });

        const inserted = (await prisma.$queryRaw`
          INSERT INTO "Company" (
            "id", "ownerUserId", "tradeName", "legalName", "cnpj", "sector", "taxRegime",
            "annualRevenueBand", "status", "isDemonstration", "notes", "createdAt", "updatedAt"
          ) VALUES (
            ${newId}, ${ownerVal}, ${data.name}, ${data.name}, ${normalizedCnpj}, ${industryVal}, ${regimeVal},
            ${tierVal}, 'active', ${isDemo}, ${initialEnvelope}, NOW(), NOW()
          )
          RETURNING "id", "ownerUserId", "tradeName", "cnpj", "sector", "taxRegime", "annualRevenueBand", "isDemonstration", "createdAt"
        `) as Array<{
          id: string;
          ownerUserId?: string | null;
          tradeName: string;
          cnpj: string | null;
          sector: string | null;
          taxRegime: string | null;
          annualRevenueBand: string | null;
          isDemonstration: boolean;
          createdAt: Date;
        }>;

        const row = inserted[0];
        return {
          id: row.id,
          ownerUserId: row.ownerUserId ?? null,
          name: row.tradeName,
          cnpj: row.cnpj,
          industry: row.sector,
          taxRegime: row.taxRegime,
          monthlyRevenueTier: row.annualRevenueBand,
          createdAt: new Date(row.createdAt).toISOString(),
          isDemo: row.isDemonstration,
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        };
      }

      const created = await prisma.company.create({
        data: {
          ...(data.id ? { id: data.id } : {}),
          ...(data.ownerUserId !== undefined ? { ownerUserId: data.ownerUserId } : {}),
          name: data.name,
          cnpj: normalizedCnpj ?? undefined,
          industry: data.industry || 'Geral',
          taxRegime: data.taxRegime || 'Simples Nacional',
          monthlyRevenueTier: data.monthlyRevenueTier || undefined,
        },
      });
      return {
        ...created,
        ownerUserId: created.ownerUserId ?? null,
        createdAt: created.createdAt.toISOString(),
        isDemo: created.name.includes('DEMONSTRAÇÃO'),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      };
    } catch (err: any) {
      // NEVER silently fall back to memory when in POSTGRESQL mode!
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha de persistência no PostgreSQL ao criar empresa (sem fallback em memória): ${safeMsg}`);
    }
  }

  // Strictly in MEMORY_DEMO mode
  if (normalizedCnpj) {
    const duplicateCnpj = memCompanies.find(c => c.cnpj === normalizedCnpj);
    if (duplicateCnpj) {
      throw new Error(`Já existe uma empresa cadastrada com o CNPJ ${normalizedCnpj} no modo de demonstração.`);
    }
  }

  const newComp: StoredCompany = {
    id: data.id || `comp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ownerUserId: data.ownerUserId ?? null,
    name: data.name,
    cnpj: normalizedCnpj,
    industry: data.industry || 'Geral',
    taxRegime: data.taxRegime || 'Simples Nacional',
    monthlyRevenueTier: data.monthlyRevenueTier || null,
    createdAt: new Date().toISOString(),
    isDemo: false,
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
  };
  memCompanies.unshift(newComp);
  return newComp;
}

export async function deleteCompanyById(companyId: string, scope?: UserAccessScope): Promise<boolean> {
  if (scope) {
    const access = await getCompanyAccessCheck(companyId, scope);
    if (!access.exists || !access.authorized) {
      return false;
    }
  }
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível no momento.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const count = await prisma.$executeRaw`
          DELETE FROM "Company" WHERE "id" = ${companyId}
        `;
        return Number(count) > 0;
      }
      const existing = await prisma.company.findUnique({ where: { id: companyId } });
      if (!existing) return false;
      await prisma.company.delete({ where: { id: companyId } });
      return true;
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao excluir empresa no PostgreSQL: ${safeMsg}`);
    }
  }
  const idx = memCompanies.findIndex(c => c.id === companyId);
  if (idx === -1) return false;
  memCompanies.splice(idx, 1);
  return true;
}

export async function getCompanyPeriods(companyId: string): Promise<StoredPeriod[]> {
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível no momento.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const periodRows = (await prisma.$queryRaw`
          SELECT "id", "companyId", "periodMonth", "periodYear", "status", "createdAt"
          FROM "FinancialPeriod"
          WHERE "companyId" = ${companyId}
          ORDER BY "periodYear" DESC, "periodMonth" DESC
        `) as Array<{
          id: string;
          companyId: string;
          periodMonth: number;
          periodYear: number;
          status: string;
          createdAt: Date;
        }>;

        const results: StoredPeriod[] = [];
        for (const p of periodRows) {
          const verRows = (await prisma.$queryRaw`
            SELECT "id", "periodId", "versionNumber", "importedAt", "rawInputs", "calculatedResults", "missingFields", "changeNotes"
            FROM "FinancialPeriodVersion"
            WHERE "periodId" = ${p.id}
            ORDER BY "versionNumber" DESC
          `) as Array<{
            id: string;
            periodId: string;
            versionNumber: number;
            importedAt: Date;
            rawInputs: any;
            calculatedResults: any;
            missingFields: any;
            changeNotes: string | null;
          }>;

          const mappedVersions: StoredPeriodVersion[] = verRows.map(v => {
            const calc = v.calculatedResults || {};
            const raw = v.rawInputs || {};
            const fallbackDre = calc.grossRevenue !== undefined ? null : calculateDRE(raw);
            return {
              id: v.id,
              financialPeriodId: v.periodId,
              versionNumber: Number(v.versionNumber),
              grossRevenue: Number(calc.grossRevenue ?? fallbackDre?.grossRevenue.toNumber() ?? 0),
              netRevenue: Number(calc.netRevenue ?? fallbackDre?.netRevenue.toNumber() ?? 0),
              cmv: Number(calc.cmv ?? fallbackDre?.cmv.toNumber() ?? 0),
              variableExpenses: Number(calc.variableExpenses ?? fallbackDre?.variableExpenses.toNumber() ?? 0),
              contributionMargin: Number(calc.contributionMargin ?? fallbackDre?.contributionMargin.toNumber() ?? 0),
              fixedExpenses: Number(calc.fixedExpenses ?? fallbackDre?.fixedExpenses.toNumber() ?? 0),
              operatingResult: Number(calc.operatingResult ?? fallbackDre?.operatingResult.toNumber() ?? 0),
              depreciation: Number(calc.depreciation ?? fallbackDre?.depreciation.toNumber() ?? 0),
              ebit: Number(calc.ebit ?? fallbackDre?.ebit.toNumber() ?? 0),
              ebitda: Number(calc.ebitda ?? fallbackDre?.ebitda.toNumber() ?? 0),
              financialResult: Number(calc.financialResult ?? fallbackDre?.financialResult.toNumber() ?? 0),
              lair: Number(calc.lair ?? fallbackDre?.lair.toNumber() ?? 0),
              netProfit: Number(calc.netProfit ?? fallbackDre?.netProfit.toNumber() ?? 0),
              operatingBreakEven: Number(calc.operatingBreakEven ?? fallbackDre?.operatingBreakEven.toNumber() ?? 0),
              financialBreakEven: Number(calc.financialBreakEven ?? fallbackDre?.financialBreakEven.toNumber() ?? 0),
              rawData: raw,
              validationSummary: calc.validationSummary ?? validateFinancialInput(raw),
              changeReason: v.changeNotes,
              createdAt: new Date(v.importedAt).toISOString(),
              persistenceMode: 'POSTGRESQL',
              isPersisted: true,
            };
          });

          const firstCalc = verRows[0]?.calculatedResults || {};
          results.push({
            id: p.id,
            companyId: p.companyId,
            year: Number(p.periodYear),
            month: p.periodMonth === 0 ? null : Number(p.periodMonth),
            periodType: firstCalc.periodType || (p.periodMonth === 0 ? 'ANNUAL' : 'MONTHLY'),
            status: p.status === 'active' ? 'VALIDATED' : p.status,
            createdAt: new Date(p.createdAt).toISOString(),
            versions: mappedVersions,
            persistenceMode: 'POSTGRESQL',
            isPersisted: true,
          });
        }
        return results;
      }

      const periods = await prisma.financialPeriod.findMany({
        where: { companyId },
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      return periods.map(p => ({
        id: p.id,
        companyId: p.companyId,
        year: p.year,
        month: p.month,
        periodType: p.periodType,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
        versions: p.versions.map(v => ({
          id: v.id,
          financialPeriodId: v.financialPeriodId,
          versionNumber: v.versionNumber,
          grossRevenue: Number(v.grossRevenue || 0),
          netRevenue: Number(v.netRevenue || 0),
          cmv: Number(v.cmv || 0),
          variableExpenses: Number(v.variableExpenses || 0),
          contributionMargin: Number(v.contributionMargin || 0),
          fixedExpenses: Number(v.fixedExpenses || 0),
          operatingResult: Number(v.operatingResult || 0),
          depreciation: Number(v.depreciation || 0),
          ebit: Number(v.ebit || 0),
          ebitda: Number(v.ebitda || 0),
          financialResult: Number(v.financialResult || 0),
          lair: Number(v.lair || 0),
          netProfit: Number(v.netProfit || 0),
          operatingBreakEven: Number(v.operatingBreakEven || 0),
          financialBreakEven: Number(v.financialBreakEven || 0),
          rawData: (v.rawData as any) || {},
          validationSummary: v.validationSummary,
          changeReason: v.changeReason,
          createdAt: v.createdAt.toISOString(),
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        })),
      }));
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      console.error(`[POSTGRESQL_READ_ERROR] Falha ao buscar períodos de ${companyId}: ${safeMsg}`);
      throw new Error(`Falha ao buscar períodos no PostgreSQL: ${safeMsg}`);
    }
  }
  return memPeriods
    .filter(p => p.companyId === companyId)
    .sort((a, b) => b.year - a.year || (b.month || 0) - (a.month || 0));
}

function canonicalFinancialSignature(input: RawFinancialInput): string {
  const keys = Object.keys(input).sort() as Array<keyof RawFinancialInput>;
  const normalized: Record<string, any> = {};
  for (const k of keys) {
    if (input[k] !== undefined && input[k] !== null && input[k] !== '') {
      normalized[k] = String(input[k]);
    }
  }
  return JSON.stringify(normalized);
}

export async function saveFinancialPeriodVersion(params: {
  companyId: string;
  year: number;
  month: number | null;
  periodType: string;
  financialData: RawFinancialInput;
  changeReason?: string;
  rejectDuplicate?: boolean;
}) {
  const company = await getCompanyById(params.companyId);
  if (!company) throw new Error('Empresa não encontrada.');

  const inputWithRegime: RawFinancialInput = {
    ...params.financialData,
    taxRegime: params.financialData.taxRegime || company.taxRegime || 'Simples Nacional',
  };

  const validation = validateFinancialInput(inputWithRegime);
  if (!validation.valid) {
    throw new Error(`Dados financeiros inválidos: ${validation.errors.join(' | ')}`);
  }

  const dre = calculateDRE(inputWithRegime);
  const indicators = calculateIndicators(dre, inputWithRegime);
  const newSignature = canonicalFinancialSignature(inputWithRegime);

  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao persistir período financeiro no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const dbMonth = params.month ? Number(params.month) : 0;
        const dbYear = Number(params.year);

        const existingPeriods = (await prisma.$queryRaw`
          SELECT "id", "periodMonth", "periodYear", "status"
          FROM "FinancialPeriod"
          WHERE "companyId" = ${params.companyId}
            AND "periodYear" = ${dbYear}
            AND "periodMonth" = ${dbMonth}
          LIMIT 1
        `) as Array<{ id: string; periodMonth: number; periodYear: number; status: string }>;

        let periodId = existingPeriods[0]?.id;
        let nextVersionNumber = 1;
        let duplicateDetected = false;

        if (periodId) {
          const latestVersions = (await prisma.$queryRaw`
            SELECT "id", "versionNumber", "rawInputs"
            FROM "FinancialPeriodVersion"
            WHERE "periodId" = ${periodId}
            ORDER BY "versionNumber" DESC
            LIMIT 1
          `) as Array<{ id: string; versionNumber: number; rawInputs: any }>;

          const latestVer = latestVersions[0];
          if (latestVer) {
            nextVersionNumber = Number(latestVer.versionNumber) + 1;
            if (latestVer.rawInputs && canonicalFinancialSignature(latestVer.rawInputs) === newSignature) {
              duplicateDetected = true;
              if (params.rejectDuplicate) {
                throw new Error(
                  `Importação duplicada detectada: os dados enviados para ${params.month ? `${params.month}/` : ''}${params.year} são idênticos à versão v${latestVer.versionNumber} já salva.`
                );
              }
              return {
                periodId,
                versionId: latestVer.id,
                versionNumber: Number(latestVer.versionNumber),
                duplicateDetected: true,
                persistenceMode: 'POSTGRESQL' as PersistenceMode,
                isPersisted: true,
                dre: serializeDRE(dre),
                indicators: serializeIndicators(indicators),
                validation,
              };
            }
          }
        } else {
          periodId = crypto.randomUUID();
          const statusVal = validation.valid ? 'VALIDATED' : 'DRAFT';
          await prisma.$executeRaw`
            INSERT INTO "FinancialPeriod" (
              "id", "companyId", "periodMonth", "periodYear", "status", "createdAt", "updatedAt"
            ) VALUES (
              ${periodId}, ${params.companyId}, ${dbMonth}, ${dbYear}, ${statusVal}, NOW(), NOW()
            )
          `;
        }

        const versionId = crypto.randomUUID();
        const serializedDre = serializeDRE(dre);
        const serializedInd = serializeIndicators(indicators);
        const calculatedResultsPayload = {
          ...serializedDre,
          operatingBreakEven: dre.operatingBreakEven.toFixed(2),
          financialBreakEven: dre.financialBreakEven.toFixed(2),
          indicators: serializedInd,
          validationSummary: validation,
          periodType: params.periodType,
        };
        const missingFieldsPayload = validation.warnings || [];
        const changeNotesVal = params.changeReason || `Importação v${nextVersionNumber}`;

        await prisma.$executeRaw`
          INSERT INTO "FinancialPeriodVersion" (
            "id", "periodId", "versionNumber", "origin", "importedAt",
            "rawInputs", "calculatedResults", "missingFields", "calculatedCount", "changeNotes"
          ) VALUES (
            ${versionId}, ${periodId}, ${nextVersionNumber}, 'IMPORT_PIPELINE', NOW(),
            ${JSON.stringify(inputWithRegime)}::jsonb,
            ${JSON.stringify(calculatedResultsPayload)}::jsonb,
            ${JSON.stringify(missingFieldsPayload)}::jsonb,
            15,
            ${changeNotesVal}
          )
        `;

        return {
          periodId,
          versionId,
          versionNumber: nextVersionNumber,
          duplicateDetected,
          persistenceMode: 'POSTGRESQL' as PersistenceMode,
          isPersisted: true,
          dre: serializedDre,
          indicators: serializedInd,
          validation,
        };
      }

      let period = await prisma.financialPeriod.findFirst({
        where: {
          companyId: params.companyId,
          year: Number(params.year),
          month: params.month ? Number(params.month) : null,
          periodType: params.periodType,
        },
      });
      let nextVersionNumber = 1;
      let duplicateDetected = false;
      if (period) {
        const latestVer = await prisma.financialPeriodVersion.findFirst({
          where: { financialPeriodId: period.id },
          orderBy: { versionNumber: 'desc' },
        });
        if (latestVer) {
          nextVersionNumber = latestVer.versionNumber + 1;
          if (latestVer.rawData && canonicalFinancialSignature(latestVer.rawData as any) === newSignature) {
            duplicateDetected = true;
            if (params.rejectDuplicate) {
              throw new Error(
                `Importação duplicada detectada: os dados enviados para ${params.month ? `${params.month}/` : ''}${params.year} são idênticos à versão v${latestVer.versionNumber} já salva.`
              );
            }
            return {
              periodId: period.id,
              versionId: latestVer.id,
              versionNumber: latestVer.versionNumber,
              duplicateDetected: true,
              persistenceMode: 'POSTGRESQL' as PersistenceMode,
              isPersisted: true,
              dre: serializeDRE(dre),
              indicators: serializeIndicators(indicators),
              validation,
            };
          }
        }
      } else {
        period = await prisma.financialPeriod.create({
          data: {
            companyId: params.companyId,
            year: Number(params.year),
            month: params.month ? Number(params.month) : null,
            periodType: params.periodType,
            status: validation.valid ? 'VALIDATED' : 'DRAFT',
          },
        });
      }

      const ver = await prisma.financialPeriodVersion.create({
        data: {
          financialPeriodId: period.id,
          versionNumber: nextVersionNumber,
          grossRevenue: dre.grossRevenue.toFixed(2),
          netRevenue: dre.netRevenue.toFixed(2),
          cmv: dre.cmv.toFixed(2),
          variableExpenses: dre.variableExpenses.toFixed(2),
          contributionMargin: dre.contributionMargin.toFixed(2),
          fixedExpenses: dre.fixedExpenses.toFixed(2),
          operatingResult: dre.operatingResult.toFixed(2),
          depreciation: dre.depreciation.toFixed(2),
          ebit: dre.ebit.toFixed(2),
          ebitda: dre.ebitda.toFixed(2),
          financialResult: dre.financialResult.toFixed(2),
          lair: dre.lair.toFixed(2),
          netProfit: dre.netProfit.toFixed(2),
          operatingBreakEven: dre.operatingBreakEven.toFixed(2),
          financialBreakEven: dre.financialBreakEven.toFixed(2),
          rawData: inputWithRegime as any,
          validationSummary: validation as any,
          changeReason: params.changeReason || `Importação v${nextVersionNumber}`,
        },
      });

      return {
        periodId: period.id,
        versionId: ver.id,
        versionNumber: nextVersionNumber,
        duplicateDetected,
        persistenceMode: 'POSTGRESQL' as PersistenceMode,
        isPersisted: true,
        dre: serializeDRE(dre),
        indicators: serializeIndicators(indicators),
        validation,
      };
    } catch (err: any) {
      // NEVER silently fall back to memory when in POSTGRESQL mode!
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao persistir período financeiro no PostgreSQL: ${safeMsg}`);
    }
  }

  // Strictly in MEMORY_DEMO mode
  let period = memPeriods.find(
    p =>
      p.companyId === params.companyId &&
      p.year === Number(params.year) &&
      p.month === (params.month ? Number(params.month) : null) &&
      p.periodType === params.periodType
  );
  let duplicateDetected = false;
  if (!period) {
    period = {
      id: `per-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId: params.companyId,
      year: Number(params.year),
      month: params.month ? Number(params.month) : null,
      periodType: params.periodType,
      status: validation.valid ? 'VALIDATED' : 'DRAFT',
      createdAt: new Date().toISOString(),
      versions: [],
      persistenceMode: 'MEMORY_DEMO',
      isPersisted: false,
    };
    memPeriods.unshift(period);
  } else if (period.versions[0]) {
    if (canonicalFinancialSignature(period.versions[0].rawData) === newSignature) {
      duplicateDetected = true;
      if (params.rejectDuplicate) {
        throw new Error(
          `Importação duplicada detectada: os dados enviados para ${params.month ? `${params.month}/` : ''}${params.year} são idênticos à versão v${period.versions[0].versionNumber} já salva.`
        );
      }
      return {
        periodId: period.id,
        versionId: period.versions[0].id,
        versionNumber: period.versions[0].versionNumber,
        duplicateDetected: true,
        persistenceMode: 'MEMORY_DEMO' as PersistenceMode,
        isPersisted: false,
        dre: serializeDRE(dre),
        indicators: serializeIndicators(indicators),
        validation,
      };
    }
  }

  const nextVersionNumber = period.versions.length > 0 ? Math.max(...period.versions.map(v => v.versionNumber)) + 1 : 1;
  const ver = makeVersionFromInput(
    `ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    period.id,
    nextVersionNumber,
    inputWithRegime,
    params.changeReason || `Importação v${nextVersionNumber}`,
    new Date().toISOString(),
    'MEMORY_DEMO'
  );
  period.versions.unshift(ver);

  return {
    periodId: period.id,
    versionId: ver.id,
    versionNumber: nextVersionNumber,
    duplicateDetected,
    persistenceMode: 'MEMORY_DEMO' as PersistenceMode,
    isPersisted: false,
    dre: serializeDRE(dre),
    indicators: serializeIndicators(indicators),
    validation,
  };
}

export async function getDebtFacilities(companyId: string): Promise<DebtFacilityRecord[]> {
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(companyId);
        return env.debts;
      }

      const rows = await prisma.debtFacility.findMany({
        where: { companyId },
        orderBy: { outstandingBalance: 'desc' },
      });
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        lender: r.lender,
        principal: Number(r.principal),
        outstandingBalance: Number(r.outstandingBalance),
        indexer: r.indexer as DebtFacilityRecord['indexer'],
        spreadAnnualPct: Number(r.spreadAnnualPct),
        monthlyPayment: r.monthlyPayment ? Number(r.monthlyPayment) : null,
        maturityDate: r.maturityDate ? r.maturityDate.toISOString().split('T')[0] : null,
        notes: r.notes,
      }));
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      console.error(`[POSTGRESQL_READ_ERROR] Falha ao buscar dívidas de ${companyId}: ${safeMsg}`);
      throw new Error(`Falha ao buscar contratos de dívida no PostgreSQL: ${safeMsg}`);
    }
  }
  return memDebts.get(companyId) || [];
}

export async function addDebtFacility(
  companyId: string,
  facility: Omit<DebtFacilityRecord, 'id'>
): Promise<DebtFacilityRecord & { persistenceMode: PersistenceMode; isPersisted: boolean }> {
  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao persistir contrato de dívida no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(companyId);
        const created: DebtFacilityRecord = {
          id: crypto.randomUUID(),
          name: facility.name,
          lender: facility.lender,
          principal: Number(facility.principal),
          outstandingBalance: Number(facility.outstandingBalance),
          indexer: facility.indexer,
          spreadAnnualPct: Number(facility.spreadAnnualPct),
          monthlyPayment: facility.monthlyPayment ?? null,
          maturityDate: facility.maturityDate ?? null,
          notes: facility.notes ?? null,
        };
        env.debts.unshift(created);
        await saveLegacyCompanyEnvelope(companyId, env);
        return {
          ...created,
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        };
      }

      const created = await prisma.debtFacility.create({
        data: {
          companyId,
          name: facility.name,
          lender: facility.lender,
          principal: facility.principal,
          outstandingBalance: facility.outstandingBalance,
          indexer: facility.indexer,
          spreadAnnualPct: facility.spreadAnnualPct,
          monthlyPayment: facility.monthlyPayment ?? undefined,
          maturityDate: facility.maturityDate ? new Date(facility.maturityDate) : undefined,
          notes: facility.notes ?? undefined,
        },
      });
      return {
        id: created.id,
        name: created.name,
        lender: created.lender,
        principal: Number(created.principal),
        outstandingBalance: Number(created.outstandingBalance),
        indexer: created.indexer as any,
        spreadAnnualPct: Number(created.spreadAnnualPct),
        monthlyPayment: created.monthlyPayment ? Number(created.monthlyPayment) : null,
        maturityDate: created.maturityDate ? created.maturityDate.toISOString().split('T')[0] : null,
        notes: created.notes,
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      };
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao persistir contrato de dívida no PostgreSQL: ${safeMsg}`);
    }
  }
  const created: DebtFacilityRecord = {
    id: `debt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...facility,
  };
  const list = memDebts.get(companyId) || [];
  list.push(created);
  memDebts.set(companyId, list);
  return {
    ...created,
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
  };
}

// Operational Memory CRUD (including persisted Scenarios)
export async function listOperationalMemory(companyId: string, memoryType?: string): Promise<StoredOperationalMemory[]> {
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(companyId);
        return env.memories
          .filter(m => !memoryType || m.memoryType === memoryType)
          .map(m => ({ ...m, persistenceMode: 'POSTGRESQL', isPersisted: true }));
      }

      const rows = await prisma.operationalMemory.findMany({
        where: { companyId, ...(memoryType ? { memoryType } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map(r => ({
        ...r,
        memoryType: r.memoryType as any,
        createdAt: r.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      }));
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      throw new Error(`Falha ao buscar memória operacional no PostgreSQL: ${safeMsg}`);
    }
  }
  return memMemories
    .filter(m => m.companyId === companyId && (!memoryType || m.memoryType === memoryType))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createOperationalMemory(
  input: Omit<StoredOperationalMemory, 'id' | 'createdAt' | 'persistenceMode' | 'isPersisted'>
): Promise<StoredOperationalMemory> {
  const normalizedTitle = input.title.trim();
  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao persistir memória operacional no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(input.companyId);
        const existingDup = env.memories.find(
          m => m.memoryType === input.memoryType && m.title.trim().toLowerCase() === normalizedTitle.toLowerCase()
        );
        if (existingDup) {
          return {
            ...existingDup,
            persistenceMode: 'POSTGRESQL',
            isPersisted: true,
            duplicatePrevented: true,
          };
        }
        const created: StoredOperationalMemory = {
          id: crypto.randomUUID(),
          ...input,
          title: normalizedTitle,
          createdAt: new Date().toISOString(),
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
          duplicatePrevented: false,
        };
        env.memories.unshift(created);
        await saveLegacyCompanyEnvelope(input.companyId, env);
        return created;
      }

      const existingDup = await prisma.operationalMemory.findFirst({
        where: {
          companyId: input.companyId,
          memoryType: input.memoryType,
          title: normalizedTitle,
        },
      });
      if (existingDup) {
        return {
          ...existingDup,
          memoryType: existingDup.memoryType as any,
          createdAt: existingDup.createdAt.toISOString(),
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
          duplicatePrevented: true,
        };
      }

      const created = await prisma.operationalMemory.create({
        data: {
          companyId: input.companyId,
          memoryType: input.memoryType,
          title: normalizedTitle,
          summary: input.summary,
          structuredData: input.structuredData ?? undefined,
          periodRef: input.periodRef ?? undefined,
          dataVersionRef: input.dataVersionRef ?? undefined,
          createdBy: input.createdBy ?? undefined,
        },
      });
      return {
        ...created,
        memoryType: created.memoryType as any,
        createdAt: created.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
        duplicatePrevented: false,
      };
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao persistir memória operacional no PostgreSQL: ${safeMsg}`);
    }
  }

  const existingMemDup = memMemories.find(
    m =>
      m.companyId === input.companyId &&
      m.memoryType === input.memoryType &&
      m.title.trim().toLowerCase() === normalizedTitle.toLowerCase()
  );
  if (existingMemDup) {
    return {
      ...existingMemDup,
      persistenceMode: 'MEMORY_DEMO',
      isPersisted: false,
      duplicatePrevented: true,
    };
  }

  const item: StoredOperationalMemory = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...input,
    title: normalizedTitle,
    createdAt: new Date().toISOString(),
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
    duplicatePrevented: false,
  };
  memMemories.unshift(item);
  return item;
}

export async function deleteOperationalMemory(companyId: string, memoryId: string): Promise<boolean> {
  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao excluir memória operacional no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(companyId);
        const idx = env.memories.findIndex(m => m.id === memoryId);
        if (idx === -1) return false;
        env.memories.splice(idx, 1);
        await saveLegacyCompanyEnvelope(companyId, env);
        return true;
      }

      const existing = await prisma.operationalMemory.findFirst({ where: { id: memoryId, companyId } });
      if (!existing) return false;
      await prisma.operationalMemory.delete({ where: { id: memoryId } });
      return true;
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao excluir memória operacional no PostgreSQL: ${safeMsg}`);
    }
  }
  const idx = memMemories.findIndex(m => m.id === memoryId && m.companyId === companyId);
  if (idx === -1) return false;
  memMemories.splice(idx, 1);
  return true;
}

// Agent Execution Logs
export async function saveAgentExecutionLog(
  log: Omit<StoredAgentLog, 'id' | 'createdAt' | 'persistenceMode' | 'isPersisted'>
): Promise<StoredAgentLog> {
  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao persistir log do agente no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const created: StoredAgentLog = {
          id: crypto.randomUUID(),
          ...log,
          createdAt: new Date().toISOString(),
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        };
        if (log.companyId) {
          const env = await getLegacyCompanyEnvelope(log.companyId);
          env.agentLogs.unshift(created);
          if (env.agentLogs.length > 100) env.agentLogs.pop();
          await saveLegacyCompanyEnvelope(log.companyId, env);
        }
        return created;
      }

      const created = await prisma.agentExecutionLog.create({
        data: {
          executionId: log.executionId,
          companyId: log.companyId ?? undefined,
          question: log.question,
          periodRef: log.periodRef ?? undefined,
          dataVersionsUsed: log.dataVersionsUsed ?? undefined,
          toolsCalled: log.toolsCalled,
          validatedArgs: log.validatedArgs ?? undefined,
          toolResults: log.toolResults ?? undefined,
          modelUsed: log.modelUsed,
          provider: log.provider,
          tokenUsage: log.tokenUsage ?? undefined,
          durationMs: log.durationMs,
          status: log.status,
          error: log.error ?? undefined,
          finalResponse: log.finalResponse ?? undefined,
        },
      });
      return {
        ...created,
        toolsCalled: (created.toolsCalled as string[]) || [],
        provider: created.provider as any,
        status: created.status as any,
        createdAt: created.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      };
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao persistir log do agente no PostgreSQL: ${safeMsg}`);
    }
  }
  const item: StoredAgentLog = {
    id: `alog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...log,
    createdAt: new Date().toISOString(),
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
  };
  memAgentLogs.unshift(item);
  if (memAgentLogs.length > 200) memAgentLogs.pop();
  return item;
}

export async function listAgentExecutionLogs(companyId: string, limit = 50): Promise<StoredAgentLog[]> {
  if (!companyId) {
    throw new Error('companyId é obrigatório para consultar logs do agente.');
  }
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(companyId);
        return env.agentLogs.slice(0, limit).map(l => ({
          ...l,
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        }));
      }

      const rows = await prisma.agentExecutionLog.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.map(r => ({
        ...r,
        toolsCalled: (r.toolsCalled as string[]) || [],
        provider: r.provider as any,
        status: r.status as any,
        createdAt: r.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      }));
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      throw new Error(`Falha ao consultar logs do agente no PostgreSQL: ${safeMsg}`);
    }
  }
  return memAgentLogs.filter(l => l.companyId === companyId).slice(0, limit);
}

// Automation Runs
export async function saveAutomationRun(run: StoredAutomationRun): Promise<StoredAutomationRun> {
  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao persistir execução de automação no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const tagged: StoredAutomationRun = {
          ...run,
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        };
        if (run.companyId) {
          const env = await getLegacyCompanyEnvelope(run.companyId);
          const idx = env.automationRuns.findIndex(r => r.id === run.id);
          if (idx >= 0) env.automationRuns[idx] = tagged;
          else env.automationRuns.unshift(tagged);
          await saveLegacyCompanyEnvelope(run.companyId, env);
        }
        return tagged;
      }

      const existing = await prisma.automationJobRun.findUnique({ where: { id: run.id } });
      if (existing) {
        await prisma.automationJobRun.update({
          where: { id: run.id },
          data: {
            status: run.status,
            steps: run.steps as any,
            metrics: run.metrics ?? undefined,
            errorMessage: run.errorMessage ?? undefined,
            completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
            durationMs: run.durationMs ?? undefined,
          },
        });
      } else {
        await prisma.automationJobRun.create({
          data: {
            id: run.id,
            companyId: run.companyId ?? undefined,
            workflowType: run.workflowType,
            status: run.status,
            steps: run.steps as any,
            metrics: run.metrics ?? undefined,
            errorMessage: run.errorMessage ?? undefined,
            startedAt: new Date(run.startedAt),
            completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
            durationMs: run.durationMs ?? undefined,
          },
        });
      }
      return { ...run, persistenceMode: 'POSTGRESQL', isPersisted: true };
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao persistir execução de automação no PostgreSQL: ${safeMsg}`);
    }
  }
  const taggedRun: StoredAutomationRun = {
    ...run,
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
  };
  const idx = memAutomationRuns.findIndex(r => r.id === run.id);
  if (idx >= 0) memAutomationRuns[idx] = taggedRun;
  else memAutomationRuns.unshift(taggedRun);
  return taggedRun;
}

export async function listAutomationRuns(companyId: string, limit = 30): Promise<StoredAutomationRun[]> {
  if (!companyId) {
    throw new Error('companyId é obrigatório para listar execuções de automação.');
  }
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(companyId);
        return env.automationRuns.slice(0, limit).map(r => ({
          ...r,
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        }));
      }

      const rows = await prisma.automationJobRun.findMany({
        where: { companyId },
        orderBy: { startedAt: 'desc' },
        take: limit,
      });
      return rows.map(r => ({
        id: r.id,
        companyId: r.companyId,
        workflowType: r.workflowType,
        status: r.status as any,
        steps: (r.steps as any) || [],
        metrics: r.metrics,
        errorMessage: r.errorMessage,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        durationMs: r.durationMs,
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      }));
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      throw new Error(`Falha ao listar automações no PostgreSQL: ${safeMsg}`);
    }
  }
  return memAutomationRuns.filter(r => r.companyId === companyId).slice(0, limit);
}

// Reports
export async function saveAnalysisReport(
  report: Omit<StoredReport, 'id' | 'createdAt' | 'persistenceMode' | 'isPersisted'>
): Promise<StoredReport> {
  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao persistir relatório no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(report.companyId);
        const created: StoredReport = {
          id: crypto.randomUUID(),
          ...report,
          createdAt: new Date().toISOString(),
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        };
        env.reports.unshift(created);
        await saveLegacyCompanyEnvelope(report.companyId, env);
        return created;
      }

      const created = await prisma.aIAnalysisReport.create({
        data: {
          companyId: report.companyId,
          reportType: report.reportType,
          provider: report.provider,
          prompt: report.prompt ?? undefined,
          response: report.response,
          metadata: report.metadata ?? undefined,
        },
      });
      return {
        ...created,
        createdAt: created.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      };
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao persistir relatório no PostgreSQL: ${safeMsg}`);
    }
  }
  const item: StoredReport = {
    id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...report,
    createdAt: new Date().toISOString(),
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
  };
  memReports.unshift(item);
  return item;
}

export async function listAnalysisReports(companyId: string, reportType?: string): Promise<StoredReport[]> {
  if (!companyId) {
    throw new Error('companyId é obrigatório para listar relatórios.');
  }
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(companyId);
        return env.reports
          .filter(r => !reportType || r.reportType === reportType)
          .map(r => ({
            ...r,
            persistenceMode: 'POSTGRESQL',
            isPersisted: true,
          }));
      }

      const rows = await prisma.aIAnalysisReport.findMany({
        where: { companyId, ...(reportType ? { reportType } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      return rows.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      }));
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      throw new Error(`Falha ao listar relatórios no PostgreSQL: ${safeMsg}`);
    }
  }
  return memReports.filter(r => r.companyId === companyId && (!reportType || r.reportType === reportType));
}

// Business Baselines
export async function saveBusinessBaseline(
  input: Omit<StoredBusinessBaseline, 'id' | 'recordedAt' | 'persistenceMode' | 'isPersisted'>
): Promise<StoredBusinessBaseline> {
  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao persistir baseline no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(input.companyId);
        const created: StoredBusinessBaseline = {
          id: crypto.randomUUID(),
          ...input,
          recordedAt: new Date().toISOString(),
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        };
        env.baselines.unshift(created);
        await saveLegacyCompanyEnvelope(input.companyId, env);
        return created;
      }

      const created = await prisma.businessBaseline.create({ data: input });
      return {
        ...created,
        recordedAt: created.recordedAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      };
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao persistir baseline no PostgreSQL: ${safeMsg}`);
    }
  }
  const item: StoredBusinessBaseline = {
    id: `base-${Date.now()}`,
    ...input,
    recordedAt: new Date().toISOString(),
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
  };
  memBaselines.unshift(item);
  return item;
}

export async function getBusinessBaselines(companyId: string): Promise<StoredBusinessBaseline[]> {
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const env = await getLegacyCompanyEnvelope(companyId);
        return env.baselines.map(b => ({
          ...b,
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        }));
      }

      const rows = await prisma.businessBaseline.findMany({
        where: { companyId },
        orderBy: { recordedAt: 'desc' },
      });
      return rows.map(r => ({
        ...r,
        recordedAt: r.recordedAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      }));
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      throw new Error(`Falha ao buscar baselines no PostgreSQL: ${safeMsg}`);
    }
  }
  return memBaselines.filter(b => b.companyId === companyId);
}

// Evaluations
export async function saveEvaluationRun(
  run: Omit<StoredEvaluationRun, 'id' | 'createdAt' | 'persistenceMode' | 'isPersisted'>
): Promise<StoredEvaluationRun> {
  if (isPostgresActive()) {
    if (!prisma) {
      const safeMsg = recordWriteError(new Error('Conexão com PostgreSQL indisponível.'));
      throw new Error(`Falha ao persistir avaliação no PostgreSQL: ${safeMsg}`);
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const created: StoredEvaluationRun = {
          id: crypto.randomUUID(),
          ...run,
          createdAt: new Date().toISOString(),
          persistenceMode: 'POSTGRESQL',
          isPersisted: true,
        };
        const targetCompId = (run as any).companyId;
        if (targetCompId) {
          const env = await getLegacyCompanyEnvelope(targetCompId);
          env.evaluationRuns = env.evaluationRuns || [];
          env.evaluationRuns.unshift(created);
          await saveLegacyCompanyEnvelope(targetCompId, env);
        }
        return created;
      }

      const created = await prisma.evaluationRun.create({ data: run as any });
      return {
        ...created,
        results: (created.results as any[]) || [],
        createdAt: created.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      };
    } catch (err: any) {
      const safeMsg = recordWriteError(err);
      throw new Error(`Falha ao persistir avaliação no PostgreSQL: ${safeMsg}`);
    }
  }
  const item: StoredEvaluationRun = {
    id: `eval-${Date.now()}`,
    ...run,
    createdAt: new Date().toISOString(),
    persistenceMode: 'MEMORY_DEMO',
    isPersisted: false,
  };
  memEvaluationRuns.unshift(item);
  return item;
}

export async function listEvaluationRuns(limit = 20, companyId?: string): Promise<StoredEvaluationRun[]> {
  if (isPostgresActive()) {
    if (!prisma) {
      throw new Error('Conexão com PostgreSQL indisponível.');
    }
    try {
      const schemaMode = await ensureSchemaInspected();
      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        if (companyId) {
          const env = await getLegacyCompanyEnvelope(companyId);
          return (env.evaluationRuns || []).slice(0, limit);
        }
        return [];
      }

      const rows = await prisma.evaluationRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.map(r => ({
        ...r,
        results: (r.results as any[]) || [],
        createdAt: r.createdAt.toISOString(),
        persistenceMode: 'POSTGRESQL',
        isPersisted: true,
      }));
    } catch (err: any) {
      const safeMsg = sanitizeDatabaseErrorMessage(err);
      throw new Error(`Falha ao listar avaliações no PostgreSQL: ${safeMsg}`);
    }
  }
  const list = companyId
    ? memEvaluationRuns.filter(r => !(r as any).companyId || (r as any).companyId === companyId)
    : memEvaluationRuns;
  return list.slice(0, limit);
}
