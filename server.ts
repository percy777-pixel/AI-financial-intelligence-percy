import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import Decimal from 'decimal.js';
import {
  isValidPostgresUrl,
  prisma,
  connectionError,
  getPersistenceState,
  getSchemaMigrationSummary,
  inspectDatabaseSchemaCompatibility,
  sanitizeDatabaseErrorMessage,
} from './server/prisma.js';
import {
  parseCsvBuffer,
  parseXlsxBuffer,
  suggestColumnMapping,
} from './server/services/importService.js';
import {
  calculateDRE,
  calculateIndicators,
  compareFinancialRecords,
  explainCalculation,
  RawFinancialInput,
  serializeDRE,
  serializeIndicators,
  validateFinancialInput,
} from './server/services/financialEngine.js';
import {
  compareMacroPeriods,
  fetchAndSyncMacroData,
  getLatestMacroIndicators,
  getMacroHistory,
  getMacroPublicationMetadata,
} from './server/services/macroService.js';
import { generateFinancialDiagnosticAndRecommendations } from './server/services/aiService.js';
import {
  buildScenarioComparisonSuite,
  simulateScenario,
} from './server/services/scenarioService.js';
import {
  addDebtFacility,
  createCompany,
  createOperationalMemory,
  deleteOperationalMemory,
  ensureDemoCompaniesInDb,
  getBusinessBaselines,
  getCompanyById,
  getCompanyPeriods,
  getDebtFacilities,
  listAgentExecutionLogs,
  listAnalysisReports,
  listAutomationRuns,
  listCompanies,
  listEvaluationRuns,
  listOperationalMemory,
  saveAnalysisReport,
  saveBusinessBaseline,
  saveFinancialPeriodVersion,
} from './server/services/dataStore.js';
import { analyzeDebtAndEconomicContext } from './server/services/economicContextService.js';
import { runFinancialAgent } from './server/services/agentService.js';
import { AGENT_FUNCTION_DECLARATIONS } from './server/services/agentTools.js';
import { generateExecutiveReport } from './server/services/reportService.js';
import {
  getAutomationTelemetrySummary,
  getWebhookStatus,
  runAutomatedImportPipeline,
  testWebhookConnection,
} from './server/services/automationService.js';
import { runAgentEvaluationSuite } from './server/services/evaluationService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the compiled frontend directory accurately in both development (tsx server.ts)
 * and compiled production (node dist/server.js) without creating a duplicate dist/dist path.
 */
export function resolveFrontendDistPath(currentDir: string = __dirname): string {
  if (fs.existsSync(path.join(currentDir, 'index.html'))) {
    return currentDir;
  }
  const childDist = path.resolve(currentDir, 'dist');
  if (fs.existsSync(path.join(childDist, 'index.html'))) {
    return childDist;
  }
  return childDist;
}

// Server-side HttpOnly session store (active when SESSION_SECRET and APP_ADMIN_PASSWORD are configured)
interface ServerSession {
  id: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}
const activeSessions = new Map<string, ServerSession>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

interface LoginAttemptRecord {
  count: number;
  windowStart: number;
}
const loginAttemptsByIp = new Map<string, LoginAttemptRecord>();
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;

export function resetLoginRateLimiterForTesting(): void {
  loginAttemptsByIp.clear();
}

export function resetAuthStateForTesting(): void {
  activeSessions.clear();
  loginAttemptsByIp.clear();
}

export function createSessionToken(secret: string, ttlMs: number = SESSION_TTL_MS): string {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  activeSessions.set(sessionId, {
    id: sessionId,
    csrfToken,
    createdAt: now,
    expiresAt: now + ttlMs,
  });
  return signSessionToken(sessionId, secret);
}

export function expireSessionCookieForTesting(cookieHeader: string | undefined): boolean {
  const session = getValidSessionFromCookie(cookieHeader);
  if (!session) return false;
  session.expiresAt = Date.now() - 1000;
  return true;
}

export function isSessionAuthEnforced(): boolean {
  const secret = process.env.SESSION_SECRET;
  const password = process.env.APP_ADMIN_PASSWORD;
  return Boolean(secret && secret.trim().length >= 16 && password && password.trim().length >= 4);
}

function signSessionToken(sessionId: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  return `${sessionId}.${sig}`;
}

function extractSessionIdFromTokenString(rawToken: string | undefined | null): string | null {
  if (!rawToken) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  let token = rawToken.trim();
  try {
    token = decodeURIComponent(token);
  } catch {
    // Keep raw token if not URI-encoded
  }
  const [sessionId, sig] = token.split('.');
  if (!sessionId || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  return sessionId;
}

function extractSessionIdFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('afi_session='));
  if (!match) return null;
  return extractSessionIdFromTokenString(match.slice('afi_session='.length));
}

function extractSessionIdFromRequest(req: { headers: Record<string, any> }): string | null {
  const fromCookie = extractSessionIdFromCookie(req.headers?.cookie);
  if (fromCookie) return fromCookie;
  const headerToken = req.headers?.['x-afi-session'];
  if (typeof headerToken === 'string' && headerToken.trim().length > 0) {
    return extractSessionIdFromTokenString(headerToken);
  }
  return null;
}

function getValidSessionFromCookie(cookieHeader: string | undefined): ServerSession | null {
  if (!isSessionAuthEnforced()) return null;
  const sessionId = extractSessionIdFromCookie(cookieHeader);
  if (!sessionId) return null;
  const session = activeSessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(sessionId);
    return null;
  }
  return session;
}

function getValidSessionFromRequest(req: { headers: Record<string, any> }): ServerSession | null {
  if (!isSessionAuthEnforced()) return null;
  const sessionId = extractSessionIdFromRequest(req);
  if (!sessionId) return null;
  const session = activeSessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(sessionId);
    return null;
  }
  return session;
}

function verifySessionCookie(cookieHeader: string | undefined): boolean {
  if (!isSessionAuthEnforced()) return true;
  return Boolean(getValidSessionFromCookie(cookieHeader));
}

function verifyPasswordConstantTime(inputPassword: string, expectedPassword: string): boolean {
  const exactH1 = crypto.createHash('sha256').update(inputPassword).digest();
  const exactH2 = crypto.createHash('sha256').update(expectedPassword).digest();
  const exactMatch = crypto.timingSafeEqual(exactH1, exactH2);

  const trimmedInput = inputPassword.trim();
  const trimmedExpected = expectedPassword.trim();
  const trimH1 = crypto.createHash('sha256').update(trimmedInput).digest();
  const trimH2 = crypto.createHash('sha256').update(trimmedExpected).digest();
  const trimmedMatch = trimmedExpected.length >= 4 && crypto.timingSafeEqual(trimH1, trimH2);

  return exactMatch || trimmedMatch;
}

function buildSessionCookieHeader(
  req: { secure?: boolean; headers: Record<string, any> },
  value: string,
  maxAgeSeconds: number
): string {
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').toLowerCase();
  const originHeader = String(req.headers?.origin || req.headers?.referer || '').toLowerCase();
  const isHttpsProxyOrIframe =
    Boolean(req.secure) ||
    forwardedProto.includes('https') ||
    originHeader.startsWith('https://') ||
    process.env.NODE_ENV === 'production';

  if (isHttpsProxyOrIframe) {
    // Required for cross-origin iframe inside Google AI Studio (https://aistudio.google.com -> https://*.run.app)
    return `afi_session=${ value }; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=None; Secure; Partitioned`;
  }
  return `afi_session=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Strict`;
}

export async function createConfiguredApp() {
  const app = express();
  const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

  app.use(express.json({ limit: '2mb' }));

  await ensureDemoCompaniesInDb();

  // Middleware: Session Auth Protection, CSRF Validation & Company Context Consistency
  app.use('/api', (req, res, next) => {
    const isPublicEndpoint =
      req.path === '/health' ||
      req.path === '/database/status' ||
      req.path === '/auth/status' ||
      req.path === '/auth/login' ||
      req.path === '/auth/logout';

    // 1. Enforce server session on ALL private routes (GET, POST, PUT, PATCH, DELETE) when SESSION_SECRET & APP_ADMIN_PASSWORD are configured
    if (!isPublicEndpoint && isSessionAuthEnforced()) {
      const session = getValidSessionFromRequest(req);
      if (!session) {
        return res.status(401).json({
          error: 'Não autenticado ou sessão expirada. Faça login em /api/auth/login para acessar os recursos privados.',
          code: 'UNAUTHORIZED_SESSION_REQUIRED',
        });
      }

      // 2. Enforce CSRF protection on mutating requests (POST, PUT, PATCH, DELETE)
      const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
      if (isMutating) {
        const csrfHeader = req.headers['x-csrf-token'];
        const providedCsrf = typeof csrfHeader === 'string' ? csrfHeader.trim() : '';
        if (!providedCsrf || providedCsrf !== session.csrfToken) {
          return res.status(403).json({
            error: 'Falha na validação de segurança CSRF (cabeçalho X-CSRF-Token ausente ou inválido).',
            code: 'CSRF_TOKEN_INVALID',
          });
        }
      }
    }

    // 3. Cross-company context consistency check via X-Company-Context header
    // Note: X-Company-Context is a context consistency lock and NEVER grants authentication by itself.
    const contextHeader = req.headers['x-company-context'];
    const headerCompanyId = typeof contextHeader === 'string' && contextHeader.trim() !== '' ? contextHeader.trim() : undefined;

    const paramMatch = req.path.match(/^\/companies\/([^/]+)/);
    const routeCompanyId = paramMatch ? decodeURIComponent(paramMatch[1]) : undefined;
    const bodyCompanyId = req.body && typeof req.body.companyId === 'string' ? req.body.companyId : undefined;
    const queryCompanyId = typeof req.query?.companyId === 'string' ? req.query.companyId : undefined;

    const targetCompanyId = routeCompanyId || bodyCompanyId || queryCompanyId;
    if (headerCompanyId && targetCompanyId && headerCompanyId !== targetCompanyId) {
      return res.status(403).json({
        error: `Violação de consistência de contexto por empresa: o contexto ativo (${headerCompanyId}) não tem permissão para acessar ou alterar dados da empresa (${targetCompanyId}).`,
        code: 'COMPANY_CONTEXT_MISMATCH',
      });
    }

    next();
  });

  // Authentication & Security Mode Endpoints
  app.get('/api/auth/status', (req, res) => {
    const enforced = isSessionAuthEnforced();
    const session = enforced ? getValidSessionFromRequest(req) : null;
    const authenticated = enforced ? Boolean(session) : false;
    res.json({
      authEnforced: enforced,
      authenticated,
      csrfToken: session ? session.csrfToken : null,
      expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
      securityMode: enforced ? 'SERVER_SESSION_HTTPONLY' : 'DEMO_PRIVATE_UNAUTHENTICATED',
      authModel: 'SINGLE_ADMIN_PASSWORD',
      isReadyForPublicMultiUser: false,
      companyContextPolicy:
        'O cabeçalho X-Company-Context atua exclusivamente como trava de consistência de contexto dentro da sessão administrativa autenticada; não concede autorização multiusuário por si só.',
      note: enforced
        ? 'Autenticação administrativa de usuário único via sessão assinada no servidor + proteção CSRF (X-CSRF-Token) ativa para todas as rotas privadas.'
        : 'Demonstração técnica privada (SESSION_SECRET / APP_ADMIN_PASSWORD não configurados). Isolamento de contexto por empresa ativo via X-Company-Context, mas não pronta para uso público multiusuário sem autenticação e RBAC.',
    });
  });

  app.post('/api/auth/login', (req, res) => {
    if (!isSessionAuthEnforced()) {
      return res.status(400).json({
        error: 'Autenticação de sessão não está habilitada (configure SESSION_SECRET e APP_ADMIN_PASSWORD no ambiente privado).',
      });
    }

    const clientIp = String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'local').split(',')[0].trim();
    const now = Date.now();
    const existingAttempt = loginAttemptsByIp.get(clientIp);
    if (existingAttempt) {
      if (now - existingAttempt.windowStart > LOGIN_RATE_LIMIT_WINDOW_MS) {
        loginAttemptsByIp.delete(clientIp);
      } else if (existingAttempt.count >= LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
        const retryAfterSeconds = Math.ceil((LOGIN_RATE_LIMIT_WINDOW_MS - (now - existingAttempt.windowStart)) / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({
          error: 'Muitas tentativas de login inválidas. Aguarde antes de tentar novamente.',
          retryAfterSeconds,
          code: 'LOGIN_RATE_LIMITED',
        });
      }
    }

    const { password } = req.body || {};
    if (typeof password !== 'string' || password.trim().length === 0 || password.length > 256) {
      const prev = loginAttemptsByIp.get(clientIp);
      loginAttemptsByIp.set(clientIp, {
        count: (prev?.count || 0) + 1,
        windowStart: prev?.windowStart || now,
      });
      return res.status(400).json({ error: 'Senha inválida ou não informada.' });
    }

    const expectedPassword = process.env.APP_ADMIN_PASSWORD!;
    if (!verifyPasswordConstantTime(password, expectedPassword)) {
      const prev = loginAttemptsByIp.get(clientIp);
      loginAttemptsByIp.set(clientIp, {
        count: (prev?.count || 0) + 1,
        windowStart: prev?.windowStart || now,
      });
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    // Reset rate limit counter on successful login
    loginAttemptsByIp.delete(clientIp);

    const sessionId = crypto.randomUUID();
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = now + SESSION_TTL_MS;
    activeSessions.set(sessionId, {
      id: sessionId,
      csrfToken,
      createdAt: now,
      expiresAt,
    });
    const signedToken = signSessionToken(sessionId, process.env.SESSION_SECRET!);
    const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
    res.setHeader('Set-Cookie', buildSessionCookieHeader(req, encodeURIComponent(signedToken), maxAgeSec));
    res.json({
      authenticated: true,
      sessionToken: signedToken,
      csrfToken,
      expiresInSeconds: maxAgeSec,
      expiresAt: new Date(expiresAt).toISOString(),
      authModel: 'SINGLE_ADMIN_PASSWORD',
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    const sessionId = extractSessionIdFromRequest(req);
    if (sessionId) {
      activeSessions.delete(sessionId);
    }
    res.setHeader('Set-Cookie', buildSessionCookieHeader(req, '', 0));
    res.json({ authenticated: false });
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    const pState = getPersistenceState();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      persistenceMode: pState.mode,
      isPersisted: pState.mode === 'POSTGRESQL',
      securityMode: isSessionAuthEnforced() ? 'SERVER_SESSION_HTTPONLY' : 'DEMO_PRIVATE_UNAUTHENTICATED',
      aiConfigured: Boolean(
        process.env.GEMINI_API_KEY &&
          process.env.GEMINI_API_KEY.trim() !== '' &&
          process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    });
  });

  // Database status endpoint
  app.get('/api/database/status', async (req, res) => {
    const databaseUrl = process.env.DATABASE_URL;
    const urlConfigured = isValidPostgresUrl(databaseUrl);
    const pState = getPersistenceState();

    if (!urlConfigured || !prisma || pState.mode !== 'POSTGRESQL') {
      return res.json({
        urlConfigured: false,
        isConnected: false,
        isFallback: true,
        persistenceMode: 'MEMORY_DEMO',
        isPersisted: false,
        provider: 'postgresql',
        lastWriteError: pState.lastWriteError,
        lastWriteErrorAt: pState.lastWriteErrorAt,
        error: connectionError || 'DATABASE_URL not configured (using in-memory demo persistence)',
      });
    }

    try {
      const schemaMode = await inspectDatabaseSchemaCompatibility();
      const updatedState = getPersistenceState();
      res.json({
        urlConfigured: true,
        isConnected: true,
        isFallback: false,
        persistenceMode: 'POSTGRESQL',
        schemaMode,
        migrationSummary: getSchemaMigrationSummary(),
        isPersisted: true,
        provider: 'postgresql',
        lastWriteError: updatedState.lastWriteError,
        lastWriteErrorAt: updatedState.lastWriteErrorAt,
        message: 'Successfully connected to PostgreSQL',
      });
    } catch (err: any) {
      res.json({
        urlConfigured: true,
        isConnected: false,
        isFallback: false,
        persistenceMode: 'POSTGRESQL',
        isPersisted: false,
        provider: 'postgresql',
        lastWriteError: pState.lastWriteError,
        lastWriteErrorAt: pState.lastWriteErrorAt,
        error: sanitizeDatabaseErrorMessage(err),
      });
    }
  });

  // Companies API
  app.get('/api/companies', async (req, res) => {
    try {
      const companies = await listCompanies();
      res.json(companies);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/companies', async (req, res) => {
    try {
      const { name, cnpj, industry, taxRegime, monthlyRevenueTier } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ error: 'Nome da empresa é obrigatório.' });
      }
      const company = await createCompany({
        name: name.trim(),
        cnpj,
        industry,
        taxRegime: taxRegime || 'Simples Nacional',
        monthlyRevenueTier,
      });
      res.status(201).json(company);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Consolidated Financial + Economic Context for a Company
  app.get('/api/companies/:companyId/context', async (req, res) => {
    try {
      const { companyId } = req.params;
      const year = req.query.year ? Number(req.query.year) : undefined;
      const month = req.query.month ? Number(req.query.month) : undefined;

      const company = await getCompanyById(companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

      const periods = await getCompanyPeriods(companyId);
      const debts = await getDebtFacilities(companyId);
      const macroIndicators = await getLatestMacroIndicators();

      if (periods.length === 0) {
        return res.json({
          company,
          hasPeriods: false,
          periods: [],
          debts,
          macroIndicators,
        });
      }

      let activePeriod = periods[0];
      if (year !== undefined || month !== undefined) {
        const matched = periods.find(
          p => (year === undefined || p.year === year) && (month === undefined || p.month === month)
        );
        if (!matched) {
          return res.status(404).json({
            error: `Período solicitado (${month ? `${String(month).padStart(2, '0')}/` : ''}${year ?? '*'}) não encontrado para a empresa ${company.name}.`,
          });
        }
        activePeriod = matched;
      }

      const latestVersion = activePeriod.versions[0];
      const rawInput: RawFinancialInput = {
        ...latestVersion.rawData,
        taxRegime: latestVersion.rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
      };

      const dre = calculateDRE(rawInput);
      const indicators = calculateIndicators(dre, rawInput);
      const validation = validateFinancialInput(rawInput);
      const economicContext = analyzeDebtAndEconomicContext(dre, debts, macroIndicators, company.industry);

      let periodComparison: any = null;
      const activeIdx = periods.findIndex(p => p.id === activePeriod.id);
      if (activeIdx >= 0 && activeIdx + 1 < periods.length) {
        const prev = periods[activeIdx + 1];
        if (prev.versions[0]) {
          const prevDre = calculateDRE({
            ...prev.versions[0].rawData,
            taxRegime: prev.versions[0].rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
          });
          periodComparison = compareFinancialRecords(
            `${prev.month ? `${String(prev.month).padStart(2, '0')}/` : ''}${prev.year}`,
            prevDre,
            `${activePeriod.month ? `${String(activePeriod.month).padStart(2, '0')}/` : ''}${activePeriod.year}`,
            dre
          );
        }
      }

      res.json({
        company,
        hasPeriods: true,
        activePeriod: {
          id: activePeriod.id,
          year: activePeriod.year,
          month: activePeriod.month,
          periodType: activePeriod.periodType,
          versionNumber: latestVersion.versionNumber,
          createdAt: latestVersion.createdAt,
          persistenceMode: activePeriod.persistenceMode,
          isPersisted: activePeriod.isPersisted,
        },
        dre: serializeDRE(dre),
        indicators: serializeIndicators(indicators),
        validation,
        debts,
        economicContext,
        periodComparison,
        macroIndicators,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Calculation Explainer
  app.get('/api/companies/:companyId/explain', async (req, res) => {
    try {
      const { companyId } = req.params;
      const metric = String(req.query.metric || '');
      if (!metric) {
        return res.status(400).json({ error: 'O parâmetro metric é obrigatório.' });
      }
      const company = await getCompanyById(companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const periods = await getCompanyPeriods(companyId);
      if (periods.length === 0) return res.status(404).json({ error: 'Sem períodos.' });
      const rawInput = {
        ...periods[0].versions[0].rawData,
        taxRegime: periods[0].versions[0].rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
      };
      const dre = calculateDRE(rawInput);
      const indicators = calculateIndicators(dre, rawInput);
      res.json(explainCalculation(metric, dre, indicators, rawInput));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Debt Facilities
  app.get('/api/companies/:companyId/debts', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const debts = await getDebtFacilities(req.params.companyId);
      res.json(debts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/companies/:companyId/debts', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const { name, lender, principal, outstandingBalance, indexer, spreadAnnualPct, monthlyPayment, maturityDate, notes } = req.body;
      if (!name || !lender || outstandingBalance === undefined || !indexer) {
        return res.status(400).json({ error: 'Campos obrigatórios: name, lender, outstandingBalance, indexer.' });
      }
      const created = await addDebtFacility(req.params.companyId, {
        name,
        lender,
        principal: Number(principal ?? outstandingBalance),
        outstandingBalance: Number(outstandingBalance),
        indexer,
        spreadAnnualPct: Number(spreadAnnualPct ?? 0),
        monthlyPayment: monthlyPayment !== undefined ? Number(monthlyPayment) : null,
        maturityDate: maturityDate || null,
        notes: notes || null,
      });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Macroeconomic Endpoints
  app.get('/api/macro/indicators', async (req, res) => {
    try {
      const indicators = await getLatestMacroIndicators();
      res.json(indicators);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/macro/history', async (req, res) => {
    try {
      const code = String(req.query.code || 'SELIC');
      const limit = Number(req.query.limit || 12);
      const history = await getMacroHistory(code, limit);
      const comparison = await compareMacroPeriods(code, Math.min(limit - 1, 5));
      res.json({ code: code.toUpperCase(), history, comparison });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/macro/metadata', async (req, res) => {
    try {
      const code = req.query.code ? String(req.query.code) : undefined;
      res.json(await getMacroPublicationMetadata(code));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/macro/sync', async (req, res) => {
    try {
      const result = await fetchAndSyncMacroData();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // File Import Preview Endpoint
  app.post('/api/import/preview', upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }
      const fileBuffer = req.file.buffer;
      const fileName = req.file.originalname.toLowerCase();

      let result;
      if (fileName.endsWith('.csv')) {
        result = parseCsvBuffer(fileBuffer);
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        result = parseXlsxBuffer(fileBuffer);
      } else {
        return res.status(400).json({ error: 'Formato não suportado. Envie CSV ou XLSX.' });
      }

      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      const suggestedMapping = suggestColumnMapping(result.headers);
      res.json({
        headers: result.headers,
        rows: result.rows.slice(0, 10),
        totalRows: result.rows.length,
        suggestedMapping,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao processar arquivo' });
    }
  });

  // Process Import & Save Version
  app.post('/api/companies/:companyId/periods', async (req, res) => {
    try {
      const { companyId } = req.params;
      const company = await getCompanyById(companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

      const { year, month, periodType, financialData, changeReason, rejectDuplicate } = req.body;

      if (!year || !periodType) {
        return res.status(400).json({ error: 'Ano e periodType são obrigatórios.' });
      }

      const enrichedFinancialData: RawFinancialInput = {
        ...(financialData || {}),
        taxRegime: financialData?.taxRegime || company.taxRegime || 'Simples Nacional',
      };

      const validation = validateFinancialInput(enrichedFinancialData);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Dados financeiros inválidos ou incompletos.',
          validation,
        });
      }

      const saved = await saveFinancialPeriodVersion({
        companyId,
        year: Number(year),
        month: month ? Number(month) : null,
        periodType,
        financialData: enrichedFinancialData,
        changeReason,
        rejectDuplicate: Boolean(rejectDuplicate),
      });

      res.status(201).json({
        success: true,
        ...saved,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao salvar período' });
    }
  });

  app.get('/api/companies/:companyId/periods', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const periods = await getCompanyPeriods(req.params.companyId);
      res.json(periods);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AI Diagnostic & Recommendations Endpoint
  // Strictly recalculates DRE & Indicators on the server from stored data (never trusts client-supplied dre/indicators)
  app.post('/api/companies/:companyId/diagnostic', async (req, res) => {
    try {
      const { companyId } = req.params;
      const reqYear = req.body?.year ? Number(req.body.year) : req.query.year ? Number(req.query.year) : undefined;
      const reqMonth = req.body?.month ? Number(req.body.month) : req.query.month ? Number(req.query.month) : undefined;

      const company = await getCompanyById(companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

      const periods = await getCompanyPeriods(companyId);
      if (periods.length === 0 || !periods[0].versions[0]) {
        return res.status(400).json({
          error: 'Empresa não possui períodos financeiros armazenados para geração de diagnóstico.',
        });
      }

      let targetPeriod = periods[0];
      if (reqYear !== undefined || reqMonth !== undefined) {
        const matched = periods.find(
          p => (reqYear === undefined || p.year === reqYear) && (reqMonth === undefined || p.month === reqMonth)
        );
        if (!matched) {
          return res.status(404).json({
            error: `Período solicitado (${reqMonth ? `${String(reqMonth).padStart(2, '0')}/` : ''}${reqYear ?? '*'}) não encontrado para "${company.name}".`,
          });
        }
        targetPeriod = matched;
      }

      const v = targetPeriod.versions[0];
      const periodLabel = `${targetPeriod.month ? `${String(targetPeriod.month).padStart(2, '0')}/` : ''}${targetPeriod.year} (v${v.versionNumber})`;
      const raw: RawFinancialInput = {
        ...v.rawData,
        taxRegime: v.rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
      };

      const calcDre = calculateDRE(raw);
      const calcInd = calculateIndicators(calcDre, raw);
      const authoritativeDre = serializeDRE(calcDre);
      const authoritativeIndicators = serializeIndicators(calcInd);

      const debts = await getDebtFacilities(companyId);
      const macroIndicators = await getLatestMacroIndicators();
      const debtSummary = analyzeDebtAndEconomicContext(calcDre, debts, macroIndicators, company.industry).debtExposureSummary;

      const aiResult = await generateFinancialDiagnosticAndRecommendations({
        companyName: company.name,
        industry: company.industry || 'Geral',
        taxRegime: company.taxRegime || 'Simples Nacional',
        dre: authoritativeDre,
        indicators: authoritativeIndicators,
        macroIndicators,
        debtSummary,
        periodLabel,
      });

      await saveAnalysisReport({
        companyId,
        reportType: 'DIAGNOSTIC_RECOMMENDATION',
        provider: aiResult.provider,
        response: JSON.stringify(aiResult),
        metadata: { periodLabel, modelUsed: aiResult.modelUsed, recalculatedOnServer: true },
      });

      res.json({
        ...aiResult,
        periodLabel,
        authoritativeDre,
        authoritativeIndicators,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Falha ao gerar diagnóstico' });
    }
  });

  // Scenario Simulation Endpoints
  app.post('/api/simulate', async (req, res) => {
    try {
      const { companyId, year, month, baseDre, simulationInput } = req.body || {};

      if (companyId) {
        const company = await getCompanyById(String(companyId));
        if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
        const periods = await getCompanyPeriods(company.id);
        if (periods.length === 0 || !periods[0].versions[0]) {
          return res.status(400).json({ error: 'Empresa sem períodos financeiros para simulação.' });
        }
        let targetPeriod = periods[0];
        if (year !== undefined || month !== undefined) {
          const matched = periods.find(
            p =>
              (year === undefined || p.year === Number(year)) &&
              (month === undefined || p.month === Number(month))
          );
          if (!matched) {
            return res.status(404).json({ error: 'Período solicitado não encontrado para simulação.' });
          }
          targetPeriod = matched;
        }
        const raw: RawFinancialInput = {
          ...targetPeriod.versions[0].rawData,
          taxRegime: targetPeriod.versions[0].rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
        };
        const authoritativeDre = calculateDRE(raw);
        const debts = await getDebtFacilities(company.id);
        const result = simulateScenario(authoritativeDre, {
          ...(simulationInput || {}),
          taxRegime: raw.taxRegime,
          debtFacilities: simulationInput?.debtFacilities ?? debts,
        });
        const shouldPersistScenario = Boolean(req.body?.persistScenario || req.body?.saveToMemory);
        let persistedMemory = null;
        if (shouldPersistScenario) {
          const periodLabel = `${targetPeriod.month ? `${String(targetPeriod.month).padStart(2, '0')}/` : ''}${targetPeriod.year} (v${targetPeriod.versions[0].versionNumber})`;
          persistedMemory = await createOperationalMemory({
            companyId: company.id,
            memoryType: 'SCENARIO',
            title: result.scenarioLabel || `Cenário Simulado (${periodLabel})`,
            summary: `Regime: ${result.taxRegime} | Receita simulada R$ ${result.simulatedNetRevenue} | Lucro simulado R$ ${result.simulatedNetProfit} (Δ R$ ${result.netProfitDiff}).`,
            structuredData: result,
            periodRef: periodLabel,
            dataVersionRef: `v${targetPeriod.versions[0].versionNumber}`,
            createdBy: 'Simulador de Decisões',
          });
        }
        return res.json({
          ...result,
          ...(persistedMemory ? { persistedMemory, isPersisted: persistedMemory.isPersisted, persistenceMode: persistedMemory.persistenceMode } : {}),
        });
      }

      const grossRev = new Decimal(baseDre?.grossRevenue ?? 1500000);
      const deductions = new Decimal(baseDre?.deductions ?? 200000);
      const netRev = new Decimal(baseDre?.netRevenue ?? grossRev.minus(deductions));
      const cmv = new Decimal(baseDre?.cmv ?? 550000);
      const varExp = new Decimal(baseDre?.variableExpenses ?? 100000);
      const cm = new Decimal(baseDre?.contributionMargin ?? netRev.minus(cmv).minus(varExp));
      const cmPct = netRev.gt(0) ? cm.dividedBy(netRev).times(100) : new Decimal(0);
      const fixedExp = new Decimal(baseDre?.fixedExpenses ?? 400000);
      const opRes = new Decimal(baseDre?.operatingResult ?? cm.minus(fixedExp));
      const opResPct = netRev.gt(0) ? opRes.dividedBy(netRev).times(100) : new Decimal(0);
      const depr = new Decimal(baseDre?.depreciation ?? 40000);
      const ebit = new Decimal(baseDre?.ebit ?? opRes.minus(depr));
      const ebitda = new Decimal(baseDre?.ebitda ?? opRes);
      const finRev = new Decimal(baseDre?.financialRevenues ?? 10000);
      const finExp = new Decimal(baseDre?.financialExpenses ?? 25000);
      const finRes = new Decimal(baseDre?.financialResult ?? finRev.minus(finExp));
      const lair = new Decimal(baseDre?.lair ?? ebit.plus(finRes));
      const taxes = new Decimal(baseDre?.taxes ?? 0);
      const netProf = new Decimal(baseDre?.netProfit ?? lair.minus(taxes));
      const netProfPct = netRev.gt(0) ? netProf.dividedBy(netRev).times(100) : new Decimal(0);

      const dreObject = {
        taxRegime: baseDre?.taxRegime || simulationInput?.taxRegime || 'Simples Nacional',
        grossRevenue: grossRev,
        deductions,
        netRevenue: netRev,
        cmv,
        variableExpenses: varExp,
        contributionMargin: cm,
        contributionMarginPercentage: cmPct,
        fixedExpenses: fixedExp,
        operatingResult: opRes,
        operatingResultPercentage: opResPct,
        depreciation: depr,
        ebit,
        ebitda,
        financialRevenues: finRev,
        financialExpenses: finExp,
        financialResult: finRes,
        lair,
        taxes,
        netProfit: netProf,
        netProfitPercentage: netProfPct,
        operatingBreakEven: new Decimal(baseDre?.operatingBreakEven ?? 800000),
        financialBreakEven: new Decimal(baseDre?.financialBreakEven ?? 830000),
        safetyMargin: new Decimal(baseDre?.safetyMargin ?? 0),
      };

      const result = simulateScenario(dreObject, simulationInput || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Simulação falhou' });
    }
  });

  app.post('/api/companies/:companyId/simulate/compare', async (req, res) => {
    try {
      const { companyId } = req.params;
      const reqYear = req.body?.year ? Number(req.body.year) : undefined;
      const reqMonth = req.body?.month ? Number(req.body.month) : undefined;

      const company = await getCompanyById(companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

      const periods = await getCompanyPeriods(companyId);
      if (periods.length === 0) return res.status(404).json({ error: 'Empresa sem períodos.' });

      let targetPeriod = periods[0];
      if (reqYear !== undefined || reqMonth !== undefined) {
        const matched = periods.find(
          p => (reqYear === undefined || p.year === reqYear) && (reqMonth === undefined || p.month === reqMonth)
        );
        if (!matched) {
          return res.status(404).json({ error: 'Período solicitado não encontrado para comparação de cenários.' });
        }
        targetPeriod = matched;
      }

      const raw = {
        ...targetPeriod.versions[0].rawData,
        taxRegime: targetPeriod.versions[0].rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
      };
      const dre = calculateDRE(raw);
      const debts = await getDebtFacilities(companyId);
      const suite = buildScenarioComparisonSuite(dre, debts, req.body?.simulationInput || {});
      res.json(suite);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Financial Intelligence Agent Endpoints
  app.get('/api/agent/tools', (req, res) => {
    res.json(
      AGENT_FUNCTION_DECLARATIONS.map(d => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters,
      }))
    );
  });

  app.post('/api/agent/run', async (req, res) => {
    try {
      const { companyId, question, year, month } = req.body;
      if (!companyId || !question) {
        return res.status(400).json({ error: 'companyId e question são obrigatórios.' });
      }
      const result = await runFinancialAgent({ companyId, question, year, month });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // SSE Streaming Agent Execution (real-time tool steps)
  app.post('/api/agent/stream', async (req, res) => {
    const { companyId, question, year, month } = req.body;
    if (!companyId || !question) {
      return res.status(400).json({ error: 'companyId e question são obrigatórios.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const result = await runFinancialAgent({
        companyId,
        question,
        year,
        month,
        onEvent: ev => sendEvent('step', ev),
      });
      sendEvent('result', result);
      res.end();
    } catch (err: any) {
      sendEvent('error', { error: err.message });
      res.end();
    }
  });

  app.get('/api/agent/logs', async (req, res) => {
    try {
      const companyId = req.query.companyId ? String(req.query.companyId).trim() : '';
      if (!companyId) {
        return res.status(400).json({
          error: 'O parâmetro companyId é obrigatório para consultar os logs de execução do agente com isolamento por empresa.',
        });
      }
      const company = await getCompanyById(companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const logs = await listAgentExecutionLogs(companyId, 50);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Automation Pipeline & Webhooks & Reports
  app.post('/api/companies/:companyId/automation/import-to-report', upload.single('file'), async (req, res) => {
    try {
      const { companyId } = req.params;
      const company = await getCompanyById(companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });

      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo CSV/XLSX enviado.' });
      }
      const year = Number(req.body.year || 2026);
      const month = req.body.month ? Number(req.body.month) : null;
      const overrideMapping = req.body.mapping ? JSON.parse(req.body.mapping) : undefined;
      const rowIndex = req.body.rowIndex !== undefined ? Number(req.body.rowIndex) : 0;
      const dispatchWebhook = req.body.dispatchWebhook === 'true' || req.body.dispatchWebhook === true;

      const result = await runAutomatedImportPipeline({
        companyId,
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        year,
        month,
        overrideMapping,
        rowIndex,
        dispatchWebhook,
      });

      res.status(result.needsCorrection ? 422 : 201).json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/companies/:companyId/automation/runs', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      res.json(await listAutomationRuns(req.params.companyId, 30));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/companies/:companyId/telemetry', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const telemetry = await getAutomationTelemetrySummary(req.params.companyId);
      const baselines = await getBusinessBaselines(req.params.companyId);
      res.json({ telemetry, baselines });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/companies/:companyId/baseline', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const { manualSpreadsheetMinutes, manualDiagnosticMinutes, manualReportMinutes, notes } = req.body;
      const saved = await saveBusinessBaseline({
        companyId: req.params.companyId,
        manualSpreadsheetMinutes: Number(manualSpreadsheetMinutes || 0),
        manualDiagnosticMinutes: Number(manualDiagnosticMinutes || 0),
        manualReportMinutes: Number(manualReportMinutes || 0),
        notes,
      });
      res.status(201).json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/automation/webhooks/status', (req, res) => {
    res.json(getWebhookStatus());
  });

  app.post('/api/automation/webhooks/test', async (req, res) => {
    try {
      const companyId = req.body?.companyId || 'demo-company-1';
      const company = await getCompanyById(String(companyId));
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const result = await testWebhookConnection(company.id);
      res.status(result.dispatched ? 200 : 422).json({
        ...result,
        webhookStatus: getWebhookStatus(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/companies/:companyId/reports/executive', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const { year, month } = req.body || {};
      const report = await generateExecutiveReport(
        req.params.companyId,
        year !== undefined ? Number(year) : undefined,
        month !== undefined ? Number(month) : undefined
      );
      res.status(201).json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/companies/:companyId/reports', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const reports = await listAnalysisReports(req.params.companyId);
      res.json(reports);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Operational Memory CRUD
  app.get('/api/companies/:companyId/memory', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const memoryType = req.query.memoryType ? String(req.query.memoryType) : undefined;
      res.json(await listOperationalMemory(req.params.companyId, memoryType));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/companies/:companyId/memory', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const { memoryType, title, summary, structuredData, periodRef, dataVersionRef, createdBy } = req.body;
      if (!title || !summary) {
        return res.status(400).json({ error: 'title e summary são obrigatórios.' });
      }
      const saved = await createOperationalMemory({
        companyId: req.params.companyId,
        memoryType: memoryType || 'DECISION',
        title,
        summary,
        structuredData,
        periodRef,
        dataVersionRef,
        createdBy: createdBy || 'Gestor',
      });
      res.status(201).json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/companies/:companyId/memory/:memoryId', async (req, res) => {
    try {
      const company = await getCompanyById(req.params.companyId);
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const ok = await deleteOperationalMemory(req.params.companyId, req.params.memoryId);
      if (!ok) return res.status(404).json({ error: 'Registro não encontrado.' });
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // AI Evaluation Benchmark Endpoints
  app.post('/api/evaluations/run', async (req, res) => {
    try {
      const companyId = req.body?.companyId || 'demo-company-1';
      const company = await getCompanyById(String(companyId));
      if (!company) return res.status(404).json({ error: 'Empresa não encontrada.' });
      const result = await runAgentEvaluationSuite(company.id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/evaluations', async (req, res) => {
    try {
      const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
      res.json(await listEvaluationRuns(20, companyId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

async function startServer() {
  const PORT = process.env.PORT || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  const app = await createConfiguredApp();

  // Vite middleware in dev, static in production
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true, port: Number(PORT) },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = resolveFrontendDistPath(__dirname);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: `Rota de API não encontrada: ${req.path}` });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} (${isProduction ? 'production' : 'development'})`);
  });
}

const isMainEntry =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isMainEntry && process.env.SKIP_SERVER_LISTEN !== 'true') {
  startServer();
}
