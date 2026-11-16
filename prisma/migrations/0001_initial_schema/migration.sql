-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "industry" TEXT,
    "taxRegime" TEXT,
    "monthlyRevenueTier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "periodType" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialPeriodVersion" (
    "id" TEXT NOT NULL,
    "financialPeriodId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "grossRevenue" DECIMAL(15,2),
    "netRevenue" DECIMAL(15,2),
    "cmv" DECIMAL(15,2),
    "variableExpenses" DECIMAL(15,2),
    "contributionMargin" DECIMAL(15,2),
    "fixedExpenses" DECIMAL(15,2),
    "operatingResult" DECIMAL(15,2),
    "depreciation" DECIMAL(15,2),
    "ebit" DECIMAL(15,2),
    "ebitda" DECIMAL(15,2),
    "financialResult" DECIMAL(15,2),
    "lair" DECIMAL(15,2),
    "netProfit" DECIMAL(15,2),
    "operatingBreakEven" DECIMAL(15,2),
    "financialBreakEven" DECIMAL(15,2),
    "rawData" JSONB,
    "validationSummary" JSONB,
    "createdBy" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialPeriodVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtFacility" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DebtFacility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroIndicator" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "seriesCode" TEXT,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "frequency" TEXT,
    "methodology" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroIndicator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroObservation" (
    "id" TEXT NOT NULL,
    "indicatorId" TEXT NOT NULL,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "publicationDate" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncSource" TEXT NOT NULL DEFAULT 'LOCAL_REFERENCE',
    "value" DECIMAL(15,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MacroObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroSyncLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MacroSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAnalysisReport" (
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

-- CreateTable
CREATE TABLE "OperationalMemory" (
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

-- CreateTable
CREATE TABLE "AgentExecutionLog" (
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

-- CreateTable
CREATE TABLE "AutomationJobRun" (
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

-- CreateTable
CREATE TABLE "BusinessBaseline" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "manualSpreadsheetMinutes" DOUBLE PRECISION NOT NULL,
    "manualDiagnosticMinutes" DOUBLE PRECISION NOT NULL,
    "manualReportMinutes" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
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

-- CreateIndex
CREATE UNIQUE INDEX "Company_cnpj_key" ON "Company"("cnpj");

-- CreateIndex
CREATE INDEX "Company_cnpj_idx" ON "Company"("cnpj");

-- CreateIndex
CREATE INDEX "FinancialPeriod_companyId_idx" ON "FinancialPeriod"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialPeriod_companyId_year_month_periodType_key" ON "FinancialPeriod"("companyId", "year", "month", "periodType");

-- CreateIndex
CREATE INDEX "FinancialPeriodVersion_financialPeriodId_versionNumber_idx" ON "FinancialPeriodVersion"("financialPeriodId", "versionNumber");

-- CreateIndex
CREATE INDEX "DebtFacility_companyId_idx" ON "DebtFacility"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "MacroIndicator_code_key" ON "MacroIndicator"("code");

-- CreateIndex
CREATE INDEX "MacroObservation_indicatorId_referenceDate_idx" ON "MacroObservation"("indicatorId", "referenceDate");

-- CreateIndex
CREATE UNIQUE INDEX "MacroObservation_indicatorId_referenceDate_key" ON "MacroObservation"("indicatorId", "referenceDate");

-- CreateIndex
CREATE INDEX "AIAnalysisReport_companyId_idx" ON "AIAnalysisReport"("companyId");

-- CreateIndex
CREATE INDEX "OperationalMemory_companyId_memoryType_idx" ON "OperationalMemory"("companyId", "memoryType");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecutionLog_executionId_key" ON "AgentExecutionLog"("executionId");

-- CreateIndex
CREATE INDEX "AgentExecutionLog_companyId_createdAt_idx" ON "AgentExecutionLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationJobRun_companyId_startedAt_idx" ON "AutomationJobRun"("companyId", "startedAt");

-- CreateIndex
CREATE INDEX "BusinessBaseline_companyId_idx" ON "BusinessBaseline"("companyId");

-- AddForeignKey
ALTER TABLE "FinancialPeriod" ADD CONSTRAINT "FinancialPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialPeriodVersion" ADD CONSTRAINT "FinancialPeriodVersion_financialPeriodId_fkey" FOREIGN KEY ("financialPeriodId") REFERENCES "FinancialPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtFacility" ADD CONSTRAINT "DebtFacility_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroObservation" ADD CONSTRAINT "MacroObservation_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "MacroIndicator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnalysisReport" ADD CONSTRAINT "AIAnalysisReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalMemory" ADD CONSTRAINT "OperationalMemory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecutionLog" ADD CONSTRAINT "AgentExecutionLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationJobRun" ADD CONSTRAINT "AutomationJobRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessBaseline" ADD CONSTRAINT "BusinessBaseline_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
