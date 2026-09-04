import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { AppLogger } from '../logging/app-logger';

/**
 * An access log, at the level each outcome deserves.
 *
 * The API previously logged only failures, which answers "what broke" and
 * nothing else — not how long a request took, not whether a slow page is the
 * server or the network, not whether an endpoint is used at all. One line per
 * request closes all three.
 *
 * The level is chosen from the status rather than fixed, so severity in the log
 * matches severity in reality:
 *
 *   verbose  the request arriving — full detail, off in production
 *   log      2xx and 3xx — it worked
 *   warn     4xx — the caller got it wrong, which is worth seeing in bulk
 *            (a spike of 401s is an expired-token bug; a spike of 422s is a
 *            client sending something the schema stopped accepting)
 *   error    5xx — we got it wrong
 *
 * `404` is included at `warn` here even though the exception filter suppresses
 * it: a missing route is noise, but a missing *record* on a real endpoint is
 * often the first sign of a broken link or a stale client, and the two are
 * indistinguishable once the line is gone.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLogger) {
    this.logger.setContext('HTTP');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // The platform's own health probe hits one path every few seconds forever.
    // Logged at `log` it would be most of the log by volume and would hide
    // everything else; it is still visible at `debug` when something is wrong
    // with the probe itself.
    const isProbe = request.originalUrl.includes('/health');
    const started = process.hrtime.bigint();

    this.logger.verbose({
      message: `→ ${request.method} ${request.originalUrl}`,
      // The caller's address, for rate-limit and lockout investigations. `ip`
      // is trustworthy because `trust proxy` is set in main.ts.
      ip: request.ip,
      userAgent: request.get('user-agent'),
      // Deliberately not the body. Request bodies here carry passwords on the
      // auth routes and personal data everywhere else; a size is enough to
      // recognise a truncated upload without keeping any of it.
      contentLength: request.get('content-length'),
    });

    const finish = (thrownStatus?: number) => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      // On the error path the filter has not written the response yet, so the
      // status has to come from the exception.
      const status = thrownStatus ?? response.statusCode;

      const line = {
        message: `${request.method} ${request.originalUrl} → ${status} ${durationMs.toFixed(1)}ms`,
        method: request.method,
        path: request.route?.path ?? request.originalUrl,
        status,
        durationMs: Number(durationMs.toFixed(1)),
      };

      if (status >= 500) this.logger.error(line);
      else if (status >= 400) this.logger.warn(line);
      else if (isProbe) this.logger.debug(line);
      else this.logger.log(line);
    };

    return next.handle().pipe(
      tap({
        next: () => finish(),
        error: (error: unknown) => finish(statusOf(error)),
      }),
    );
  }
}

/** The HTTP status an exception will become, without importing the filter's logic. */
function statusOf(error: unknown): number {
  const status = (error as { status?: unknown; getStatus?: () => number })?.status;
  if (typeof status === 'number') return status;
  const getStatus = (error as { getStatus?: () => number })?.getStatus;
  if (typeof getStatus === 'function') {
    try {
      return getStatus.call(error);
    } catch {
      /* fall through to 500 */
    }
  }
  return 500;
}
