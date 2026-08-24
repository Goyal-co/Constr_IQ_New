/**
 * Request contracts, declared once with zod.
 *
 * The API validates against these via a pipe; the web app reuses the same schemas
 * for form validation. One definition, so a rule can never be tightened on the
 * server and left loose in the form.
 *
 * Phases, categories and templates are referenced by id — there are no enum
 * literals for organisation-defined data anywhere in this file.
 */

import { z } from 'zod';
import {
  ACTIVITY_STATUSES,
  MATERIAL_STATUSES,
  PROJECT_STATUSES,
  TEMPLATE_ITEM_KINDS,
} from './constants';
import { ROLES } from './rbac';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real calendar date');

/**
 * HTML form controls submit an empty string for "nothing chosen", which is
 * neither null nor undefined and so fails a plain `.nullable().optional()`.
 * Normalising here means every optional field accepts what a real form actually
 * sends, rather than making each caller sanitise before validating — the kind of
 * step that gets forgotten on exactly one form.
 */
const blankToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? null : value), schema);

const nullableIsoDate = blankToNull(isoDate.nullable().optional());

const id = z.string().uuid();

/** An optional foreign key: absent, explicitly cleared, or a real uuid. */
const optionalId = blankToNull(id.nullable().optional());

/** An optional number that treats a cleared input as "not set" rather than zero. */
const optionalNumber = (schema: z.ZodTypeAny) => blankToNull(schema.nullable().optional());

const trimmedName = (max = 160) =>
  z.string().trim().min(1, 'Required').max(max, `Must be ${max} characters or fewer`);

const hexColour = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. #3b6fe0');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Length carries far more entropy than character-class rules, so we require 12
 * characters rather than demanding a symbol users will append as "!".
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Must be 128 characters or fewer');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  organisationName: trimmedName(120),
  name: trimmedName(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: passwordSchema,
  /**
   * Optional starter configuration chosen during setup. Nothing is created unless
   * the administrator asks for it — an empty organisation is a valid organisation.
   */
  seedStarterConfiguration: z.boolean().default(false),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export type RefreshDto = z.infer<typeof refreshSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const inviteUserSchema = z.object({
  name: trimmedName(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(ROLES),
});
export type InviteUserDto = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  name: trimmedName(120).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

// ---------------------------------------------------------------------------
// Organisation settings — every tunable number in the engine
// ---------------------------------------------------------------------------

export const organisationSettingsSchema = z.object({
  orderSoonWindowDays: z.coerce.number().int().min(0).max(365).optional(),
  riskHandoverWindowDays: z.coerce.number().int().min(0).max(730).optional(),
  riskDrawingThresholdPct: z.coerce.number().int().min(0).max(100).optional(),
  riskOnSlippedActivity: z.boolean().optional(),
  riskOnOverdueOrder: z.boolean().optional(),
  activityStatusWeights: z
    .record(z.enum(ACTIVITY_STATUSES), z.coerce.number().min(0).max(100))
    .optional(),
  defaultProgrammeWeeks: z.coerce.number().int().min(1).max(520).optional(),
  defaultLeadTimeWeeks: z.coerce.number().int().min(0).max(104).optional(),
  handoverReminderDays: z.coerce.number().int().min(0).max(365).optional(),
  defaultCurrency: z.string().trim().length(3).optional(),
  locale: z.string().trim().min(2).max(20).optional(),
  digestDayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  digestHourUtc: z.coerce.number().int().min(0).max(23).optional(),
});
export type OrganisationSettingsDto = z.infer<typeof organisationSettingsSchema>;

export const updateOrganisationSchema = z.object({
  name: trimmedName(120).optional(),
  logoUrl: z.string().trim().url().nullable().optional(),
});
export type UpdateOrganisationDto = z.infer<typeof updateOrganisationSchema>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categorySchema = z.object({
  name: trimmedName(80),
  description: z.string().trim().max(400).nullable().optional(),
});
export type CategoryDto = z.infer<typeof categorySchema>;

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export const phaseSchema = z.object({
  name: trimmedName(80),
  colour: hexColour,
});
export type PhaseDto = z.infer<typeof phaseSchema>;

export const updatePhaseSchema = phaseSchema.partial().extend({
  isArchived: z.boolean().optional(),
});
export type UpdatePhaseDto = z.infer<typeof updatePhaseSchema>;

// ---------------------------------------------------------------------------
// Templates (project playbooks)
// ---------------------------------------------------------------------------

export const templateItemSchema = z
  .object({
    kind: z.enum(TEMPLATE_ITEM_KINDS),
    /** Ignored for DESIGN_FILE, which is not phase-scoped. */
    phaseId: id.nullable().optional(),
    name: trimmedName(200),
    leadTimeWeeks: optionalNumber(z.coerce.number().int().min(0).max(104)),
    offsetStartDays: z.coerce.number().int().min(-3650).max(3650).nullable().optional(),
    offsetEndDays: z.coerce.number().int().min(-3650).max(3650).nullable().optional(),
  })
  .refine(
    (v) =>
      v.offsetStartDays == null || v.offsetEndDays == null || v.offsetStartDays <= v.offsetEndDays,
    { message: 'Start offset must fall on or before end offset', path: ['offsetEndDays'] },
  );
export type TemplateItemDto = z.infer<typeof templateItemSchema>;

export const templateSchema = z.object({
  name: trimmedName(120),
  description: z.string().trim().max(1000).nullable().optional(),
  isDefault: z.boolean().default(false),
});
export type TemplateDto = z.infer<typeof templateSchema>;

/** Replaces a template's item list wholesale — simpler than per-row patching. */
export const templateItemsSchema = z.object({
  items: z.array(templateItemSchema).max(500),
});
export type TemplateItemsDto = z.infer<typeof templateItemsSchema>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: trimmedName(160),
  code: z.string().trim().max(32).nullable().optional(),
  categoryId: id,
  consultant: z.string().trim().max(160).nullable().optional(),
  vendor: z.string().trim().max(160).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).default('DISCUSSION'),
  handoverDate: nullableIsoDate,
  description: z.string().trim().max(4000).nullable().optional(),
  siteAddress: z.string().trim().max(400).nullable().optional(),
  budgetAmount: optionalNumber(z.coerce.number().nonnegative()),
  currency: z.string().trim().length(3).optional(),
  managerId: optionalId,
  /** Apply a template. Omit to create an empty project. */
  templateId: optionalId,
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().omit({ templateId: true });
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;

/** Applies a template to a project that already exists, appending to its lists. */
export const applyTemplateSchema = z.object({
  templateId: id,
  /** Pre-fill planned dates from the template offsets against the handover date. */
  seedPlannedDates: z.boolean().default(true),
});
export type ApplyTemplateDto = z.infer<typeof applyTemplateSchema>;

export const projectQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  categoryId: id.optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  managerId: id.optional(),
  phaseId: id.optional(),
  /** 'active' hides completed projects, 'completed' shows only them. */
  scope: z.enum(['all', 'active', 'completed']).default('active'),
  atRisk: z.coerce.boolean().optional(),
  handoverBefore: isoDate.optional(),
  handoverAfter: isoDate.optional(),
  sort: z
    .enum(['position', 'name', 'handover', 'progress', 'execution', 'risk', 'updated'])
    .default('position'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProjectQueryDto = z.infer<typeof projectQuerySchema>;

export const reorderSchema = z.object({
  /** Ids in their new order. Positions are rewritten to match this array. */
  ids: z.array(id).min(1).max(1000),
});
export type ReorderDto = z.infer<typeof reorderSchema>;

// ---------------------------------------------------------------------------
// Design files  (Design → Design Files)
// ---------------------------------------------------------------------------

export const createDesignFileSchema = z.object({
  name: trimmedName(200),
  /** When it is due to be issued. Optional — not every document has a deadline. */
  expectedDate: nullableIsoDate,
});
export type CreateDesignFileDto = z.infer<typeof createDesignFileSchema>;

export const updateDesignFileSchema = z.object({
  name: trimmedName(200).optional(),
  isComplete: z.boolean().optional(),
  expectedDate: nullableIsoDate,
  /**
   * Normally stamped automatically when `isComplete` flips true. Accepted here so
   * a document issued last week can be backdated rather than recorded as today.
   */
  completedDate: nullableIsoDate,
});
export type UpdateDesignFileDto = z.infer<typeof updateDesignFileSchema>;

// ---------------------------------------------------------------------------
// Work items  (Design → {phase} and Execution → {phase} — one row, two tracks)
// ---------------------------------------------------------------------------

export const createWorkItemSchema = z.object({
  phaseId: id,
  name: trimmedName(200),
  designExpectedDate: nullableIsoDate,
  plannedStart: nullableIsoDate,
  plannedEnd: nullableIsoDate,
  assigneeId: optionalId,
});
export type CreateWorkItemDto = z.infer<typeof createWorkItemSchema>;

/**
 * Both tracks patch through the same endpoint. `designComplete` belongs to the
 * Design view; the execution fields belong to the Execution view. Keeping them
 * on one route means the two views cannot fall out of step.
 */
export const updateWorkItemSchema = z
  .object({
    name: trimmedName(200).optional(),
    phaseId: id.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),

    designComplete: z.boolean().optional(),
    designExpectedDate: nullableIsoDate,
    designCompletedDate: nullableIsoDate,

    executionStatus: z.enum(ACTIVITY_STATUSES).optional(),
    plannedStart: nullableIsoDate,
    plannedEnd: nullableIsoDate,
    actualStart: nullableIsoDate,
    actualEnd: nullableIsoDate,
    assigneeId: optionalId,
  })
  .refine((v) => !v.plannedStart || !v.plannedEnd || v.plannedStart <= v.plannedEnd, {
    message: 'Planned start must fall on or before planned end',
    path: ['plannedEnd'],
  })
  .refine((v) => !v.actualStart || !v.actualEnd || v.actualStart <= v.actualEnd, {
    message: 'Actual start must fall on or before actual end',
    path: ['actualEnd'],
  });
export type UpdateWorkItemDto = z.infer<typeof updateWorkItemSchema>;

/** Tick or untick the design track for a whole phase at once. */
export const bulkDesignSchema = z.object({
  phaseId: id,
  designComplete: z.boolean(),
});
export type BulkDesignDto = z.infer<typeof bulkDesignSchema>;

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export const createMaterialSchema = z.object({
  /** The tag. Determines which work items may be linked. */
  phaseId: id,
  name: trimmedName(200),
  /** Entered directly. Optional so an item can be raised before its date is known. */
  orderByDate: nullableIsoDate,
  /** Optional helper for calculating orderByDate back from handover. */
  leadTimeWeeks: optionalNumber(z.coerce.number().int().min(0).max(104)),
  /** The execution work item this order gates. Must sit in the same phase. */
  workItemId: optionalId,
  supplier: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type CreateMaterialDto = z.infer<typeof createMaterialSchema>;

export const updateMaterialSchema = z.object({
  name: trimmedName(200).optional(),
  phaseId: id.optional(),
  orderByDate: nullableIsoDate,
  leadTimeWeeks: optionalNumber(z.coerce.number().int().min(0).max(104)),
  workItemId: optionalId,
  status: z.enum(MATERIAL_STATUSES).optional(),
  supplier: z.string().trim().max(160).nullable().optional(),
  poNumber: z.string().trim().max(64).nullable().optional(),
  orderedAt: nullableIsoDate,
  deliveredAt: nullableIsoDate,
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateMaterialDto = z.infer<typeof updateMaterialSchema>;

// ---------------------------------------------------------------------------
// Reports & audit
// ---------------------------------------------------------------------------

export const reportSchema = z.object({
  title: trimmedName(200).optional(),
  commentary: z.string().trim().max(8000).optional(),
});
export type ReportDto = z.infer<typeof reportSchema>;

export const reportQuerySchema = z.object({
  categoryId: id.optional(),
  managerId: id.optional(),
  scope: z.enum(['all', 'active', 'completed']).default('all'),
});
export type ReportQueryDto = z.infer<typeof reportQuerySchema>;

export const auditQuerySchema = z.object({
  entityType: z.string().trim().max(40).optional(),
  entityId: id.optional(),
  actorId: id.optional(),
  action: z.string().trim().max(60).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQueryDto = z.infer<typeof auditQuerySchema>;

export const notificationQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type NotificationQueryDto = z.infer<typeof notificationQuerySchema>;
