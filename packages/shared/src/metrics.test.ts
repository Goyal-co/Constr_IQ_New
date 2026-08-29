import { describe, expect, it } from 'vitest';
import { parseIsoDate, parseLegacyHandover, toIsoDate } from './dates';
import {
  blockingMaterialsFor,
  buildExecutiveSummary,
  buildProgrammeChart,
  computeMaterialSchedule,
  computeProjectMetrics,
  computeSlippage,
  designSlippageDays,
  evaluateExecutionGate,
  isDesignOverdue,
  isProgressStatus,
  isMaterialBlocking,
  isWorkItemBlocked,
  suggestOrderByDate,
  type MaterialLike,
  type PhaseRef,
  type ProgrammeActivityInput,
} from './metrics';
import { DEFAULT_SETTINGS, withSettingDefaults, type OrganisationSettings } from './settings';
import type { PortfolioKpis } from './types';

const D = (iso: string) => parseIsoDate(iso)!;
const TODAY = D('2026-03-01');
const HANDOVER = D('2026-06-30');

const settings = (overrides: Partial<OrganisationSettings> = {}) => withSettingDefaults(overrides);

const phase = (name: string, position: number): PhaseRef => ({
  id: `phase-${position}`,
  name,
  colour: '#3b6fe0',
  position,
});

describe('computeMaterialSchedule', () => {
  it('reads urgency from the stored order-by date', () => {
    const result = computeMaterialSchedule(
      { status: 'PENDING', orderByDate: '2026-04-07' },
      settings(),
      TODAY,
    );
    expect(result.orderByDate).toBe('2026-04-07');
    expect(result.daysUntilOrderBy).toBe(37);
    expect(result.procurementState).toBe('SCHEDULED');
  });

  it('flags an order overdue once its date has passed', () => {
    expect(
      computeMaterialSchedule({ status: 'PENDING', orderByDate: '2026-02-01' }, settings(), TODAY)
        .procurementState,
    ).toBe('OVERDUE');
  });

  it('never reports an ordered, delivered or cancelled item as outstanding', () => {
    for (const status of ['ORDERED', 'DELIVERED', 'CANCELLED'] as const) {
      expect(
        computeMaterialSchedule({ status, orderByDate: '2026-01-01' }, settings(), TODAY)
          .procurementState,
      ).toBe(status);
    }
  });

  it('honours the configured warning window rather than any fixed value', () => {
    const material = { status: 'PENDING' as const, orderByDate: '2026-03-10' };
    expect(
      computeMaterialSchedule(material, settings({ orderSoonWindowDays: 21 }), TODAY)
        .procurementState,
    ).toBe('DUE_SOON');
    expect(
      computeMaterialSchedule(material, settings({ orderSoonWindowDays: 5 }), TODAY)
        .procurementState,
    ).toBe('SCHEDULED');
  });

  it('degrades to SCHEDULED when no date has been set', () => {
    const result = computeMaterialSchedule(
      { status: 'PENDING', orderByDate: null },
      settings(),
      TODAY,
    );
    expect(result.orderByDate).toBeNull();
    expect(result.procurementState).toBe('SCHEDULED');
  });
});

describe('suggestOrderByDate', () => {
  it('walks back from handover by the lead time', () => {
    // 12 weeks = 84 days before 30 Jun 2026 is 7 Apr 2026.
    expect(toIsoDate(suggestOrderByDate(HANDOVER, 12))).toBe('2026-04-07');
  });

  it('is null without a handover date or a lead time', () => {
    expect(suggestOrderByDate(null, 12)).toBeNull();
    expect(suggestOrderByDate(HANDOVER, null)).toBeNull();
  });

  it('clamps a negative lead time rather than scheduling past handover', () => {
    expect(toIsoDate(suggestOrderByDate(HANDOVER, -5))).toBe('2026-06-30');
  });
});

// ---------------------------------------------------------------------------
// The material gate — a work item cannot complete while its materials are out
// ---------------------------------------------------------------------------

describe('material gating', () => {
  const tiles = (
    status: MaterialLike['status'],
    workItemId: string | null = 'flooring',
  ): MaterialLike => ({
    id: 'tiles',
    name: undefined as never,
    status,
    orderByDate: '2026-04-01',
    workItemId,
  });

  it('blocks while the order is pending', () => {
    expect(isMaterialBlocking(tiles('PENDING'))).toBe(true);
  });

  it('still blocks once ordered — a purchase order is not a delivery', () => {
    expect(isMaterialBlocking(tiles('ORDERED'))).toBe(true);
  });

  it('stops blocking on delivery', () => {
    expect(isMaterialBlocking(tiles('DELIVERED'))).toBe(false);
  });

  it('stops blocking when cancelled, so dropped scope cannot freeze work', () => {
    expect(isMaterialBlocking(tiles('CANCELLED'))).toBe(false);
  });

  it('never blocks when it is linked to nothing', () => {
    expect(isMaterialBlocking(tiles('PENDING', null))).toBe(false);
  });

  it('names what a work item is waiting on', () => {
    const materials: MaterialLike[] = [
      tiles('PENDING'),
      { id: 'grout', status: 'DELIVERED', orderByDate: '2026-04-01', workItemId: 'flooring' },
      { id: 'paint', status: 'PENDING', orderByDate: '2026-04-01', workItemId: 'painting' },
    ];
    const blocking = blockingMaterialsFor('flooring', materials);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].id).toBe('tiles');
    expect(isWorkItemBlocked('flooring', materials)).toBe(true);
    expect(isWorkItemBlocked('ceiling', materials)).toBe(false);
  });

  it('clears the block once every linked material has arrived', () => {
    const materials: MaterialLike[] = [
      { id: 'tiles', status: 'DELIVERED', orderByDate: '2026-04-01', workItemId: 'flooring' },
      { id: 'grout', status: 'DELIVERED', orderByDate: '2026-04-01', workItemId: 'flooring' },
    ];
    expect(isWorkItemBlocked('flooring', materials)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The execution gate — design issued AND materials delivered
// ---------------------------------------------------------------------------

describe('evaluateExecutionGate', () => {
  const item = (designComplete: boolean) => ({
    id: 'flooring',
    designComplete,
    executionStatus: 'NOT_STARTED' as const,
    plannedEnd: null,
    actualEnd: null,
  });

  const tiles = (status: MaterialLike['status']): MaterialLike => ({
    id: 'tiles',
    status,
    orderByDate: '2026-04-01',
    workItemId: 'flooring',
  });

  it('allows progress once the design is issued and materials have arrived', () => {
    const gate = evaluateExecutionGate(item(true), [tiles('DELIVERED')]);
    expect(gate.canStart).toBe(true);
    expect(gate.canComplete).toBe(true);
    expect(gate.reasons).toHaveLength(0);
  });

  it('blocks BOTH starting and completing while the design is outstanding', () => {
    const gate = evaluateExecutionGate(item(false), [tiles('DELIVERED')]);
    expect(gate.canStart).toBe(false);
    expect(gate.canComplete).toBe(false);
    expect(gate.designPending).toBe(true);
    expect(gate.reasons).toContain('its design has not been issued');
  });

  it('blocks BOTH starting and completing while a material is undelivered', () => {
    const gate = evaluateExecutionGate(item(true), [tiles('ORDERED')]);
    expect(gate.canStart).toBe(false);
    expect(gate.canComplete).toBe(false);
    expect(gate.pendingMaterialIds).toEqual(['tiles']);
    expect(gate.reasons.join(' ')).toContain('not been delivered');
  });

  it('reports both reasons when both preconditions fail', () => {
    const gate = evaluateExecutionGate(item(false), [tiles('PENDING')]);
    expect(gate.reasons).toHaveLength(2);
  });

  it('needs no materials at all when none are linked', () => {
    expect(evaluateExecutionGate(item(true), []).canStart).toBe(true);
  });

  it('ignores materials linked to a different work item', () => {
    const gate = evaluateExecutionGate(item(true), [
      { id: 'paint', status: 'PENDING', orderByDate: null, workItemId: 'painting' },
    ]);
    expect(gate.canStart).toBe(true);
  });

  it('treats a cancelled material as no longer standing in the way', () => {
    expect(evaluateExecutionGate(item(true), [tiles('CANCELLED')]).canStart).toBe(true);
  });
});

describe('isProgressStatus', () => {
  it('gates In progress and Done, but never Blocked or Not started', () => {
    expect(isProgressStatus('IN_PROGRESS')).toBe(true);
    expect(isProgressStatus('DONE')).toBe(true);
    // Flagging a problem must never itself be blocked.
    expect(isProgressStatus('BLOCKED')).toBe(false);
    expect(isProgressStatus('NOT_STARTED')).toBe(false);
  });
});

describe('design dates', () => {
  it('flags an unissued document past its expected date', () => {
    expect(isDesignOverdue('2026-02-01', false, TODAY)).toBe(true);
  });

  it('does not flag one still within its date', () => {
    expect(isDesignOverdue('2026-04-01', false, TODAY)).toBe(false);
  });

  it('never flags something already issued, however late it was', () => {
    expect(isDesignOverdue('2026-01-01', true, TODAY)).toBe(false);
  });

  it('is not overdue when no date was ever set', () => {
    expect(isDesignOverdue(null, false, TODAY)).toBe(false);
  });

  it('measures how late an issue actually was', () => {
    expect(designSlippageDays('2026-02-01', '2026-02-09')).toBe(8);
    expect(designSlippageDays('2026-02-09', '2026-02-01')).toBe(-8);
    expect(designSlippageDays('2026-02-01', null)).toBeNull();
  });
});

describe('computeSlippage', () => {
  const item = (over: Partial<Parameters<typeof computeSlippage>[0]> = {}) => ({
    designComplete: true,
    executionStatus: 'IN_PROGRESS' as const,
    plannedEnd: null,
    actualEnd: null,
    ...over,
  });

  it('reports days late when the work finished after plan', () => {
    expect(
      computeSlippage(
        item({ executionStatus: 'DONE', plannedEnd: '2026-02-20', actualEnd: '2026-02-27' }),
        TODAY,
      ),
    ).toEqual({ state: 'LATE', days: 7 });
  });

  it('reports early finishes as negative days', () => {
    expect(
      computeSlippage(
        item({ executionStatus: 'DONE', plannedEnd: '2026-02-20', actualEnd: '2026-02-15' }),
        TODAY,
      ),
    ).toEqual({ state: 'EARLY', days: -5 });
  });

  it('accrues overdue days for unfinished work past its planned end', () => {
    expect(computeSlippage(item({ plannedEnd: '2026-02-20' }), TODAY)).toEqual({
      state: 'OVERDUE',
      days: 9,
    });
  });

  it('treats future planned work as pending, not late', () => {
    expect(computeSlippage(item({ plannedEnd: '2026-04-01' }), TODAY)?.state).toBe('PENDING');
  });

  it('returns null when there is no plan to judge against', () => {
    expect(computeSlippage(item(), TODAY)).toBeNull();
  });
});

describe('computeProjectMetrics', () => {
  const base = {
    status: 'IN_PROGRESS' as const,
    handoverDate: '2026-06-30',
    designFiles: [
      { isComplete: true },
      { isComplete: true },
      { isComplete: false, expectedDate: '2026-02-01' }, // overdue
    ],
    workItems: [
      {
        id: 'w1',
        designComplete: true,
        executionStatus: 'DONE' as const,
        plannedEnd: '2026-02-01',
        actualEnd: '2026-02-01',
      },
      {
        id: 'w2',
        designComplete: true,
        executionStatus: 'IN_PROGRESS' as const,
        plannedEnd: '2026-02-01',
        actualEnd: null,
      }, // overdue
      {
        id: 'w3',
        designComplete: false,
        executionStatus: 'NOT_STARTED' as const,
        plannedEnd: null,
        actualEnd: null,
      },
      {
        id: 'w4',
        designComplete: false,
        executionStatus: 'BLOCKED' as const,
        plannedEnd: null,
        actualEnd: null,
      },
    ],
    materials: [
      { id: 'm1', status: 'PENDING' as const, orderByDate: '2026-02-01', workItemId: 'w3' }, // overdue + blocks w3
      { id: 'm2', status: 'PENDING' as const, orderByDate: '2026-03-10', workItemId: null }, // due soon
      { id: 'm3', status: 'ORDERED' as const, orderByDate: '2026-05-01', workItemId: 'w2' }, // blocks w2
      { id: 'm4', status: 'DELIVERED' as const, orderByDate: '2026-01-01', workItemId: 'w1' },
    ],
  };

  it('rolls design up across both sub-sections', () => {
    const m = computeProjectMetrics(base, settings(), TODAY);
    // 3 design files (2 done) + 4 work items (2 designed) = 4 of 7.
    expect(m.designFilesTotal).toBe(3);
    expect(m.designFilesComplete).toBe(2);
    expect(m.designTotal).toBe(7);
    expect(m.designComplete).toBe(4);
    expect(m.designPct).toBe(57);
  });

  it('weights execution using the configured weights', () => {
    // 100 + 50 + 0 + 0 over four items.
    expect(computeProjectMetrics(base, settings(), TODAY).executionPct).toBe(38);
  });

  it('counts work items blocked by undelivered materials', () => {
    const m = computeProjectMetrics(base, settings(), TODAY);
    // w2 (ordered, not delivered) and w3 (pending). w1 is delivered and done.
    expect(m.executionBlocked).toBe(2);
  });

  it('does not count a completed item as blocked', () => {
    const m = computeProjectMetrics(
      {
        ...base,
        workItems: base.workItems.map((w) =>
          w.id === 'w2' ? { ...w, executionStatus: 'DONE' as const, actualEnd: '2026-02-01' } : w,
        ),
      },
      settings(),
      TODAY,
    );
    expect(m.executionBlocked).toBe(1);
  });

  it('buckets materials by procurement urgency', () => {
    const m = computeProjectMetrics(base, settings(), TODAY);
    expect(m.materialsOverdue).toBe(1);
    expect(m.materialsDueSoon).toBe(1);
    expect(m.materialsOrdered).toBe(2);
    expect(m.materialsTotal).toBe(4);
  });

  it('flags blocked work as a risk reason in plain language', () => {
    const m = computeProjectMetrics(base, settings(), TODAY);
    expect(m.atRisk).toBe(true);
    expect(m.riskReasons.join(' ')).toContain('blocked waiting on materials');
  });

  it('never flags a completed project as at risk', () => {
    const m = computeProjectMetrics({ ...base, status: 'COMPLETED' }, settings(), TODAY);
    expect(m.atRisk).toBe(false);
    expect(m.riskReasons).toHaveLength(0);
  });

  it('counts design items outstanding past their expected date', () => {
    const m = computeProjectMetrics(base, settings(), TODAY);
    expect(m.designOverdue).toBe(1);
    expect(m.riskReasons.join(' ')).toContain('past its expected date');
  });

  it('handles an empty project without dividing by zero', () => {
    const m = computeProjectMetrics(
      { status: 'DISCUSSION', handoverDate: null, designFiles: [], workItems: [], materials: [] },
      settings(),
      TODAY,
    );
    expect(m.designPct).toBe(0);
    expect(m.executionPct).toBe(0);
    expect(m.executionBlocked).toBe(0);
    expect(m.atRisk).toBe(false);
  });
});

describe('buildProgrammeChart', () => {
  const design = phase('Civil', 0);
  const build = phase('Finishing', 1);

  const items: ProgrammeActivityInput[] = [
    {
      id: 'a1',
      name: 'Blockwork',
      phase: design,
      executionStatus: 'DONE',
      plannedStart: '2026-01-05',
      plannedEnd: '2026-02-13',
      actualStart: '2026-01-05',
      actualEnd: '2026-02-20',
    },
    {
      id: 'a2',
      name: 'Flooring',
      phase: build,
      executionStatus: 'IN_PROGRESS',
      plannedStart: '2026-02-16',
      plannedEnd: '2026-04-10',
      actualStart: '2026-02-23',
      actualEnd: null,
      isBlocked: true,
    },
  ];

  it('fits the window to the dates that actually exist', () => {
    const chart = buildProgrammeChart(items, HANDOVER, TODAY)!;
    expect(chart.windowStart.getTime()).toBeLessThan(D('2026-01-05').getTime());
    expect(chart.windowEnd.getTime()).toBeGreaterThan(HANDOVER.getTime());
    expect(chart.bars).toHaveLength(2);
  });

  it('orders bars by phase position, then start date', () => {
    expect(buildProgrammeChart(items, HANDOVER, TODAY)!.bars.map((b) => b.name)).toEqual([
      'Blockwork',
      'Flooring',
    ]);
  });

  it('carries the blocked flag through to the bar', () => {
    const chart = buildProgrammeChart(items, HANDOVER, TODAY)!;
    expect(chart.bars.find((b) => b.id === 'a2')?.isBlocked).toBe(true);
    expect(chart.bars.find((b) => b.id === 'a1')?.isBlocked).toBe(false);
  });

  it('draws unfinished work through to today so an overrun is visible', () => {
    const chart = buildProgrammeChart(items, HANDOVER, TODAY)!;
    expect(chart.bars.find((b) => b.id === 'a2')?.actual?.end).toEqual(TODAY);
  });

  it('keeps every bar inside the window', () => {
    for (const bar of buildProgrammeChart(items, HANDOVER, TODAY)!.bars) {
      for (const span of [bar.planned, bar.actual]) {
        if (!span) continue;
        expect(span.offsetPct).toBeGreaterThanOrEqual(0);
        expect(span.offsetPct + span.widthPct).toBeLessThanOrEqual(100.01);
      }
    }
  });

  it('adapts the axis interval to the span', () => {
    const short = buildProgrammeChart(
      [{ ...items[0], plannedStart: '2026-01-05', plannedEnd: '2026-01-19', actualEnd: null }],
      null,
      TODAY,
    )!;
    const long = buildProgrammeChart(
      [{ ...items[0], plannedStart: '2024-01-05', plannedEnd: '2027-01-19', actualEnd: null }],
      null,
      TODAY,
    )!;
    expect(short.ticks.length).toBeLessThanOrEqual(10);
    expect(long.ticks.length).toBeLessThanOrEqual(10);
    expect(short.ticks.length).toBeGreaterThan(1);
    expect(long.ticks.length).toBeGreaterThan(1);
  });

  it('reports how many items were left out for having no dates', () => {
    const chart = buildProgrammeChart(
      [
        ...items,
        {
          id: 'a3',
          name: 'Snagging',
          phase: build,
          executionStatus: 'NOT_STARTED',
          plannedStart: null,
          plannedEnd: null,
          actualStart: null,
          actualEnd: null,
        },
      ],
      HANDOVER,
      TODAY,
    )!;
    expect(chart.undatedCount).toBe(1);
    expect(chart.bars).toHaveLength(2);
  });

  it('returns null when nothing is dated', () => {
    expect(buildProgrammeChart([], null, TODAY)).toBeNull();
  });

  // --- Drawings -----------------------------------------------------------
  // A drawing is a point, not a span: it has a due date and an issued date and
  // no duration between them that anybody entered.

  it('places drawings as milestones', () => {
    const chart = buildProgrammeChart(items, HANDOVER, TODAY, [
      { id: 'd1', name: 'GFC set', expected: '2026-02-10', actual: null, isComplete: false },
    ])!;

    expect(chart.milestones).toHaveLength(1);
    expect(chart.milestones[0].expectedPct).toBeGreaterThanOrEqual(0);
    expect(chart.milestones[0].expectedPct).toBeLessThanOrEqual(100);
    expect(chart.milestones[0].actualPct).toBeNull();
  });

  it('flags a drawing outstanding past its due date', () => {
    // Found by name, not by index: milestones come back in due-date order and
    // these two share a date, so the tie-break by name reverses the input.
    const milestones = buildProgrammeChart(items, HANDOVER, TODAY, [
      { id: 'a', name: 'Late', expected: '2026-01-05', actual: null, isComplete: false },
      { id: 'b', name: 'Fine', expected: '2026-01-05', actual: '2026-01-05', isComplete: true },
    ])!.milestones;
    const overdue = milestones.find((m) => m.name === 'Late')!;
    const ontime = milestones.find((m) => m.name === 'Fine')!;

    expect(overdue.isOverdue).toBe(true);
    // Issued, so its due date passing is history rather than a problem.
    expect(ontime.isOverdue).toBe(false);
    expect(ontime.daysLate).toBeNull();
  });

  it('measures how late a drawing was issued', () => {
    const chart = buildProgrammeChart(items, HANDOVER, TODAY, [
      { id: 'd', name: 'RCP', expected: '2026-02-01', actual: '2026-02-09', isComplete: true },
    ])!;
    expect(chart.milestones[0].daysLate).toBe(8);
  });

  it('draws a timeline for drawings alone, with no dated activities', () => {
    const chart = buildProgrammeChart([], null, TODAY, [
      { id: 'd', name: 'Concept', expected: '2026-03-01', actual: null, isComplete: false },
    ]);
    // The drawing programme usually exists before any site dates do; refusing
    // to draw it until an activity has dates would hide the only plan there is.
    expect(chart).not.toBeNull();
    expect(chart!.milestones).toHaveLength(1);
    expect(chart!.bars).toHaveLength(0);
  });

  it('widens the window to include a drawing outside the activity span', () => {
    const withDrawing = buildProgrammeChart(items, null, TODAY, [
      { id: 'd', name: 'Early concept', expected: '2025-11-01', actual: null, isComplete: false },
    ])!;
    // Without this the drawing would position off the left edge of the chart.
    expect(withDrawing.windowStart.getTime()).toBeLessThanOrEqual(new Date('2025-11-01').getTime());
    expect(withDrawing.milestones[0].expectedPct).toBeGreaterThanOrEqual(0);
  });

  it('orders drawings by due date, not by name', () => {
    const chart = buildProgrammeChart(items, null, TODAY, [
      { id: '1', name: 'Zebra', expected: '2026-01-10', actual: null, isComplete: false },
      { id: '2', name: 'Alpha', expected: '2026-02-10', actual: null, isComplete: false },
    ])!;
    expect(chart.milestones.map((m) => m.name)).toEqual(['Zebra', 'Alpha']);
  });

  it('ignores drawings with no dates at all', () => {
    const chart = buildProgrammeChart(items, HANDOVER, TODAY, [
      { id: 'd', name: 'Undated', expected: null, actual: null, isComplete: false },
    ])!;
    expect(chart.milestones).toHaveLength(0);
  });
});

describe('buildExecutiveSummary', () => {
  const kpis: PortfolioKpis = {
    totalProjects: 7,
    activeProjects: 5,
    completedProjects: 2,
    byStatus: { DISCUSSION: 2, IN_PROGRESS: 2, ON_HOLD: 1, COMPLETED: 2 },
    designTotal: 100,
    designComplete: 42,
    designPct: 42,
    workItemsTotal: 40,
    executionDelayed: 3,
    executionBlocked: 4,
    executionPct: 30,
    materialsTotal: 20,
    ordersOverdue: 2,
    ordersDueSoon: 4,
    projectsAtRisk: 3,
  };

  it('states only figures the data supports', () => {
    const summary = buildExecutiveSummary(kpis, [], TODAY);
    expect(summary).toContain('7 projects');
    expect(summary).toContain('42% complete (42 of 100)');
    expect(summary).toContain('2 material orders are past');
    expect(summary).toContain('4 work items are blocked waiting on materials');
    expect(summary).toContain('3 projects are flagged at risk');
  });

  it('says so plainly when the portfolio is empty', () => {
    expect(buildExecutiveSummary({ ...kpis, totalProjects: 0 }, [], TODAY)).toContain(
      'no projects have been added',
    );
  });

  it('omits the procurement sentence when there are no materials at all', () => {
    const summary = buildExecutiveSummary(
      { ...kpis, materialsTotal: 0, ordersOverdue: 0, ordersDueSoon: 0 },
      [],
      TODAY,
    );
    expect(summary).not.toContain('material order');
  });
});

describe('settings defaults', () => {
  it('fills gaps left by a settings row written before a key existed', () => {
    const merged = withSettingDefaults({ orderSoonWindowDays: 10 });
    expect(merged.orderSoonWindowDays).toBe(10);
    expect(merged.riskHandoverWindowDays).toBe(DEFAULT_SETTINGS.riskHandoverWindowDays);
    expect(merged.activityStatusWeights.DONE).toBe(100);
  });

  it('merges partial weight maps rather than replacing them wholesale', () => {
    const merged = withSettingDefaults({ activityStatusWeights: { BLOCKED: 30 } as never });
    expect(merged.activityStatusWeights.BLOCKED).toBe(30);
    expect(merged.activityStatusWeights.IN_PROGRESS).toBe(50);
  });

  it('returns a fresh copy so callers cannot mutate the shared defaults', () => {
    const a = withSettingDefaults(null);
    a.orderSoonWindowDays = 999;
    expect(withSettingDefaults(null).orderSoonWindowDays).toBe(
      DEFAULT_SETTINGS.orderSoonWindowDays,
    );
  });
});

describe('legacy import', () => {
  it('resolves the old "Feb 2026" spreadsheet format to the last day of that month', () => {
    expect(toIsoDate(parseLegacyHandover('Feb 2026'))).toBe('2026-02-28');
    expect(toIsoDate(parseLegacyHandover('Jun 2026'))).toBe('2026-06-30');
  });

  it('returns null for blank or unparseable values', () => {
    expect(parseLegacyHandover('')).toBeNull();
    expect(parseLegacyHandover('sometime next year')).toBeNull();
  });
});
