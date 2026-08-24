import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClientMeta } from '../../common/auth-context';
import type { AppConfig } from '../../config/configuration';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  org: string;
  role: Role;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Token issuance and rotation.
 *
 * Access tokens are short-lived JWTs carrying identity and role. Refresh tokens
 * are opaque random strings stored only as SHA-256 digests — a database dump
 * therefore does not hand an attacker a set of usable sessions.
 *
 * Rotation is single-use: presenting a refresh token revokes it and issues a new
 * pair. Presenting one that was already used means it leaked, so the whole
 * session family is revoked and the user must sign in again.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get jwtConfig() {
    return this.config.get('jwt', { infer: true });
  }

  async issue(
    user: { id: string; email: string; organisationId: string; role: Role },
    client?: ClientMeta,
  ): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      org: user.organisationId,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.jwtConfig.accessSecret,
      expiresIn: this.jwtConfig.accessTtl,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDuration(this.jwtConfig.refreshTtl)),
        userAgent: client?.userAgent ?? null,
        ipAddress: client?.ipAddress ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDuration(this.jwtConfig.accessTtl) / 1000),
    };
  }

  /**
   * Exchange a refresh token for a fresh pair.
   *
   * Reuse detection: if the presented token exists but is already revoked, we
   * treat it as a stolen credential and revoke every live session for that user.
   */
  async rotate(refreshToken: string, client?: ClientMeta): Promise<IssuedTokens> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('That session is no longer valid. Sign in again.');

    if (stored.revokedAt) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException(
        'This session was already used and has been closed for security. Sign in again.',
      );
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }

    if (!stored.user.isActive) {
      throw new UnauthorizedException('This account has been deactivated.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issue(
      {
        id: stored.user.id,
        email: stored.user.email,
        organisationId: stored.user.organisationId,
        role: stored.user.role as Role,
      },
      client,
    );
  }

  /** Sign out of the current device. Unknown tokens are ignored, not reported. */
  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Sign out everywhere — used on password change and on reuse detection. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Housekeeping for the nightly job: drop rows nobody can present any more. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
    });
    return count;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parses `15m` / `30d` / `12h` / `45s` into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Unsupported duration format: "${value}" (expected e.g. 15m, 30d)`);
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return amount * multipliers[unit];
}
