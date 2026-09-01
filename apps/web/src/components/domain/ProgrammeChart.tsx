import { memo, useMemo, useState } from 'react';
import {
  ACTIVITY_STATUS_LABELS,
  buildProgrammeChart,
  formatDateShort,
  parseIsoDate,
  type DesignFile,
  type IsoDate,
  type ProgrammeBar,
  type ProgrammeMilestone,
  type WorkItem,
} from '@ciq/shared';
import { EmptyState } from '@/components/ui';
import { IconAlert, IconGantt } from '@/components/ui/Icons';

/**
 * Programme chart.
 *
 * Built from the project's own activities and their dates — no fixed sequence of
 * trades, no assumed programme length. The window fits whatever dates exist and
 * the axis interval adapts to the span.
 *
 * The central decision is that each activity is **one bar on one baseline**, not
 * two stacked ones. Planned is a light channel; actual is a solid bar running
 * through it. Slippage is then the actual visibly overshooting the end of its
 * channel — a length you can see — rather than something you infer by comparing
 * two bars sitting at different heights. That comparison was the old chart's
 * whole problem: it drew the data correctly and made the reader do the work.
 *
 * Colours come from each activity's phase row, so a phase renamed or recoloured
 * in Settings changes this chart with no code change here.
 *
 * The Execution table below is this chart's table view — every date drawn here
 * is editable there, so nothing is reachable only by hovering.
 */

/** Either kind of row can be hovered; the readout differs. */
type HoverState =
  | { kind: 'bar'; bar: ProgrammeBar; x: number; y: number }
  | { kind: 'milestone'; milestone: ProgrammeMilestone; x: number; y: number };

/**
 * Memoised.
 *
 * The chart is the most expensive thing on the page — it rebuilds a window,
 * ticks and sixteen rows of geometry — and it only depends on the dates. Without
 * this it re-rendered whenever anything else on the project page changed state:
 * a dialog opening, a row expanding, a comment being typed.
 *
 * It still rebuilds when the work items genuinely change, which is correct — an
 * edited date must move its bar.
 */
export const ProgrammeChart = memo(function ProgrammeChart({
  workItems,
  designFiles = [],
  handoverDate,
  locale = 'en-GB',
}: {
  workItems: WorkItem[];
  /** Drawings. Rendered as milestones — they are dates, not durations. */
  designFiles?: DesignFile[];
  handoverDate: IsoDate | null;
  locale?: string;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const chart = useMemo(
    () =>
      buildProgrammeChart(
        workItems.map((item) => ({
          id: item.id,
          name: item.name,
          phase: {
            id: item.phase.id,
            name: item.phase.name,
            colour: item.phase.colour,
            position: item.phase.position,
          },
          executionStatus: item.executionStatus,
          designExpectedDate: item.designExpectedDate,
          designCompletedDate: item.designCompletedDate,
          designComplete: item.designComplete,
          plannedStart: item.plannedStart,
          plannedEnd: item.plannedEnd,
          actualStart: item.actualStart,
          actualEnd: item.actualEnd,
          isBlocked: item.blockingMaterials.length > 0 && item.executionStatus !== 'DONE',
        })),
        handoverDate ? parseIsoDate(handoverDate) : null,
        undefined,
        designFiles.map((file) => ({
          id: file.id,
          name: file.name,
          expected: file.expectedDate,
          actual: file.completedDate,
          isComplete: file.isComplete,
        })),
      ),
    [workItems, designFiles, handoverDate],
  );

  /** Rows grouped under their phase, in the order an administrator set. */
  const groups = useMemo(() => {
    if (!chart) return [];
    const map = new Map<string, { phase: ProgrammeBar['phase']; bars: ProgrammeBar[] }>();
    for (const bar of chart.bars) {
      const existing = map.get(bar.phase.id);
      if (existing) existing.bars.push(bar);
      else map.set(bar.phase.id, { phase: bar.phase, bars: [bar] });
    }
    return [...map.values()].sort((a, b) => a.phase.position - b.phase.position);
  }, [chart]);

  /**
   * The banding, built once.
   *
   * Every row paints the same set, so building it per row allocated one array
   * of elements per activity for a mark that never varies.
   */
  const bands = useMemo(
    () =>
      chart?.ticks.map((tick, index) => {
        const next = chart.ticks[index + 1];
        if (!next || index % 2 === 1) return null;
        return (
          <span
            key={`band-${index}`}
            className="gantt-band"
            style={{
              left: `${tick.offsetPct}%`,
              width: `${next.offsetPct - tick.offsetPct}%`,
            }}
          />
        );
      }) ?? null,
    [chart],
  );

  if (!chart) {
    return (
      <EmptyState
        icon={<IconGantt size={20} />}
        title="No dated work items yet"
        message="The timeline is drawn from the planned and actual dates on each work item. Add dates in the table below and the programme appears here."
      />
    );
  }

  return (
    <div className="gantt-wrap">
      <div className="scroll-x">
        <div className="gantt">
          {/* --- Axis ------------------------------------------------------ */}
          <div className="gantt-head">
            <div className="gantt-head-label" />
            <div className="gantt-head-track">
              {/* Alternating bands between ticks. Tracking a bar across a wide
                  chart by gridline alone means counting hairlines; a band gives
                  the eye a region to follow instead. */}
              {bands}

              {chart.ticks.map((tick, index) => (
                <span key={index} className="gantt-tick" style={{ left: `${tick.offsetPct}%` }}>
                  {formatDateShort(tick.date, locale)}
                </span>
              ))}

              {chart.todayPct !== null && (
                <span
                  className="gantt-flag"
                  data-kind="today"
                  style={{ left: `${chart.todayPct}%` }}
                >
                  Today
                </span>
              )}
              {chart.handoverPct !== null && (
                <span
                  className="gantt-flag"
                  data-kind="handover"
                  style={{ left: `${chart.handoverPct}%` }}
                >
                  Handover
                </span>
              )}
            </div>
          </div>

          {/* --- Rows ------------------------------------------------------ */}
          <div className="gantt-body">
            {/* Drawings first: they gate everything below them, and on a real
                programme they are the dates that exist before any site date
                does. Drawn as diamonds because a drawing is a deadline, not a
                stretch of work — giving it a bar would invent a start date. */}
            {chart.milestones.length > 0 && (
              <div className="gantt-group">
                <div className="gantt-group-head">
                  <span className="gantt-milestone-key" />
                  Drawings
                  <span className="gantt-group-count">{chart.milestones.length}</span>
                </div>

                {chart.milestones.map((milestone) => (
                  <div
                    key={milestone.id}
                    className="gantt-row"
                    tabIndex={0}
                    onMouseMove={(event) =>
                      setHover({
                        kind: 'milestone',
                        milestone,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    onFocus={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      setHover({
                        kind: 'milestone',
                        milestone,
                        x: box.left + box.width / 2,
                        y: box.top,
                      });
                    }}
                    onBlur={() => setHover(null)}
                    aria-label={describeMilestone(milestone, locale)}
                  >
                    <div className="gantt-label" title={milestone.name}>
                      {milestone.isOverdue && (
                        <IconAlert
                          size={11}
                          style={{ color: 'var(--danger-text)', flex: '0 0 auto' }}
                        />
                      )}
                      <span className="truncate">{milestone.name}</span>
                    </div>

                    <div className="gantt-track">
                      {bands}
                      {chart.handoverPct !== null && (
                        <span
                          className="gantt-handover"
                          style={{ left: `${chart.handoverPct}%` }}
                        />
                      )}
                      {chart.todayPct !== null && (
                        <span className="gantt-today" style={{ left: `${chart.todayPct}%` }} />
                      )}

                      {/* The slip, drawn as the distance between due and
                          issued. A number in a tooltip states it; this shows
                          it at the same scale as everything else on the row. */}
                      {milestone.expectedPct !== null &&
                        milestone.actualPct !== null &&
                        milestone.daysLate !== null && (
                          <span
                            className="gantt-slip"
                            style={{
                              left: `${Math.min(milestone.expectedPct, milestone.actualPct)}%`,
                              width: `${Math.abs(milestone.actualPct - milestone.expectedPct)}%`,
                            }}
                          />
                        )}

                      {milestone.expectedPct !== null && (
                        <span
                          className="gantt-diamond"
                          data-kind="expected"
                          data-overdue={milestone.isOverdue}
                          style={{ left: `${milestone.expectedPct}%` }}
                        />
                      )}
                      {milestone.actualPct !== null && (
                        <span
                          className="gantt-diamond"
                          data-kind="actual"
                          data-late={milestone.daysLate !== null}
                          style={{ left: `${milestone.actualPct}%` }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {groups.map((group) => (
              <div key={group.phase.id} className="gantt-group">
                <div className="gantt-group-head">
                  <span className="phase-swatch" style={{ background: group.phase.colour }} />
                  {group.phase.name}
                  <span className="gantt-group-count">{group.bars.length}</span>
                </div>

                {group.bars.map((bar) => {
                  const slipped =
                    bar.slippage?.state === 'LATE' || bar.slippage?.state === 'OVERDUE';

                  /**
                   * Hatching is reserved for work that needs attention *now* —
                   * blocked, or running past its planned end.
                   *
                   * A completed activity that finished late deliberately does
                   * not get it. Its overrun is already drawn: the solid bar
                   * visibly overshoots the end of its channel, and that length
                   * is the slippage. Hatching it too said the same thing twice
                   * in the loudest ink on the chart, and with four of ten rows
                   * striped the phase colours stopped reading at all.
                   */
                  const needsAttention =
                    bar.isBlocked || (slipped && bar.executionStatus !== 'DONE');
                  const running = bar.executionStatus === 'IN_PROGRESS';

                  return (
                    <div
                      key={bar.id}
                      className="gantt-row"
                      tabIndex={0}
                      // The whole row is the hit target, not the 10px bar — a
                      // pointer should not have to land on the mark itself.
                      onMouseMove={(event) =>
                        setHover({ kind: 'bar', bar, x: event.clientX, y: event.clientY })
                      }
                      onMouseLeave={() => setHover(null)}
                      onFocus={(event) => {
                        const box = event.currentTarget.getBoundingClientRect();
                        setHover({
                          kind: 'bar',
                          bar,
                          x: box.left + box.width / 2,
                          y: box.top,
                        });
                      }}
                      onBlur={() => setHover(null)}
                      aria-label={describe(bar, locale)}
                    >
                      <div className="gantt-label" title={bar.name}>
                        {needsAttention && (
                          <IconAlert
                            size={11}
                            style={{ color: 'var(--danger-text)', flex: '0 0 auto' }}
                          />
                        )}
                        <span className="truncate">{bar.name}</span>
                      </div>

                      <div className="gantt-track">
                        {bands}

                        {chart.handoverPct !== null && (
                          <span
                            className="gantt-handover"
                            style={{ left: `${chart.handoverPct}%` }}
                          />
                        )}
                        {chart.todayPct !== null && (
                          <span className="gantt-today" style={{ left: `${chart.todayPct}%` }} />
                        )}

                        {/* The drawing, on the same row as the build.
                            An activity is one thing that gets drawn and then
                            built; putting its two halves on separate rows made
                            "when was the ceiling drawn" and "when was it built"
                            two lookups about the same ceiling. */}
                        {bar.design?.expectedPct !== null &&
                          bar.design?.expectedPct !== undefined && (
                            <span
                              className="gantt-diamond gantt-diamond--sm"
                              data-kind="expected"
                              data-overdue={bar.design.isOverdue}
                              style={{ left: `${bar.design.expectedPct}%` }}
                            />
                          )}
                        {bar.design?.actualPct !== null && bar.design?.actualPct !== undefined && (
                          <span
                            className="gantt-diamond gantt-diamond--sm"
                            data-kind="actual"
                            data-late={bar.design.daysLate !== null}
                            style={{ left: `${bar.design.actualPct}%` }}
                          />
                        )}

                        {/* The plan, as a channel. */}
                        {bar.planned && (
                          <span
                            className="gantt-planned"
                            style={
                              {
                                left: `${bar.planned.offsetPct}%`,
                                width: `${bar.planned.widthPct}%`,
                                '--bar-colour': bar.phase.colour,
                              } as React.CSSProperties
                            }
                          />
                        )}

                        {/* A crisp tick at the planned end.
                            The channel alone was not enough: a solid actual bar
                            covers its own channel, so on a late activity there
                            was nothing left to overshoot and the slippage —
                            the entire point of drawing both — became invisible.
                            The tick survives underneath the bar and gives the
                            eye a fixed mark to read the overrun against. */}
                        {bar.planned && bar.actual && (
                          <span
                            className="gantt-plan-end"
                            style={
                              {
                                left: `${bar.planned.offsetPct + bar.planned.widthPct}%`,
                                '--bar-colour': bar.phase.colour,
                              } as React.CSSProperties
                            }
                          />
                        )}

                        {/* Actual, running through the channel. Where it ends
                            past the channel, that overhang is the slippage. */}
                        {bar.actual && (
                          <span
                            className="gantt-actual"
                            data-flagged={needsAttention}
                            // Work still running has no end date, so its bar is
                            // given no hard end either — it fades out rather
                            // than stopping, which stops today's line reading
                            // as a finish date.
                            data-running={running}
                            style={
                              {
                                left: `${bar.actual.offsetPct}%`,
                                width: `${bar.actual.widthPct}%`,
                                '--bar-colour': bar.phase.colour,
                              } as React.CSSProperties
                            }
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {hover &&
        (hover.kind === 'bar' ? (
          <Tooltip state={hover} locale={locale} />
        ) : (
          <MilestoneTooltip state={hover} locale={locale} />
        ))}

      {/* --- Legend ------------------------------------------------------
          Split in two. Phases are identity — which activity is whose — while
          planned/actual/late are encoding. Running them together in one row,
          as this used to, asks the reader to sort two different kinds of thing
          out of a single list. */}
      <div className="gantt-legend">
        <div className="gantt-legend-group">
          {groups.map((group) => (
            <span key={group.phase.id}>
              <span className="legend-swatch" style={{ background: group.phase.colour }} />
              {group.phase.name}
            </span>
          ))}
        </div>

        <div className="gantt-legend-group" data-encoding="true">
          <span>
            <span className="gantt-milestone-key" />
            Drawing due / issued
          </span>
          <span>
            <span className="legend-key legend-key--planned" />
            Planned
          </span>
          <span>
            <span className="legend-key legend-key--actual" />
            Actual
          </span>
          <span>
            <span className="legend-key legend-key--planend" />
            Planned end
          </span>
          <span>
            <span className="legend-key legend-key--late" />
            Overdue or blocked
          </span>
          <span>
            <span className="legend-key legend-key--today" />
            Today
          </span>
          {chart.handoverPct !== null && (
            <span>
              <span className="legend-key legend-key--handover" />
              Handover
            </span>
          )}
        </div>
      </div>

      {chart.undatedCount > 0 && (
        <p className="text-xs text-tertiary" style={{ marginTop: 'var(--space-3)' }}>
          {chart.undatedCount} work item{chart.undatedCount === 1 ? ' is' : 's are'} not shown —
          they have no planned or actual dates yet.
        </p>
      )}
    </div>
  );
});

/**
 * The hover readout.
 *
 * Fixed-position rather than absolute: the chart scrolls inside its own box, and
 * an absolutely positioned tooltip would be clipped by that overflow at exactly
 * the right-hand rows a reader scrolls to see.
 */
function Tooltip({
  state,
  locale,
}: {
  state: Extract<HoverState, { kind: 'bar' }>;
  locale: string;
}) {
  const { bar } = state;
  const late = bar.slippage?.state === 'LATE' || bar.slippage?.state === 'OVERDUE';

  return (
    <div
      className="gantt-tip"
      role="tooltip"
      style={{
        // Clamped so a row at the right edge does not push the tooltip off
        // screen; 260 is its max-width plus the offset.
        left: Math.min(state.x + 14, window.innerWidth - 260),
        top: Math.max(state.y - 12, 8),
      }}
    >
      <div className="gantt-tip-head">
        <span className="phase-swatch" style={{ background: bar.phase.colour }} />
        {bar.name}
      </div>

      <dl className="gantt-tip-rows">
        <dt>Status</dt>
        <dd>{ACTIVITY_STATUS_LABELS[bar.executionStatus]}</dd>

        {bar.design && (
          <>
            <dt>Drawing due</dt>
            <dd>
              {bar.design.expectedDate
                ? formatDateShort(bar.design.expectedDate, locale)
                : 'Not set'}
            </dd>

            <dt>Drawing issued</dt>
            <dd>
              {bar.design.actualDate ? formatDateShort(bar.design.actualDate, locale) : 'Not yet'}
            </dd>
          </>
        )}

        <dt>Planned</dt>
        <dd>
          {bar.planned
            ? `${formatDateShort(bar.planned.start, locale)} – ${formatDateShort(bar.planned.end, locale)}`
            : 'Not set'}
        </dd>

        <dt>Actual</dt>
        <dd>
          {bar.actual
            ? `${formatDateShort(bar.actual.start, locale)} – ${formatDateShort(bar.actual.end, locale)}`
            : 'Not started'}
        </dd>
      </dl>

      {late && bar.slippage && (
        <div className="gantt-tip-flag" data-tone="danger">
          {bar.slippage.days} day{bar.slippage.days === 1 ? '' : 's'}{' '}
          {bar.slippage.state === 'OVERDUE' ? 'overdue' : 'late'}
        </div>
      )}
      {bar.isBlocked && (
        <div className="gantt-tip-flag" data-tone="danger">
          Waiting on materials
        </div>
      )}
      {bar.design?.daysLate !== null && bar.design?.daysLate !== undefined && (
        <div className="gantt-tip-flag" data-tone="danger">
          Drawing issued {bar.design.daysLate} day
          {bar.design.daysLate === 1 ? '' : 's'} late
        </div>
      )}
      {bar.design?.isOverdue && (
        <div className="gantt-tip-flag" data-tone="danger">
          Drawing past its due date
        </div>
      )}
      {!late && !bar.isBlocked && bar.slippage?.state === 'EARLY' && (
        <div className="gantt-tip-flag" data-tone="success">
          {Math.abs(bar.slippage.days)} day{Math.abs(bar.slippage.days) === 1 ? '' : 's'} early
        </div>
      )}
    </div>
  );
}

/** The drawing readout — due against issued, and the gap between them. */
function MilestoneTooltip({
  state,
  locale,
}: {
  state: Extract<HoverState, { kind: 'milestone' }>;
  locale: string;
}) {
  const { milestone } = state;

  return (
    <div
      className="gantt-tip"
      role="tooltip"
      style={{
        left: Math.min(state.x + 14, window.innerWidth - 260),
        top: Math.max(state.y - 12, 8),
      }}
    >
      <div className="gantt-tip-head">
        <span className="gantt-milestone-key" />
        {milestone.name}
      </div>

      <dl className="gantt-tip-rows">
        <dt>Status</dt>
        <dd>{milestone.isComplete ? 'Issued' : 'Not issued'}</dd>

        <dt>Due</dt>
        <dd>
          {milestone.expectedDate ? formatDateShort(milestone.expectedDate, locale) : 'Not set'}
        </dd>

        <dt>Issued</dt>
        <dd>{milestone.actualDate ? formatDateShort(milestone.actualDate, locale) : 'Not yet'}</dd>
      </dl>

      {milestone.isOverdue && (
        <div className="gantt-tip-flag" data-tone="danger">
          Past its due date
        </div>
      )}
      {milestone.daysLate !== null && (
        <div className="gantt-tip-flag" data-tone="danger">
          Issued {milestone.daysLate} day{milestone.daysLate === 1 ? '' : 's'} late
        </div>
      )}
    </div>
  );
}

function describeMilestone(milestone: ProgrammeMilestone, locale: string): string {
  const parts = [milestone.name, 'drawing', milestone.isComplete ? 'issued' : 'not issued'];
  if (milestone.expectedDate) {
    parts.push(`due ${formatDateShort(milestone.expectedDate, locale)}`);
  }
  if (milestone.actualDate) {
    parts.push(`issued ${formatDateShort(milestone.actualDate, locale)}`);
  }
  if (milestone.daysLate !== null) parts.push(`${milestone.daysLate} days late`);
  else if (milestone.isOverdue) parts.push('past its due date');
  return parts.join(', ');
}

/** The same reading as the tooltip, for a screen reader on the focused row. */
function describe(bar: ProgrammeBar, locale: string): string {
  const parts = [bar.name, bar.phase.name, ACTIVITY_STATUS_LABELS[bar.executionStatus]];
  if (bar.planned) {
    parts.push(
      `planned ${formatDateShort(bar.planned.start, locale)} to ${formatDateShort(bar.planned.end, locale)}`,
    );
  }
  if (bar.actual) {
    parts.push(
      `actual ${formatDateShort(bar.actual.start, locale)} to ${formatDateShort(bar.actual.end, locale)}`,
    );
  }
  if (bar.design?.expectedDate) {
    parts.push(`drawing due ${formatDateShort(bar.design.expectedDate, locale)}`);
  }
  if (bar.design?.actualDate) {
    parts.push(`drawing issued ${formatDateShort(bar.design.actualDate, locale)}`);
  }
  if (bar.slippage?.state === 'LATE' || bar.slippage?.state === 'OVERDUE') {
    parts.push(`${bar.slippage.days} days late`);
  }
  if (bar.isBlocked) parts.push('waiting on materials');
  return parts.join(', ');
}
