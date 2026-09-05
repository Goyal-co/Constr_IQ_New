/* eslint-disable no-console */

/**
 * Client-side logging, at levels.
 *
 * The browser half of the application logged nothing at all, which made a whole
 * class of report unanswerable: "it just stopped working" from someone whose
 * network dropped one request looks identical to a bug, and nothing on the
 * server distinguishes them — a request that never arrived leaves no trace
 * there.
 *
 * The levels match the API's, so a description of severity means the same thing
 * on both sides of the wire:
 *
 *   error    something broke and the user saw it
 *   warn     recoverable, but worth knowing — a retry, a token refresh
 *   log      significant events: sign-in, navigation to a project
 *   debug    request/response detail, cache decisions
 *   verbose  everything
 *
 * Default is `warn` in a production build and `debug` in development, so a
 * deployed bundle is quiet unless somebody asks it not to be. Two overrides,
 * both without a redeploy:
 *
 *   VITE_LOG_LEVEL=debug        at build time
 *   localStorage['ciq.logLevel'] = 'debug'   in the browser, per person
 *
 * The second is the useful one: it turns "can you reproduce it with the console
 * open" into something a non-technical user can be walked through in one line,
 * on the machine where the problem actually happens.
 */

export type LogLevel = 'silent' | 'error' | 'warn' | 'log' | 'debug' | 'verbose';

const ORDER: LogLevel[] = ['silent', 'error', 'warn', 'log', 'debug', 'verbose'];

const LEVEL_KEY = 'ciq.logLevel';

function isLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (ORDER as string[]).includes(value);
}

/**
 * `info` means `log`, matching the API.
 *
 * Nest names this level `log`; almost everything else names it `info`. Accepting
 * both means one LOG_LEVEL value can be pasted into both halves of the stack
 * and mean the same thing, which is the whole point of the names matching.
 */
function normalise(value: unknown): unknown {
  return value === 'info' ? 'log' : value;
}

function resolveLevel(): LogLevel {
  // The per-browser override wins, so support can raise the level on one
  // machine without touching the deployment.
  try {
    const stored = normalise(localStorage.getItem(LEVEL_KEY));
    if (isLevel(stored)) return stored;
  } catch {
    // Private mode, or storage disabled. Fall through to the build-time value.
  }

  const configured = normalise(import.meta.env.VITE_LOG_LEVEL);
  if (isLevel(configured)) return configured;

  return import.meta.env.PROD ? 'warn' : 'debug';
}

let level = resolveLevel();

/** Re-reads the level. Called after `setLevel`, and available from the console. */
export function refreshLogLevel(): LogLevel {
  level = resolveLevel();
  return level;
}

/** Persists a level for this browser. Survives reloads; affects nobody else. */
export function setLogLevel(next: LogLevel): void {
  try {
    localStorage.setItem(LEVEL_KEY, next);
  } catch {
    // Nothing to do — the in-memory level below still takes effect for this tab.
  }
  level = next;
}

function enabled(target: Exclude<LogLevel, 'silent'>): boolean {
  return ORDER.indexOf(target) <= ORDER.indexOf(level);
}

/**
 * `[14:32:01.123] [api]` — a timestamp and a scope on every line.
 *
 * The timestamp matters more here than on the server: a user pasting a console
 * screenshot is usually the only record of when something happened, and the
 * browser's own console timestamps are off by default.
 */
function prefix(scope: string): string {
  return `[${new Date().toISOString().slice(11, 23)}] [${scope}]`;
}

export interface Logger {
  error(message: string, ...detail: unknown[]): void;
  warn(message: string, ...detail: unknown[]): void;
  log(message: string, ...detail: unknown[]): void;
  debug(message: string, ...detail: unknown[]): void;
  verbose(message: string, ...detail: unknown[]): void;
}

/** A logger tagged with the area it belongs to: `createLogger('api')`. */
export function createLogger(scope: string): Logger {
  return {
    error: (message, ...detail) =>
      enabled('error') && console.error(prefix(scope), message, ...detail),
    warn: (message, ...detail) =>
      enabled('warn') && console.warn(prefix(scope), message, ...detail),
    log: (message, ...detail) => enabled('log') && console.info(prefix(scope), message, ...detail),
    debug: (message, ...detail) =>
      enabled('debug') && console.debug(prefix(scope), message, ...detail),
    verbose: (message, ...detail) =>
      enabled('verbose') && console.debug(prefix(scope), message, ...detail),
  };
}

/**
 * Exposed on `window` so it can be reached from a browser console.
 *
 * `window.ciq.setLogLevel('debug')` is a sentence you can read down a phone
 * line. Reaching the same function through the bundle is not, because the
 * module name is hashed.
 */
declare global {
  interface Window {
    ciq?: { setLogLevel: (level: LogLevel) => void; logLevel: () => LogLevel };
  }
}

if (typeof window !== 'undefined') {
  window.ciq = { setLogLevel, logLevel: () => level };
}
