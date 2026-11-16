import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getPersistenceMode, prisma, sanitizeDatabaseErrorMessage } from '../prisma.js';
import { AuthUserRole, claimLegacyCompaniesForAdmin } from './dataStore.js';

export const BCRYPT_SALT_ROUNDS = 12;
export const STANDARD_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const EXTENDED_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days ("Manter sessão")
const DUMMY_BCRYPT_HASH = '$2b$12$KIX0p5e5n3Z2jY1W8vQ0Oe5M7x8uL9jH3fG6kR2tP4sV1wZ9yB8qK';

export interface PublicUserDTO {
  id: string;
  fullName: string;
  email: string;
  role: AuthUserRole;
  emailVerified: boolean;
  createdAt: string;
}

export interface StoredUserInternal extends PublicUserDTO {
  passwordHash: string;
  isActive: boolean;
  acceptedTermsAt: string | null;
  lastLoginAt: string | null;
}

export interface ServerSessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  rememberMe: boolean;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number | null;
  user: PublicUserDTO;
}

// In-memory store strictly used when PersistenceMode === 'MEMORY_DEMO' (or as transient test store)
const memUsers = new Map<string, StoredUserInternal>(); // keyed by id
const memUsersByEmail = new Map<string, string>(); // normalizedEmail -> userId
const memSessions = new Map<string, ServerSessionRecord>(); // sessionId -> record

// Rate Limiting Stores
interface AttemptWindow {
  count: number;
  windowStart: number;
}
const loginAttemptsByKey = new Map<string, AttemptWindow>();
const registerAttemptsByIp = new Map<string, AttemptWindow>();
const adminMigrateAttemptsByIp = new Map<string, AttemptWindow>();

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_FAILS_PER_ACCOUNT = 5;
const LOGIN_MAX_FAILS_PER_IP = 20;
const REGISTER_MAX_PER_IP = 8;
const ADMIN_MIGRATE_MAX_FAILS_PER_IP = 5;

const EMAIL_REGEX = /^[^\s@<>()[\]\\,;:\s@"]+@[^\s@<>()[\]\\,;:\s@"]+\.[^\s@<>()[\]\\,;:\s@"]{2,}$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || normalized.includes('*')) return null;
  if (!EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

export function validateFullName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Informe seu nome completo.' };
  }
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2) {
    return { ok: false, error: 'O nome completo deve ter pelo menos 2 caracteres.' };
  }
  if (cleaned.length > 120) {
    return { ok: false, error: 'O nome completo não pode exceder 120 caracteres.' };
  }
  return { ok: true, value: cleaned };
}

export function validatePasswordStrength(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Informe uma senha válida.' };
  }
  if (raw.length < 8) {
    return { ok: false, error: 'A senha deve ter no mínimo 8 caracteres.' };
  }
  if (raw.length > 128) {
    return { ok: false, error: 'A senha não pode exceder 128 caracteres.' };
  }
  if (!/[A-Za-zÀ-ÿ]/.test(raw) || !/[0-9]/.test(raw)) {
    return { ok: false, error: 'A senha deve conter pelo menos uma letra e um número.' };
  }
  return { ok: true, value: raw };
}

export function toPublicUserDTO(u: {
  id: string;
  fullName: string;
  email: string;
  role: string;
  emailVerified: boolean;
  createdAt: Date | string;
}): PublicUserDTO {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role === 'ADMIN' ? 'ADMIN' : 'USER',
    emailVerified: Boolean(u.emailVerified),
    createdAt: typeof u.createdAt === 'string' ? u.createdAt : u.createdAt.toISOString(),
  };
}

export function isEmailDeliveryConfigured(): boolean {
  const resend = process.env.RESEND_API_KEY?.trim();
  const smtp = process.env.SMTP_URL?.trim();
  return Boolean((resend && resend.length > 5) || (smtp && smtp.length > 5));
}

export function isLegacyAdminPasswordConfigured(): boolean {
  const pw = process.env.APP_ADMIN_PASSWORD?.trim();
  return Boolean(pw && pw.length >= 4);
}

function verifySecretConstantTime(input: string, expected: string): boolean {
  const exactH1 = crypto.createHash('sha256').update(input).digest();
  const exactH2 = crypto.createHash('sha256').update(expected).digest();
  const exactMatch = crypto.timingSafeEqual(exactH1, exactH2);

  const trimmedInput = input.trim();
  const trimmedExpected = expected.trim();
  const trimH1 = crypto.createHash('sha256').update(trimmedInput).digest();
  const trimH2 = crypto.createHash('sha256').update(trimmedExpected).digest();
  const trimmedMatch = trimmedExpected.length >= 4 && crypto.timingSafeEqual(trimH1, trimH2);

  return exactMatch || trimmedMatch;
}

export function resetAuthRateLimitersForTesting(): void {
  loginAttemptsByKey.clear();
  registerAttemptsByIp.clear();
  adminMigrateAttemptsByIp.clear();
}

export function resetAllAuthStoresForTesting(): void {
  memUsers.clear();
  memUsersByEmail.clear();
  memSessions.clear();
  resetAuthRateLimitersForTesting();
}

function checkRateLimit(
  store: Map<string, AttemptWindow>,
  key: string,
  maxAttempts: number
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  const record = store.get(key);
  if (!record) return { allowed: true };
  if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    store.delete(key);
    return { allowed: true };
  }
  if (record.count >= maxAttempts) {
    const retryAfterSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true };
}

function recordAttempt(store: Map<string, AttemptWindow>, key: string): void {
  const now = Date.now();
  const prev = store.get(key);
  if (!prev || now - prev.windowStart > RATE_LIMIT_WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
  } else {
    store.set(key, { count: prev.count + 1, windowStart: prev.windowStart });
  }
}

function isPostgresUsersActive(): boolean {
  return getPersistenceMode() === 'POSTGRESQL' && Boolean(prisma);
}

export async function findUserByEmail(normalizedEmail: string): Promise<StoredUserInternal | null> {
  if (isPostgresUsersActive()) {
    try {
      const row = await prisma!.user.findUnique({ where: { email: normalizedEmail } });
      if (!row) return null;
      return {
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        passwordHash: row.passwordHash,
        role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
        emailVerified: row.emailVerified,
        isActive: row.isActive,
        acceptedTermsAt: row.acceptedTermsAt ? row.acceptedTermsAt.toISOString() : null,
        lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    } catch (err: any) {
      throw new Error(`Erro ao consultar usuário no banco de dados: ${sanitizeDatabaseErrorMessage(err)}`);
    }
  }
  const userId = memUsersByEmail.get(normalizedEmail);
  return userId ? memUsers.get(userId) || null : null;
}

export async function findUserById(userId: string): Promise<StoredUserInternal | null> {
  if (isPostgresUsersActive()) {
    try {
      const row = await prisma!.user.findUnique({ where: { id: userId } });
      if (!row) return null;
      return {
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        passwordHash: row.passwordHash,
        role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
        emailVerified: row.emailVerified,
        isActive: row.isActive,
        acceptedTermsAt: row.acceptedTermsAt ? row.acceptedTermsAt.toISOString() : null,
        lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    } catch (err: any) {
      throw new Error(`Erro ao consultar usuário no banco de dados: ${sanitizeDatabaseErrorMessage(err)}`);
    }
  }
  return memUsers.get(userId) || null;
}

export async function countAdminUsers(): Promise<number> {
  if (isPostgresUsersActive()) {
    try {
      return await prisma!.user.count({ where: { role: 'ADMIN', isActive: true } });
    } catch {
      return 0;
    }
  }
  let count = 0;
  for (const u of memUsers.values()) {
    if (u.role === 'ADMIN' && u.isActive) count++;
  }
  return count;
}

export async function hasPendingAdminMigration(): Promise<boolean> {
  if (!isLegacyAdminPasswordConfigured()) return false;
  const admins = await countAdminUsers();
  return admins === 0;
}

async function createUserRecord(params: {
  fullName: string;
  email: string;
  passwordHash: string;
  role: AuthUserRole;
  emailVerified: boolean;
  acceptedTermsAt: Date | null;
}): Promise<PublicUserDTO> {
  if (isPostgresUsersActive()) {
    try {
      const created = await prisma!.user.create({
        data: {
          fullName: params.fullName,
          email: params.email,
          passwordHash: params.passwordHash,
          role: params.role,
          emailVerified: params.emailVerified,
          acceptedTermsAt: params.acceptedTermsAt,
          isActive: true,
        },
      });
      return toPublicUserDTO(created);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const dupErr: any = new Error('Já existe uma conta cadastrada com este e-mail.');
        dupErr.status = 409;
        dupErr.code = 'EMAIL_ALREADY_EXISTS';
        throw dupErr;
      }
      throw new Error(`Falha ao criar conta no banco de dados: ${sanitizeDatabaseErrorMessage(err)}`);
    }
  }

  if (memUsersByEmail.has(params.email)) {
    const dupErr: any = new Error('Já existe uma conta cadastrada com este e-mail.');
    dupErr.status = 409;
    dupErr.code = 'EMAIL_ALREADY_EXISTS';
    throw dupErr;
  }

  const id = `usr-${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  const rec: StoredUserInternal = {
    id,
    fullName: params.fullName,
    email: params.email,
    passwordHash: params.passwordHash,
    role: params.role,
    emailVerified: params.emailVerified,
    isActive: true,
    acceptedTermsAt: params.acceptedTermsAt ? params.acceptedTermsAt.toISOString() : null,
    lastLoginAt: null,
    createdAt: nowIso,
  };
  memUsers.set(id, rec);
  memUsersByEmail.set(params.email, id);
  return toPublicUserDTO(rec);
}

export async function createSessionForUser(params: {
  user: PublicUserDTO;
  rememberMe?: boolean;
  ttlMsOverride?: number;
}): Promise<{ session: ServerSessionRecord; maxAgeSec: number }> {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const rememberMe = Boolean(params.rememberMe);
  const ttlMs = params.ttlMsOverride ?? (rememberMe ? EXTENDED_SESSION_TTL_MS : STANDARD_SESSION_TTL_MS);
  const now = Date.now();
  const expiresAt = now + ttlMs;

  if (isPostgresUsersActive()) {
    try {
      await prisma!.userSession.create({
        data: {
          id: sessionId,
          userId: params.user.id,
          csrfToken,
          rememberMe,
          expiresAt: new Date(expiresAt),
        },
      });
    } catch (err: any) {
      throw new Error(`Falha ao iniciar sessão no banco de dados: ${sanitizeDatabaseErrorMessage(err)}`);
    }
  }

  const session: ServerSessionRecord = {
    id: sessionId,
    userId: params.user.id,
    csrfToken,
    rememberMe,
    createdAt: now,
    expiresAt,
    revokedAt: null,
    user: params.user,
  };
  memSessions.set(sessionId, session);

  return {
    session,
    maxAgeSec: Math.max(0, Math.floor(ttlMs / 1000)),
  };
}

export async function getValidSessionById(sessionId: string): Promise<ServerSessionRecord | null> {
  if (!sessionId) return null;

  const cached = memSessions.get(sessionId);
  if (cached) {
    if (cached.revokedAt || Date.now() > cached.expiresAt) {
      memSessions.delete(sessionId);
      if (isPostgresUsersActive()) {
        await prisma!.userSession.delete({ where: { id: sessionId } }).catch(() => {});
      }
      return null;
    }
    return cached;
  }

  if (isPostgresUsersActive()) {
    try {
      const row = await prisma!.userSession.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (!row || row.revokedAt || !row.user || !row.user.isActive) {
        return null;
      }
      const expiresAtMs = row.expiresAt.getTime();
      if (Date.now() > expiresAtMs) {
        await prisma!.userSession.delete({ where: { id: sessionId } }).catch(() => {});
        return null;
      }
      const rec: ServerSessionRecord = {
        id: row.id,
        userId: row.userId,
        csrfToken: row.csrfToken,
        rememberMe: row.rememberMe,
        createdAt: row.createdAt.getTime(),
        expiresAt: expiresAtMs,
        revokedAt: null,
        user: toPublicUserDTO(row.user),
      };
      memSessions.set(sessionId, rec);
      return rec;
    } catch {
      return null;
    }
  }

  return null;
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  if (!sessionId) return;
  memSessions.delete(sessionId);
  if (isPostgresUsersActive()) {
    await prisma!.userSession
      .updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => {});
  }
}

export async function expireSessionByIdForTesting(sessionId: string): Promise<boolean> {
  const s = memSessions.get(sessionId);
  let existed = Boolean(s);
  if (s) {
    s.expiresAt = Date.now() - 1000;
  }
  if (isPostgresUsersActive()) {
    const res = await prisma!.userSession
      .updateMany({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      .catch(() => ({ count: 0 }));
    if (res.count > 0) existed = true;
  }
  return existed;
}

export async function registerPublicUser(params: {
  clientIp: string;
  fullName: unknown;
  email: unknown;
  password: unknown;
  passwordConfirmation?: unknown;
  acceptTerms: unknown;
  rememberMe?: boolean;
}): Promise<
  | { ok: true; user: PublicUserDTO; session: ServerSessionRecord; maxAgeSec: number }
  | { ok: false; status: number; code: string; error: string; retryAfterSeconds?: number }
> {
  const rateCheck = checkRateLimit(registerAttemptsByIp, params.clientIp, REGISTER_MAX_PER_IP);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'REGISTER_RATE_LIMITED',
      error: 'Muitas tentativas de cadastro em sequência. Aguarde alguns minutos para tentar novamente.',
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    };
  }

  const nameVal = validateFullName(params.fullName);
  if (!nameVal.ok) {
    return { ok: false, status: 400, code: 'INVALID_FULL_NAME', error: nameVal.error };
  }

  const emailNormalized = normalizeEmail(params.email);
  if (!emailNormalized) {
    return { ok: false, status: 400, code: 'INVALID_EMAIL', error: 'Informe um endereço de e-mail válido.' };
  }

  const passVal = validatePasswordStrength(params.password);
  if (!passVal.ok) {
    return { ok: false, status: 400, code: 'WEAK_PASSWORD', error: passVal.error };
  }

  if (params.passwordConfirmation !== undefined && params.passwordConfirmation !== passVal.value) {
    return {
      ok: false,
      status: 400,
      code: 'PASSWORD_MISMATCH',
      error: 'A senha e a confirmação de senha não coincidem.',
    };
  }

  if (params.acceptTerms !== true) {
    return {
      ok: false,
      status: 400,
      code: 'TERMS_NOT_ACCEPTED',
      error: 'É necessário aceitar os Termos de Uso e a Política de Privacidade para criar uma conta.',
    };
  }

  recordAttempt(registerAttemptsByIp, params.clientIp);

  const existing = await findUserByEmail(emailNormalized);
  if (existing) {
    return {
      ok: false,
      status: 409,
      code: 'EMAIL_ALREADY_EXISTS',
      error: 'Já existe uma conta cadastrada com este e-mail.',
    };
  }

  const passwordHash = await bcrypt.hash(passVal.value, BCRYPT_SALT_ROUNDS);

  // CRITICAL: Public registration ALWAYS assigns role = 'USER'
  const user = await createUserRecord({
    fullName: nameVal.value,
    email: emailNormalized,
    passwordHash,
    role: 'USER',
    emailVerified: false,
    acceptedTermsAt: new Date(),
  });

  const { session, maxAgeSec } = await createSessionForUser({
    user,
    rememberMe: Boolean(params.rememberMe),
  });

  return { ok: true, user, session, maxAgeSec };
}

export async function authenticateWithEmailPassword(params: {
  clientIp: string;
  email: unknown;
  password: unknown;
  rememberMe?: boolean;
}): Promise<
  | { ok: true; user: PublicUserDTO; session: ServerSessionRecord; maxAgeSec: number }
  | { ok: false; status: number; code: string; error: string; retryAfterSeconds?: number }
> {
  const emailNormalized = normalizeEmail(params.email);
  const ipKey = `ip:${params.clientIp}`;
  const acctKey = emailNormalized ? `acct:${params.clientIp}:${emailNormalized}` : `acct:${params.clientIp}:invalid`;

  const ipRate = checkRateLimit(loginAttemptsByKey, ipKey, LOGIN_MAX_FAILS_PER_IP);
  if (!ipRate.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'LOGIN_RATE_LIMITED',
      error: 'Muitas tentativas de login detectadas. Aguarde antes de tentar novamente.',
      retryAfterSeconds: ipRate.retryAfterSeconds,
    };
  }

  const acctRate = checkRateLimit(loginAttemptsByKey, acctKey, LOGIN_MAX_FAILS_PER_ACCOUNT);
  if (!acctRate.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'LOGIN_RATE_LIMITED',
      error: 'Muitas tentativas de login inválidas para esta conta. Aguarde antes de tentar novamente.',
      retryAfterSeconds: acctRate.retryAfterSeconds,
    };
  }

  if (!emailNormalized || typeof params.password !== 'string' || params.password.length === 0 || params.password.length > 128) {
    recordAttempt(loginAttemptsByKey, ipKey);
    recordAttempt(loginAttemptsByKey, acctKey);
    return {
      ok: false,
      status: 401,
      code: 'INVALID_CREDENTIALS',
      error: 'E-mail ou senha inválidos.',
    };
  }

  const user = await findUserByEmail(emailNormalized);
  if (!user || !user.isActive) {
    // Perform dummy bcrypt compare for timing consistency against user enumeration
    await bcrypt.compare(params.password, DUMMY_BCRYPT_HASH);
    recordAttempt(loginAttemptsByKey, ipKey);
    recordAttempt(loginAttemptsByKey, acctKey);
    return {
      ok: false,
      status: 401,
      code: 'INVALID_CREDENTIALS',
      error: 'E-mail ou senha inválidos.',
    };
  }

  const passwordValid = await bcrypt.compare(params.password, user.passwordHash);
  if (!passwordValid) {
    recordAttempt(loginAttemptsByKey, ipKey);
    recordAttempt(loginAttemptsByKey, acctKey);
    return {
      ok: false,
      status: 401,
      code: 'INVALID_CREDENTIALS',
      error: 'E-mail ou senha inválidos.',
    };
  }

  // Clear account attempt counter on success
  loginAttemptsByKey.delete(acctKey);

  if (isPostgresUsersActive()) {
    await prisma!.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => {});
  } else {
    user.lastLoginAt = new Date().toISOString();
  }

  const publicUser = toPublicUserDTO(user);
  const { session, maxAgeSec } = await createSessionForUser({
    user: publicUser,
    rememberMe: Boolean(params.rememberMe),
  });

  return { ok: true, user: publicUser, session, maxAgeSec };
}

/**
 * Converts legacy APP_ADMIN_PASSWORD access into an individual ADMIN email+password account
 * and assigns all pre-existing unassigned legacy companies to that ADMIN account.
 * Strictly blocked if APP_ADMIN_PASSWORD is not configured or does not match.
 */
export async function migrateLegacyAdminAccount(params: {
  clientIp: string;
  currentAdminPassword: unknown;
  fullName: unknown;
  email: unknown;
  newPassword: unknown;
  newPasswordConfirmation?: unknown;
}): Promise<
  | { ok: true; user: PublicUserDTO; session: ServerSessionRecord; maxAgeSec: number; claimedCompaniesCount: number }
  | { ok: false; status: number; code: string; error: string; retryAfterSeconds?: number }
> {
  if (!isLegacyAdminPasswordConfigured()) {
    return {
      ok: false,
      status: 403,
      code: 'ADMIN_MIGRATION_NOT_AVAILABLE',
      error: 'Migração administrativa não está habilitada neste ambiente.',
    };
  }

  const rateCheck = checkRateLimit(adminMigrateAttemptsByIp, params.clientIp, ADMIN_MIGRATE_MAX_FAILS_PER_IP);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'ADMIN_MIGRATE_RATE_LIMITED',
      error: 'Muitas tentativas inválidas. Aguarde antes de tentar novamente.',
      retryAfterSeconds: rateCheck.retryAfterSeconds,
    };
  }

  const adminCount = await countAdminUsers();
  if (adminCount > 0) {
    return {
      ok: false,
      status: 409,
      code: 'ADMIN_ALREADY_MIGRATED',
      error: 'Uma conta administrativa individual já foi configurada. Utilize o login padrão com e-mail e senha.',
    };
  }

  if (
    typeof params.currentAdminPassword !== 'string' ||
    !verifySecretConstantTime(params.currentAdminPassword, process.env.APP_ADMIN_PASSWORD!)
  ) {
    recordAttempt(adminMigrateAttemptsByIp, params.clientIp);
    return {
      ok: false,
      status: 401,
      code: 'INVALID_ADMIN_PASSWORD',
      error: 'Senha administrativa atual incorreta.',
    };
  }

  const nameVal = validateFullName(params.fullName);
  if (!nameVal.ok) {
    return { ok: false, status: 400, code: 'INVALID_FULL_NAME', error: nameVal.error };
  }

  const emailNormalized = normalizeEmail(params.email);
  if (!emailNormalized) {
    return { ok: false, status: 400, code: 'INVALID_EMAIL', error: 'Informe um endereço de e-mail válido.' };
  }

  const passVal = validatePasswordStrength(params.newPassword);
  if (!passVal.ok) {
    return { ok: false, status: 400, code: 'WEAK_PASSWORD', error: passVal.error };
  }

  if (params.newPasswordConfirmation !== undefined && params.newPasswordConfirmation !== passVal.value) {
    return {
      ok: false,
      status: 400,
      code: 'PASSWORD_MISMATCH',
      error: 'A nova senha e a confirmação não coincidem.',
    };
  }

  const existing = await findUserByEmail(emailNormalized);
  if (existing) {
    return {
      ok: false,
      status: 409,
      code: 'EMAIL_ALREADY_EXISTS',
      error: 'Este e-mail já está vinculado a uma conta existente. Utilize outro e-mail para o perfil administrador.',
    };
  }

  adminMigrateAttemptsByIp.delete(params.clientIp);
  const passwordHash = await bcrypt.hash(passVal.value, BCRYPT_SALT_ROUNDS);

  const adminUser = await createUserRecord({
    fullName: nameVal.value,
    email: emailNormalized,
    passwordHash,
    role: 'ADMIN',
    emailVerified: true,
    acceptedTermsAt: new Date(),
  });

  const claimedCompaniesCount = await claimLegacyCompaniesForAdmin(adminUser.id);
  const { session, maxAgeSec } = await createSessionForUser({
    user: adminUser,
    rememberMe: false,
  });

  return {
    ok: true,
    user: adminUser,
    session,
    maxAgeSec,
    claimedCompaniesCount,
  };
}

/**
 * Optional env-based bootstrap: if APP_ADMIN_EMAIL and APP_ADMIN_PASSWORD are both configured,
 * ensures the individual ADMIN account exists and owns legacy unassigned companies.
 */
export async function ensureBootstrapAdminAccount(): Promise<void> {
  const bootstrapEmail = normalizeEmail(process.env.APP_ADMIN_EMAIL);
  const bootstrapPass = process.env.APP_ADMIN_PASSWORD?.trim();
  if (!bootstrapEmail || !bootstrapPass || bootstrapPass.length < 4) return;

  try {
    const existing = await findUserByEmail(bootstrapEmail);
    if (existing) {
      if (existing.role === 'ADMIN') {
        await claimLegacyCompaniesForAdmin(existing.id);
      }
      return;
    }
    const adminCount = await countAdminUsers();
    if (adminCount > 0) return;

    const passwordHash = await bcrypt.hash(bootstrapPass, BCRYPT_SALT_ROUNDS);
    const created = await createUserRecord({
      fullName: 'Administrador Financeiro',
      email: bootstrapEmail,
      passwordHash,
      role: 'ADMIN',
      emailVerified: true,
      acceptedTermsAt: new Date(),
    });
    await claimLegacyCompaniesForAdmin(created.id);
  } catch (err: any) {
    console.warn(`[AUTH_BOOTSTRAP] Aviso ao inicializar conta admin opcional: ${sanitizeDatabaseErrorMessage(err)}`);
  }
}

export async function deleteUserForTesting(userId: string): Promise<void> {
  memSessions.forEach((s, sid) => {
    if (s.userId === userId) memSessions.delete(sid);
  });
  const memUser = memUsers.get(userId);
  if (memUser) {
    memUsersByEmail.delete(memUser.email);
    memUsers.delete(userId);
  }
  if (isPostgresUsersActive()) {
    await prisma!.userSession.deleteMany({ where: { userId } }).catch(() => {});
    await prisma!.company.deleteMany({ where: { ownerUserId: userId } }).catch(() => {});
    await prisma!.user.deleteMany({ where: { id: userId } }).catch(() => {});
  }
}
