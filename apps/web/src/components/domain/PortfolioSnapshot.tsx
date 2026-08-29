import { useId, useState } from 'react';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type PortfolioKpis,
  type ProjectStatus,
  type UpcomingHandover,
} from '@ciq/shared';
import { IconAlert, IconClock, IconLayers, IconProcurement } from '@/components/ui/Icons';
import { STATUS_SERIES, TRACK_COLOUR } from '@/lib/chart-palette';

/**
 * The portfolio at a glance.
 *
 * Replaces the prose executive summary. The summary said things like "8 projects
 * — 6 active and 2 completed, design 62% complete, 5 orders past their date":
 * every clause is either a proportion or a single number, and both read faster
 * as a mark than as a sentence buried in a paragraph.
 *
 * Three forms, each matched to the job:
 *   • status mix   → one stacked bar (identity across a whole)
 *   • progress     → two meters (magnitude against a known 100%)
 *   • exceptions   → status tiles (single headline numbers, not a chart)
 *
 * Series colours come from the validated chart tokens, not the badge tones —
 * see the note in tokens.css for why those two differ.
 */

export function PortfolioSnapshot({
  kpis,
  upcoming,
}: {
  kpis: PortfolioKpis;
  upcoming: UpcomingHandover[];
}) {
  const titleId = useId();
  const [hovered, setHovered] = useState<ProjectStatus | null>(null);

  const total = kpis.totalProjects;
  const present = PROJECT_STATUSES.filter((status) => kpis.byStatus[status] > 0);
  const next = upcoming[0];

  if (total === 0) {
    return (
      <div className="callout" data-tone="info">
        <IconLayers size={16} />
        <div>No projects yet. Figures appear here as soon as the first one is added.</div>
      </div>
    );
  }

  return (
    <section className="snapshot" aria-labelledby={titleId}>
      <h2 id={titleId} className="visually-hidden">
        Portfolio at a glance
      </h2>

      {/* --- Status mix ---------------------------------------------------- */}
      <div className="snapshot-block">
        <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
          <span className="eyebrow">Portfolio</span>
          <span className="text-xs text-secondary tnum">
            {total} project{total === 1 ? '' : 's'}
          </span>
        </div>

        <div
          className="stackbar"
          role="img"
          aria-label={present
            .map((s) => `${PROJECT_STATUS_LABELS[s]}: ${kpis.byStatus[s]}`)
            .join(', ')}
        >
          {present.map((status) => {
            const count = kpis.byStatus[status];
            const pct = (count / total) * 100;
            return (
              <span
                key={status}
                className="stackbar-seg"
                // Segments are separated by a surface-coloured gap rather than a
                // border, so adjacent fills never appear to blend into one.
                style={{ width: `${pct}%`, background: STATUS_SERIES[status] }}
                onMouseEnter={() => setHovered(status)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(status)}
                onBlur={() => setHovered(null)}
                tabIndex={0}
                title={`${PROJECT_STATUS_LABELS[status]}: ${count} of ${total}`}
                data-dim={hovered && hovered !== status ? 'true' : undefined}
              >
                {/* Direct label, but only where the segment is wide enough to
                    hold it — a number squeezed into 4% is worse than none. */}
                {pct >= 12 && <span className="stackbar-label">{count}</span>}
              </span>
            );
          })}
        </div>

        {/* A legend is always present for two or more series, so identity is
            never carried by colour alone. */}
        <ul className="chart-legend">
          {present.map((status) => (
            <li key={status} data-dim={hovered && hovered !== status ? 'true' : undefined}>
              <span className="legend-swatch" style={{ background: STATUS_SERIES[status] }} />
              {PROJECT_STATUS_LABELS[status]}
              <b className="tnum">{kpis.byStatus[status]}</b>
            </li>
          ))}
        </ul>
      </div>

      {/* --- Progress ------------------------------------------------------- */}
      <div className="snapshot-block">
        <span className="eyebrow">Progress</span>
        <div className="stack gap-3" style={{ marginTop: 'var(--space-2)' }}>
          <Meter
            label="Drawings"
            pct={kpis.designPct}
            detail={`${kpis.designComplete} of ${kpis.designTotal} issued`}
            colour={TRACK_COLOUR.design}
          />
          <Meter
            label="Execution"
            pct={kpis.executionPct}
            detail={`${kpis.workItemsTotal} work item${kpis.workItemsTotal === 1 ? '' : 's'}`}
            colour={TRACK_COLOUR.execution}
          />
        </div>
      </div>

      {/* --- Exceptions ------------------------------------------------------
          Headline numbers, so tiles rather than a chart. Status colour is
          always paired with an icon and a label, never used alone. */}
      <div className="snapshot-block">
        <span className="eyebrow">Needs attention</span>
        <div className="snapshot-flags">
          <Flag
            icon={<IconProcurement size={14} />}
            value={kpis.ordersOverdue}
            label="orders overdue"
            tone={kpis.ordersOverdue > 0 ? 'danger' : 'success'}
          />
          <Flag
            icon={<IconAlert size={14} />}
            value={kpis.executionBlocked}
            label="blocked"
            tone={kpis.executionBlocked > 0 ? 'danger' : 'success'}
          />
          <Flag
            icon={<IconClock size={14} />}
            value={kpis.executionDelayed}
            label="behind plan"
            tone={kpis.executionDelayed > 0 ? 'warning' : 'success'}
          />
          <Flag
            icon={<IconLayers size={14} />}
            value={kpis.projectsAtRisk}
            label="at risk"
            tone={kpis.projectsAtRisk > 0 ? 'warning' : 'success'}
          />
        </div>

        {next && (
          <p className="snapshot-next">
            Nearest handover <b>{next.projectName}</b>{' '}
            <span
              style={{
                color:
                  next.daysRemaining < 0
                    ? 'var(--danger-text)'
                    : next.daysRemaining < 30
                      ? 'var(--warning-text)'
                      : 'var(--text-secondary)',
              }}
            >
              {next.daysRemaining < 0
                ? `${Math.abs(next.daysRemaining)} days overdue`
                : `in ${next.daysRemaining} days`}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function Meter({
  label,
  pct,
  detail,
  colour,
}: {
  label: string;
  pct: number;
  detail: string;
  colour: string;
}) {
  return (
    <div>
      <div className="row-between" style={{ marginBottom: 5 }}>
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tnum">{pct}%</span>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={`${label} ${pct}% — ${detail}`}
        title={`${label}: ${detail}`}
      >
        <span
          className="meter-fill"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: colour }}
        />
      </div>
      <div className="text-2xs text-tertiary" style={{ marginTop: 3 }}>
        {detail}
      </div>
    </div>
  );
}

function Flag({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone: 'danger' | 'warning' | 'success';
}) {
  return (
    <div className="snapshot-flag" data-tone={value === 0 ? 'clear' : tone}>
      {icon}
      <b className="tnum">{value}</b>
      <span>{label}</span>
    </div>
  );
}
