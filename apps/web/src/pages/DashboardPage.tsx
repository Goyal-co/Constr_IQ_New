import { Link } from 'react-router-dom';
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES } from '@ciq/shared';
import { useAuth } from '@/lib/auth';
import { usePortfolioReport } from '@/lib/queries';
import { formatCountdown, formatIso } from '@/lib/format';
import { Badge, Card, EmptyState, Kpi, Progress, SkeletonRows } from '@/components/ui';
import {
  IconAlert,
  IconArrowUpRight,
  IconCalendar,
  IconLayers,
  IconProcurement,
  IconProjects,
} from '@/components/ui/Icons';
import { PageHeader } from '@/components/domain';
import { PortfolioSnapshot } from '@/components/domain/PortfolioSnapshot';
import { STATUS_SERIES, TRACK_COLOUR } from '@/lib/chart-palette';

/**
 * Dashboard.
 *
 * Answers three questions in order: how much is in flight, what is going wrong,
 * and what has to happen this week. Every figure is a count over live rows —
 * there is no cached summary table behind any of it.
 */
export function DashboardPage() {
  const { user, settings } = useAuth();
  const { data: report, isLoading } = usePortfolioReport({ scope: 'all' });

  if (isLoading || !report) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="grid grid-auto-sm" style={{ marginBottom: 'var(--space-6)' }}>
          <SkeletonRows rows={1} height={92} />
          <SkeletonRows rows={1} height={92} />
          <SkeletonRows rows={1} height={92} />
          <SkeletonRows rows={1} height={92} />
        </div>
        <SkeletonRows rows={3} height={140} />
      </>
    );
  }

  const k = report.kpis;
  const firstName = user?.name.split(' ')[0] ?? 'there';

  if (k.totalProjects === 0) {
    return (
      <>
        <PageHeader title={`Good to see you, ${firstName}`} />
        <EmptyState
          icon={<IconProjects size={20} />}
          title="Your workspace is empty"
          message="Start by defining the phases your delivery runs through and the categories your projects fall into, then build a template so new projects arrive with their checklists already in place."
          action={
            <div className="row gap-2">
              <Link to="/settings/phases" className="btn btn-primary">
                Set up phases
              </Link>
              <Link to="/projects" className="btn btn-secondary">
                Create a project
              </Link>
            </div>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Good to see you, ${firstName}`}
        actions={
          <Link to="/reports" className="btn btn-secondary">
            Full report
            <IconArrowUpRight size={14} />
          </Link>
        }
      />

      {/* Where the prose summary used to be. Same figures, read at a glance
          rather than parsed out of a sentence. */}
      <div className="card card-pad" style={{ marginBottom: 'var(--space-6)' }}>
        <PortfolioSnapshot kpis={k} upcoming={report.upcomingHandovers} />
      </div>

      <div className="grid grid-auto-sm" style={{ marginBottom: 'var(--space-6)' }}>
        <Kpi
          value={k.activeProjects}
          label="Active projects"
          hint={`${k.completedProjects} completed`}
        />
        <Kpi
          value={`${k.designPct}%`}
          label="Design"
          hint={`${k.designComplete} of ${k.designTotal} issued`}
          tone={k.designPct >= 75 ? 'success' : undefined}
        />
        <Kpi
          value={`${k.executionPct}%`}
          label="Site execution"
          hint={`${k.workItemsTotal} activities`}
        />
        <Kpi
          value={k.ordersOverdue}
          label="Orders overdue"
          hint={
            k.ordersDueSoon > 0
              ? `${k.ordersDueSoon} due within ${settings.orderSoonWindowDays} days`
              : 'None due soon'
          }
          tone={k.ordersOverdue > 0 ? 'danger' : 'success'}
        />
        <Kpi
          value={k.projectsAtRisk}
          label="At risk"
          hint={k.executionDelayed > 0 ? `${k.executionDelayed} activities late` : 'None flagged'}
          tone={k.projectsAtRisk > 0 ? 'warning' : 'success'}
        />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 'var(--space-6)' }}>
        <Card
          title="Needs attention"
          icon={<IconAlert size={16} />}
          description="Projects failing at least one of your configured risk rules."
        >
          {report.atRisk.length === 0 ? (
            <p className="text-sm text-secondary">
              Nothing is currently flagged. Risk rules are set in Settings → Thresholds.
            </p>
          ) : (
            <div className="stack gap-3">
              {report.atRisk.slice(0, 5).map((project) => (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="stack gap-2"
                  style={{
                    padding: 'var(--space-3)',
                    border: '1px solid var(--danger-border)',
                    background: 'var(--danger-bg)',
                    borderRadius: 'var(--radius-md)',
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <div className="row-between">
                    <span className="font-semibold text-sm">{project.name}</span>
                    <Badge tone="danger">
                      {project.metrics.riskReasons.length} issue
                      {project.metrics.riskReasons.length === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <ul className="reason-chips">
                    {project.metrics.riskReasons.map((reason) => (
                      <li key={reason} className="reason-chip">
                        <IconAlert size={10} />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Upcoming handovers"
          icon={<IconCalendar size={16} />}
          description="Nearest live projects by handover date."
        >
          {report.upcomingHandovers.length === 0 ? (
            <p className="text-sm text-secondary">No handover dates have been set yet.</p>
          ) : (
            <div className="stack gap-1">
              {report.upcomingHandovers.map((handover) => (
                <Link
                  key={handover.projectId}
                  to={`/projects/${handover.projectId}`}
                  className="row-between check-row"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="text-sm font-medium truncate">{handover.projectName}</div>
                    <div className="text-2xs text-tertiary">
                      design {handover.designPct}% · execution {handover.executionPct}%
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="text-xs">
                      {formatIso(handover.handoverDate, settings.locale)}
                    </div>
                    <div
                      className="text-2xs"
                      style={{
                        color:
                          handover.daysRemaining < 0
                            ? 'var(--danger-text)'
                            : handover.daysRemaining < 30
                              ? 'var(--warning-text)'
                              : 'var(--text-tertiary)',
                      }}
                    >
                      {formatCountdown(handover.daysRemaining)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-2">
        <Card
          title="Order this week"
          icon={<IconProcurement size={16} />}
          description={`Items past, or within ${settings.orderSoonWindowDays} days of, their order-by date.`}
          actions={
            <Link to="/procurement" className="btn btn-ghost btn-sm">
              All orders
            </Link>
          }
        >
          {report.procurementAlerts.length === 0 ? (
            <p className="text-sm text-secondary">Every order is inside its lead-time window.</p>
          ) : (
            <div className="stack gap-1">
              {report.procurementAlerts.slice(0, 7).map((alert) => (
                <Link
                  key={alert.materialId}
                  to={`/projects/${alert.projectId}`}
                  className="row-between check-row"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="text-sm font-medium truncate">{alert.materialName}</div>
                    <div className="text-2xs text-tertiary truncate">
                      {alert.projectName} · {alert.phaseName} · {alert.leadTimeWeeks}w lead
                    </div>
                  </div>
                  <Badge tone={alert.procurementState === 'OVERDUE' ? 'danger' : 'warning'}>
                    {alert.daysUntilOrderBy < 0
                      ? `${Math.abs(alert.daysUntilOrderBy)}d over`
                      : `in ${alert.daysUntilOrderBy}d`}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Progress by phase"
          icon={<IconLayers size={16} />}
          description="Across every project using each phase you have defined."
        >
          {report.byPhase.length === 0 ? (
            <p className="text-sm text-secondary">
              No phases are in use yet. Create them in Settings → Phases.
            </p>
          ) : (
            <div className="stack gap-4">
              {report.byPhase.map((row) => (
                <div key={row.phase.id}>
                  <div className="row-between" style={{ marginBottom: 6 }}>
                    <span className="row gap-2 text-sm font-medium">
                      <span className="phase-swatch" style={{ background: row.phase.colour }} />
                      {row.phase.name}
                    </span>
                    <span className="text-2xs text-tertiary">
                      {row.projectCount} project{row.projectCount === 1 ? '' : 's'}
                      {row.materialsOutstanding > 0 && ` · ${row.materialsOutstanding} to order`}
                    </span>
                  </div>
                  {/* Labelled inline rather than explained in a caption
                      underneath — a legend that sits below four charts makes the
                      reader hold the mapping in their head while scrolling. */}
                  <div className="stack gap-1">
                    <div className="track-row">
                      <span>Design</span>
                      <Progress
                        value={row.designPct}
                        size="sm"
                        colour={TRACK_COLOUR.design}
                        label={`${row.phase.name} drawings`}
                      />
                      <span>{row.designPct}%</span>
                    </div>
                    <div className="track-row">
                      <span>Execution</span>
                      <Progress
                        value={row.executionPct}
                        size="sm"
                        colour={TRACK_COLOUR.execution}
                        label={`${row.phase.name} execution`}
                      />
                      <span>{row.executionPct}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Portfolio by category"
        icon={<IconProjects size={16} />}
        description="Status distribution across the categories you have defined."
        className="no-print"
      >
        {report.byCategory.length === 0 ? (
          <p className="text-sm text-secondary">No categories yet.</p>
        ) : (
          <div className="stack gap-4">
            {report.byCategory.map((row) => (
              <div key={row.categoryId} className="row gap-4">
                <span className="text-sm font-medium" style={{ width: 170, flex: '0 0 170px' }}>
                  {row.categoryName}
                </span>
                <div className="stackbar grow" style={{ height: 20 }}>
                  {PROJECT_STATUSES.filter((status) => row.counts[status] > 0).map((status) => (
                    <span
                      key={status}
                      className="stackbar-seg"
                      title={`${PROJECT_STATUS_LABELS[status]}: ${row.counts[status]} of ${row.total}`}
                      style={{
                        width: `${(row.counts[status] / row.total) * 100}%`,
                        background: STATUS_SERIES[status],
                      }}
                    />
                  ))}
                </div>
                <span
                  className="text-xs text-tertiary tnum"
                  style={{ width: 28, textAlign: 'right' }}
                >
                  {row.total}
                </span>
              </div>
            ))}
            <ul className="chart-legend" style={{ paddingTop: 'var(--space-2)' }}>
              {PROJECT_STATUSES.map((status) => (
                <li key={status}>
                  <span className="legend-swatch" style={{ background: STATUS_SERIES[status] }} />
                  {PROJECT_STATUS_LABELS[status]}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </>
  );
}
