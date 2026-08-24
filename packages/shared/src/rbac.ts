/**
 * Role-based access control.
 *
 * A single permission matrix lives here and is enforced in two places: the API
 * guards it on every mutating route, and the web app reads it to decide whether
 * to render an action at all. The API is the authority — the web app only uses
 * it to avoid showing buttons that would fail.
 */

export const ROLES = [
  'OWNER',
  'ADMIN',
  'PROJECT_MANAGER',
  'SITE_ENGINEER',
  'CONSULTANT',
  'VIEWER',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  PROJECT_MANAGER: 'Project Manager',
  SITE_ENGINEER: 'Site Engineer',
  CONSULTANT: 'Consultant',
  VIEWER: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Full control including billing, organisation settings and role assignment.',
  ADMIN: 'Manages users, categories and every project in the organisation.',
  PROJECT_MANAGER: 'Creates and runs projects end to end, including procurement sign-off.',
  SITE_ENGINEER: 'Updates execution progress, drawings and material status on assigned projects.',
  CONSULTANT: 'Updates drawings and comments on assigned projects. Cannot alter procurement.',
  VIEWER: 'Read-only access to projects and reports.',
};

export const PERMISSIONS = [
  // Organisation & people
  'org:read',
  'org:update',
  'user:read',
  'user:invite',
  'user:update',
  'user:delete',
  'role:assign',
  // Projects
  // Creating a category is separated from `org:update` deliberately: the person
  // setting up a project needs to be able to add the category it belongs to,
  // whereas renaming or deleting one affects everybody and stays with admins.
  'category:create',
  'project:read',
  'project:create',
  'project:update',
  'project:delete',
  'project:reorder',
  // Drawings
  'drawing:read',
  'drawing:create',
  'drawing:update',
  'drawing:delete',
  // Materials / procurement
  'material:read',
  'material:create',
  'material:update',
  'material:delete',
  'material:order',
  // Execution
  'activity:read',
  'activity:create',
  'activity:update',
  'activity:delete',
  // Attachments
  'attachment:read',
  'attachment:upload',
  'attachment:delete',
  // Reporting & audit
  'report:read',
  'report:write',
  'report:export',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const READ_ONLY: Permission[] = [
  'org:read',
  'user:read',
  'project:read',
  'drawing:read',
  'material:read',
  'activity:read',
  'attachment:read',
  'report:read',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL,

  ADMIN: ALL.filter((p) => p !== 'org:update'),

  PROJECT_MANAGER: [
    ...READ_ONLY,
    'category:create',
    'project:create',
    'project:update',
    'project:delete',
    'project:reorder',
    'drawing:create',
    'drawing:update',
    'drawing:delete',
    'material:create',
    'material:update',
    'material:delete',
    'material:order',
    'activity:create',
    'activity:update',
    'activity:delete',
    'attachment:upload',
    'attachment:delete',
    'report:write',
    'report:export',
    'audit:read',
  ],

  SITE_ENGINEER: [
    ...READ_ONLY,
    'project:update',
    'drawing:update',
    'material:update',
    'activity:create',
    'activity:update',
    'attachment:upload',
    'report:export',
  ],

  // A consultant owns the drawing set but must not move procurement dates.
  CONSULTANT: [...READ_ONLY, 'drawing:create', 'drawing:update', 'attachment:upload'],

  VIEWER: [...READ_ONLY],
};

/** True when the role carries the permission. */
export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** True when the role carries every permission listed. */
export function roleHasAll(role: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => roleHas(role, p));
}

/** True when the role carries at least one of the permissions listed. */
export function roleHasAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => roleHas(role, p));
}

/**
 * Roles a given actor is allowed to grant. Nobody may grant a role at or above
 * their own level, which stops an admin from minting a second owner.
 */
export function assignableRoles(actor: Role): Role[] {
  const rank: Record<Role, number> = {
    OWNER: 5,
    ADMIN: 4,
    PROJECT_MANAGER: 3,
    SITE_ENGINEER: 2,
    CONSULTANT: 2,
    VIEWER: 1,
  };
  if (actor === 'OWNER') return ROLES.filter((r) => r !== 'OWNER');
  return ROLES.filter((r) => rank[r] < rank[actor]);
}
