import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The request a line of work belongs to, available anywhere without being
 * passed.
 *
 * This is what makes logging below the error level worth having. A `debug` line
 * from a service is close to useless on its own — twenty concurrent requests
 * interleave into one stream and there is no way to tell which one produced it.
 * Stamped with a request id, the same line lets you pull one request's entire
 * story out of a day's logs with a single grep.
 *
 * `AsyncLocalStorage` rather than a parameter on every method: correlation is a
 * property of the surrounding request, not of the operation, and threading it
 * through would put a `requestId` argument on functions that have no other
 * reason to know one exists — where it would then be forgotten by exactly the
 * new code that most needs it.
 *
 * The store follows `await` and callbacks automatically, so a line logged from
 * a promise resolved four layers deep still carries the right id.
 */
export interface RequestContext {
  /** Correlation id — echoed to the client as `x-request-id`. */
  requestId: string;
  /** Who, once the guard has authenticated them. Absent on public routes. */
  userId?: string;
  organisationId?: string;
  method?: string;
  path?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` visible to everything it calls, however deep. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The current request's context, or undefined outside a request — a scheduled job, boot. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Adds to the current context in place.
 *
 * Used by the auth guard, which learns who the caller is only after the store
 * has been opened. Mutating the existing object rather than nesting a second
 * store keeps a single context per request, so a line logged before
 * authentication and one logged after carry the same id.
 */
export function enrichRequestContext(patch: Partial<RequestContext>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, patch);
}
