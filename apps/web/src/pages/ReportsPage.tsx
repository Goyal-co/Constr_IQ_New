import { useEffect, useState } from 'react';
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ReportQueryDto } from '@ciq/shared';
import { downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCategories, usePortfolioReport, useSaveReportMeta } from '@/lib/queries';
import { formatIso, formatTimestamp } from '@/lib/format';
import { Button, Card, Kpi, Progress, SkeletonRows, useToast } from '@/components/ui';
import { IconAlert, IconDownload, IconReport } from '@/components/ui/Icons';
import { PageHeader, ProjectRow } from '@/components/domain';
import { PortfolioSnapshot } from '@/components/domain/PortfolioSnapshot';
import { STATUS_SERIES, TRACK_COLOUR } from '@/lib/chart-palette';

/**
 * Management report.
 *
 * The screen version and both export formats are generated from the same
 * `PortfolioReport` payload, so an exported figure can never disagree with the
 * one somebody read here.
 */
export function ReportsPage() {
  const { can, settings } = useAuth();
  const toast = useToast();
  const categories = useCategories();

  const [scope, setScope] = useState<ReportQueryDto['scope']>('all');
  const [categoryId, setCategoryId] = useState<string>('');
  const query = { scope, ...(categoryId ? { categoryId } : {}) };

  const { data: report, isLoading } = usePortfolioReport(query);
  const saveMeta = useSaveReportMeta();

  const [title, setTitle] = useState('');
  const [commentary, setCommentary] = useState('');
  const [dirty, setDirty] = useState(false);

  // Adopt the server's values whenever a fresh report arrives, unless the user
  // has unsaved edits in the box — overwriting those would be maddening.
  useEffect(() => {
    if (!report || dirty) return;
    setTitle(report.title);
    setCommentary(report.commentary);
  }, [report, dirty]);

  if (isLoading || !report) {
    return (
      <>
        <PageHeader title="Management report" />
        <SkeletonRows rows={4} height={110} />
      </>
    );
  }

  const k = report.kpis;
  const canWrite = can('report:write');

  return (
    <>
      <PageHeader
        title="Management report"
        subtitle={`Generated ${formatTimestamp(report.generatedAt, settings.locale)} · every figure is a live count`}
        actions={
          <>
            <select
              className="select"
              style={{ width: 'auto' }}
              aria-label="Category filter"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ width: 'auto' }}
              aria-label="Scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as ReportQueryDto['scope'])}
            >
              <option value="all">All projects</option>
              <option value="active">Active only</option>
              <option value="completed">Completed only</option>
            </select>
            {can('report:export') && (
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
            )}
          </>
        }
      />

      <div className="card card-pad" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="eyebrow">Portfolio report</div>
        {canWrite ? (
          <input
            className="input"
            style={{
              border: 0,
              padding: 0,
              fontSize: 'var(--text-2xl)',
              fontWeight: 'var(--weight-bold)',
              letterSpacing: 'var(--tracking-tight)',
              background: 'transparent',
              marginTop: 4,
            }}
            aria-label="Report title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setDirty(true);
            }}
          />
        ) : (
          <h2 className="text-2xl font-bold" style={{ marginTop: 4 }}>
            {report.title}
          </h2>
        )}
        <p className="text-sm text-tertiary">Prepared for management</p>
      </div>

      <div className="grid grid-auto-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <Kpi value={k.totalProjects} label="Projects" hint={`${k.activeProjects} active`} />
        <Kpi value={k.byStatus.IN_PROGRESS} label="In progress" tone="warning" />
        <Kpi value={k.byStatus.DISCUSSION} label="In discussion" tone="info" />
        <Kpi
          value={k.byStatus.ON_HOLD}
          label="On hold"
          tone={k.byStatus.ON_HOLD > 0 ? 'danger' : undefined}
        />
        <Kpi
          value={`${k.designPct}%`}
          label="Design"
          hint={`${k.designComplete} of ${k.designTotal}`}
          tone="success"
        />
        <Kpi
          value={`${k.executionPct}%`}
          label="Execution"
          hint={`${k.workItemsTotal} activities`}
        />
      </div>

      <Card
        title="Portfolio at a glance"
        icon={<IconReport size={16} />}
        description="Every mark is a count over live rows. Nothing here is estimated or cached."
        className="stack"
      >
        <PortfolioSnapshot kpis={k} upcoming={report.upcomingHandovers} />

        <div style={{ marginTop: 'var(--space-4)' }}>
          <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
            <span className="eyebrow">Management commentary</span>
            {canWrite && dirty && (
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
                        toast.success('Report saved');
                      },
                      onError: () => toast.error('Could not save the report'),
                    },
                  )
                }
              >
                Save
              </Button>
            )}
          </div>
          {canWrite ? (
            <textarea
              className="textarea"
              aria-label="Management commentary"
              placeholder="Your narrative for management — wins, risks, decisions needed, resourcing asks…"
              value={commentary}
              onChange={(event) => {
                setCommentary(event.target.value);
                setDirty(true);
              }}
            />
          ) : (
            <p className="text-sm text-secondary" style={{ whiteSpace: 'pre-wrap' }}>
              {report.commentary || 'No commentary has been added.'}
            </p>
          )}
        </div>
      </Card>

      <div className="grid grid-2" style={{ margin: 'var(--space-5) 0' }}>
        <Card title="Status by category">
          {report.byCategory.length === 0 ? (
            <p className="text-sm text-secondary">No categories in this view.</p>
          ) : (
            <div className="stack gap-3">
              {report.byCategory.map((row) => (
                <div key={row.categoryId} className="row gap-3">
                  <span className="text-sm" style={{ width: 150, flex: '0 0 150px' }}>
                    {row.categoryName}
                  </span>
                  <div className="stackbar grow" style={{ height: 18 }}>
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
                    style={{ width: 24, textAlign: 'right' }}
                  >
                    {row.total}
                  </span>
                </div>
              ))}
              <ul className="chart-legend">
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

        <Card title="Progress by phase">
          {report.byPhase.length === 0 ? (
            <p className="text-sm text-secondary">No phases in use.</p>
          ) : (
            <div className="stack gap-4">
              {report.byPhase.map((row) => (
                <div key={row.phase.id}>
                  <div className="row-between" style={{ marginBottom: 5 }}>
                    <span className="row gap-2 text-sm">
                      <span className="phase-swatch" style={{ background: row.phase.colour }} />
                      {row.phase.name}
                    </span>
                    <span className="text-2xs text-tertiary">
                      {row.materialsOutstanding} outstanding order
                      {row.materialsOutstanding === 1 ? '' : 's'}
                    </span>
                  </div>
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

      {report.atRisk.length > 0 && (
        <Card
          title="Needs attention"
          description="Projects failing at least one configured risk rule."
          className="stack"
          padded
        >
          <div className="stack gap-2">
            {report.atRisk.map((project) => (
              <div
                key={project.id}
                className="row-between gap-4"
                style={{
                  padding: 'var(--space-3)',
                  border: '1px solid var(--danger-border)',
                  background: 'var(--danger-bg)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div>
                  <div className="font-semibold text-sm">{project.name}</div>
                  <ul className="reason-chips" style={{ marginTop: 4 }}>
                    {project.metrics.riskReasons.map((reason) => (
                      <li key={reason} className="reason-chip">
                        <IconAlert size={10} />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
                <span className="text-xs shrink-0">
                  {formatIso(project.handoverDate, settings.locale)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Project status sheet"
        description="The full portfolio at a glance."
        className="no-print-break"
        padded={false}
        style={{ marginTop: 'var(--space-5)' }}
      >
        <div className="scroll-x">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Handover</th>
                <th>Design</th>
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
  );
}
