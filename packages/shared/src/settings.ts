/**
 * Organisation settings — every tunable number in the engine.
 *
 * Nothing in the metric functions is a literal. Each threshold, window and weight
 * arrives from here, loaded per organisation from the database, so a business can
 * change what "due soon" or "at risk" means without a code change.
 *
 * `DEFAULT_SETTINGS` exists only to bootstrap a brand-new organisation and to
 * keep pure functions callable in tests. It is written to the database on setup
 * and read from there thereafter — it is a starting point, never the law.
 */

import type { ActivityStatus } from './constants';

export interface OrganisationSettings {
  /**
   * Days before a material's order-by date at which it escalates from
   * "scheduled" to "due soon" — how much warning procurement wants.
   */
  orderSoonWindowDays: number;

  /**
   * A project is flagged at risk when handover falls inside this many days while
   * drawing progress is still below `riskDrawingThresholdPct`.
   */
  riskHandoverWindowDays: number;
  riskDrawingThresholdPct: number;

  /** Whether a slipping site activity on its own is enough to flag a project. */
  riskOnSlippedActivity: boolean;

  /** Whether an overdue material order on its own is enough to flag a project. */
  riskOnOverdueOrder: boolean;

  /**
   * Percentage credit each activity state contributes to phase completion.
   *
   * Defaults score BLOCKED at zero: blocked work is stalled, not half-finished,
   * and crediting it would flatter the programme. An organisation that reports
   * differently can change it here rather than arguing with the chart.
   */
  activityStatusWeights: Record<ActivityStatus, number>;

  /** Fallback programme length, in weeks, when a template does not specify one. */
  defaultProgrammeWeeks: number;

  /** Lead time applied to a new material when none is given. */
  defaultLeadTimeWeeks: number;

  /** Days before handover at which the scheduler raises a reminder. */
  handoverReminderDays: number;

  /** ISO 4217 code used for new projects. */
  defaultCurrency: string;

  /** BCP-47 tag driving date and number formatting across the app and exports. */
  locale: string;

  /** Weekly management digest: day of week (0 = Sunday) and hour, both UTC. */
  digestDayOfWeek: number;
  digestHourUtc: number;
}

export const DEFAULT_SETTINGS: OrganisationSettings = {
  orderSoonWindowDays: 21,
  riskHandoverWindowDays: 42,
  riskDrawingThresholdPct: 60,
  riskOnSlippedActivity: true,
  riskOnOverdueOrder: true,
  activityStatusWeights: {
    NOT_STARTED: 0,
    IN_PROGRESS: 50,
    DONE: 100,
    BLOCKED: 0,
  },
  defaultProgrammeWeeks: 20,
  defaultLeadTimeWeeks: 6,
  handoverReminderDays: 30,
  defaultCurrency: 'INR',
  locale: 'en-GB',
  digestDayOfWeek: 1,
  digestHourUtc: 3,
};

/**
 * Fills gaps in a stored settings row with defaults.
 *
 * Settings are persisted as JSON, so a row written before a new key existed will
 * be missing it. Merging here means adding a setting never requires a migration
 * or leaves an organisation with `undefined` where a number belongs.
 */
export function withSettingDefaults(
  partial: Partial<OrganisationSettings> | null | undefined,
): OrganisationSettings {
  if (!partial) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    activityStatusWeights: {
      ...DEFAULT_SETTINGS.activityStatusWeights,
      ...(partial.activityStatusWeights ?? {}),
    },
  };
}
