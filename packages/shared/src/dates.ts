/**
 * Date helpers for programme maths.
 *
 * Everything here is UTC and date-only on purpose. A handover date, an order-by
 * date and a planned activity date are calendar facts, not instants — treating
 * them as local timestamps makes a site engineer in IST and a server in UTC
 * disagree about whether an order is one day late. Domain dates travel as
 * `YYYY-MM-DD` strings and are only widened to `Date` for arithmetic.
 */

export const MS_PER_DAY = 86_400_000;

export type IsoDate = string; // 'YYYY-MM-DD'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Parse a `YYYY-MM-DD` string into a UTC-midnight Date. Returns null when unusable. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.slice(0, 10);
  if (!ISO_DATE_RE.test(trimmed)) return null;
  const [y, m, d] = trimmed.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Render a Date as a `YYYY-MM-DD` string using its UTC parts. */
export function toIsoDate(date: Date | null | undefined): IsoDate | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** Today at UTC midnight — the reference point for every "is it late" question. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Last calendar day of the month containing `date`. */
export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Parse the loose "Feb 2026" handover format used by the original spreadsheet and
 * the v1 prototype, resolving to the last day of that month. Retained so legacy
 * exports can be imported without a manual clean-up pass.
 */
export function parseLegacyHandover(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = String(value)
    .trim()
    .toLowerCase()
    .match(/([a-z]{3,})\s+(\d{4})/);
  if (!match) return null;
  const monthIndex = MONTH_NAMES.findIndex((m) => m.toLowerCase() === match[1].slice(0, 3));
  if (monthIndex < 0) return null;
  const year = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year)) return null;
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

/**
 * Order-by date for a material: walk back from handover by the supplier lead time.
 * This is the whole point of the procurement view — miss this date and the item
 * lands after the site needs it.
 */
export function orderByDate(handover: Date | null, leadTimeWeeks: number): Date | null {
  if (!handover) return null;
  return addWeeks(handover, -Math.max(0, leadTimeWeeks));
}

// ---------------------------------------------------------------------------
// Presentation helpers (UTC-stable, locale-formatted)
// ---------------------------------------------------------------------------

export function formatDate(date: Date | null | undefined, locale = 'en-GB'): string {
  if (!date) return '—';
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateShort(date: Date | null | undefined, locale = 'en-GB'): string {
  if (!date) return '—';
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function formatMonthYear(date: Date | null | undefined, locale = 'en-GB'): string {
  if (!date) return '—';
  return date.toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "12 days late" / "in 4 days" / "today" — used across chips and tables. */
export function formatRelativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;
  const overdue = Math.abs(days);
  return `${overdue} day${overdue === 1 ? '' : 's'} overdue`;
}
