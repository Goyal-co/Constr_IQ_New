/**
 * Domain vocabulary.
 *
 * This file holds only the closed sets that carry *behaviour* — the states a
 * workflow can be in, and which of them the engine treats as terminal, active or
 * stalled. Anything an organisation would reasonably want to rename, reorder,
 * recolour or extend lives in the database instead:
 *
 *   • project categories  → `Category` rows
 *   • delivery phases     → `Phase` rows (name, colour, order)
 *   • drawing / activity / material checklists → `Template` + `TemplateItem` rows
 *   • programme timelines → each activity's own planned and actual dates
 *   • risk and lead-time thresholds, progress weights → `OrganisationSettings`
 *
 * If you find yourself wanting to add a business list here, it almost certainly
 * belongs in a table. See `settings.ts` for the configurable numbers.
 */

// ---------------------------------------------------------------------------
// Project lifecycle
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ['DISCUSSION', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Statuses that count as live work — everything except a delivered project. */
export const ACTIVE_PROJECT_STATUSES: ProjectStatus[] = ['DISCUSSION', 'IN_PROGRESS', 'ON_HOLD'];

/**
 * Default display labels. Organisations may override any of these through
 * settings; these are the fallbacks used before an override exists.
 */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DISCUSSION: 'Discussion',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
};

export type Tone = 'info' | 'warning' | 'danger' | 'success' | 'neutral';

/**
 * Semantic tone rather than raw hex, so the palette stays theme-aware. Phase
 * colours are per-organisation data and are *not* listed here.
 */
export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  DISCUSSION: 'info',
  IN_PROGRESS: 'warning',
  ON_HOLD: 'danger',
  COMPLETED: 'success',
};

// ---------------------------------------------------------------------------
// Execution (on-site build) activity states
// ---------------------------------------------------------------------------

export const ACTIVITY_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'BLOCKED'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  BLOCKED: 'Blocked',
};

export const ACTIVITY_STATUS_TONE: Record<ActivityStatus, Tone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'warning',
  DONE: 'success',
  BLOCKED: 'danger',
};

// ---------------------------------------------------------------------------
// Materials & procurement
// ---------------------------------------------------------------------------

export const MATERIAL_STATUSES = ['PENDING', 'ORDERED', 'DELIVERED', 'CANCELLED'] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  PENDING: 'Pending',
  ORDERED: 'Ordered',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const MATERIAL_STATUS_TONE: Record<MaterialStatus, Tone> = {
  PENDING: 'neutral',
  ORDERED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

/** Procurement urgency, derived — never stored. */
export const PROCUREMENT_STATES = [
  'OVERDUE',
  'DUE_SOON',
  'SCHEDULED',
  'ORDERED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type ProcurementState = (typeof PROCUREMENT_STATES)[number];

export const PROCUREMENT_STATE_LABELS: Record<ProcurementState, string> = {
  OVERDUE: 'Overdue',
  DUE_SOON: 'Due soon',
  SCHEDULED: 'Scheduled',
  ORDERED: 'Ordered',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const PROCUREMENT_STATE_TONE: Record<ProcurementState, Tone> = {
  OVERDUE: 'danger',
  DUE_SOON: 'warning',
  SCHEDULED: 'neutral',
  ORDERED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
};

// ---------------------------------------------------------------------------
// Project structure
// ---------------------------------------------------------------------------

/**
 * The three sections every project has.
 *
 * This is structural — it is how a project is navigated, not a business list.
 * What varies per organisation is the *work phases* inside Design and Execution,
 * which are `Phase` rows.
 */
export const PROJECT_SECTIONS = ['DESIGN', 'MATERIALS', 'EXECUTION'] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

export const PROJECT_SECTION_LABELS: Record<ProjectSection, string> = {
  DESIGN: 'Design',
  MATERIALS: 'Materials',
  EXECUTION: 'Execution',
};

/**
 * Design has one fixed sub-section — the drawing documents — followed by one
 * sub-section per work phase. Execution has the same work-phase sub-sections and
 * no fixed one, because there is nothing to build for a document.
 */
export const DESIGN_FILES_LABEL = 'Design Files';

// ---------------------------------------------------------------------------
// Work items — the rows shared by Design and Execution
// ---------------------------------------------------------------------------

/**
 * A work item carries two independent completion tracks:
 *
 *   • design   — has the design for this been issued?  (boolean)
 *   • execution — has it been built on site?           (ActivityStatus + dates)
 *
 * One row, surfaced in both sections. Adding "Blockwork" under Design → Civil
 * makes it appear under Execution → Civil immediately, because it is the same
 * record rather than a copy that could drift.
 *
 * The execution track reuses `ACTIVITY_STATUSES`, declared above.
 */

// ---------------------------------------------------------------------------
// Template item kinds — which list a template row seeds
// ---------------------------------------------------------------------------

export const TEMPLATE_ITEM_KINDS = ['DESIGN_FILE', 'WORK_ITEM', 'MATERIAL'] as const;
export type TemplateItemKind = (typeof TEMPLATE_ITEM_KINDS)[number];

export const TEMPLATE_ITEM_KIND_LABELS: Record<TemplateItemKind, string> = {
  DESIGN_FILE: 'Design file',
  WORK_ITEM: 'Work item',
  MATERIAL: 'Material',
};

/** Plurals are listed rather than derived — "Activitys" is what appending an s gives. */
export const TEMPLATE_ITEM_KIND_PLURALS: Record<TemplateItemKind, string> = {
  DESIGN_FILE: 'Design files',
  WORK_ITEM: 'Work items',
  MATERIAL: 'Materials',
};

export const TEMPLATE_ITEM_KIND_HINTS: Record<TemplateItemKind, string> = {
  DESIGN_FILE: 'A drawing or document. Lands in Design → Design Files.',
  WORK_ITEM: 'A package of work. Lands in Design → its phase and Execution → its phase.',
  MATERIAL: 'Something to purchase. Lands in Materials, tagged with its phase.',
};

/**
 * Palette offered when creating a phase or template.
 *
 * A convenience for the colour picker, not a constraint — a phase stores whatever
 * hex value the administrator chose.
 */
export const PHASE_COLOUR_CHOICES = [
  '#3b6fe0',
  '#7c5cd6',
  '#0f9d8f',
  '#d98a20',
  '#22a06b',
  '#c2544d',
  '#5b7083',
  '#b4459b',
] as const;
