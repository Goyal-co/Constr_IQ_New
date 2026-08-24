import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ROLE_PERMISSIONS, type Role } from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/auth-context';
import type { AppConfig } from '../../config/configuration';
import type { AccessTokenPayload } from './token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt', { infer: true }).accessSecret,
    });
  }

  /**
   * Re-reads the user on every request rather than trusting the token body.
   *
   * That costs one indexed primary-key lookup, and buys correct behaviour for
   * deactivation and role changes: without it, a user demoted from Admin to
   * Viewer would keep admin powers until their 15-minute access token expired.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        organisationId: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) throw new UnauthorizedException('This account no longer exists.');
    if (!user.isActive) throw new UnauthorizedException('This account has been deactivated.');

    // A token minted for one tenant must never be honoured against another, even
    // if the user id somehow exists in both.
    if (user.organisationId !== payload.org) {
      throw new UnauthorizedException('This session is not valid for this organisation.');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organisationId: user.organisationId,
      role: user.role as Role,
      permissions: ROLE_PERMISSIONS[user.role as Role],
    };
  }
}
