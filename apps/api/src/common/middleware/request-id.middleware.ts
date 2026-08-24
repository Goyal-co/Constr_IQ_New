import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Attaches a correlation id to every request.
 *
 * An inbound `x-request-id` is honoured so a trace started at the load balancer
 * or the browser carries through; otherwise one is minted. The id is echoed back
 * on the response and included in every error body, which is what makes a user
 * saying "it failed" actionable.
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
    next();
  }
}
