import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { usePortfolioReport } from '@/lib/queries';
import { formatIso } from '@/lib/format';
import { Badge, Card, EmptyState, Kpi, SkeletonRows } from '@/components/ui';
import { IconProcurement, IconSearch } from '@/components/ui/Icons';
import { PageHeader } from '@/components/domain';

/**
 * Cross-project buying list.
 *
 * The one view that answers "what must be ordered this week" across the whole
 * portfolio. Per-project procurement lives on the project page; this exists
 * because a buyer works by date, not by project.
 */
export function ProcurementPage() {
  const { settings } = useAuth();
  const { data: report, isLoading } = usePortfolioReport({ scope: 'active' });
  const [search, setSearch] = useState('');

  const alerts = useMemo(() => {
    const rows = report?.procurementAlerts ?? [];
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((alert) =>
      `${alert.materialName} ${alert.projectName} ${alert.phaseName} ${alert.supplier ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [report, search]);

  if (isLoading || !report) {
    return (
      <>
        <PageHeader title="Procurement" />
        <SkeletonRows rows={5} height={64} />
      </>
    );
  }

  const overdue = alerts.filter((alert) => alert.procurementState === 'OVERDUE');
  const dueSoon = alerts.filter((alert) => alert.procurementState === 'DUE_SOON');

  return (
    <>
      <PageHeader
        title="Procurement"
        subtitle={`Order-by dates are handover minus lead time. An item is flagged ${settings.orderSoonWindowDays} days before its date — adjust that in Settings → Thresholds.`}
      />

      <div className="grid grid-auto-sm" style={{ marginBottom: 'var(--space-5)' }}>
        <Kpi
          value={overdue.length}
          label="Overdue"
          hint="Past the order-by date"
          tone={overdue.length > 0 ? 'danger' : 'success'}
        />
        <Kpi
          value={dueSoon.length}
          label="Due soon"
          hint={`Within ${settings.orderSoonWindowDays} days`}
          tone={dueSoon.length > 0 ? 'warning' : undefined}
        />
        <Kpi
          value={report.kpis.materialsTotal}
          label="Materials tracked"
          hint="Across active projects"
        />
      </div>

      <Card
        title="Order these next"
        icon={<IconProcurement size={16} />}
        description="Sorted by how soon each purchase order must be raised."
        actions={
          <div style={{ position: 'relative', width: 240 }}>
            <label className="visually-hidden" htmlFor="procurement-search">
              Search materials
            </label>
            <input
              id="procurement-search"
              className="input input-sm input-search"
              placeholder="Search material, project, supplier…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        }
        padded={false}
      >
        {alerts.length === 0 ? (
          <div style={{ padding: 'var(--space-6)' }}>
            <EmptyState
              icon={<IconSearch size={20} />}
              title={search ? 'Nothing matches that search' : 'Every order is inside its window'}
              message={
                search
                  ? 'Try a different material, project or supplier name.'
                  : 'No material on an active project is past, or approaching, its order-by date.'
              }
            />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Order by</th>
                  <th>Days</th>
                  <th>Material</th>
                  <th>Project</th>
                  <th>Phase</th>
                  <th className="num">Lead</th>
                  <th>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.materialId}>
                    <td data-label="Order by" style={{ whiteSpace: 'nowrap' }}>
                      {formatIso(alert.orderByDate, settings.locale)}
                    </td>
                    <td data-label="Days">
                      <Badge tone={alert.procurementState === 'OVERDUE' ? 'danger' : 'warning'}>
                        {alert.daysUntilOrderBy < 0
                          ? `${Math.abs(alert.daysUntilOrderBy)}d over`
                          : `in ${alert.daysUntilOrderBy}d`}
                      </Badge>
                    </td>
                    <td data-label="Material" className="font-medium">
                      {alert.materialName}
                    </td>
                    <td data-label="Project">
                      <Link to={`/projects/${alert.projectId}`}>{alert.projectName}</Link>
                    </td>
                    <td data-label="Phase" className="text-xs text-secondary">
                      {alert.phaseName}
                    </td>
                    <td data-label="Lead" className="num text-xs">
                      {alert.leadTimeWeeks}w
                    </td>
                    <td data-label="Supplier" className="text-xs text-secondary">
                      {alert.supplier ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
