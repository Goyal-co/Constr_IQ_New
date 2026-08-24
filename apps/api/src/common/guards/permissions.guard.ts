import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleHasAll, type Permission } from '@ciq/shared';
import { PERMISSIONS_KEY, type RequestWithUser } from '../auth-context';

/**
 * Enforces the `@RequirePermissions(...)` metadata against the caller's role,
 * using the shared permission matrix.
 *
 * The web app consults the same matrix to decide which buttons to render, but
 * that is only cosmetic — this guard is the authority. Hiding a button is not
 * access control.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user) throw new ForbiddenException('Sign in to continue.');

    if (!roleHasAll(user.role, required)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `Your role (${user.role}) does not allow this action.`,
      });
    }
    return true;
  }
}
