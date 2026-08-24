import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../auth-context';

/**
 * Global authentication guard — applied to every route unless marked `@Public()`.
 *
 * Deny-by-default is the point: a new controller added six months from now is
 * protected because nobody had to remember to protect it.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser>(err: unknown, user: TUser, info: unknown): TUser {
    if (err || !user) {
      // Distinguish expiry from a malformed token so the client knows whether to
      // attempt a silent refresh or bounce the user to the login screen.
      const name = (info as Error | undefined)?.name;
      if (name === 'TokenExpiredError') {
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'Token Expired',
          message: 'Your session has expired. Refreshing…',
        });
      }
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Sign in to continue.',
      });
    }
    return user;
  }
}
