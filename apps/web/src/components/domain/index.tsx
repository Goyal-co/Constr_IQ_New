import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ACTIVITY_STATUS_LABELS,
  ACTIVITY_STATUS_TONE,
  MATERIAL_STATUS_LABELS,
  PROCUREMENT_STATE_LABELS,
  PROCUREMENT_STATE_TONE,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONE,
  type ActivityStatus,
  type MaterialStatus,
  type ProcurementState,
  type ProjectStatus,
  type ProjectSummary,
  type Slippage,
} from '@ciq/shared';
import { formatCountdown, formatIso } from '@/lib/format';
import { Badge, ConfirmDialog, Menu, MenuItem, Progress } from '@/components/ui';
import {
  IconAlert,
  IconArrowUpRight,
  IconCalendar,
  IconMore,
  IconTrash,
} from '@/components/ui/Icons';

/**
 * Domain-aware presentation components.
 *
 * Labels and tones come from the shared vocabulary so a status reads the same
 * everywhere. Phase colours come from the database, never from a lookup here.
 */

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge tone={PROJECT_STATUS_TONE[status]} dot>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ActivityStatusBadge({ status }: { status: ActivityStatus }) {
  return (
    <Badge tone={ACTIVITY_STATUS_TONE[status]} lozenge>
      {ACTIVITY_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ProcurementBadge({ state }: { state: ProcurementState }) {
  return (
    <Badge tone={PROCUREMENT_STATE_TONE[state]} lozenge>
      {PROCUREMENT_STATE_LABELS[state]}
    </Badge>
  );
}

export function MaterialStatusLabel({ status }: { status: MaterialStatus }) {
  return <span className="text-xs text-secondary">{MATERIAL_STATUS_LABELS[status]}</span>;
}

/**
 * Slippage chip.
 *
 * Deliberately explicit about direction: "6 days late" and "6 days early" are
 * opposite outcomes, and a bare signed number in a table gets misread.
 */
export function SlippageChip({ slippage }: { slippage: Slippage | null }) {
  if (!slippage) return <span className="text-xs text-tertiary">—</span>;

  switch (slippage.state) {
    case 'LATE':
      return <Badge tone="danger">{slippage.days}d late</Badge>;
    case 'OVERDUE':
      return <Badge tone="danger">{slippage.days}d over</Badge>;
    case 'EARLY':
      return <Badge tone="success">{Math.abs(slippage.days)}d early</Badge>;
    case 'ON_TIME':
      return <Badge tone="success">On time</Badge>;
    default:
      return <Badge tone="neutral">in {Math.abs(slippage.days)}d</Badge>;
  }
}

export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="grow">
        {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="row gap-2 wrap shrink-0 no-print">{actions}</div>}
    </header>
  );
}

/**
 * Project card for the board view.
 *
 * Shows the two numbers a delivery manager checks first — drawing and execution
 * progress — plus whatever is currently wrong, stated in words rather than as a
 * bare red dot.
 */
export function ProjectCard({
  project,
  onDelete,
}: {
  project: ProjectSummary;
  /** Omitted when the signed-in role cannot delete — no disabled ghost item. */
  onDelete?: () => void;
}) {
  const m = project.metrics;

  // Held here rather than inside the menu: selecting the item closes the menu,
  // which unmounts everything the menu rendered.
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="card-with-actions">
      <Link to={`/projects/${project.id}`} className="card card-link card-pad">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <h3 className="text-md font-semibold truncate">{project.name}</h3>
            <p className="text-xs text-tertiary truncate">
              {[project.code, project.consultant].filter(Boolean).join(' · ') ||
                'No consultant set'}
            </p>
          </div>
          {/* Padded right so the status badge clears the overflow trigger that
              sits above it. */}
          <span style={{ paddingRight: onDelete ? 26 : 0 }}>
            <ProjectStatusBadge status={project.status} />
          </span>
        </div>

        <div className="stack gap-2" style={{ marginTop: 'var(--space-4)' }}>
          <div>
            <div className="row-between text-2xs text-tertiary" style={{ marginBottom: 4 }}>
              <span>Drawings</span>
              <span>
                {m.designComplete}/{m.designTotal}
              </span>
            </div>
            <Progress value={m.designPct} size="sm" label="Drawing progress" />
          </div>
          <div>
            <div className="row-between text-2xs text-tertiary" style={{ marginBottom: 4 }}>
              <span>Execution</span>
              <span>{m.workItemsTotal} activities</span>
            </div>
            <Progress
              value={m.executionPct}
              size="sm"
              colour="var(--accent-solid)"
              label="Execution progress"
            />
          </div>
        </div>

        <div
          className="row-between wrap gap-2"
          style={{
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <span className="row gap-1 text-xs text-secondary">
            <IconCalendar size={13} />
            {project.handoverDate ? formatCountdown(m.daysToHandover) : 'No handover date'}
          </span>
          <span className="row gap-2">
            {m.materialsOverdue > 0 && (
              <Badge tone="danger">
                <IconAlert size={11} />
                {m.materialsOverdue} to order
              </Badge>
            )}
            {m.materialsOverdue === 0 && m.materialsDueSoon > 0 && (
              <Badge tone="warning">{m.materialsDueSoon} due soon</Badge>
            )}
            {m.executionDelayed > 0 && <Badge tone="danger">{m.executionDelayed} late</Badge>}
          </span>
        </div>

        {/* Every reason as its own chip rather than the first one followed by
            "+2 more": the count of things wrong is the reading, and it should
            not need a click to see. */}
        {m.atRisk && (
          <ul className="reason-chips" style={{ marginTop: 'var(--space-3)' }}>
            {m.riskReasons.map((reason) => (
              <li key={reason} className="reason-chip">
                <IconAlert size={10} />
                {reason}
              </li>
            ))}
          </ul>
        )}
      </Link>

      {/* Outside the anchor, not nested in it: a button inside a link is
          invalid markup and the click would navigate before the menu opened. */}
      {onDelete && (
        <div className="card-actions no-print">
          <Menu
            trigger={(triggerProps) => (
              <button
                type="button"
                className="row-action"
                aria-label={`Actions for ${project.name}`}
                aria-haspopup="menu"
                {...triggerProps}
              >
                <IconMore size={15} />
              </button>
            )}
          >
            {(close) => (
              <MenuItem
                danger
                onClick={() => {
                  close();
                  setConfirming(true);
                }}
              >
                <IconTrash size={14} />
                Delete project
              </MenuItem>
            )}
          </Menu>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title="Delete project"
          confirmLabel="Delete project"
          destructive
          message={
            <>
              <strong>{project.name}</strong> and everything inside it — design files, work items,
              materials and attachments — will be removed from every view and report. This cannot be
              undone from the app.
            </>
          }
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDelete?.();
          }}
        />
      )}
    </div>
  );
}

/** Compact row for the status sheet and dashboard lists. */
export function ProjectRow({ project }: { project: ProjectSummary }) {
  const m = project.metrics;
  return (
    <tr>
      <td data-label="Project">
        <Link to={`/projects/${project.id}`} className="row gap-2 font-medium">
          {project.name}
          <IconArrowUpRight size={12} />
        </Link>
        <div className="text-2xs text-tertiary">{project.category.name}</div>
      </td>
      <td data-label="Status">
        <ProjectStatusBadge status={project.status} />
      </td>
      <td data-label="Handover" className="text-xs">
        {formatIso(project.handoverDate)}
      </td>
      <td data-label="Drawings" style={{ width: 140 }}>
        <Progress value={m.designPct} size="sm" label="Drawings" />
      </td>
      <td data-label="Execution" style={{ width: 140 }}>
        <Progress value={m.executionPct} size="sm" colour="var(--accent-solid)" label="Execution" />
      </td>
      <td data-label="Orders" className="num">
        {m.materialsOverdue > 0 ? (
          <span className="text-danger font-semibold">{m.materialsOverdue}</span>
        ) : (
          <span className="text-tertiary">—</span>
        )}
      </td>
      <td data-label="Late" className="num">
        {m.executionDelayed > 0 ? (
          <span className="text-danger font-semibold">{m.executionDelayed}</span>
        ) : (
          <span className="text-tertiary">—</span>
        )}
      </td>
      <td data-label="Flag">
        {project.status === 'COMPLETED' ? (
          <Badge tone="neutral">Done</Badge>
        ) : m.atRisk ? (
          <Badge tone="danger" dot>
            At risk
          </Badge>
        ) : (
          <Badge tone="success" dot>
            On track
          </Badge>
        )}
      </td>
    </tr>
  );
}
