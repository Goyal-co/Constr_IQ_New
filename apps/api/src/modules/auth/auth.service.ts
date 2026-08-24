import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import {
  DEFAULT_SETTINGS,
  type ChangePasswordDto,
  type CurrentUser,
  type LoginDto,
  type LoginResult,
  type RegisterDto,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClientMeta } from '../../common/auth-context';
import type { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { toCurrentUser } from '../users/user.mapper';
import { TokenService } from './token.service';

/**
 * Cost factor for bcrypt. 12 lands around 250ms on typical container hardware —
 * slow enough to make offline cracking expensive, fast enough that a login does
 * not feel broken.
 */
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Creates an organisation and its first user, who becomes OWNER.
   *
   * Only reachable when the deployment has no organisations yet, or via an
   * invitation. An open registration endpoint on a single-tenant enterprise
   * deployment is a way in, not a feature.
   */
  async register(dto: RegisterDto, client?: ClientMeta): Promise<LoginResult> {
    const existingOrgs = await this.prisma.organisation.count();
    if (existingOrgs > 0) {
      throw new ForbiddenException(
        'This deployment is already set up. Ask an administrator for an invitation.',
      );
    }

    const slug = slugify(dto.organisationName);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const { user, organisation } = await this.prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.create({
        data: {
          name: dto.organisationName,
          slug,
          // Settings start at the documented defaults and are editable from the
          // settings screen. No categories, phases or templates are created —
          // guessing what this business builds is exactly the assumption that
          // makes software feel like it was written for somebody else.
          settings: DEFAULT_SETTINGS as unknown as object,
          reportSetting: { create: {} },
        },
      });

      const user = await tx.user.create({
        data: {
          organisationId: organisation.id,
          email: dto.email,
          name: dto.name,
          passwordHash,
          role: 'OWNER',
        },
      });

      return { user, organisation };
    });

    await this.audit.record({
      organisationId: organisation.id,
      actorId: user.id,
      action: 'organisation.created',
      entityType: 'Organisation',
      entityId: organisation.id,
      entityLabel: organisation.name,
      after: { name: organisation.name, slug: organisation.slug },
      client,
    });

    const issued = await this.tokens.issue(
      { id: user.id, email: user.email, organisationId: organisation.id, role: 'OWNER' },
      client,
    );
    return { ...issued, user: toCurrentUser(user, organisation) };
  }

  /**
   * Verify credentials and start a session.
   *
   * Every failure path returns the same message and takes roughly the same time.
   * A login form that says "no such user" for one email and "wrong password" for
   * another is a free account-enumeration oracle.
   */
  async login(dto: LoginDto, client?: ClientMeta): Promise<LoginResult> {
    const generic = 'Those credentials do not match our records.';
    const { maxLoginAttempts, lockoutMinutes } = this.config.get('jwt', { infer: true });

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
      include: { organisation: true },
    });

    if (!user) {
      // Burn comparable CPU so response time does not reveal whether the account
      // exists. The hash is a fixed dummy; the comparison always fails.
      await bcrypt.compare(
        dto.password,
        '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva',
      );
      throw new UnauthorizedException(generic);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }

    const matches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!matches) {
      const failedLoginCount = user.failedLoginCount + 1;
      const shouldLock = failedLoginCount >= maxLoginAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil: shouldLock ? new Date(Date.now() + lockoutMinutes * 60_000) : null,
        },
      });
      if (shouldLock) {
        this.logger.warn(`Account locked after ${failedLoginCount} failed attempts: ${user.id}`);
        await this.audit.record({
          organisationId: user.organisationId,
          actorId: user.id,
          action: 'auth.locked',
          entityType: 'User',
          entityId: user.id,
          entityLabel: user.email,
          client,
        });
      }
      throw new UnauthorizedException(generic);
    }

    if (!user.isActive) throw new UnauthorizedException('This account has been deactivated.');

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await this.audit.record({
      organisationId: user.organisationId,
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.email,
      client,
    });

    const issued = await this.tokens.issue(
      {
        id: user.id,
        email: user.email,
        organisationId: user.organisationId,
        role: user.role,
      },
      client,
    );

    return { ...issued, user: toCurrentUser(updated, user.organisation) };
  }

  async refresh(refreshToken: string, client?: ClientMeta) {
    return this.tokens.rotate(refreshToken, client);
  }

  async logout(refreshToken: string): Promise<{ success: true }> {
    await this.tokens.revoke(refreshToken);
    return { success: true };
  }

  async me(userId: string): Promise<CurrentUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { organisation: true },
    });
    return toCurrentUser(user, user.organisation);
  }

  /**
   * Change password and close every other session.
   *
   * Revoking all refresh tokens is the point of a password change: if the reason
   * for changing it is that someone else knows it, leaving their session alive
   * defeats the exercise.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const matches = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!matches) throw new UnauthorizedException('Your current password is incorrect.');

    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('Choose a password you have not used here before.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
      },
    });

    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({
      organisationId: user.organisationId,
      actorId: userId,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: userId,
      entityLabel: user.email,
      client,
    });

    return { success: true };
  }

  /** True when the deployment has no organisation yet — drives the setup screen. */
  async needsSetup(): Promise<{ needsSetup: boolean }> {
    return { needsSetup: (await this.prisma.organisation.count()) === 0 };
  }

  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'organisation'
  );
}
