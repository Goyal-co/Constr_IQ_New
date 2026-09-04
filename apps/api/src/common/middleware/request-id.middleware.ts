import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../logging/request-context';

/**
 * Attaches a correlation id to every request, and opens the logging context.
 *
 * An inbound `x-request-id` is honoured so a trace started at the load balancer
 * or the browser carries through; otherwise one is minted. The id is echoed back
 * on the response and included in every error body, which is what makes a user
 * saying "it failed" actionable.
 *
 * Middleware rather than an interceptor, because middleware runs first. Opening
 * the context here means guards, pipes, interceptors, controllers, services and
 * the exception filter all log inside it — so a request rejected by the auth
 * guard, before any interceptor has run, still produces correlated lines.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.get('x-request-id');
    // Only accept a well-formed inbound id — an arbitrary header value ends up in
    // logs, and unbounded attacker-controlled strings there are a liability.
    const id = inbound && /^[\w-]{8,64}$/.test(inbound) ? inbound : randomUUID();

    (req as Request & { id: string }).id = id;
    res.setHeader('x-request-id', id);

    // `next` is called inside the store, so everything downstream of this
    // middleware — including work resumed after an `await` — sees the context.
    runWithRequestContext({ requestId: id, method: req.method, path: req.originalUrl }, () =>
      next(),
    );
  }
}
