import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { NotificationKind, Tone } from '@ciq/shared';
import { useNotificationActions, useNotifications } from '@/lib/queries';
import { formatRelative } from '@/lib/format';
import { Badge, Button, EmptyState, SkeletonRows } from '@/components/ui';
import { IconBell, IconCheck, IconX } from '@/components/ui/Icons';

/**
 * Notification centre.
 *
 * Alerts are raised by the nightly sweep and by actions that affect someone
 * else's work. Each carries the project it came from so the reader can act
 * without hunting for it.
 */

const KIND_TONE: Record<NotificationKind, Tone> = {
  MATERIAL_OVERDUE: 'danger',
  MATERIAL_DUE_SOON: 'warning',
  ACTIVITY_SLIPPED: 'danger',
  PROJECT_AT_RISK: 'danger',
  PROJECT_ASSIGNED: 'info',
  HANDOVER_APPROACHING: 'warning',
  MENTION: 'info',
};

const KIND_LABEL: Record<NotificationKind, string> = {
  MATERIAL_OVERDUE: 'Order overdue',
  MATERIAL_DUE_SOON: 'Order due',
  ACTIVITY_SLIPPED: 'Behind plan',
  PROJECT_AT_RISK: 'At risk',
  PROJECT_ASSIGNED: 'Assigned',
  HANDOVER_APPROACHING: 'Handover',
  MENTION: 'Mention',
};

export function NotificationDrawer({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useNotifications({ pageSize: 40 });
  const { markRead, markAllRead, dismiss } = useNotificationActions();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const items = data?.items ?? [];
  const unreadCount = items.filter((item) => !item.isRead).length;

  return (
    <>
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Notifications">
        <header className="card-head">
          <div>
            <div className="card-title">
              <IconBell size={16} />
              Notifications
            </div>
            <p className="card-desc">
              {unreadCount > 0 ? `${unreadCount} unread` : 'Nothing needs your attention'}
            </p>
          </div>
          <div className="row gap-2">
            {unreadCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => markAllRead.mutate()}>
                <IconCheck size={14} />
                Mark all read
              </Button>
            )}
            <Button size="sm" variant="ghost" iconOnly onClick={onClose} aria-label="Close">
              <IconX size={16} />
            </Button>
          </div>
        </header>

        <div className="grow" style={{ overflowY: 'auto', padding: 'var(--space-3)' }}>
          {isLoading ? (
            <SkeletonRows rows={5} height={72} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<IconBell size={20} />}
              title="You are all caught up"
              message="Alerts appear here when an order passes its order-by date, an activity falls behind plan, or a handover approaches."
            />
          ) : (
            <div className="stack gap-2">
              {items.map((notification) => (
                <article
                  key={notification.id}
                  className="card card-pad"
                  style={{
                    // A quiet left rule marks unread without shouting; a fully
                    // tinted card for every unread item turns the panel into noise.
                    borderLeft: notification.isRead ? undefined : '3px solid var(--accent-solid)',
                  }}
                >
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <Badge tone={KIND_TONE[notification.kind]}>
                      {KIND_LABEL[notification.kind]}
                    </Badge>
                    <div className="row gap-1">
                      <span className="text-2xs text-tertiary">
                        {formatRelative(notification.createdAt)}
                      </span>
                      <button
                        type="button"
                        className="row-action"
                        style={{ opacity: 1 }}
                        onClick={() => dismiss.mutate(notification.id)}
                        aria-label="Dismiss notification"
                      >
                        <IconX size={13} />
                      </button>
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold" style={{ marginTop: 'var(--space-2)' }}>
                    {notification.title}
                  </h3>
                  <p className="text-xs text-secondary" style={{ marginTop: 2 }}>
                    {notification.body}
                  </p>

                  <div className="row-between" style={{ marginTop: 'var(--space-3)' }}>
                    {notification.projectId ? (
                      <Link
                        to={`/projects/${notification.projectId}`}
                        className="text-xs font-medium"
                        onClick={() => {
                          if (!notification.isRead) markRead.mutate(notification.id);
                          onClose();
                        }}
                      >
                        {notification.projectName ?? 'Open project'} →
                      </Link>
                    ) : (
                      <span />
                    )}
                    {!notification.isRead && (
                      <button
                        type="button"
                        className="text-2xs text-tertiary"
                        onClick={() => markRead.mutate(notification.id)}
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
