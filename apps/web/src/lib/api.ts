import type { ApiError, AuthTokens } from '@ciq/shared';
import { createLogger } from './logger';

/**
 * HTTP client.
 *
 * Two things it does that a bare `fetch` wrapper does not:
 *
 *  1. Refreshes an expired access token transparently and replays the original
 *     request, so a 15-minute token boundary never surfaces as a failed save.
 *  2. Coalesces concurrent refreshes. Five queries firing at once on a stale
 *     token must trigger one refresh, not five — and since refresh tokens are
 *     single-use on the server, five would invalidate each other and log the
 *     user out.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

const log = createLogger('api');

// Logged once, at load. Pointing a build at the wrong API is the single most
// common deployment mistake here, and this is the line that settles it in one
// glance at the console instead of a network-tab archaeology session.
log.debug(`Base URL ${BASE_URL}`);

const ACCESS_KEY = 'ciq.accessToken';
const REFRESH_KEY = 'ciq.refreshToken';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly details?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(payload: ApiError) {
    super(payload.message);
    this.name = 'ApiRequestError';
    this.status = payload.statusCode;
    this.details = payload.details;
    this.requestId = payload.requestId;
  }

  /** First validation message for a field, for inline form errors. */
  fieldError(field: string): string | undefined {
    return this.details?.[field]?.[0];
  }
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

export const tokenStore = {
  get access(): string | null {
    return safeRead(ACCESS_KEY);
  },
  get refresh(): string | null {
    return safeRead(REFRESH_KEY);
  },
  set(tokens: AuthTokens): void {
    safeWrite(ACCESS_KEY, tokens.accessToken);
    safeWrite(REFRESH_KEY, tokens.refreshToken);
  },
  clear(): void {
    safeRemove(ACCESS_KEY);
    safeRemove(REFRESH_KEY);
  },
};

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private browsing with storage disabled — the session lives in memory only. */
  }
}
function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Session expiry
// ---------------------------------------------------------------------------

type ExpiryListener = () => void;
const expiryListeners = new Set<ExpiryListener>();

/** Notifies the app when refresh fails so it can route to the login screen. */
export function onSessionExpired(listener: ExpiryListener): () => void {
  expiryListeners.add(listener);
  return () => expiryListeners.delete(listener);
}

function announceExpiry(): void {
  log.warn('Session ended — clearing tokens and returning to sign-in');
  tokenStore.clear();
  expiryListeners.forEach((listener) => listener());
}

// ---------------------------------------------------------------------------
// Refresh coalescing
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = tokenStore.refresh;
    if (!refreshToken) {
      log.debug('No refresh token stored — cannot refresh');
      return null;
    }

    try {
      log.debug('Access token expired — refreshing');
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        log.warn(`Refresh refused with ${response.status}`);
        return null;
      }

      const tokens = (await response.json()) as AuthTokens;
      tokenStore.set(tokens);
      log.log('Access token refreshed');
      return tokens.accessToken;
    } catch (error) {
      // A network failure, not a refusal. Worth distinguishing: one means the
      // session is over, the other means the user is on a train.
      log.warn('Refresh failed to reach the server', error);
      return null;
    } finally {
      // Cleared in a microtask so callers awaiting this promise all observe the
      // same result before a new refresh can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skips the auth header and the refresh retry — used by login and setup. */
  anonymous?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, anonymous, headers, ...rest } = options;

  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const send = async (token: string | null): Promise<Response> =>
    fetch(url.toString(), {
      ...rest,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const started = performance.now();
  log.verbose(`→ ${rest.method ?? 'GET'} ${url.pathname}${url.search}`);

  let response = await send(anonymous ? null : tokenStore.access);

  // One retry after a refresh. A second 401 means the session is genuinely gone.
  if (response.status === 401 && !anonymous) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      announceExpiry();
      throw new ApiRequestError({
        statusCode: 401,
        message: 'Your session has ended. Sign in again.',
      });
    }
    response = await send(refreshed);
    if (response.status === 401) {
      announceExpiry();
      throw new ApiRequestError({
        statusCode: 401,
        message: 'Your session has ended. Sign in again.',
      });
    }
  }

  const durationMs = Math.round(performance.now() - started);

  if (!response.ok) {
    const payload = await readError(response);
    // `requestId` is the API's correlation id, echoed back in the error body.
    // Quoting it in a bug report turns "a save failed this morning" into one
    // grep on the server, which is the entire reason both sides carry it.
    log.error(
      `${rest.method ?? 'GET'} ${url.pathname} → ${payload.statusCode} in ${durationMs}ms: ${payload.message}`,
      payload.requestId ? `requestId=${payload.requestId}` : '',
    );
    throw new ApiRequestError(payload);
  }

  // Slow enough that the user noticed. Logged as a warning so it stands out in
  // a console that is otherwise quiet in production.
  const line = `${rest.method ?? 'GET'} ${url.pathname} → ${response.status} in ${durationMs}ms`;
  if (durationMs > 2000) log.warn(`Slow request: ${line}`);
  else log.debug(line);

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return (await response.text()) as T;

  return (await response.json()) as T;
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as ApiError;
    return { ...payload, statusCode: payload.statusCode ?? response.status };
  } catch {
    return {
      statusCode: response.status,
      message:
        response.status >= 500
          ? 'The server could not complete that request. Try again in a moment.'
          : 'That request could not be completed.',
    };
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

/**
 * Downloads an export.
 *
 * Exports need the Authorization header, so a plain `<a href>` will not do — the
 * response is fetched, turned into a blob and handed to a synthetic link.
 */
export async function downloadFile(path: string, query?: RequestOptions['query']): Promise<void> {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  let token = tokenStore.access;
  let response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });

  if (response.status === 401) {
    token = await refreshAccessToken();
    if (!token) {
      announceExpiry();
      throw new ApiRequestError({
        statusCode: 401,
        message: 'Your session has ended. Sign in again.',
      });
    }
    response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  }

  if (!response.ok) throw new ApiRequestError(await readError(response));

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = match?.[1] ?? 'export';

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a delay; revoking immediately can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}
