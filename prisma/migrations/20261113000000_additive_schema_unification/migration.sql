-- Additive, Non-Destructive Schema Unification Migration for Neon PostgreSQL
-- Preserves all existing tables, columns, constraints, and records (11 MacroIndicators, 120 MacroObservations, 4 MacroSyncLogs)
-- Adds missing tables and columns required by prisma/schema.prisma and synchronizes legacy/modern columns via triggers

-- 1. Add missing columns to existing "Company" table
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "industry" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "monthlyRevenueTier" TEXT;
ALTER TABLE "Company" ALTER COLUMN "tradeName" SET DEFAULT '';
ALTER TABLE "Company" ALTER COLUMN "sector" SET DEFAULT 'vestuario';
ALTER TABLE "Company" ALTER COLUMN "taxRegime" SET DEFAULT 'Simples Nacional';
ALTER TABLE "Company" ALTER COLUMN "status" SET DEFAULT 'active';
ALTER TABLE "Company" ALTER COLUMN "isDemonstration" SET DEFAULT false;
ALTER TABLE "Company" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "Company"
SET
  "name" = COALESCE("name", "tradeName", 'Empresa'),
  "industry" = COALESCE("industry", "sector", 'Geral'),
  "monthlyRevenueTier" = COALESCE("monthlyRevenueTier", "annualRevenueBand")
WHERE "name" IS NULL OR "industry" IS NULL;

ALTER TABLE "Company" ALTER COLUMN "name" SET DEFAULT '';
ALTER TABLE "Company" ALTER COLUMN "name" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Company_cnpj_idx" ON "Company"("cnpj");

CREATE OR REPLACE FUNCTION afi_sync_company_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW."name" := COALESCE(NULLIF(NEW."name", ''), NULLIF(NEW."tradeName", ''), 'Empresa');
  NEW."tradeName" := COALESCE(NULLIF(NEW."tradeName", ''), NEW."name", 'Empresa');
  NEW."legalName" := COALESCE(NEW."legalName", NEW."name");
  NEW."industry" := COALESCE(NULLIF(NEW."industry", ''), NULLIF(NEW."sector", ''), 'Geral');
  NEW."sector" := COALESCE(NULLIF(NEW."sector", ''), NEW."industry", 'vestuario');
  NEW."annualRevenueBand" := COALESCE(NEW."annualRevenueBand", NEW."monthlyRevenueTier");
  NEW."monthlyRevenueTier" := COALESCE(NEW."monthlyRevenueTier", NEW."annualRevenueBand");
  NEW."taxRegime" := COALESCE(NULLIF(NEW."taxRegime", ''), 'Simples Nacional');
  NEW."status" := COALESCE(NULLIF(NEW."status", ''), 'active');
  NEW."isDemonstration" := COALESCE(NEW."isDemonstration", POSITION('DEMONSTRAÇÃO' IN UPPER(NEW."name")) > 0);
  NEW."updatedAt" := COALESCE(NEW."updatedAt", CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_afi_sync_company_columns ON "Company";
CREATE TRIGGER trg_afi_sync_company_columns
BEFORE INSERT OR UPDATE ON "Company"
FOR EACH ROW EXECUTE FUNCTION afi_sync_company_columns();

-- 2. Add missing columns to existing "FinancialPeriod" table
ALTER TABLE "FinancialPeriod" ADD COLUMN IF NOT EXISTS "year" INTEGER;
ALTER TABLE "FinancialPeriod" ADD COLUMN IF NOT EXISTS "month" INTEGER;
ALTER TABLE "FinancialPeriod" ADD COLUMN IF NOT EXISTS "periodType" TEXT DEFAULT 'MONTHLY';
ALTER TABLE "FinancialPeriod" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE "FinancialPeriod" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
ALTER TABLE "FinancialPeriod" ALTER COLUMN "periodMonth" SET DEFAULT 0;
ALTER TABLE "FinancialPeriod" ALTER COLUMN "periodYear" SET DEFAULT 2026;
ALTER TABLE "FinancialPeriod" ALTER COLUMN "status" SET DEFAULT 'VALIDATED';
ALTER TABLE "FinancialPeriod" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "FinancialPeriod"
SET
  "year" = COALESCE("year", "periodYear", 2026),
  "month" = CASE WHEN "periodMonth" = 0 THEN NULL ELSE COALESCE("month", "periodMonth") END,
  "periodType" = COALESCE("periodType", CASE WHEN "periodMonth" = 0 THEN 'ANNUAL' ELSE 'MONTHLY' END)
WHERE "year" IS NULL OR "periodType" IS NULL;

ALTER TABLE "FinancialPeriod" ALTER COLUMN "year" SET DEFAULT 2026;
ALTER TABLE "FinancialPeriod" ALTER COLUMN "year" SET NOT NULL;
ALTER TABLE "FinancialPeriod" ALTER COLUMN "periodType" SET DEFAULT 'MONTHLY';
ALTER TABLE "FinancialPeriod" ALTER COLUMN "periodType" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialPeriod_companyId_year_month_periodType_key"
  ON "FinancialPeriod"("companyId", "year", "month", "periodType");

CREATE OR REPLACE FUNCTION afi_sync_financial_period_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW."year" := COALESCE(NEW."year", NEW."periodYear", 2026);
  NEW."periodYear" := COALESCE(NEW."year", NEW."periodYear", 2026);
  IF NEW."month" IS NOT NULL THEN
    NEW."periodMonth" := NEW."month";
  ELSIF NEW."periodMonth" IS NOT NULL AND NEW."periodMonth" > 0 THEN
    NEW."month" := NEW."periodMonth";
  ELSE
    NEW."periodMonth" := 0;
  END IF;
  NEW."periodType" := COALESCE(NULLIF(NEW."periodType", ''), CASE WHEN NEW."periodMonth" = 0 THEN 'ANNUAL' ELSE 'MONTHLY' END);
  NEW."status" := COALESCE(NULLIF(NEW."status", ''), 'VALIDATED');
  NEW."updatedAt" := COALESCE(NEW."updatedAt", CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_afi_sync_financial_period_columns ON "FinancialPeriod";
CREATE TRIGGER trg_afi_sync_financial_period_columns
BEFORE INSERT OR UPDATE ON "FinancialPeriod"
FOR EACH ROW EXECUTE FUNCTION afi_sync_financial_period_columns();

-- 3. Add missing columns to existing "FinancialPeriodVersion" table
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "financialPeriodId" TEXT;
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "grossRevenue" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "netRevenue" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "cmv" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "variableExpenses" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "contributionMargin" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "fixedExpenses" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "operatingResult" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "depreciation" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "ebit" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "ebitda" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "financialResult" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "lair" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "netProfit" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "operatingBreakEven" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "financialBreakEven" DECIMAL(15,2);
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "rawData" JSONB;
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "validationSummary" JSONB;
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "changeReason" TEXT;
ALTER TABLE "FinancialPeriodVersion" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "FinancialPeriodVersion" ALTER COLUMN "versionNumber" SET DEFAULT 1;
ALTER TABLE "FinancialPeriodVersion" ALTER COLUMN "origin" SET DEFAULT 'PRISMA_IMPORT';
ALTER TABLE "FinancialPeriodVersion" ALTER COLUMN "rawInputs" SET DEFAULT '{}'::jsonb;
ALTER TABLE "FinancialPeriodVersion" ALTER COLUMN "calculatedResults" SET DEFAULT '{}'::jsonb;
ALTER TABLE "FinancialPeriodVersion" ALTER COLUMN "missingFields" SET DEFAULT '[]'::jsonb;
ALTER TABLE "FinancialPeriodVersion" ALTER COLUMN "calculatedCount" SET DEFAULT 15;

UPDATE "FinancialPeriodVersion"
SET
  "financialPeriodId" = COALESCE("financialPeriodId", "periodId"),
  "rawData" = COALESCE("rawData", "rawInputs"),
  "changeReason" = COALESCE("changeReason", "changeNotes"),
  "createdAt" = COALESCE("createdAt", "importedAt", CURRENT_TIMESTAMP)
WHERE "financialPeriodId" IS NULL;

ALTER TABLE "FinancialPeriodVersion" ALTER COLUMN "financialPeriodId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "FinancialPeriodVersion_financialPeriodId_versionNumber_idx"
  ON "FinancialPeriodVersion"("financialPeriodId", "versionNumber");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public'
      AND table_name = 'FinancialPeriodVersion'
      AND constraint_name = 'FinancialPeriodVersion_financialPeriodId_fkey'
  ) THEN
    ALTER TABLE "FinancialPeriodVersion"
      ADD CONSTRAINT "FinancialPeriodVersion_financialPeriodId_fkey"
      FOREIGN KEY ("financialPeriodId") REFERENCES "FinancialPeriod"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION afi_sync_financial_period_version_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW."financialPeriodId" := COALESCE(NULLIF(NEW."financialPeriodId", ''), NEW."periodId");
  NEW."periodId" := COALESCE(NULLIF(NEW."periodId", ''), NEW."financialPeriodId");
  NEW."origin" := COALESCE(NULLIF(NEW."origin", ''), 'PRISMA_IMPORT');
  NEW."rawData" := COALESCE(NEW."rawData", NEW."rawInputs", '{}'::jsonb);
  NEW."rawInputs" := COALESCE(NEW."rawInputs", NEW."rawData", '{}'::jsonb);
  NEW."calculatedResults" := COALESCE(
    NEW."calculatedResults",
    jsonb_build_object(
      'grossRevenue', COALESCE(NEW."grossRevenue", 0),
      'netRevenue', COALESCE(NEW."netRevenue", 0),
      'cmv', COALESCE(NEW."cmv", 0),
      'variableExpenses', COALESCE(NEW."variableExpenses", 0),
      'contributionMargin', COALESCE(NEW."contributionMargin", 0),
      'fixedExpenses', COALESCE(NEW."fixedExpenses", 0),
      'operatingResult', COALESCE(NEW."operatingResult", 0),
      'depreciation', COALESCE(NEW."depreciation", 0),
      'ebit', COALESCE(NEW."ebit", 0),
      'ebitda', COALESCE(NEW."ebitda", 0),
      'financialResult', COALESCE(NEW."financialResult", 0),
      'lair', COALESCE(NEW."lair", 0),
      'netProfit', COALESCE(NEW."netProfit", 0),
      'operatingBreakEven', COALESCE(NEW."operatingBreakEven", 0),
      'financialBreakEven', COALESCE(NEW."financialBreakEven", 0)
    )
  );
  NEW."missingFields" := COALESCE(NEW."missingFields", '[]'::jsonb);
  NEW."calculatedCount" := COALESCE(NEW."calculatedCount", 15);
  NEW."changeNotes" := COALESCE(NEW."changeNotes", NEW."changeReason");
  NEW."changeReason" := COALESCE(NEW."changeReason", NEW."changeNotes");
  NEW."importedAt" := COALESCE(NEW."importedAt", NEW."createdAt", CURRENT_TIMESTAMP);
  NEW."createdAt" := COALESCE(NEW."createdAt", NEW."importedAt", CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_afi_sync_financial_period_version_columns ON "FinancialPeriodVersion";
CREATE TRIGGER trg_afi_sync_financial_period_version_columns
BEFORE INSERT OR UPDATE ON "FinancialPeriodVersion"
FOR EACH ROW EXECUTE FUNCTION afi_sync_financial_period_version_columns();

-- 4. Add missing columns to existing "MacroIndicator" table & backfill 11 existing indicators
ALTER TABLE "MacroIndicator" ADD COLUMN IF NOT EXISTS "seriesCode" TEXT;
ALTER TABLE "MacroIndicator" ADD COLUMN IF NOT EXISTS "methodology" TEXT;
ALTER TABLE "MacroIndicator" ALTER COLUMN "shortLabel" SET DEFAULT '';
ALTER TABLE "MacroIndicator" ALTER COLUMN "officialSourceUrl" SET DEFAULT 'https://www.bcb.gov.br';
ALTER TABLE "MacroIndicator" ALTER COLUMN "frequency" SET DEFAULT 'Mensal';
ALTER TABLE "MacroIndicator" ALTER COLUMN "description" SET DEFAULT '';
ALTER TABLE "MacroIndicator" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "MacroIndicator"
SET
  "seriesCode" = COALESCE("seriesCode", "code"),
  "methodology" = COALESCE("methodology", "description", "transmissionChannel", 'Série oficial BCB/IBGE')
WHERE "seriesCode" IS NULL OR "methodology" IS NULL;

CREATE OR REPLACE FUNCTION afi_sync_macro_indicator_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW."shortLabel" := COALESCE(NULLIF(NEW."shortLabel", ''), NEW."code");
  NEW."officialSourceUrl" := COALESCE(NULLIF(NEW."officialSourceUrl", ''), 'https://www.bcb.gov.br');
  NEW."frequency" := COALESCE(NULLIF(NEW."frequency", ''), 'Mensal');
  NEW."description" := COALESCE(NULLIF(NEW."description", ''), NEW."name");
  NEW."seriesCode" := COALESCE(NULLIF(NEW."seriesCode", ''), NEW."code");
  NEW."updatedAt" := COALESCE(NEW."updatedAt", CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_afi_sync_macro_indicator_columns ON "MacroIndicator";
CREATE TRIGGER trg_afi_sync_macro_indicator_columns
BEFORE INSERT OR UPDATE ON "MacroIndicator"
FOR EACH ROW EXECUTE FUNCTION afi_sync_macro_indicator_columns();

-- 5. Add missing columns to existing "MacroObservation" table & backfill 120 existing observations
ALTER TABLE "MacroObservation" ADD COLUMN IF NOT EXISTS "publicationDate" TIMESTAMP(3);
ALTER TABLE "MacroObservation" ADD COLUMN IF NOT EXISTS "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MacroObservation" ADD COLUMN IF NOT EXISTS "syncSource" TEXT NOT NULL DEFAULT 'LIVE_API';
ALTER TABLE "MacroObservation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MacroObservation" ALTER COLUMN "dateFormatted" SET DEFAULT '';
ALTER TABLE "MacroObservation" ALTER COLUMN "unit" SET DEFAULT '%';

UPDATE "MacroObservation"
SET
  "fetchedAt" = COALESCE("collectedAt", CURRENT_TIMESTAMP),
  "updatedAt" = COALESCE("collectedAt", CURRENT_TIMESTAMP),
  "syncSource" = 'LIVE_API';

CREATE OR REPLACE FUNCTION afi_sync_macro_observation_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW."dateFormatted" := COALESCE(NULLIF(NEW."dateFormatted", ''), to_char(NEW."referenceDate", 'YYYY-MM-DD'));
  NEW."unit" := COALESCE(NULLIF(NEW."unit", ''), '%');
  NEW."collectedAt" := COALESCE(NEW."collectedAt", NEW."fetchedAt", CURRENT_TIMESTAMP);
  NEW."fetchedAt" := COALESCE(NEW."fetchedAt", NEW."collectedAt", CURRENT_TIMESTAMP);
  NEW."updatedAt" := COALESCE(NEW."updatedAt", CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_afi_sync_macro_observation_columns ON "MacroObservation";
CREATE TRIGGER trg_afi_sync_macro_observation_columns
BEFORE INSERT OR UPDATE ON "MacroObservation"
FOR EACH ROW EXECUTE FUNCTION afi_sync_macro_observation_columns();

-- 6. Add missing columns to existing "MacroSyncLog" table & backfill 4 existing logs
ALTER TABLE "MacroSyncLog" ADD COLUMN IF NOT EXISTS "recordsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MacroSyncLog" ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "MacroSyncLog"
SET
  "recordsCount" = COALESCE("itemsSynced", 0),
  "syncedAt" = COALESCE("executedAt", CURRENT_TIMESTAMP);

CREATE OR REPLACE FUNCTION afi_sync_macro_sync_log_columns()
RETURNS TRIGGER AS $$
BEGIN
  NEW."itemsSynced" := COALESCE(NEW."recordsCount", NEW."itemsSynced", 0);
  NEW."recordsCount" := COALESCE(NEW."recordsCount", NEW."itemsSynced", 0);
  NEW."executedAt" := COALESCE(NEW."syncedAt", NEW."executedAt", CURRENT_TIMESTAMP);
  NEW."syncedAt" := COALESCE(NEW."syncedAt", NEW."executedAt", CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_afi_sync_macro_sync_log_columns ON "MacroSyncLog";
CREATE TRIGGER trg_afi_sync_macro_sync_log_columns
BEFORE INSERT OR UPDATE ON "MacroSyncLog"
FOR EACH ROW EXECUTE FUNCTION afi_sync_macro_sync_log_columns();

-- 7. Create the 7 missing tables required by prisma/schema.prisma (strictly CREATE TABLE IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "DebtFacility" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "principal" DECIMAL(15,2) NOT NULL,
    "outstandingBalance" DECIMAL(15,2) NOT NULL,
    "indexer" TEXT NOT NULL,
    "spreadAnnualPct" DECIMAL(8,4) NOT NULL,
    "monthlyPayment" DECIMAL(15,2),
    "maturityDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DebtFacility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIAnalysisReport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "prompt" TEXT,
    "response" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIAnalysisReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OperationalMemory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "memoryType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "structuredData" JSONB,
    "periodRef" TEXT,
    "dataVersionRef" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationalMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentExecutionLog" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "companyId" TEXT,
    "question" TEXT NOT NULL,
    "periodRef" TEXT,
    "dataVersionsUsed" JSONB,
    "toolsCalled" JSONB,
    "validatedArgs" JSONB,
    "toolResults" JSONB,
    "modelUsed" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tokenUsage" JSONB,
    "durationMs" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "finalResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutomationJobRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "workflowType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "metrics" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    CONSTRAINT "AutomationJobRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BusinessBaseline" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "manualSpreadsheetMinutes" DOUBLE PRECISION NOT NULL,
    "manualDiagnosticMinutes" DOUBLE PRECISION NOT NULL,
    "manualReportMinutes" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessBaseline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EvaluationRun" (
    "id" TEXT NOT NULL,
    "suiteName" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "totalCases" INTEGER NOT NULL,
    "passedCases" INTEGER NOT NULL,
    "scorePct" DOUBLE PRECISION NOT NULL,
    "results" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- 8. Create non-destructive indexes and foreign keys for the 7 newly created tables
CREATE INDEX IF NOT EXISTS "DebtFacility_companyId_idx" ON "DebtFacility"("companyId");
CREATE INDEX IF NOT EXISTS "AIAnalysisReport_companyId_idx" ON "AIAnalysisReport"("companyId");
CREATE INDEX IF NOT EXISTS "OperationalMemory_companyId_memoryType_idx" ON "OperationalMemory"("companyId", "memoryType");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentExecutionLog_executionId_key" ON "AgentExecutionLog"("executionId");
CREATE INDEX IF NOT EXISTS "AgentExecutionLog_companyId_createdAt_idx" ON "AgentExecutionLog"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutomationJobRun_companyId_startedAt_idx" ON "AutomationJobRun"("companyId", "startedAt");
CREATE INDEX IF NOT EXISTS "BusinessBaseline_companyId_idx" ON "BusinessBaseline"("companyId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'DebtFacility' AND constraint_name = 'DebtFacility_companyId_fkey'
  ) THEN
    ALTER TABLE "DebtFacility" ADD CONSTRAINT "DebtFacility_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'AIAnalysisReport' AND constraint_name = 'AIAnalysisReport_companyId_fkey'
  ) THEN
    ALTER TABLE "AIAnalysisReport" ADD CONSTRAINT "AIAnalysisReport_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'OperationalMemory' AND constraint_name = 'OperationalMemory_companyId_fkey'
  ) THEN
    ALTER TABLE "OperationalMemory" ADD CONSTRAINT "OperationalMemory_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'AgentExecutionLog' AND constraint_name = 'AgentExecutionLog_companyId_fkey'
  ) THEN
    ALTER TABLE "AgentExecutionLog" ADD CONSTRAINT "AgentExecutionLog_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'AutomationJobRun' AND constraint_name = 'AutomationJobRun_companyId_fkey'
  ) THEN
    ALTER TABLE "AutomationJobRun" ADD CONSTRAINT "AutomationJobRun_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'public' AND table_name = 'BusinessBaseline' AND constraint_name = 'BusinessBaseline_companyId_fkey'
  ) THEN
    ALTER TABLE "BusinessBaseline" ADD CONSTRAINT "BusinessBaseline_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
