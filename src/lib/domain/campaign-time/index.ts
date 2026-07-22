/**
 * Campaign-time domain logic.
 *
 * Canonical campaign time is stored as (current_week, current_cycle,
 * current_cycle_day). The named time phase (e.g. "Forenoon") is a presentation
 * value derived here and is never persisted as the current time. This module is
 * the single source of truth for the phase mapping.
 */

export type CampaignCycle = "DAY" | "NIGHT";

export type CampaignCycleDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type CampaignTime = {
  currentWeek: number;
  currentCycle: CampaignCycle;
  currentCycleDay: CampaignCycleDay;
};

export const MIN_CYCLE_DAY = 1;
export const MAX_CYCLE_DAY = 7;
export const MIN_WEEK = 1;

const DAY_PHASES = [
  "Dawn",
  "Sunrise",
  "Morning",
  "Forenoon",
  "Midday",
  "Afternoon",
  "Civil Twilight",
] as const;

const NIGHT_PHASES = [
  "Nautical Twilight",
  "Astronomical Twilight",
  "Evening",
  "Night",
  "Midnight",
  "Dead of Night",
  "Pre-Dawn",
] as const;

export type CampaignPhaseName =
  | (typeof DAY_PHASES)[number]
  | (typeof NIGHT_PHASES)[number];

function assertValidCycle(cycle: CampaignCycle): void {
  if (cycle !== "DAY" && cycle !== "NIGHT") {
    throw new RangeError(`cycle must be DAY or NIGHT, received ${cycle}`);
  }
}

/** Type guard for a valid cycle day (an integer from 1 through 7). */
export function isCampaignCycleDay(value: number): value is CampaignCycleDay {
  return (
    Number.isInteger(value) &&
    value >= MIN_CYCLE_DAY &&
    value <= MAX_CYCLE_DAY
  );
}

function assertValidCycleDay(
  cycleDay: number,
): asserts cycleDay is CampaignCycleDay {
  if (!isCampaignCycleDay(cycleDay)) {
    throw new RangeError(
      `cycleDay must be an integer between ${MIN_CYCLE_DAY} and ${MAX_CYCLE_DAY}, received ${cycleDay}`,
    );
  }
}

/** Narrows an arbitrary number to a CampaignCycleDay or throws. */
export function toCampaignCycleDay(value: number): CampaignCycleDay {
  assertValidCycleDay(value);
  return value;
}

/**
 * Returns the derived display phase for a cycle and cycle day.
 */
export function getPhaseName(
  cycle: CampaignCycle,
  cycleDay: number,
): CampaignPhaseName {
  assertValidCycle(cycle);
  assertValidCycleDay(cycleDay);
  const phases = cycle === "DAY" ? DAY_PHASES : NIGHT_PHASES;
  return phases[cycleDay - 1];
}

/** Returns the complete immutable phase sequence for a cycle. */
export function getCyclePhases(
  cycle: CampaignCycle,
): readonly CampaignPhaseName[] {
  assertValidCycle(cycle);
  return cycle === "DAY" ? DAY_PHASES : NIGHT_PHASES;
}

/** Throws when canonical campaign-time state is invalid. */
export function assertValidCampaignTime(time: CampaignTime): void {
  if (!Number.isInteger(time.currentWeek) || time.currentWeek < MIN_WEEK) {
    throw new RangeError(
      `currentWeek must be an integer >= ${MIN_WEEK}, received ${time.currentWeek}`,
    );
  }
  assertValidCycle(time.currentCycle);
  assertValidCycleDay(time.currentCycleDay);
}

/** Returns the next canonical state after exactly one campaign day. */
export function getNextCampaignTime(current: CampaignTime): CampaignTime {
  assertValidCampaignTime(current);

  if (current.currentCycleDay < MAX_CYCLE_DAY) {
    return {
      ...current,
      currentCycleDay: toCampaignCycleDay(current.currentCycleDay + 1),
    };
  }

  return {
    currentWeek: current.currentWeek + 1,
    currentCycle: current.currentCycle === "DAY" ? "NIGHT" : "DAY",
    currentCycleDay: MIN_CYCLE_DAY,
  };
}

/**
 * Returns a human-readable label, e.g. "Week 8 • Day Cycle • Forenoon".
 */
export function formatCampaignTime(time: CampaignTime): string {
  assertValidCampaignTime(time);
  const cycleLabel = time.currentCycle === "DAY" ? "Day Cycle" : "Night Cycle";
  const phase = getPhaseName(time.currentCycle, time.currentCycleDay);
  return `Week ${time.currentWeek} • ${cycleLabel} • ${phase}`;
}
