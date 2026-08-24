import { Prisma } from '@prisma/client';
import type {
  Category as PrismaCategory,
  DesignFile as PrismaDesignFile,
  Material as PrismaMaterial,
  Phase as PrismaPhase,
  Project as PrismaProject,
  User as PrismaUser,
  WorkItem as PrismaWorkItem,
} from '@prisma/client';
import {
  blockingMaterialsFor,
  computeMaterialSchedule,
  designSlippageDays,
  diffDays,
  evaluateExecutionGate,
  isDesignOverdue,
  todayUtc,
  computeProjectMetrics,
  computeSlippage,
  DEFAULT_SETTINGS,
  isMaterialBlocking,
  toIsoDate,
  type ActivityStatus,
  type DesignFile,
  type Material,
  type MaterialLink,
  type MaterialStatus,
  type OrganisationSettings,
  type PhaseProgress,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectSummary,
  type WorkItem,
  type WorkItemRef,
} from '@ciq/shared';
import { toCategory } from '../categories/categories.service';
import { toPhase } from '../phases/phases.service';
import { toUserSummary } from '../users/user.mapper';

/**
 * Row-to-wire projection for a project and its three sections.
 *
 * Every derived number — order-by urgency, slippage, design and execution
 * progress, material gating, risk — is computed here by `@ciq/shared`, using the
 * organisation's own settings. The database stores facts; the interpretation of
 * those facts lives in exactly one place.
 */

export type DesignFileWithRelations = PrismaDesignFile & { completedBy?: PrismaUser | null };

export type MaterialWithRelations = PrismaMaterial & {
  phase: PrismaPhase;
  workItem?: (PrismaWorkItem & { phase: PrismaPhase }) | null;
};

export type WorkItemWithRelations = PrismaWorkItem & {
  phase: PrismaPhase;
  designedBy?: PrismaUser | null;
  assignee?: PrismaUser | null;
};

export type ProjectWithRelations = PrismaProject & {
  category: PrismaCategory & { _count?: { projects: number } };
  manager: PrismaUser | null;
  designFiles: DesignFileWithRelations[];
  workItems: WorkItemWithRelations[];
  materials: MaterialWithRelations[];
  members?: { userId: string; projectRole: string | null; addedAt: Date; user: PrismaUser }[];
};

/** Attachment counts keyed by entity id, fetched in one grouped query. */
export type AttachmentCounts = Map<string, number>;

// ---------------------------------------------------------------------------
// Design files
// ---------------------------------------------------------------------------

export function toDesignFile(
  row: DesignFileWithRelations,
  attachments: AttachmentCounts = new Map(),
  now: Date = todayUtc(),
): DesignFile {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    isComplete: row.isComplete,
    position: row.position,
    expectedDate: toIsoDate(row.expectedDate),
    completedDate: toIsoDate(row.completedDate),
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy ? toUserSummary(row.completedBy) : null,
    attachmentCount: attachments.get(row.id) ?? 0,
    updatedAt: row.updatedAt.toISOString(),
    daysUntilExpected: row.expectedDate ? diffDays(now, row.expectedDate) : null,
    isOverdue: isDesignOverdue(row.expectedDate, row.isComplete, now),
    daysLate: designSlippageDays(row.expectedDate, row.completedDate),
  };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export function toMaterial(
  row: MaterialWithRelations,
  settings: OrganisationSettings = DEFAULT_SETTINGS,
  attachments: AttachmentCounts = new Map(),
  now?: Date,
): Material {
  const schedule = computeMaterialSchedule(
    { status: row.status as MaterialStatus, orderByDate: row.orderByDate },
    settings,
    now,
  );

  const linkedWorkItem: WorkItemRef | null = row.workItem
    ? {
        id: row.workItem.id,
        name: row.workItem.name,
        phase: toPhase(row.workItem.phase),
        executionStatus: row.workItem.executionStatus as ActivityStatus,
      }
    : null;

  return {
    id: row.id,
    projectId: row.projectId,
    phase: toPhase(row.phase),
    name: row.name,
    orderByDate: toIsoDate(row.orderByDate),
    leadTimeWeeks: row.leadTimeWeeks,
    status: row.status as MaterialStatus,
    supplier: row.supplier,
    poNumber: row.poNumber,
    orderedAt: toIsoDate(row.orderedAt),
    deliveredAt: toIsoDate(row.deliveredAt),
    notes: row.notes,
    position: row.position,
    attachmentCount: attachments.get(row.id) ?? 0,
    updatedAt: row.updatedAt.toISOString(),
    linkedWorkItem,
    daysUntilOrderBy: schedule.daysUntilOrderBy,
    procurementState: schedule.procurementState,
    isBlocking: isMaterialBlocking({
      status: row.status as MaterialStatus,
      orderByDate: row.orderByDate,
      workItemId: row.workItemId,
    }),
  };
}

/** Compact form embedded on a work item so the UI can name what it is waiting on. */
function toMaterialLink(
  row: PrismaMaterial,
  settings: OrganisationSettings,
  now?: Date,
): MaterialLink {
  const schedule = computeMaterialSchedule(
    { status: row.status as MaterialStatus, orderByDate: row.orderByDate },
    settings,
    now,
  );
  return {
    id: row.id,
    name: row.name,
    status: row.status as MaterialStatus,
    orderByDate: toIsoDate(row.orderByDate),
    procurementState: schedule.procurementState,
  };
}

// ---------------------------------------------------------------------------
// Work items — the rows shared by Design and Execution
// ---------------------------------------------------------------------------

export function toWorkItem(
  row: WorkItemWithRelations,
  /** All the project's materials, so gating resolves without an extra query. */
  materials: PrismaMaterial[] = [],
  settings: OrganisationSettings = DEFAULT_SETTINGS,
  attachments: AttachmentCounts = new Map(),
  now: Date = todayUtc(),
): WorkItem {
  const linked = materials.filter((m) => m.workItemId === row.id);
  const blocking = blockingMaterialsFor(
    row.id,
    linked.map((m) => ({
      id: m.id,
      status: m.status as MaterialStatus,
      orderByDate: m.orderByDate,
      workItemId: m.workItemId,
    })),
  );
  const blockingIds = new Set(blocking.map((m) => m.id));

  return {
    id: row.id,
    projectId: row.projectId,
    phase: toPhase(row.phase),
    name: row.name,
    position: row.position,
    notes: row.notes,
    attachmentCount: attachments.get(row.id) ?? 0,
    updatedAt: row.updatedAt.toISOString(),

    designComplete: row.designComplete,
    designExpectedDate: toIsoDate(row.designExpectedDate),
    designCompletedDate: toIsoDate(row.designCompletedDate),
    designCompletedAt: row.designCompletedAt?.toISOString() ?? null,
    designCompletedBy: row.designedBy ? toUserSummary(row.designedBy) : null,
    designOverdue: isDesignOverdue(row.designExpectedDate, row.designComplete, now),

    executionStatus: row.executionStatus as ActivityStatus,
    plannedStart: toIsoDate(row.plannedStart),
    plannedEnd: toIsoDate(row.plannedEnd),
    actualStart: toIsoDate(row.actualStart),
    actualEnd: toIsoDate(row.actualEnd),
    assignee: row.assignee ? toUserSummary(row.assignee) : null,
    slippage: computeSlippage(
      {
        designComplete: row.designComplete,
        executionStatus: row.executionStatus as ActivityStatus,
        plannedEnd: row.plannedEnd,
        actualEnd: row.actualEnd,
      },
      now,
    ),

    linkedMaterials: linked.map((m) => toMaterialLink(m, settings, now)),
    blockingMaterials: linked
      .filter((m) => blockingIds.has(m.id))
      .map((m) => toMaterialLink(m, settings, now)),

    // Sent from the server so the interface disables exactly the transitions the
    // API would refuse, rather than guessing at the rule a second time.
    gate: (() => {
      const result = evaluateExecutionGate(
        {
          id: row.id,
          designComplete: row.designComplete,
          executionStatus: row.executionStatus as ActivityStatus,
          plannedEnd: row.plannedEnd,
          actualEnd: row.actualEnd,
        },
        linked.map((m) => ({
          id: m.id,
          status: m.status as MaterialStatus,
          orderByDate: m.orderByDate,
          workItemId: m.workItemId,
        })),
      );
      const pendingIds = new Set(result.pendingMaterialIds);
      return {
        canStart: result.canStart,
        canComplete: result.canComplete,
        designPending: result.designPending,
        pendingMaterials: linked
          .filter((m) => pendingIds.has(m.id))
          .map((m) => toMaterialLink(m, settings, now)),
        reasons: result.reasons,
      };
    })(),
  };
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export function toProjectSummary(
  row: ProjectWithRelations,
  settings: OrganisationSettings = DEFAULT_SETTINGS,
  now?: Date,
): ProjectSummary {
  const metrics = computeProjectMetrics(
    {
      status: row.status as ProjectStatus,
      handoverDate: row.handoverDate,
      designFiles: row.designFiles.map((f) => ({
        isComplete: f.isComplete,
        expectedDate: f.expectedDate,
      })),
      workItems: row.workItems.map((w) => ({
        id: w.id,
        designComplete: w.designComplete,
        designExpectedDate: w.designExpectedDate,
        executionStatus: w.executionStatus as ActivityStatus,
        plannedEnd: w.plannedEnd,
        actualEnd: w.actualEnd,
      })),
      materials: row.materials.map((m) => ({
        id: m.id,
        status: m.status as MaterialStatus,
        orderByDate: m.orderByDate,
        workItemId: m.workItemId,
      })),
    },
    settings,
    now,
  );

  return {
    id: row.id,
    name: row.name,
    code: row.code,
    consultant: row.consultant,
    vendor: row.vendor,
    status: row.status as ProjectStatus,
    handoverDate: toIsoDate(row.handoverDate),
    category: toCategory(row.category),
    manager: row.manager ? toUserSummary(row.manager) : null,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metrics,
  };
}

/**
 * Per-phase rollup derived from whichever phases this project's rows actually
 * reference — not from a fixed list. A project using two of the organisation's
 * six phases reports on two.
 */
export function buildPhaseProgress(
  row: ProjectWithRelations,
  settings: OrganisationSettings = DEFAULT_SETTINGS,
  now?: Date,
): PhaseProgress[] {
  const phases = new Map<string, PrismaPhase>();
  for (const item of [...row.workItems, ...row.materials]) {
    if (!phases.has(item.phase.id)) phases.set(item.phase.id, item.phase);
  }

  const materialsForGating = row.materials.map((m) => ({
    id: m.id,
    status: m.status as MaterialStatus,
    orderByDate: m.orderByDate,
    workItemId: m.workItemId,
  }));

  return [...phases.values()]
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .map((phase) => {
      const workItems = row.workItems.filter((w) => w.phaseId === phase.id);
      const materials = row.materials.filter((m) => m.phaseId === phase.id);

      const designComplete = workItems.filter((w) => w.designComplete).length;
      const executionScore = workItems.reduce(
        (sum, w) =>
          sum + (settings.activityStatusWeights[w.executionStatus as ActivityStatus] ?? 0),
        0,
      );
      const executionDelayed = workItems.filter((w) => isSlippingRow(w, now)).length;
      const executionBlocked = workItems.filter(
        (w) =>
          w.executionStatus !== 'DONE' && blockingMaterialsFor(w.id, materialsForGating).length > 0,
      ).length;

      const outstanding = materials.filter((m) => {
        const { procurementState } = computeMaterialSchedule(
          { status: m.status as MaterialStatus, orderByDate: m.orderByDate },
          settings,
          now,
        );
        return (
          procurementState === 'OVERDUE' ||
          procurementState === 'DUE_SOON' ||
          procurementState === 'SCHEDULED'
        );
      }).length;

      return {
        phase: toPhase(phase),
        workItemsTotal: workItems.length,
        designComplete,
        designPct: workItems.length > 0 ? Math.round((designComplete / workItems.length) * 100) : 0,
        executionPct: workItems.length > 0 ? Math.round(executionScore / workItems.length) : 0,
        executionDelayed,
        executionBlocked,
        materialsTotal: materials.length,
        materialsOutstanding: outstanding,
      };
    });
}

function isSlippingRow(row: PrismaWorkItem, now?: Date): boolean {
  const slippage = computeSlippage(
    {
      designComplete: row.designComplete,
      executionStatus: row.executionStatus as ActivityStatus,
      plannedEnd: row.plannedEnd,
      actualEnd: row.actualEnd,
    },
    now,
  );
  return slippage !== null && (slippage.state === 'LATE' || slippage.state === 'OVERDUE');
}

export function toProjectDetail(
  row: ProjectWithRelations,
  settings: OrganisationSettings = DEFAULT_SETTINGS,
  attachments: AttachmentCounts = new Map(),
  now?: Date,
): ProjectDetail {
  return {
    ...toProjectSummary(row, settings, now),
    description: row.description,
    siteAddress: row.siteAddress,
    // Decimal is a bignum object; the wire contract is a plain number.
    budgetAmount: row.budgetAmount ? Number(row.budgetAmount) : null,
    currency: row.currency,
    designFiles: row.designFiles.map((f) => toDesignFile(f, attachments)),
    workItems: row.workItems.map((w) => toWorkItem(w, row.materials, settings, attachments, now)),
    materials: row.materials.map((m) => toMaterial(m, settings, attachments, now)),
    members: (row.members ?? []).map((m) => ({
      userId: m.userId,
      user: toUserSummary(m.user),
      projectRole: m.projectRole,
      addedAt: m.addedAt.toISOString(),
    })),
    phases: buildPhaseProgress(row, settings, now),
  };
}

/**
 * Relations every project query must load for metrics to be computable.
 *
 * Materials are always loaded alongside work items because gating cannot be
 * resolved without them — a work item does not know what it is waiting on.
 */
export const PROJECT_INCLUDE = {
  category: true,
  manager: true,
  designFiles: { orderBy: { position: 'asc' } },
  workItems: {
    include: { phase: true, assignee: true },
    orderBy: [{ phase: { position: 'asc' } }, { position: 'asc' }],
  },
  materials: {
    include: { phase: true, workItem: { include: { phase: true } } },
    orderBy: [{ phase: { position: 'asc' } }, { position: 'asc' }],
  },
} satisfies Prisma.ProjectInclude;

export const PROJECT_DETAIL_INCLUDE = {
  ...PROJECT_INCLUDE,
  designFiles: { include: { completedBy: true }, orderBy: { position: 'asc' } },
  workItems: {
    include: { phase: true, assignee: true, designedBy: true },
    orderBy: [{ phase: { position: 'asc' } }, { position: 'asc' }],
  },
  members: { include: { user: true }, orderBy: { addedAt: 'asc' } },
} satisfies Prisma.ProjectInclude;
