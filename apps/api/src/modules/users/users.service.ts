import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import {
  assignableRoles,
  type InviteUserDto,
  type UpdateUserDto,
  type UserSummary,
} from '@ciq/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser, ClientMeta } from '../../common/auth-context';
import type { AppConfig } from '../../config/configuration';
import { MailService } from '../../infra/mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { toUserSummary } from './user.mapper';

const INVITATION_TTL_DAYS = 7;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async list(organisationId: string, includeInactive = false): Promise<UserSummary[]> {
    const users = await this.prisma.user.findMany({
      where: { organisationId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return users.map(toUserSummary);
  }

  /**
   * Invite a colleague.
   *
   * A temporary password is generated and emailed rather than chosen by the
   * inviter — an admin who picks the password knows it, and the new user has no
   * way to tell whether anyone else does. `mustChangePassword` forces a reset on
   * first sign-in.
   */
  async invite(
    actor: AuthenticatedUser,
    dto: InviteUserDto,
    client?: ClientMeta,
  ): Promise<{ user: UserSummary; temporaryPassword: string }> {
    this.assertCanAssign(actor, dto.role);

    const existing = await this.prisma.user.findFirst({
      where: { organisationId: actor.organisationId, email: dto.email },
    });
    if (existing) throw new BadRequestException('Someone with that email is already a member.');

    // 18 random bytes in base64url — comfortably past the 12-character policy and
    // well beyond guessing range for a credential that lives for one login.
    const temporaryPassword = randomBytes(18).toString('base64url');

    const user = await this.prisma.user.create({
      data: {
        organisationId: actor.organisationId,
        email: dto.email,
        name: dto.name,
        role: dto.role,
        passwordHash: await AuthService.hashPassword(temporaryPassword),
        mustChangePassword: true,
      },
    });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.invitation.create({
      data: {
        organisationId: actor.organisationId,
        email: dto.email,
        name: dto.name,
        role: dto.role,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
        invitedById: actor.id,
      },
    });

    const webUrl = this.config.get('webAppUrl', { infer: true });
    await this.mail.send({
      to: dto.email,
      subject: `${actor.name} invited you to ConstructIQ Tracker`,
      html: invitationEmail({
        name: dto.name,
        inviterName: actor.name,
        email: dto.email,
        temporaryPassword,
        signInUrl: `${webUrl}/login`,
        expiresInDays: INVITATION_TTL_DAYS,
      }),
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'user.invited',
      entityType: 'User',
      entityId: user.id,
      entityLabel: `${user.name} <${user.email}>`,
      after: { name: user.name, email: user.email, role: user.role },
      client,
    });

    // Returned so an administrator can pass it on directly when mail is not
    // configured — the local driver only logs.
    return { user: toUserSummary(user), temporaryPassword };
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
    client?: ClientMeta,
  ): Promise<UserSummary> {
    const existing = await this.prisma.user.findFirst({
      where: { id, organisationId: actor.organisationId },
    });
    if (!existing) throw new NotFoundException('That user does not exist.');

    if (dto.role && dto.role !== existing.role) this.assertCanAssign(actor, dto.role);

    // Guard rails against locking the organisation out of its own admin surface.
    if (existing.role === 'OWNER' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only an owner can change another owner.');
    }
    if (existing.id === actor.id && dto.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }
    if (existing.id === actor.id && dto.role && dto.role !== existing.role) {
      throw new BadRequestException('You cannot change your own role.');
    }
    if (existing.role === 'OWNER' && (dto.role || dto.isActive === false)) {
      const owners = await this.prisma.user.count({
        where: { organisationId: actor.organisationId, role: 'OWNER', isActive: true },
      });
      if (owners <= 1) {
        throw new BadRequestException(
          'This is the only active owner. Promote someone else before changing this account.',
        );
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });

    // A deactivated or demoted user must lose their live sessions immediately,
    // not when their access token happens to expire.
    if (dto.isActive === false || (dto.role && dto.role !== existing.role)) {
      await this.tokens.revokeAllForUser(id);
    }

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: dto.role && dto.role !== existing.role ? 'user.role_changed' : 'user.updated',
      entityType: 'User',
      entityId: id,
      entityLabel: `${user.name} <${user.email}>`,
      before: { name: existing.name, role: existing.role, isActive: existing.isActive },
      after: { name: user.name, role: user.role, isActive: user.isActive },
      client,
    });

    return toUserSummary(user);
  }

  /**
   * Deactivate rather than delete.
   *
   * A user id appears throughout the audit trail, on completed drawings and on
   * assigned activities. Removing the row would either break those references or
   * erase the record of who did what.
   */
  async deactivate(
    actor: AuthenticatedUser,
    id: string,
    client?: ClientMeta,
  ): Promise<{ success: true }> {
    await this.update(actor, id, { isActive: false }, client);
    return { success: true };
  }

  /** Issues a new temporary password and forces a change at next sign-in. */
  async resetPassword(
    actor: AuthenticatedUser,
    id: string,
    client?: ClientMeta,
  ): Promise<{ temporaryPassword: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id, organisationId: actor.organisationId },
    });
    if (!user) throw new NotFoundException('That user does not exist.');
    if (user.role === 'OWNER' && actor.role !== 'OWNER') {
      throw new ForbiddenException('Only an owner can reset another owner.');
    }

    const temporaryPassword = randomBytes(18).toString('base64url');
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await AuthService.hashPassword(temporaryPassword),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.tokens.revokeAllForUser(id);

    await this.mail.send({
      to: user.email,
      subject: 'Your ConstructIQ Tracker password was reset',
      html: resetEmail({
        name: user.name,
        actorName: actor.name,
        temporaryPassword,
        signInUrl: `${this.config.get('webAppUrl', { infer: true })}/login`,
      }),
    });

    await this.audit.record({
      organisationId: actor.organisationId,
      actorId: actor.id,
      action: 'user.password_reset',
      entityType: 'User',
      entityId: id,
      entityLabel: `${user.name} <${user.email}>`,
      client,
    });

    return { temporaryPassword };
  }

  /** Nobody may grant a role at or above their own level. */
  private assertCanAssign(actor: AuthenticatedUser, role: string): void {
    if (!assignableRoles(actor.role).includes(role as never)) {
      throw new ForbiddenException(`Your role cannot assign ${role}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Email bodies — inline styles, because email clients strip <style> blocks
// ---------------------------------------------------------------------------

const SHELL = (body: string) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px">
    ${body}
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af">
      ConstructIQ Tracker
    </p>
  </div>
</div>`;

function invitationEmail(p: {
  name: string;
  inviterName: string;
  email: string;
  temporaryPassword: string;
  signInUrl: string;
  expiresInDays: number;
}): string {
  return SHELL(`
    <h1 style="margin:0 0 6px;font-size:19px;color:#111827">You have been added to ConstructIQ Tracker</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#4b5563">
      Hello ${escapeHtml(p.name)} — ${escapeHtml(p.inviterName)} has given you access.
      Sign in with the details below. You will be asked to choose your own password straight away.
    </p>
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#6b7280">Email</td><td style="padding:8px 0;color:#111827"><b>${escapeHtml(p.email)}</b></td></tr>
      <tr><td style="padding:8px 0;color:#6b7280">Temporary password</td><td style="padding:8px 0"><code style="background:#f3f4f6;padding:4px 8px;border-radius:6px;font-size:13px">${escapeHtml(p.temporaryPassword)}</code></td></tr>
    </table>
    <p style="margin:22px 0 0">
      <a href="${p.signInUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600">Sign in</a>
    </p>
    <p style="margin:18px 0 0;font-size:12.5px;color:#9ca3af">
      This temporary password expires in ${p.expiresInDays} days.
    </p>`);
}

function resetEmail(p: {
  name: string;
  actorName: string;
  temporaryPassword: string;
  signInUrl: string;
}): string {
  return SHELL(`
    <h1 style="margin:0 0 6px;font-size:19px;color:#111827">Your password was reset</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#4b5563">
      Hello ${escapeHtml(p.name)} — ${escapeHtml(p.actorName)} reset your password.
      Sign in with the temporary password below and choose a new one.
    </p>
    <p style="margin:0 0 18px"><code style="background:#f3f4f6;padding:6px 10px;border-radius:6px;font-size:13px">${escapeHtml(p.temporaryPassword)}</code></p>
    <p style="margin:0">
      <a href="${p.signInUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600">Sign in</a>
    </p>
    <p style="margin:18px 0 0;font-size:12.5px;color:#9ca3af">
      If you did not expect this, contact your administrator immediately.
    </p>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
