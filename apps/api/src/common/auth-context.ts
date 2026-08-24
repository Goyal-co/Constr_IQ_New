import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@ciq/shared';
import type { Request } from 'express';

/**
 * The authenticated principal attached to every request by JwtStrategy.
 *
 * `organisationId` is the tenant boundary — every repository query filters on it.
 * It is read from the verified token, never from a header or body the caller
 * controls, so a user cannot reach another tenant by changing a request field.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  organisationId: string;
  role: Role;
  permissions: Permission[];
}

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
  id?: string;
}

// ---------------------------------------------------------------------------
// Route metadata
// ---------------------------------------------------------------------------

export const IS_PUBLIC_KEY = 'ciq:isPublic';

/** Opts a route out of the global JWT guard. Use sparingly — login, health, docs. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'ciq:permissions';

/**
 * Declares the permissions a route requires. PermissionsGuard enforces that the
 * caller's role carries *all* of them.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// ---------------------------------------------------------------------------
// Param decorators
// ---------------------------------------------------------------------------

/** Injects the authenticated user, or one of its fields: `@CurrentUser('organisationId')`. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return field ? request.user?.[field] : request.user;
  },
);

export interface ClientMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Injects caller IP and user agent, recorded on audit entries and refresh tokens. */
export const ClientInfo = createParamDecorator((_: unknown, ctx: ExecutionContext): ClientMeta => {
  const request = ctx.switchToHttp().getRequest<Request>();
  // Behind Railway/Vercel the real client sits in X-Forwarded-For; `trust proxy`
  // is enabled in main.ts so express resolves request.ip correctly.
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.get('user-agent')?.slice(0, 400) ?? null,
  };
});
