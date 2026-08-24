/**
 * Wire types — the shapes the API returns and the web app consumes.
 *
 * Dates cross the wire as `YYYY-MM-DD` (calendar facts) or full ISO-8601
 * timestamps (audit instants). Never as `Date`, which does not survive JSON.
 *
 * Note that phases arrive as embedded objects, not enum strings: a phase is a row
 * an administrator created, with its own name, colour and position.
 */

import type {
  ActivityStatus,
  MaterialStatus,
  ProcurementState,
  ProjectStatus,
  TemplateItemKind,
} from './constants';
import type { IsoDate } from './dates';
import type { Permission, Role } from './rbac';
import type { OrganisationSettings } from './settings';

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: Role;
  isActive: boolean;
}

export interface CurrentUser extends UserSummary {
  organisation: Organisation;
  permissions: Permission[];
  settings: OrganisationSettings;
  lastLoginAt: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface LoginResult extends AuthTokens {
  user: CurrentUser;
}

// ---------------------------------------------------------------------------
// Configuration entities — all administrator-managed
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  description: string | null;
  position: number;
  projectCount?: number;
}

/**
 * A delivery phase. Name, colour and order are data, so an organisation can run
 * "Design / Civil / Finishing", "RIBA 0-7", or anything else entirely.
 */
export interface Phase {
  id: string;
  name: string;
  colour: string;
  position: number;
  isArchived: boolean;
  /** Populated on the settings screen so a phase in use cannot be deleted silently. */
  usageCount?: number;
}

export interface TemplateItem {
  id: string;
  kind: TemplateItemKind;
  /** Null for DESIGN_FILE — a document belongs to no work phase. */
  phase: Phase | null;
  name: string;
  position: number;
  /** MATERIAL only — supplier lead time used to suggest an order-by date. */
  leadTimeWeeks: number | null;
  /**
   * WORK_ITEM only — offsets in days from the handover date, used to pre-fill
   * planned dates when the template is applied. Negative means before handover.
   * Null leaves the item undated.
   */
  offsetStartDays: number | null;
  offsetEndDays: number | null;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail extends Template {
  items: TemplateItem[];
}

// ---------------------------------------------------------------------------
// Project entities
// ---------------------------------------------------------------------------

/**
 * A drawing or document. Lives in Design → Design Files only — a document is not
 * something the site builds, so it has no execution track and no phase.
 */
export interface DesignFile {
  id: string;
  projectId: string;
  name: string;
  isComplete: boolean;
  position: number;

  /** When this document is due to be issued. Entered directly. */
  expectedDate: IsoDate | null;
  /** Stamped when it is marked issued; cleared if it is reopened. */
  completedDate: IsoDate | null;

  completedAt: string | null;
  completedBy: UserSummary | null;
  attachmentCount: number;
  updatedAt: string;

  /** Derived: days from today until expectedDate. Negative means overdue. */
  daysUntilExpected: number | null;
  /** Derived: still outstanding with its expected date already passed. */
  isOverdue: boolean;
  /** Derived: issued later than expected, in days. Null when not applicable. */
  daysLate: number | null;
}

/**
 * A package of work, carrying two independent completion tracks.
 *
 * The same record is surfaced twice: under Design → {phase} to track whether its
 * design has been issued, and under Execution → {phase} to track whether it has
 * been built. Adding one in Design makes it appear in Execution immediately,
 * because there is only ever one row.
 */
export interface WorkItem {
  id: string;
  projectId: string;
  phase: Phase;
  name: string;
  position: number;
  notes: string | null;
  attachmentCount: number;
  updatedAt: string;

  // --- Design track --------------------------------------------------------
  designComplete: boolean;
  /** When the design is due to be issued. */
  designExpectedDate: IsoDate | null;
  /** Stamped when the design is marked issued; cleared if reopened. */
  designCompletedDate: IsoDate | null;
  designCompletedAt: string | null;
  designCompletedBy: UserSummary | null;
  /** Derived: design outstanding with its expected date already passed. */
  designOverdue: boolean;

  // --- Execution track -----------------------------------------------------
  executionStatus: ActivityStatus;
  plannedStart: IsoDate | null;
  plannedEnd: IsoDate | null;
  actualStart: IsoDate | null;
  actualEnd: IsoDate | null;
  assignee: UserSummary | null;
  /** Derived from this item's own planned and actual dates. */
  slippage: Slippage | null;

  // --- Material gating -----------------------------------------------------
  /**
   * Materials linked to this item that have not yet been delivered. While this
   * is non-empty the item cannot be marked Done — you cannot lay flooring the
   * tiles for which have not arrived.
   */
  blockingMaterials: MaterialLink[];
  /** Every material linked to this item, delivered or not. */
  linkedMaterials: MaterialLink[];

  /**
   * Whether the build may progress, and why not.
   *
   * Site work cannot start or finish until the design has been issued and every
   * linked material has arrived. Sent from the server so the interface disables
   * the same transitions the API refuses.
   */
  gate: ExecutionGate;
}

export interface ExecutionGate {
  /** May move to In progress. */
  canStart: boolean;
  /** May move to Done. */
  canComplete: boolean;
  /** True when the design track is still outstanding. */
  designPending: boolean;
  /** Materials linked to this item that have not been delivered. */
  pendingMaterials: MaterialLink[];
  /** Plain-language reasons, ready to show. Empty when nothing is in the way. */
  reasons: string[];
}

/** Compact material reference shown on a work item without a second request. */
export interface MaterialLink {
  id: string;
  name: string;
  status: MaterialStatus;
  orderByDate: IsoDate | null;
  procurementState: ProcurementState;
}

export interface Material {
  id: string;
  projectId: string;
  /** The tag: which work phase this material belongs to. */
  phase: Phase;
  name: string;
  /**
   * The date this must be ordered by. Entered directly. `leadTimeWeeks` is an
   * optional convenience for calculating it back from handover, not the source
   * of truth — a buyer who knows the real date should be able to just type it.
   */
  orderByDate: IsoDate | null;
  leadTimeWeeks: number | null;
  status: MaterialStatus;
  supplier: string | null;
  poNumber: string | null;
  orderedAt: IsoDate | null;
  deliveredAt: IsoDate | null;
  notes: string | null;
  position: number;
  attachmentCount: number;
  updatedAt: string;

  /** The execution work item this material gates. Null when it gates nothing. */
  linkedWorkItem: WorkItemRef | null;

  /** Derived: days from today until orderByDate. Negative means overdue. */
  daysUntilOrderBy: number | null;
  /** Derived from status, order-by date and the organisation's warning window. */
  procurementState: ProcurementState;
  /** True while this material is stopping its linked work item completing. */
  isBlocking: boolean;
}

/** Compact work-item reference for the materials list. */
export interface WorkItemRef {
  id: string;
  name: string;
  phase: Phase;
  executionStatus: ActivityStatus;
}

export type SlippageState = 'LATE' | 'OVERDUE' | 'ON_TIME' | 'EARLY' | 'PENDING';

export interface Slippage {
  state: SlippageState;
  /** Positive = days behind plan. Negative = days ahead. */
  days: number;
}

export interface ProjectMetrics {
  /** Design Files sub-section. */
  designFilesTotal: number;
  designFilesComplete: number;
  /** Design items — files or work items — outstanding past their expected date. */
  designOverdue: number;
  /** Design track across all work items, plus design files. */
  designTotal: number;
  designComplete: number;
  designPct: number;

  /** Execution track across all work items. */
  workItemsTotal: number;
  executionPct: number;
  executionDelayed: number;
  /** Work items that cannot be completed because a linked material is outstanding. */
  executionBlocked: number;

  materialsTotal: number;
  materialsOrdered: number;
  materialsOverdue: number;
  materialsDueSoon: number;

  daysToHandover: number | null;
  atRisk: boolean;
  /** Plain-language explanation of every rule that fired. Empty when not at risk. */
  riskReasons: string[];
}

/** Per-phase rollup, computed from whichever phases the project actually uses. */
export interface PhaseProgress {
  phase: Phase;
  workItemsTotal: number;
  designComplete: number;
  designPct: number;
  executionPct: number;
  executionDelayed: number;
  executionBlocked: number;
  materialsTotal: number;
  materialsOutstanding: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  code: string | null;
  consultant: string | null;
  vendor: string | null;
  status: ProjectStatus;
  handoverDate: IsoDate | null;
  category: Category;
  manager: UserSummary | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  metrics: ProjectMetrics;
}

export interface ProjectDetail extends ProjectSummary {
  description: string | null;
  siteAddress: string | null;
  budgetAmount: number | null;
  currency: string;

  /** Design → Design Files. */
  designFiles: DesignFile[];
  /**
   * The rows behind both Design → {phase} and Execution → {phase}. The client
   * groups them by phase for each section rather than fetching twice.
   */
  workItems: WorkItem[];
  /** Materials, each tagged with a phase and optionally gating a work item. */
  materials: Material[];

  members: ProjectMember[];
  /** Work phases this project actually uses, in the organisation's order. */
  phases: PhaseProgress[];
}

export interface ProjectMember {
  userId: string;
  user: UserSummary;
  projectRole: string | null;
  addedAt: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'DRAWING' | 'PHOTO' | 'PURCHASE_ORDER' | 'DOCUMENT';
  entityType: 'PROJECT' | 'DESIGN_FILE' | 'MATERIAL' | 'WORK_ITEM';
  entityId: string;
  uploadedBy: UserSummary;
  uploadedAt: string;
  /** Short-lived signed URL. Re-fetch the attachment to refresh it. */
  downloadUrl: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  actor: UserSummary | null;
  changes: AuditChange[];
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

export type NotificationKind =
  | 'MATERIAL_OVERDUE'
  | 'MATERIAL_DUE_SOON'
  | 'ACTIVITY_SLIPPED'
  | 'PROJECT_AT_RISK'
  | 'PROJECT_ASSIGNED'
  | 'HANDOVER_APPROACHING'
  | 'MENTION';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  projectId: string | null;
  projectName: string | null;
  isRead: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Portfolio reporting — every figure below is a count of real rows
// ---------------------------------------------------------------------------

export interface PortfolioKpis {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  /** Live count per status, keyed by the status value. */
  byStatus: Record<ProjectStatus, number>;
  designTotal: number;
  designComplete: number;
  designPct: number;
  workItemsTotal: number;
  executionDelayed: number;
  executionBlocked: number;
  executionPct: number;
  materialsTotal: number;
  ordersOverdue: number;
  ordersDueSoon: number;
  projectsAtRisk: number;
}

export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  total: number;
  counts: Record<ProjectStatus, number>;
}

export interface PhaseBreakdown {
  phase: Phase;
  projectCount: number;
  designPct: number;
  executionPct: number;
  materialsOutstanding: number;
}

export interface UpcomingHandover {
  projectId: string;
  projectName: string;
  handoverDate: IsoDate;
  daysRemaining: number;
  designPct: number;
  executionPct: number;
  atRisk: boolean;
}

export interface ProcurementAlert {
  materialId: string;
  materialName: string;
  projectId: string;
  projectName: string;
  phaseName: string;
  leadTimeWeeks: number | null;
  orderByDate: IsoDate;
  daysUntilOrderBy: number;
  procurementState: ProcurementState;
  supplier: string | null;
  /** The work item this order is holding up, when it gates one. */
  blocksWorkItemName: string | null;
}

export interface PortfolioReport {
  generatedAt: string;
  title: string;
  commentary: string;
  executiveSummary: string;
  kpis: PortfolioKpis;
  byCategory: CategoryBreakdown[];
  byPhase: PhaseBreakdown[];
  upcomingHandovers: UpcomingHandover[];
  procurementAlerts: ProcurementAlert[];
  atRisk: ProjectSummary[];
  statusSheet: ProjectSummary[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  error?: string;
  /** Field-level messages keyed by dotted path, present on 422 validation errors. */
  details?: Record<string, string[]>;
  requestId?: string;
}
