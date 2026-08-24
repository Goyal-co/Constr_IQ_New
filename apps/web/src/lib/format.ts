import {
  formatDate as formatDateShared,
  formatDateShort as formatDateShortShared,
  parseIsoDate,
  type IsoDate,
} from '@ciq/shared';

/**
 * Presentation helpers.
 *
 * All date formatting funnels through the shared UTC-stable helpers, so a
 * handover date renders identically in Bengaluru and in a UTC CI runner.
 */

export function formatIso(date: IsoDate | null | undefined, locale = 'en-GB'): string {
  return date ? formatDateShared(parseIsoDate(date), locale) : '—';
}

export function formatIsoShort(date: IsoDate | null | undefined, locale = 'en-GB'): string {
  return date ? formatDateShortShared(parseIsoDate(date), locale) : '—';
}

export function formatTimestamp(value: string | null | undefined, locale = 'en-GB'): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "just now" / "4h ago" / "12 Mar" — for audit and notification lists. */
export function formatRelative(value: string | null | undefined, locale = 'en-GB'): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);

  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d ago`;

  return new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** Days remaining, phrased for a countdown chip. */
export function formatCountdown(days: number | null): string {
  if (days === null) return 'No date set';
  if (days === 0) return 'Today';
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} left`;
  const overdue = Math.abs(days);
  return `${overdue} day${overdue === 1 ? '' : 's'} overdue`;
}

export function formatCurrency(
  amount: number | null | undefined,
  currency = 'INR',
  locale = 'en-IN',
): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Initials for the avatar. Two letters at most, so the circle stays legible. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '');
}

/** Turns `project.status_changed` into `Project status changed` for the audit list. */
export function humaniseAction(action: string): string {
  const text = action.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Turns a camelCase field name into a readable label for audit diffs. */
export function humaniseField(field: string): string {
  const text = field.replace(/([A-Z])/g, ' $1').replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** Renders an audit diff value without dumping raw JSON at the reader. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatIso(value.slice(0, 10)) : value;
  }
  return JSON.stringify(value);
}
