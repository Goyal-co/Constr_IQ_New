import { useMemo } from 'react';
import {
  buildProgrammeChart,
  formatDateShort,
  parseIsoDate,
  type IsoDate,
  type WorkItem,
} from '@ciq/shared';
import { EmptyState } from '@/components/ui';
import { IconGantt } from '@/components/ui/Icons';

/**
 * Programme chart.
 *
 * Built from the project's own activities and their planned and actual dates —
 * there is no fixed sequence of trades and no assumed programme length. The
 * window fits whatever dates exist, the axis interval adapts to the span, and
 * each row draws planned as a faint bar with actual solid on top so an overrun
 * is visible rather than merely tabulated.
 *
 * Colours come from each activity's phase row, so a phase renamed and recoloured
 * in Settings changes this chart with no code change.
 */
export function ProgrammeChart({
  workItems,
  handoverDate,
  locale = 'en-GB',
}: {
  workItems: WorkItem[];
  handoverDate: IsoDate | null;
  locale?: string;
}) {
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
          plannedStart: item.plannedStart,
          plannedEnd: item.plannedEnd,
          actualStart: item.actualStart,
          actualEnd: item.actualEnd,
          // Drawn hatched, so a bar that is waiting on a delivery reads
          // differently from one that is merely late.
          isBlocked: item.blockingMaterials.length > 0 && item.executionStatus !== 'DONE',
        })),
        handoverDate ? parseIsoDate(handoverDate) : null,
      ),
    [workItems, handoverDate],
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

  const phasesInUse = [
    ...new Map(chart.bars.map((bar) => [bar.phase.id, bar.phase])).values(),
  ].sort((a, b) => a.position - b.position);

  return (
    <div>
      <div className="scroll-x">
        <div className="gantt">
          <div className="gantt-axis">
            {chart.ticks.map((tick, index) => (
              <span key={index} className="gantt-tick" style={{ left: `${tick.offsetPct}%` }}>
                {formatDateShort(tick.date, locale)}
              </span>
            ))}
          </div>

          <div className="gantt-rows">
            {chart.bars.map((bar) => {
              const isLate = bar.slippage?.state === 'LATE' || bar.slippage?.state === 'OVERDUE';
              const showHatch = isLate || bar.isBlocked;
              return (
                <div key={bar.id} className="gantt-row">
                  <div className="gantt-label" title={`${bar.phase.name} · ${bar.name}`}>
                    <span
                      className="phase-swatch"
                      style={{
                        background: bar.phase.colour,
                        display: 'inline-block',
                        marginRight: 6,
                      }}
                    />
                    {bar.name}
                  </div>

                  <div className="gantt-track">
                    {chart.ticks.map((tick, index) => (
                      <span
                        key={index}
                        className="gantt-grid"
                        style={{ left: `${tick.offsetPct}%` }}
                      />
                    ))}

                    {chart.handoverPct !== null && (
                      <span className="gantt-handover" style={{ left: `${chart.handoverPct}%` }} />
                    )}
                    {chart.todayPct !== null && (
                      <span className="gantt-today" style={{ left: `${chart.todayPct}%` }} />
                    )}

                    {bar.planned && (
                      <span
                        className="gantt-planned"
                        title={`Planned ${formatDateShort(bar.planned.start, locale)} – ${formatDateShort(bar.planned.end, locale)}`}
                        style={
                          {
                            left: `${bar.planned.offsetPct}%`,
                            width: `${bar.planned.widthPct}%`,
                            '--bar-colour': bar.phase.colour,
                          } as React.CSSProperties
                        }
                      />
                    )}

                    {bar.actual && (
                      <span
                        className="gantt-actual"
                        data-late={showHatch}
                        title={`Actual ${formatDateShort(bar.actual.start, locale)} – ${formatDateShort(bar.actual.end, locale)}${
                          bar.slippage?.state === 'LATE' ? ` (${bar.slippage.days} days late)` : ''
                        }`}
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
        </div>
      </div>

      <div className="gantt-legend">
        {phasesInUse.map((phase) => (
          <span key={phase.id} className="row gap-2">
            <span className="phase-swatch" style={{ background: phase.colour }} />
            {phase.name}
          </span>
        ))}
        <span className="row gap-2">
          <span
            className="phase-swatch"
            style={{ background: 'var(--neutral-solid)', opacity: 0.28 }}
          />
          Planned
        </span>
        <span className="row gap-2">
          <span className="phase-swatch" style={{ background: 'var(--neutral-solid)' }} />
          Actual
        </span>
        <span className="row gap-2">
          <span
            className="phase-swatch"
            style={{
              background:
                'repeating-linear-gradient(45deg, var(--danger-solid), var(--danger-solid) 3px, #fff 3px, #fff 6px)',
            }}
          />
          Late or blocked
        </span>
        <span className="row gap-2">
          <span
            style={{
              width: 2,
              height: 11,
              background: 'var(--danger-solid)',
              display: 'inline-block',
            }}
          />
          Today
        </span>
        {chart.handoverPct !== null && (
          <span className="row gap-2">
            <span
              style={{
                width: 0,
                height: 11,
                borderLeft: '2px dashed var(--accent-solid)',
                display: 'inline-block',
              }}
            />
            Handover
          </span>
        )}
      </div>

      {chart.undatedCount > 0 && (
        <p className="text-xs text-tertiary" style={{ marginTop: 'var(--space-3)' }}>
          {chart.undatedCount} work item{chart.undatedCount === 1 ? ' is' : 's are'} not shown —
          they have no planned or actual dates yet.
        </p>
      )}
    </div>
  );
}
