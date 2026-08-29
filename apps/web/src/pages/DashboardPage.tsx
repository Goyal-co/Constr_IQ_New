import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ReportQueryDto } from '@ciq/shared';
import { downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCategories, usePortfolioReport, useProjects, useSaveReportMeta } from '@/lib/queries';
import { formatCountdown, formatIso, formatTimestamp } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FilterBar,
  Kpi,
  Progress,
  SkeletonRows,
  useToast,
} from '@/components/ui';
import {
  IconAlert,
  IconCalendar,
  IconDownload,
  IconLayers,
  IconProcurement,
  IconProjects,
  IconReport,
} from '@/components/ui/Icons';
import { PageHeader, ProjectRow } from '@/components/domain';
import { PortfolioSnapshot } from '@/components/domain/PortfolioSnapshot';
import { STATUS_SERIES, TRACK_COLOUR } from '@/lib/chart-palette';

/**
 * Dashboard — the whole reporting surface.
 *
 * This absorbed the separate Reports page. Keeping two screens off one
 * `PortfolioReport` payload meant the same numbers were rendered twice in two
 * layouts, and people had to know which one to open to get the status sheet or
 * the export. There is now one place, with filters that narrow everything on it
 * at once — including down to a single project, which is what somebody tracking
 * one fit-out actually wants.
 *
 * Filters live in the URL so a filtered view is a link somebody can send.
 */
export function DashboardPage() {
  const { user, can, settings } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const categories = useCategories();
  // Only for the picker; the report itself does the filtering server-side.
  // 100 is the schema's ceiling, and a dropdown longer than that would be the
  // wrong control anyway — a portfolio that big needs a searchable picker.
  const projectList = useProjects({ scope: 'all', pageSize: 100, sort: 'name' });

  const query = useMemo<ReportQueryDto>(
    () => ({
      scope: (params.get('scope') as ReportQueryDto['scope'] | null) ?? 'all',
      ...(params.get('category') ? { categoryId: params.get('category')! } : {}),
      ...(params.get('project') ? { projectId: params.get('project')! } : {}),
    }),
    [params],
  );

  const { data: report, isLoading } = usePortfolioReport(query);
  const saveMeta = useSaveReportMeta();

  const [title, setTitle] = useState('');
  const [commentary, setCommentary] = useState('');
  const [dirty, setDirty] = useState(false);

  // Adopt the server's values whenever a fresh report arrives, unless there are
  // unsaved edits in the box — overwriting those would be maddening.
  useEffect(() => {
    if (!report || dirty) return;
    setTitle(report.title);
    setCommentary(report.commentary);
  }, [report, dirty]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const activeFilters = ['scope', 'category', 'project'].filter(
    (key) => params.get(key) && params.get(key) !== 'all',
  ).length;

  const firstName = user?.name.split(' ')[0] ?? 'there';
  const focused = projectList.data?.items.find((p) => p.id === params.get('project'));

  if (isLoading || !report) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div className="grid grid-auto-sm" style={{ marginBottom: 'var(--space-6)' }}>
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonRows key={i} rows={1} height={92} />
          ))}
        </div>
        <SkeletonRows rows={3} height={140} />
      </>
    );
  }

  const k = report.kpis;
  const canWrite = can('report:write');

  if (k.totalProjects === 0 && activeFilters === 0) {
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
        title={focused ? focused.name : `Good to see you, ${firstName}`}
        subtitle={
          focused
            ? 'Every figure below is scoped to this project.'
            : `Generated ${formatTimestamp(report.generatedAt, settings.locale)} · every figure is a live count`
        }
        actions={
          can('report:export') && (
            <>
              <Button
                onClick={() =>
                  void downloadFile('/exports/portfolio.xlsx', query).catch(() =>
                    toast.error('Export failed'),
                  )
                }
              >
                <IconDownload size={15} />
                Excel
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  void downloadFile('/exports/portfolio.pdf', query).catch(() =>
                    toast.error('Export failed'),
                  )
                }
              >
                <IconDownload size={15} />
                PDF
              </Button>
            </>
          )
        }
      />

      {/* --- Filters -------------------------------------------------------
          Narrow everything below at once, exports included — the PDF is
          generated from the same query, so what you see is what you send. */}
      <FilterBar
        activeCount={activeFilters}
        onClear={() => setParams(new URLSearchParams(), { replace: true })}
        summary={
          <div className="row gap-3 wrap">
            <div>
              <label className="visually-hidden" htmlFor="dash-project">
                Focus on one project
              </label>
              <select
                id="dash-project"
                className="select"
                style={{ minWidth: 220 }}
                value={params.get('project') ?? ''}
                onChange={(event) => setParam('project', event.target.value || null)}
              >
                <option value="">All projects</option>
                {projectList.data?.items.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        }
      >
        <div className="row gap-3 wrap">
          <div className="segmented" role="group" aria-label="Scope">
            {(['all', 'active', 'completed'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={(params.get('scope') ?? 'all') === value}
                onClick={() => setParam('scope', value === 'all' ? null : value)}
              >
                {value === 'all' ? 'All' : value === 'active' ? 'Active' : 'Completed'}
              </button>
            ))}
          </div>

          <div>
            <label className="visually-hidden" htmlFor="dash-category">
              Category
            </label>
            <select
              id="dash-category"
              className="select"
              style={{ width: 'auto', minWidth: 170 }}
              value={params.get('category') ?? ''}
              onChange={(event) => setParam('category', event.target.value || null)}
            >
              <option value="">All categories</option>
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterBar>

      {k.totalProjects === 0 ? (
        <EmptyState
          icon={<IconProjects size={20} />}
          title="Nothing matches these filters"
          message="Try widening the scope, or clearing the category and project."
          action={
            <Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
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
              label="Drawings"
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
              hint={
                k.executionDelayed > 0 ? `${k.executionDelayed} activities late` : 'None flagged'
              }
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
                  {report.atRisk.slice(0, 6).map((project) => (
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
                          drawings {handover.designPct}% · execution {handover.executionPct}%
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

          <div className="grid grid-2" style={{ marginBottom: 'var(--space-6)' }}>
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
                <p className="text-sm text-secondary">
                  Every order is inside its lead-time window.
                </p>
              ) : (
                <div className="stack gap-1">
                  {report.procurementAlerts.slice(0, 8).map((alert) => (
                    <Link
                      key={alert.materialId}
                      to={`/projects/${alert.projectId}`}
                      className="row-between check-row"
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="text-sm font-medium truncate">{alert.materialName}</div>
                        <div className="text-2xs text-tertiary truncate">
                          {alert.projectName} · {alert.phaseName}
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
              description="Across every project in this view."
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
                          {row.materialsOutstanding > 0 &&
                            ` · ${row.materialsOutstanding} to order`}
                        </span>
                      </div>
                      <div className="stack gap-1">
                        <div className="track-row">
                          <span>Drawings</span>
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

          {/* --- Category mix — hidden when one project is in focus, where a
              single-bar chart says nothing. */}
          {!focused && report.byCategory.length > 0 && (
            <Card
              title="Portfolio by category"
              icon={<IconProjects size={16} />}
              description="Status distribution across the categories you have defined."
              style={{ marginBottom: 'var(--space-6)' }}
            >
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
                <ul className="chart-legend">
                  {PROJECT_STATUSES.map((status) => (
                    <li key={status}>
                      <span
                        className="legend-swatch"
                        style={{ background: STATUS_SERIES[status] }}
                      />
                      {PROJECT_STATUS_LABELS[status]}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          {/* --- Management commentary — the one part of the old Reports page
              that is authored rather than derived. */}
          <Card
            title="Management commentary"
            icon={<IconReport size={16} />}
            description="Yours to write. Included in both export formats."
            className="no-print-break"
            style={{ marginBottom: 'var(--space-6)' }}
            actions={
              canWrite &&
              dirty && (
                <Button
                  size="sm"
                  variant="primary"
                  loading={saveMeta.isPending}
                  onClick={() =>
                    saveMeta.mutate(
                      { title, commentary },
                      {
                        onSuccess: () => {
                          setDirty(false);
                          toast.success('Saved');
                        },
                        onError: () => toast.error('Could not save that'),
                      },
                    )
                  }
                >
                  Save
                </Button>
              )
            }
          >
            {canWrite ? (
              <div className="stack gap-3">
                <div className="field">
                  <label className="label" htmlFor="report-title">
                    Report title
                  </label>
                  <input
                    id="report-title"
                    className="input"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                <textarea
                  className="textarea"
                  aria-label="Management commentary"
                  rows={4}
                  placeholder="Your narrative for management — wins, risks, decisions needed, resourcing asks…"
                  value={commentary}
                  onChange={(event) => {
                    setCommentary(event.target.value);
                    setDirty(true);
                  }}
                />
              </div>
            ) : (
              <p className="text-sm text-secondary" style={{ whiteSpace: 'pre-wrap' }}>
                {report.commentary || 'No commentary has been added.'}
              </p>
            )}
          </Card>

          {/* --- The status sheet, straight from the old Reports page. */}
          <Card
            title="Project status sheet"
            description="The full portfolio at a glance."
            padded={false}
          >
            <div className="scroll-x">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Handover</th>
                    <th>Drawings</th>
                    <th>Execution</th>
                    <th className="num">Orders</th>
                    <th className="num">Late</th>
                    <th>Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {report.statusSheet.map((project) => (
                    <ProjectRow key={project.id} project={project} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
