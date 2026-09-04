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

/**
 * Transient scope.
 *
 * Nest injects a separate instance per consuming class, which is what lets each
 * one report its own `context` without every call site repeating the class
 * name.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class AppLogger extends ConsoleLogger {
  private json = false;

  /** Called once at boot, before anything is logged in anger. */
  configure(options: { level: LogLevel; format: 'json' | 'pretty' }): void {
    this.json = options.format === 'json';
    this.setLogLevels(levelsUpTo(options.level));
  }

  error(message: unknown, stackOrContext?: unknown, context?: string): void {
    if (!this.json) return super.error(message as string, stackOrContext as string, context);
    // Nest's own signature is overloaded: the second argument is a stack when
    // there are three, and a context when there are two.
    const stack = context === undefined ? undefined : (stackOrContext as string);
    const ctx = context ?? (stackOrContext as string | undefined);
    this.write('error', message, ctx, stack);
  }

  warn(message: unknown, context?: string): void {
    if (!this.json) return super.warn(message as string, context);
    this.write('warn', message, context);
  }

  log(message: unknown, context?: string): void {
    if (!this.json) return super.log(message as string, context);
    this.write('log', message, context);
  }

  debug(message: unknown, context?: string): void {
    if (!this.json) return super.debug(message as string, context);
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    if (!this.json) return super.verbose(message as string, context);
    this.write('verbose', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string, stack?: string): void {
    if (!this.isLevelEnabled(level)) return;

    const request = getRequestContext();
    const line: StructuredLine = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? this.context,
      // A caller may pass an object to attach fields; its `message` becomes the
      // text and the rest are merged as siblings, so they stay queryable rather
      // than being flattened into a sentence.
      ...(isRecord(message) ? message : {}),
      message: isRecord(message) ? String(message.message ?? '') : String(message),
      ...(request?.requestId ? { requestId: request.requestId } : {}),
      ...(request?.userId ? { userId: request.userId } : {}),
      ...(request?.organisationId ? { organisationId: request.organisationId } : {}),
      ...(stack ? { stack } : {}),
    };

    // Straight to stdout. `console.log` would re-enter Nest's own formatting in
    // some setups, and the platform reads stdout either way.
    process.stdout.write(`${safeStringify(line)}\n`);
  }
}

/**
 * Nest takes the set of enabled levels, not a threshold, so a named level has
 * to be expanded into itself and everything more severe.
 */
export function levelsUpTo(level: LogLevel): LogLevel[] {
  const order: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  const index = order.indexOf(level);
  return order.slice(0, index === -1 ? 3 : index + 1);
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
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'A log line could not be serialised.',
    });
  }
}
