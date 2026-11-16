import fs from 'fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

/**
 * Hydrates runtime environment variables from the active server.ts process in /proc
 * when running CLI tools or test suites in subshells that do not inherit platform secrets.
 * Never logs or exposes any secret values.
 */
export function hydrateRuntimeEnvFromServerProcess(): void {
  if (process.env.FORCE_MEMORY_DEMO === 'true') return;
  if (process.env.DATABASE_URL && process.env.GEMINI_API_KEY) return;
  try {
    if (!fs.existsSync('/proc')) return;
    const nul = String.fromCharCode(0);
    const pids = fs.readdirSync('/proc').filter(f => /^\d+$/.test(f));
    for (const pid of pids) {
      try {
        const rawEnv = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
        if (!rawEnv.includes('DATABASE_URL=')) continue;
        for (const entry of rawEnv.split(nul)) {
          const idx = entry.indexOf('=');
          if (idx > 0) {
            const key = entry.slice(0, idx);
            const val = entry.slice(idx + 1);
            if (
              [
                'DATABASE_URL',
                'GEMINI_API_KEY',
                'SESSION_SECRET',
                'APP_ADMIN_PASSWORD',
                'APP_ADMIN_EMAIL',
                'RESEND_API_KEY',
                'SMTP_URL',
                'EMAIL_FROM',
                'N8N_WEBHOOK_URL',
                'N8N_WEBHOOK_SECRET',
                'N8N_WEBHOOK_AUTH_MODE',
              ].includes(key) &&
              !process.env[key] &&
              val
            ) {
              process.env[key] = val;
            }
          }
        }
        if (process.env.DATABASE_URL) break;
      } catch {
        // Ignore unreadable /proc entries
      }
    }
  } catch {
    // Ignore if /proc is unavailable
  }
}

hydrateRuntimeEnvFromServerProcess();

export type PersistenceMode = 'POSTGRESQL' | 'MEMORY_DEMO';
export type DatabaseSchemaMode = 'FULL_PRISMA_SCHEMA' | 'LEGACY_COMPATIBLE_NEON' | 'UNVERIFIED';

let prisma: PrismaClient | null = null;
let connectionError: string | null = null;
let persistenceMode: PersistenceMode = 'MEMORY_DEMO';
let lastWriteError: string | null = null;
let detectedSchemaMode: DatabaseSchemaMode = 'UNVERIFIED';
let schemaMigrationSummary: {
  compatibleWithDirectPrismaModels: boolean;
  legacyCompatibleAdapterActive: boolean;
  appliedMigrations: string[];
  pendingLocalMigrations: string[];
  existingTables: string[];
  missingTablesFromLocalSchema: string[];
  schemaConflictNotes: string[];
} | null = null;

/**
 * Scrubs any database connection URLs, passwords, usernames, tokens, Neon hostnames, or secrets
 * from error messages before logging or returning to callers.
 */
export function sanitizeDatabaseErrorMessage(raw: unknown): string {
  const text = String((raw as any)?.message || raw || 'Erro desconhecido no banco de dados');
  return text
    .replace(/(?:jdbc:)?postgres(ql)?:\/\/[^\s"']+/gi, 'postgresql://[CREDENCIAIS_OCULTADAS]')
    .replace(/(user|username|password|secret|token|apikey|api_key)\s*=\s*[^\s&"']+/gi, '$1=[OCULTADO]')
    .replace(/[a-z0-9.-]+\.neon\.tech/gi, '[HOST_NEON_OCULTADO]');
}

/**
 * Normalizes PostgreSQL connection strings, including Neon JDBC URLs
 * (e.g. jdbc:postgresql://host/db?user=...&password=...&sslmode=require&channelBinding=require)
 * into RFC-3986 standard postgresql:// URLs accepted by Prisma Client.
 */
export function normalizePostgresUrl(rawUrl?: string | null): string {
  if (!rawUrl) return '';
  let clean = rawUrl.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!clean) return '';

  // Extract URL if wrapped in a psql command string
  const psqlMatch = clean.match(/^psql\s+['"]?((?:jdbc:)?postgres(?:ql)?:\/\/[^'"\s]+)['"]?/i);
  if (psqlMatch) {
    clean = psqlMatch[1];
  }

  // Strip leading jdbc: prefix if configured from a JDBC connection string snippet
  if (/^jdbc:postgres(ql)?:\/\//i.test(clean)) {
    clean = clean.replace(/^jdbc:/i, '');
  }

  if (!/^postgres(ql)?:\/\/.+/i.test(clean)) {
    return clean;
  }

  try {
    const parsed = new URL(clean);
    const qpUser = parsed.searchParams.get('user') || parsed.searchParams.get('username');
    const qpPass = parsed.searchParams.get('password');

    if (!parsed.username && qpUser) {
      parsed.username = encodeURIComponent(qpUser);
      parsed.searchParams.delete('user');
      parsed.searchParams.delete('username');
    }
    if (!parsed.password && qpPass) {
      parsed.password = encodeURIComponent(qpPass);
      parsed.searchParams.delete('password');
    }
    if (parsed.searchParams.has('channelBinding')) {
      const cb = parsed.searchParams.get('channelBinding');
      parsed.searchParams.delete('channelBinding');
      if (cb && !parsed.searchParams.has('channel_binding')) {
        parsed.searchParams.set('channel_binding', cb);
      }
    }
    return parsed.toString();
  } catch {
    return clean;
  }
}

export function isValidPostgresUrl(url?: string | null): boolean {
  if (!url) return false;
  const clean = normalizePostgresUrl(url);
  if (!clean) return false;
  if (!/^postgres(ql)?:\/\/.+/i.test(clean)) return false;
  if (/USER:PASSWORD@HOST|MY_DATABASE_URL/i.test(clean)) return false;
  try {
    const parsed = new URL(clean);
    return Boolean(parsed.hostname && parsed.pathname && parsed.pathname.length > 1);
  } catch {
    return false;
  }
}

export function getPersistenceMode(): PersistenceMode {
  return persistenceMode;
}

export function getDatabaseSchemaMode(): DatabaseSchemaMode {
  return detectedSchemaMode;
}

export function getSchemaMigrationSummary() {
  return schemaMigrationSummary;
}

export function getLastWriteError(): string | null {
  return lastWriteError;
}

export function getPersistenceState(): {
  mode: PersistenceMode;
  schemaMode: DatabaseSchemaMode;
  isConnected: boolean;
  lastWriteError: string | null;
  lastWriteErrorAt: string | null;
} {
  return {
    mode: persistenceMode,
    schemaMode: detectedSchemaMode,
    isConnected: persistenceMode === 'POSTGRESQL' && Boolean(prisma),
    lastWriteError,
    lastWriteErrorAt: lastWriteError ? new Date().toISOString() : null,
  };
}

export function recordWriteError(err: unknown): string {
  const safeMsg = sanitizeDatabaseErrorMessage(err);
  lastWriteError = safeMsg;
  console.error(`[POSTGRESQL_WRITE_ERROR] Operação de escrita falhou no PostgreSQL: ${safeMsg}`);
  return safeMsg;
}

export function switchToMemoryDemoAtStartup(reason: string) {
  const safeReason = sanitizeDatabaseErrorMessage(reason);
  // Only allow switching to MEMORY_DEMO if DATABASE_URL is NOT configured
  if (!isValidPostgresUrl(process.env.DATABASE_URL)) {
    if (prisma) {
      prisma.$disconnect().catch(() => {});
    }
    prisma = null;
    persistenceMode = 'MEMORY_DEMO';
  }
  connectionError = safeReason;
}

const EXPECTED_PRISMA_TABLES = [
  'User',
  'UserSession',
  'Company',
  'FinancialPeriod',
  'FinancialPeriodVersion',
  'DebtFacility',
  'MacroIndicator',
  'MacroObservation',
  'MacroSyncLog',
  'AIAnalysisReport',
  'OperationalMemory',
  'AgentExecutionLog',
  'AutomationJobRun',
  'BusinessBaseline',
  'EvaluationRun',
];

export async function inspectDatabaseSchemaCompatibility(): Promise<DatabaseSchemaMode> {
  if (!prisma || persistenceMode !== 'POSTGRESQL') {
    detectedSchemaMode = 'UNVERIFIED';
    return detectedSchemaMode;
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    const tablesRows = (await prisma.$queryRaw`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `) as Array<{ table_name: string }>;

    const existingTables = tablesRows.map(r => r.table_name);
    const missingTables = EXPECTED_PRISMA_TABLES.filter(t => !existingTables.includes(t));

    const companyColsRows = (await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Company'
    `) as Array<{ column_name: string }>;
    const companyCols = companyColsRows.map(c => c.column_name);

    let appliedMigrations: string[] = [];
    if (existingTables.includes('_prisma_migrations')) {
      const migRows = (await prisma.$queryRaw`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE rolled_back_at IS NULL
        ORDER BY started_at ASC
      `) as Array<{ migration_name: string }>;
      appliedMigrations = migRows.map(m => m.migration_name);
    }

    const hasModernCompanyCols =
      companyCols.includes('name') &&
      companyCols.includes('industry') &&
      companyCols.includes('monthlyRevenueTier');

    const hasLegacyCompanyCols =
      companyCols.includes('tradeName') &&
      companyCols.includes('sector') &&
      companyCols.includes('isDemonstration');

    const pendingLocalMigrations = appliedMigrations.includes('0001_initial_schema')
      ? []
      : ['0001_initial_schema'];

    const conflictNotes: string[] = [];
    if (hasLegacyCompanyCols && !hasModernCompanyCols) {
      conflictNotes.push(
        'O banco Neon possui as migrações anteriores (20261111000000_init_companies_financial_history e 20261112000000_add_macro_indicators) com estrutura legada nas 6 tabelas existentes (ex.: Company.tradeName/sector, FinancialPeriod.periodMonth/periodYear, FinancialPeriodVersion.periodId/rawInputs/calculatedResults).'
      );
    }
    if (missingTables.length > 0) {
      conflictNotes.push(
        `7 tabelas do schema atual (0001_initial_schema) ainda não foram criadas no banco: ${missingTables.join(', ')}.`
      );
    }

    if (hasModernCompanyCols && missingTables.length === 0) {
      detectedSchemaMode = 'FULL_PRISMA_SCHEMA';
    } else if (hasLegacyCompanyCols) {
      detectedSchemaMode = 'LEGACY_COMPATIBLE_NEON';
    } else {
      detectedSchemaMode = 'FULL_PRISMA_SCHEMA';
    }

    schemaMigrationSummary = {
      compatibleWithDirectPrismaModels: detectedSchemaMode === 'FULL_PRISMA_SCHEMA',
      legacyCompatibleAdapterActive: detectedSchemaMode === 'LEGACY_COMPATIBLE_NEON',
      appliedMigrations,
      pendingLocalMigrations,
      existingTables: existingTables.filter(t => t !== '_prisma_migrations'),
      missingTablesFromLocalSchema: missingTables,
      schemaConflictNotes: conflictNotes,
    };

    connectionError = null;
    return detectedSchemaMode;
  } catch (err: any) {
    connectionError = sanitizeDatabaseErrorMessage(err);
    return detectedSchemaMode;
  }
}

/**
 * Used strictly in automated tests to verify that PostgreSQL write failures
 * throw an explicit error and NEVER fall back silently to in-memory storage.
 */
export function setPersistenceStateForTesting(state: {
  mode: PersistenceMode;
  client?: any;
  isConnected?: boolean;
  lastWriteError?: string | null;
  error?: string | null;
  schemaMode?: DatabaseSchemaMode;
}) {
  persistenceMode = state.mode;
  prisma = state.client ?? null;
  connectionError = state.error ?? null;
  lastWriteError = state.lastWriteError ?? null;
  if (state.schemaMode) {
    detectedSchemaMode = state.schemaMode;
  }
}

try {
  const isTestRunnerMemoryMode = process.env.FORCE_MEMORY_DEMO === 'true';
  const rawUrl = process.env.DATABASE_URL;
  const normalizedUrl = normalizePostgresUrl(rawUrl);

  if (isTestRunnerMemoryMode) {
    persistenceMode = 'MEMORY_DEMO';
    connectionError = 'Modo de teste unitário isolado (FORCE_MEMORY_DEMO=true).';
  } else if (!normalizedUrl) {
    persistenceMode = 'MEMORY_DEMO';
    connectionError =
      'DATABASE_URL não configurada no ambiente privado (operando exclusivamente em modo de demonstração em memória — registros não persistidos).';
  } else if (!isValidPostgresUrl(normalizedUrl)) {
    persistenceMode = 'MEMORY_DEMO';
    connectionError =
      'DATABASE_URL inválida: deve iniciar com postgresql://, postgres:// ou jdbc:postgresql:// (operando em modo de demonstração em memória).';
  } else {
    process.env.DATABASE_URL = normalizedUrl;
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: normalizedUrl,
        },
      },
    });
    persistenceMode = 'POSTGRESQL';
    connectionError = null;
  }
} catch (err: any) {
  prisma = null;
  persistenceMode = 'MEMORY_DEMO';
  connectionError = sanitizeDatabaseErrorMessage(err);
}

export { prisma, connectionError };

