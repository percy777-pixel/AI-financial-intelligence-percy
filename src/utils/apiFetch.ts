const SESSION_TOKEN_STORAGE_KEY = 'afi_auth_session_token';
const CSRF_TOKEN_STORAGE_KEY = 'afi_auth_csrf_token';

function readStorage(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage.getItem(key);
    }
  } catch {
    // Ignore storage errors in restricted iframe contexts
  }
  return null;
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (value) {
        window.sessionStorage.setItem(key, value);
      } else {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage errors in restricted iframe contexts
  }
}

let activeSessionToken: string | null = readStorage(SESSION_TOKEN_STORAGE_KEY);
let activeCsrfToken: string | null = readStorage(CSRF_TOKEN_STORAGE_KEY);
let onUnauthorizedCallback: (() => void) | null = null;

export function setActiveSessionToken(token: string | null): void {
  activeSessionToken = token;
  writeStorage(SESSION_TOKEN_STORAGE_KEY, token);
}

export function getActiveSessionToken(): string | null {
  if (!activeSessionToken) {
    activeSessionToken = readStorage(SESSION_TOKEN_STORAGE_KEY);
  }
  return activeSessionToken;
}

export function setActiveCsrfToken(token: string | null): void {
  activeCsrfToken = token;
  writeStorage(CSRF_TOKEN_STORAGE_KEY, token);
}

export function getActiveCsrfToken(): string | null {
  if (!activeCsrfToken) {
    activeCsrfToken = readStorage(CSRF_TOKEN_STORAGE_KEY);
  }
  return activeCsrfToken;
}

export function clearClientAuthTokens(): void {
  activeSessionToken = null;
  activeCsrfToken = null;
  writeStorage(SESSION_TOKEN_STORAGE_KEY, null);
  writeStorage(CSRF_TOKEN_STORAGE_KEY, null);
}

export function setOnUnauthorizedCallback(cb: (() => void) | null): void {
  onUnauthorizedCallback = cb;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const isApiCall = urlStr.startsWith('/api/');
  const nextInit: RequestInit = init ? { ...init } : {};

  if (isApiCall) {
    nextInit.credentials = nextInit.credentials || 'include';
    const headers = new Headers(nextInit.headers || {});
    const currentSessionToken = getActiveSessionToken();
    const currentCsrfToken = getActiveCsrfToken();

    if (currentSessionToken && !headers.has('X-AFI-Session')) {
      headers.set('X-AFI-Session', currentSessionToken);
    }
    if (currentCsrfToken && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', currentCsrfToken);
    }
    nextInit.headers = headers;
  }

  const currentFetch: typeof fetch =
    typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? window.fetch.bind(window)
      : fetch;

  const response = await currentFetch(input, nextInit);
  if (
    isApiCall &&
    response.status === 401 &&
    !urlStr.startsWith('/api/auth/login') &&
    !urlStr.startsWith('/api/auth/register') &&
    !urlStr.startsWith('/api/auth/admin/migrate') &&
    !urlStr.startsWith('/api/auth/forgot-password') &&
    !urlStr.startsWith('/api/auth/status')
  ) {
    clearClientAuthTokens();
    if (onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
  }
  return response;
}
