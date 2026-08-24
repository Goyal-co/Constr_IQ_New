import { useState } from 'react';
import { useAuditLog, useUsers } from '@/lib/queries';
import {
  formatAuditValue,
  formatRelative,
  formatTimestamp,
  humaniseAction,
  humaniseField,
} from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { Avatar, Badge, Button, EmptyState, SkeletonRows } from '@/components/ui';
import { IconAudit, IconChevronLeft, IconChevronRight } from '@/components/ui/Icons';
import { PageHeader } from '@/components/domain';

const ENTITY_TYPES = [
  'Project',
  'Drawing',
  'Material',
  'Activity',
  'User',
  'Phase',
  'Category',
  'Template',
  'Organisation',
  'Report',
];

/**
 * Audit trail.
 *
 * Every create, update and delete, with the actor, the time, and a field-level
 * before/after diff. This is what turns "someone changed the lead time" into a
 * question with an answer.
 */
export function AuditPage() {
  const { settings } = useAuth();
  const users = useUsers(true);

  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');

  const { data, isLoading, isFetching } = useAuditLog({
    page,
    pageSize: 40,
    ...(entityType ? { entityType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(action ? { action } : {}),
  });

  const resetTo = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="An immutable record of every change, with who made it and exactly what moved."
      />

      <div className="card card-pad" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="row gap-3 wrap">
          <input
            className="input"
            style={{ flex: '1 1 200px' }}
            placeholder="Filter by action, e.g. material.ordered"
            aria-label="Filter by action"
            value={action}
            onChange={(event) => resetTo(() => setAction(event.target.value))}
          />
          <select
            className="select"
            style={{ width: 'auto', minWidth: 150 }}
            aria-label="Filter by record type"
            value={entityType}
            onChange={(event) => resetTo(() => setEntityType(event.target.value))}
          >
            <option value="">All record types</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select
            className="select"
            style={{ width: 'auto', minWidth: 170 }}
            aria-label="Filter by person"
            value={actorId}
            onChange={(event) => resetTo(() => setActorId(event.target.value))}
          >
            <option value="">Anyone</option>
            {users.data?.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
          {(action || entityType || actorId) && (
            <Button
              onClick={() =>
                resetTo(() => {
                  setAction('');
                  setEntityType('');
                  setActorId('');
                })
              }
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <SkeletonRows rows={6} height={72} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={<IconAudit size={20} />}
          title="No entries match these filters"
          message="Every create, update and delete is recorded here. Try widening the filters."
        />
      ) : (
        <>
          <div
            className="stack gap-2"
            style={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity 120ms' }}
          >
            {data.items.map((entry) => (
              <article key={entry.id} className="card card-pad">
                <div className="row-between gap-4 wrap">
                  <div className="row gap-3" style={{ minWidth: 0 }}>
                    {entry.actor ? (
                      <Avatar name={entry.actor.name} size="sm" />
                    ) : (
                      <span className="avatar avatar-sm">SY</span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div className="text-sm">
                        <span className="font-semibold">{entry.actor?.name ?? 'System'}</span>{' '}
                        <span className="text-secondary">
                          {humaniseAction(entry.action).toLowerCase()}
                        </span>
                      </div>
                      {entry.entityLabel && (
                        <div className="text-xs text-tertiary truncate">{entry.entityLabel}</div>
                      )}
                    </div>
                  </div>
                  <div className="row gap-3 shrink-0">
                    <Badge tone="neutral">{entry.entityType}</Badge>
                    <span
                      className="text-xs text-tertiary"
                      title={formatTimestamp(entry.createdAt, settings.locale)}
                    >
                      {formatRelative(entry.createdAt, settings.locale)}
                    </span>
                  </div>
                </div>

                {entry.changes.length > 0 && (
                  <div
                    className="scroll-x"
                    style={{
                      marginTop: 'var(--space-3)',
                      paddingTop: 'var(--space-3)',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <table className="table" style={{ fontSize: 'var(--text-xs)' }}>
                      <tbody>
                        {entry.changes.map((change) => (
                          <tr key={change.field}>
                            <td style={{ width: 180, color: 'var(--text-tertiary)' }}>
                              {humaniseField(change.field)}
                            </td>
                            <td
                              style={{
                                textDecoration: 'line-through',
                                color: 'var(--text-tertiary)',
                              }}
                            >
                              {formatAuditValue(change.before)}
                            </td>
                            <td style={{ width: 20, color: 'var(--text-tertiary)' }}>→</td>
                            <td className="font-medium">{formatAuditValue(change.after)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="row-between" style={{ marginTop: 'var(--space-5)' }}>
            <span className="text-sm text-tertiary">
              Page {data.page} of {data.totalPages} · {data.total} entries
            </span>
            <div className="row gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <IconChevronLeft size={14} />
                Previous
              </Button>
              <Button
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <IconChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
