import { ConsoleLogger, Injectable, LogLevel, Scope } from '@nestjs/common';
import { getRequestContext } from './request-context';

/**
 * The application logger.
 *
 * Nest's default writes coloured text to stdout, which is right for a terminal
 * and wrong for everywhere this actually runs. Render, Railway and every hosted
 * log service ingest a line at a time and can only filter, search or alert on
 * fields they can parse — so in production each line is one JSON object, and in
 * development it stays the readable coloured form.
 *
 * Two things are added at every level, not just at `error`:
 *
 *   • the request id, pulled from AsyncLocalStorage, so a `debug` line can be
 *     tied to the request that produced it;
 *   • the user and organisation, once known, so "who saw this" is answerable
 *     without correlating against a separate audit query.
 *
 * That is the difference between logging below `error` being useful and being
 * noise: an unattributed `debug` line in a stream of twenty concurrent requests
 * tells you almost nothing.
 *
 * Callers may pass a string or an object. An object's `message` becomes the
 * text and its other keys are kept as siblings in JSON — so a duration stays a
 * number you can sort and alert on, rather than a fragment of a sentence.
 */

/** The wire shape in production. One of these per line, newline-delimited. */
interface StructuredLine {
  timestamp: string;
  level: LogLevel;
  context?: string;
  message: string;
  requestId?: string;
  userId?: string;
  organisationId?: string;
  /** Present on `error` only. */
  stack?: string;
  /** Anything a caller attached — durations, counts, ids. */
  [key: string]: unknown;
}

const ORDER: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

/**
 * Level and format are process-wide, held statically.
 *
 * They have to be. `AppLogger` is transient-scoped so each injecting class gets
 * its own instance with its own context, and configuring one of those in
 * `main.ts` left every other instance on the defaults — the interceptor's copy
 * quietly wrote unformatted text into an otherwise-JSON log while the
 * bootstrap logger looked correct. Whether this process emits JSON is a fact
 * about the process, not about one injection site.
 */
let settings: { level: LogLevel; json: boolean } = { level: 'log', json: false };

/**
 * Transient scope: Nest injects a separate instance per consuming class, which
 * is what lets each report its own `context` without every call site repeating
 * the class name.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class AppLogger extends ConsoleLogger {
  /** Called once at boot, before anything is logged in anger. */
  configure(options: { level: LogLevel; format: 'json' | 'pretty' }): void {
    settings = { level: options.level, json: options.format === 'json' };
    // Nest's own internal loggers read the levels off the instance passed to
    // `useLogger`, so that one still has to be told.
    this.setLogLevels(levelsUpTo(options.level));
  }

  error(message: unknown, stackOrContext?: unknown, context?: string): void {
    // Nest's signature is overloaded: with three arguments the second is a
    // stack, with two it is a context.
    const stack = context === undefined ? undefined : (stackOrContext as string);
    const ctx = context ?? (stackOrContext as string | undefined);
    this.emit('error', message, ctx, stack);
  }

  warn(message: unknown, context?: string): void {
    this.emit('warn', message, context);
  }

  log(message: unknown, context?: string): void {
    this.emit('log', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.emit('verbose', message, context);
  }

  private emit(level: LogLevel, message: unknown, context?: string, stack?: string): void {
    if (!isEnabled(level)) return;

    const request = getRequestContext();
    const extra = isRecord(message) ? message : {};
    const text = isRecord(message) ? String(message.message ?? '') : String(message);

    if (!settings.json) {
      // Pretty mode still has to render the extra fields, or an object-shaped
      // call logs its text and silently drops the numbers that were the reason
      // for making the call.
      const suffix = renderFields({ ...extra, requestId: request?.requestId });
      const line = suffix ? `${text} ${suffix}` : text;
      if (level === 'error') super.error(line, stack, context);
      else super[level](line, context);
      return;
    }

    const line: StructuredLine = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? this.context,
      ...extra,
      message: text,
      ...(request?.requestId ? { requestId: request.requestId } : {}),
      ...(request?.userId ? { userId: request.userId } : {}),
      ...(request?.organisationId ? { organisationId: request.organisationId } : {}),
      ...(stack ? { stack } : {}),
    };

    // Straight to stdout: the platform reads it either way, and going through
    // `console` would re-enter Nest's formatting in some setups.
    process.stdout.write(`${safeStringify(line)}\n`);
  }
}

/**
 * Nest takes the set of enabled levels, not a threshold, so a named level has
 * to be expanded into itself and everything more severe.
 */
export function levelsUpTo(level: LogLevel): LogLevel[] {
  const index = ORDER.indexOf(level);
  return ORDER.slice(0, index === -1 ? 3 : index + 1);
}

function isEnabled(level: LogLevel): boolean {
  return ORDER.indexOf(level) <= ORDER.indexOf(settings.level);
}

/** `status=401 durationMs=767.5` — the structured fields, for human eyes. */
function renderFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([key, value]) => key !== 'message' && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? safeStringify(value) : value}`)
    .join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Never let logging throw.
 *
 * A circular reference in something a caller attached would otherwise take the
 * process down from inside a log statement, which is an absurd way to lose a
 * service — and it would happen in production, where the object graphs are
 * bigger.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '"[unserialisable]"';
  }
}
