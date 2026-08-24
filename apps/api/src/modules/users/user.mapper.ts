import type { Organisation as PrismaOrganisation, User } from '@prisma/client';
import {
  ROLE_PERMISSIONS,
  withSettingDefaults,
  type CurrentUser,
  type Organisation,
  type OrganisationSettings,
  type Role,
  type UserSummary,
} from '@ciq/shared';

/**
 * Projects a database row onto the wire shape.
 *
 * Deliberately explicit rather than a spread: `passwordHash`, `failedLoginCount`
 * and `lockedUntil` live on the same row, and a spread would ship all three to
 * the browser the moment someone adds a field.
 */
export function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: user.role as Role,
    isActive: user.isActive,
  };
}

export function toOrganisation(org: PrismaOrganisation): Organisation {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logoUrl: org.logoUrl,
    createdAt: org.createdAt.toISOString(),
  };
}

/**
 * The `/auth/me` payload.
 *
 * Ships the organisation's settings alongside identity so the web app can render
 * thresholds, weights and locale-correct dates without a second round trip — and,
 * more importantly, so the browser computes derived values with exactly the same
 * numbers the server used.
 */
export function toCurrentUser(user: User, organisation: PrismaOrganisation): CurrentUser {
  const settings: OrganisationSettings = withSettingDefaults(
    (organisation.settings as Partial<OrganisationSettings> | null) ?? null,
  );

  return {
    ...toUserSummary(user),
    organisation: toOrganisation(organisation),
    permissions: ROLE_PERMISSIONS[user.role as Role],
    settings,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}
