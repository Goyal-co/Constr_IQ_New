/**
 * Domain calculations.
 *
 * Pure and dependency-free so the identical function runs against a database row
 * on the server and a cached DTO in the browser.
 *
 * Every threshold, window and weight is a parameter sourced from
 * `OrganisationSettings`. There is no tuning literal anywhere in this file — if a
 * business wants "due soon" to mean ten days instead of twenty-one, that is a row
 * in the settings table, not an edit here.
 */

import type { ActivityStatus, MaterialStatus, ProcurementState, ProjectStatus } from './constants';
import { addDays, addWeeks, diffDays, parseIsoDate, todayUtc, toIsoDate } from './dates';
import { DEFAULT_SETTINGS, type OrganisationSettings } from './settings';
import type { PortfolioKpis, ProjectMetrics, Slippage, UpcomingHandover } from './types';

// ---------------------------------------------------------------------------
// Minimal structural inputs — satisfied by both database rows and wire DTOs
// ---------------------------------------------------------------------------

export interface MaterialLike {
  id?: string;
  status: MaterialStatus;
  /** The stored order-by date. Entered directly by whoever raises the material. */
  orderByDate: string | Date | null;
  /** Optional convenience input used to calculate `orderByDate` back from handover. */
  leadTimeWeeks?: number | null;
  /** The work item this material gates, if any. */
  workItemId?: string | null;
}

export interface WorkItemLike {
  id?: string;
  designComplete: boolean;
  designExpectedDate?: string | Date | null;
  executionStatus: ActivityStatus;
  plannedEnd: string | Date | null;
  actualEnd: string | Date | null;
}

export interface DesignFileLike {
  isComplete: boolean;
  expectedDate?: string | Date | null;
}

/** A phase as the caller knows it — identity and presentation come from the database. */
export interface PhaseRef {
  id: string;
  name: string;
  colour: string;
  position: number;
}

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  return parseIsoDate(value);
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// ---------------------------------------------------------------------------
// Procurement
// ---------------------------------------------------------------------------

/**
 * Suggest an order-by date from a supplier lead time.
 *
 * A convenience only. The stored `orderByDate` is the source of truth — this
 * exists so the material form can offer "calculate from handover" rather than
 * making a buyer do the arithmetic.
 */
export function suggestOrderByDate(
  handover: Date | null,
  leadTimeWeeks: number | null | undefined,
): Date | null {
  if (!handover || leadTimeWeeks == null) return null;
  return addWeeks(handover, -Math.max(0, leadTimeWeeks));
}

export interface MaterialSchedule {
  orderByDate: string | null;
  daysUntilOrderBy: number | null;
  procurementState: ProcurementState;
}

/**
 * Work out how urgent a material order is right now.
 *
 * Cancelled and delivered items short-circuit: an item already on site cannot be
 * "overdue to order", and surfacing it as such is how a procurement dashboard
 * loses the trust of the people who use it.
 */
export function computeMaterialSchedule(
  material: MaterialLike,
  settings: OrganisationSettings = DEFAULT_SETTINGS,
  now: Date = todayUtc(),
): MaterialSchedule {
  const orderBy = asDate(material.orderByDate);
  const daysUntil = orderBy ? diffDays(now, orderBy) : null;

  let state: ProcurementState;
  if (material.status === 'CANCELLED') state = 'CANCELLED';
  else if (material.status === 'DELIVERED') state = 'DELIVERED';
  else if (material.status === 'ORDERED') state = 'ORDERED';
  else if (daysUntil === null) state = 'SCHEDULED';
  else if (daysUntil < 0) state = 'OVERDUE';
  else if (daysUntil <= settings.orderSoonWindowDays) state = 'DUE_SOON';
  else state = 'SCHEDULED';

  return {
    orderByDate: toIsoDate(orderBy),
    daysUntilOrderBy: daysUntil,
    procurementState: state,
  };
}

/** Procurement states that represent an unmet ordering obligation. */
export function isOrderOutstanding(state: ProcurementState): boolean {
  return state === 'OVERDUE' || state === 'DUE_SOON' || state === 'SCHEDULED';
}

/**
 * Whether a material still gates the work item it is linked to.
 *
 * Delivered means the material is on site, so the work can proceed. Cancelled
 * means it was dropped from scope and must stop blocking — otherwise removing a
 * line item would permanently freeze the activity it was attached to.
 *
 * Everything else — pending, ordered but not arrived — blocks. Ordered is not
 * enough: a purchase order is a promise, not a delivery, and you cannot lay
 * tiles that are still on a lorry.
 */
export function isMaterialBlocking(material: MaterialLike): boolean {
  if (!material.workItemId) return false;
  return material.status !== 'DELIVERED' && material.status !== 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Execution slippage and gating
// ---------------------------------------------------------------------------

/**
 * Compare a work item's execution against its own plan.
 *
 * Three cases matter: finished work is judged on actual against planned;
 * unfinished work with a plan in the past is accruing delay right now; anything
 * else has no meaningful verdict yet and returns null rather than a misleading
 * zero. No fixed programme is consulted — only the dates on the item itself.
 */
export function computeSlippage(item: WorkItemLike, now: Date = todayUtc()): Slippage | null {
  const planned = asDate(item.plannedEnd);
  const actual = asDate(item.actualEnd);
  if (!planned) return null;

  if (actual) {
    const days = diffDays(planned, actual);
    if (days > 0) return { state: 'LATE', days };
    if (days === 0) return { state: 'ON_TIME', days: 0 };
    return { state: 'EARLY', days };
  }

  if (item.executionStatus === 'DONE') return null;

  const days = diffDays(planned, now);
  if (days > 0) return { state: 'OVERDUE', days };
  return { state: 'PENDING', days };
}

export function isSlipping(slippage: Slippage | null): boolean {
  return slippage !== null && (slippage.state === 'LATE' || slippage.state === 'OVERDUE');
}

/**
 * The materials currently stopping a work item from being completed.
 *
 * Returns the offending materials rather than a boolean so the interface can name
 * them: "waiting on Floor tiles" is actionable where a disabled control is not.
 */
export function blockingMaterialsFor<T extends MaterialLike>(
  workItemId: string,
  materials: T[],
): T[] {
  return materials.filter((m) => m.workItemId === workItemId && isMaterialBlocking(m));
}

export function isWorkItemBlocked(workItemId: string, materials: MaterialLike[]): boolean {
  return blockingMaterialsFor(workItemId, materials).length > 0;
}

export interface ExecutionGateResult {
  canStart: boolean;
  canComplete: boolean;
  designPending: boolean;
  pendingMaterialIds: string[];
  reasons: string[];
}

/**
 * Whether site work on an item may progress.
 *
 * Two preconditions, both of which have to hold before the build can start *or*
 * finish:
 *
 *   1. the design has been issued — you do not build from a drawing that does
 *      not exist yet; and
 *   2. every material linked to the item has been delivered — a purchase order
 *      is a promise, not a pallet on site.
 *
 * Deliberately gates starting as well as completing. Letting a crew mark work
 * "in progress" against an unissued drawing records activity that cannot have
 * happened, and the programme then reports progress the site does not have.
 *
 * Blocked and Not started stay reachable regardless: flagging a problem must
 * never itself be blocked, and reverting is how a mistake gets undone.
 */
export function evaluateExecutionGate(
  item: WorkItemLike,
  materials: MaterialLike[] = [],
): ExecutionGateResult {
  const pending = item.id ? blockingMaterialsFor(item.id, materials) : [];
  const designPending = !item.designComplete;

  const reasons: string[] = [];
  if (designPending) reasons.push('its design has not been issued');
  if (pending.length > 0) {
    reasons.push(
      `${pending.length} linked material${pending.length === 1 ? ' has' : 's have'} not been delivered`,
    );
  }

  const clear = reasons.length === 0;
  return {
    canStart: clear,
    canComplete: clear,
    designPending,
    pendingMaterialIds: pending.map((m) => m.id).filter((id): id is string => Boolean(id)),
    reasons,
  };
}

/** Statuses that represent site progress, and are therefore gated. */
export function isProgressStatus(status: ActivityStatus): boolean {
  return status === 'IN_PROGRESS' || status === 'DONE';
}

/**
 * Whether a dated design item is outstanding past when it was due.
 *
 * Only unissued work counts: a drawing issued two days late is a slippage fact
 * recorded on the row, not a live problem demanding attention today.
 */
export function isDesignOverdue(
  expected: string | Date | null | undefined,
  isComplete: boolean,
  now: Date = todayUtc(),
): boolean {
  if (isComplete) return false;
  const date = asDate(expected ?? null);
  return date !== null && diffDays(now, date) < 0;
}

/** Days between an expected and an actual issue date. Positive means late. */
export function designSlippageDays(
  expected: string | Date | null | undefined,
  completed: string | Date | null | undefined,
): number | null {
  const from = asDate(expected ?? null);
  const to = asDate(completed ?? null);
  if (!from || !to) return null;
  return diffDays(from, to);
}

// ---------------------------------------------------------------------------
// Project rollup
// ---------------------------------------------------------------------------

export interface ProjectMetricsInput {
  status: ProjectStatus;
  handoverDate: string | Date | null;
  designFiles: DesignFileLike[];
  workItems: WorkItemLike[];
  materials: MaterialLike[];
}

export function computeProjectMetrics(
  input: ProjectMetricsInput,
  settings: OrganisationSettings = DEFAULT_SETTINGS,
  now: Date = todayUtc(),
): ProjectMetrics {
  const handover = asDate(input.handoverDate);

  const designFilesTotal = input.designFiles.length;
  const designFilesComplete = input.designFiles.filter((f) => f.isComplete).length;

  const designOverdue =
    input.designFiles.filter((f) => isDesignOverdue(f.expectedDate, f.isComplete, now)).length +
    input.workItems.filter((w) => isDesignOverdue(w.designExpectedDate, w.designComplete, now))
      .length;

  const workItemsTotal = input.workItems.length;
  const workItemsDesigned = input.workItems.filter((w) => w.designComplete).length;

  // Design progress spans both sub-sections: the document set and the design
  // track of every work item. Reporting only one of them would let a project
  // read as fully designed with half its scope untouched.
  const designTotal = designFilesTotal + workItemsTotal;
  const designComplete = designFilesComplete + workItemsDesigned;

  const executionScore = input.workItems.reduce(
    (sum, item) => sum + (settings.activityStatusWeights[item.executionStatus] ?? 0),
    0,
  );
  const executionPct = workItemsTotal > 0 ? Math.round(executionScore / workItemsTotal) : 0;
  const executionDelayed = input.workItems.filter((item) =>
    isSlipping(computeSlippage(item, now)),
  ).length;

  const executionBlocked = input.workItems.filter(
    (item) =>
      item.executionStatus !== 'DONE' &&
      item.id !== undefined &&
      isWorkItemBlocked(item.id, input.materials),
  ).length;

  let materialsOrdered = 0;
  let materialsOverdue = 0;
  let materialsDueSoon = 0;
  for (const material of input.materials) {
    const { procurementState } = computeMaterialSchedule(material, settings, now);
    if (procurementState === 'ORDERED' || procurementState === 'DELIVERED') materialsOrdered += 1;
    else if (procurementState === 'OVERDUE') materialsOverdue += 1;
    else if (procurementState === 'DUE_SOON') materialsDueSoon += 1;
  }

  const daysToHandover = handover ? diffDays(now, handover) : null;
  const designPct = pct(designComplete, designTotal);

  const riskReasons: string[] = [];
  if (input.status !== 'COMPLETED') {
    if (settings.riskOnOverdueOrder && materialsOverdue > 0) {
      riskReasons.push(
        `${materialsOverdue} material order${materialsOverdue === 1 ? '' : 's'} past the order-by date`,
      );
    }
    if (executionBlocked > 0) {
      riskReasons.push(
        `${executionBlocked} work item${executionBlocked === 1 ? '' : 's'} blocked waiting on materials`,
      );
    }
    if (designOverdue > 0) {
      riskReasons.push(
        `${designOverdue} design item${designOverdue === 1 ? ' is past its' : 's are past their'} expected date`,
      );
    }
    if (
      daysToHandover !== null &&
      daysToHandover >= 0 &&
      daysToHandover < settings.riskHandoverWindowDays &&
      designPct < settings.riskDrawingThresholdPct
    ) {
      riskReasons.push(
        `design only ${designPct}% complete with ${daysToHandover} days to handover`,
      );
    }
    if (daysToHandover !== null && daysToHandover < 0) {
      riskReasons.push(`handover date passed ${Math.abs(daysToHandover)} days ago`);
    }
    if (settings.riskOnSlippedActivity && executionDelayed > 0) {
      riskReasons.push(
        `${executionDelayed} work item${executionDelayed === 1 ? ' is' : 's are'} behind plan`,
      );
    }
  }

  return {
    designFilesTotal,
    designFilesComplete,
    designOverdue,
    designTotal,
    designComplete,
    designPct,
    workItemsTotal,
    executionPct,
    executionDelayed,
    executionBlocked,
    materialsTotal: input.materials.length,
    materialsOrdered,
    materialsOverdue,
    materialsDueSoon,
    daysToHandover,
    atRisk: riskReasons.length > 0,
    riskReasons,
  };
}

// ---------------------------------------------------------------------------
// Programme chart, built from the project's own work items
// ---------------------------------------------------------------------------

export interface ProgrammeActivityInput {
  id: string;
  name: string;
  phase: PhaseRef;
  executionStatus: ActivityStatus;
  plannedStart: string | Date | null;
  plannedEnd: string | Date | null;
  actualStart: string | Date | null;
  actualEnd: string | Date | null;
  /** Drawn as a marker so a blocked bar is visibly waiting on something. */
  isBlocked?: boolean;
}

export interface ProgrammeBar {
  id: string;
  name: string;
  phase: PhaseRef;
  executionStatus: ActivityStatus;
  isBlocked: boolean;
  planned: { start: Date; end: Date; offsetPct: number; widthPct: number } | null;
  actual: { start: Date; end: Date; offsetPct: number; widthPct: number } | null;
  slippage: Slippage | null;
}

export interface ProgrammeTick {
  date: Date;
  offsetPct: number;
}

export interface ProgrammeChart {
  windowStart: Date;
  windowEnd: Date;
  totalDays: number;
  bars: ProgrammeBar[];
  ticks: ProgrammeTick[];
  /** Position of today within the window, or null when today falls outside it. */
  todayPct: number | null;
  /** Position of the handover date, or null when unset or outside the window. */
  handoverPct: number | null;
  /** Work items excluded because they carry no dates at all. */
  undatedCount: number;
}

/**
 * Build the timeline from real data.
 *
 * The window is fitted to the dates that actually exist on the project — earliest
 * planned or actual start through latest end, widened to include handover — so a
 * two-week snagging job and an eighteen-month tower both render sensibly. There
 * is no fixed programme length and no assumed sequence of trades.
 *
 * Returns null when nothing is dated, which the UI turns into a prompt to set
 * dates rather than an empty chart that looks broken.
 */
export function buildProgrammeChart(
  items: ProgrammeActivityInput[],
  handover: Date | null = null,
  now: Date = todayUtc(),
): ProgrammeChart | null {
  const dated = items.filter((a) => a.plannedStart || a.plannedEnd || a.actualStart || a.actualEnd);
  if (dated.length === 0) return null;

  const points: Date[] = [];
  for (const item of dated) {
    for (const value of [item.plannedStart, item.plannedEnd, item.actualStart, item.actualEnd]) {
      const date = asDate(value);
      if (date) points.push(date);
    }
  }
  if (handover) points.push(handover);
  if (points.length === 0) return null;

  let windowStart = new Date(Math.min(...points.map((d) => d.getTime())));
  let windowEnd = new Date(Math.max(...points.map((d) => d.getTime())));

  // A single-day span would divide by zero; give it a week of breathing room.
  if (windowEnd.getTime() <= windowStart.getTime()) {
    windowEnd = addDays(windowStart, 7);
  }

  // Pad the window by 4% each side so bars never sit flush against the frame.
  const rawSpan = diffDays(windowStart, windowEnd);
  const padding = Math.max(1, Math.round(rawSpan * 0.04));
  windowStart = addDays(windowStart, -padding);
  windowEnd = addDays(windowEnd, padding);

  const totalDays = diffDays(windowStart, windowEnd);
  const position = (d: Date) =>
    ((d.getTime() - windowStart.getTime()) / (totalDays * 86_400_000)) * 100;

  const span = (start: Date | null, end: Date | null) => {
    if (!start && !end) return null;
    const from = start ?? end!;
    const to = end ?? start!;
    const offsetPct = position(from);
    return {
      start: from,
      end: to,
      offsetPct,
      // Minimum width keeps a same-day milestone visible rather than invisible.
      widthPct: Math.max(position(to) - offsetPct, 0.6),
    };
  };

  const bars: ProgrammeBar[] = dated.map((item) => {
    const plannedStart = asDate(item.plannedStart);
    const plannedEnd = asDate(item.plannedEnd);
    const actualStart = asDate(item.actualStart);
    const actualEnd = asDate(item.actualEnd);

    // Work that has started but not finished is drawn running to today, which is
    // what makes an overrun visible on the chart rather than only in a column.
    const actualClose =
      actualEnd ?? (actualStart && item.executionStatus !== 'NOT_STARTED' ? now : null);

    return {
      id: item.id,
      name: item.name,
      phase: item.phase,
      executionStatus: item.executionStatus,
      isBlocked: item.isBlocked ?? false,
      planned: span(plannedStart, plannedEnd),
      actual: span(actualStart, actualClose),
      slippage: computeSlippage(
        {
          designComplete: true,
          executionStatus: item.executionStatus,
          plannedEnd: item.plannedEnd,
          actualEnd: item.actualEnd,
        },
        now,
      ),
    };
  });

  bars.sort((a, b) => {
    const phaseDelta = a.phase.position - b.phase.position;
    if (phaseDelta !== 0) return phaseDelta;
    const aStart = a.planned?.start ?? a.actual?.start;
    const bStart = b.planned?.start ?? b.actual?.start;
    if (aStart && bStart) return aStart.getTime() - bStart.getTime();
    return a.name.localeCompare(b.name);
  });

  return {
    windowStart,
    windowEnd,
    totalDays,
    bars,
    ticks: buildTicks(windowStart, windowEnd, totalDays, position),
    todayPct: now >= windowStart && now <= windowEnd ? position(now) : null,
    handoverPct:
      handover && handover >= windowStart && handover <= windowEnd ? position(handover) : null,
    undatedCount: items.length - dated.length,
  };
}

/**
 * Choose an axis interval that yields roughly 5–10 labels whatever the span,
 * so a three-week programme gets weekly ticks and a two-year one gets quarterly.
 */
function buildTicks(
  windowStart: Date,
  windowEnd: Date,
  totalDays: number,
  position: (d: Date) => number,
): ProgrammeTick[] {
  const candidates = [1, 2, 7, 14, 28, 56, 91, 182, 365];
  const targetCount = 8;
  const interval =
    candidates.find((days) => totalDays / days <= targetCount) ?? candidates[candidates.length - 1];

  const ticks: ProgrammeTick[] = [];
  for (let day = 0; day <= totalDays; day += interval) {
    const date = addDays(windowStart, day);
    if (date > windowEnd) break;
    ticks.push({ date, offsetPct: position(date) });
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Portfolio narrative
// ---------------------------------------------------------------------------

/**
 * The prose paragraph at the top of the management report.
 *
 * Every figure is interpolated from the KPI object — nothing is asserted that the
 * data does not support. Written as a template rather than a generated summary
 * because management reads this weekly and needs the numbers reproducible.
 */
export function buildExecutiveSummary(
  kpis: PortfolioKpis,
  upcoming: UpcomingHandover[],
  generatedAt: Date = todayUtc(),
  locale = 'en-GB',
): string {
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const date = generatedAt.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  if (kpis.totalProjects === 0) {
    return `As of ${date}, no projects have been added to the portfolio yet.`;
  }

  const parts: string[] = [
    `As of ${date}, the portfolio holds ${kpis.totalProjects} ${plural(kpis.totalProjects, 'project', 'projects')} — ` +
      `${kpis.activeProjects} active and ${kpis.completedProjects} completed.`,
  ];

  if (kpis.designTotal > 0 || kpis.workItemsTotal > 0) {
    const measures: string[] = [];
    if (kpis.designTotal > 0) {
      measures.push(
        `design is ${kpis.designPct}% complete (${kpis.designComplete} of ${kpis.designTotal})`,
      );
    }
    if (kpis.workItemsTotal > 0) {
      measures.push(`site execution stands at ${kpis.executionPct}%`);
    }
    parts.push(`Across all projects, ${measures.join(' and ')}.`);
  }

  if (kpis.materialsTotal > 0) {
    if (kpis.ordersOverdue > 0) {
      parts.push(
        `${kpis.ordersOverdue} material ${plural(kpis.ordersOverdue, 'order is', 'orders are')} past the recommended ` +
          `order-by date and ${plural(kpis.ordersOverdue, 'needs', 'need')} immediate action.`,
      );
    } else if (kpis.ordersDueSoon > 0) {
      parts.push(
        `All orders are within their lead-time window, though ${kpis.ordersDueSoon} ${plural(kpis.ordersDueSoon, 'falls', 'fall')} due shortly.`,
      );
    } else {
      parts.push('All material orders are on schedule.');
    }
  }

  if (kpis.executionBlocked > 0) {
    parts.push(
      `${kpis.executionBlocked} work ${plural(kpis.executionBlocked, 'item is', 'items are')} blocked waiting on materials.`,
    );
  }

  if (kpis.executionDelayed > 0) {
    parts.push(
      `${kpis.executionDelayed} work ${plural(kpis.executionDelayed, 'item is', 'items are')} behind plan.`,
    );
  }

  if (kpis.projectsAtRisk > 0) {
    parts.push(
      `${kpis.projectsAtRisk} ${plural(kpis.projectsAtRisk, 'project is', 'projects are')} flagged at risk.`,
    );
  }

  const next = upcoming[0];
  if (next) {
    parts.push(
      next.daysRemaining >= 0
        ? `Nearest handover: ${next.projectName} in ${next.daysRemaining} ${plural(next.daysRemaining, 'day', 'days')}.`
        : `${next.projectName} is ${Math.abs(next.daysRemaining)} days past its handover date.`,
    );
  }

  return parts.join(' ');
}
