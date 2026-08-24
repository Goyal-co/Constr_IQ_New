import type { ProjectStatus } from '@ciq/shared';

/**
 * Chart series colours.
 *
 * Thin indirection over the CSS custom properties, so a chart written in JSX
 * reaches for the same token a stylesheet would. Keeping it here rather than
 * beside a component means every stacked bar in the app paints a given status
 * the same colour — a status that changed hue between two charts on one page
 * would read as two different things.
 *
 * The values themselves, and why they are not the badge tones, are documented
 * where they are defined: `styles/tokens.css`.
 */

/**
 * Project status → series colour, in the fixed order the palette was validated
 * in: Discussion, In Progress, On Hold, Completed. Assigned in that order and
 * never cycled.
 */
export const STATUS_SERIES: Record<ProjectStatus, string> = {
  DISCUSSION: 'var(--chart-status-1)',
  IN_PROGRESS: 'var(--chart-status-2)',
  ON_HOLD: 'var(--chart-status-3)',
  COMPLETED: 'var(--chart-status-4)',
};

/** Single-hue ramps for magnitude. One hue each — never a rainbow. */
export const TRACK_COLOUR = {
  design: 'var(--chart-design)',
  execution: 'var(--chart-execution)',
} as const;
