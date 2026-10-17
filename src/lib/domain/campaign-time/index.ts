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

// Phase names from the CampaignHub design board (user decision 2026-10-17).
const DAY_PHASES = [
  "Dawn",
  "Sunrise",
  "Morning",
  "High Noon",
  "Afternoon",
  "Sunset",
  "Nautical Twilight",
] as const;

const NIGHT_PHASES = [
  "Nightfall",
  "Moonrise",
  "Deep Night",
  "Midnight",
  "Witching Hour",
  "Small Hours",
  "Nautical Dawn",
] as const;

/** Each week is one 7-day cycle; four weeks make a month (the board's default). */
export const WEEKS_PER_MONTH = 4;

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

/** The month (1-based) a campaign week falls in. */
export function monthOf(week: number): number {
  return Math.floor((week - 1) / WEEKS_PER_MONTH) + 1;
}

/** The week's position within its month, 1 to WEEKS_PER_MONTH. */
export function weekInMonth(week: number): number {
  return ((week - 1) % WEEKS_PER_MONTH) + 1;
}

/** Board label, e.g. "Month 2 · Week 1 · Day 4" (Cinzel renders the digits). */
export function formatCampaignTime(time: CampaignTime): string {
  assertValidCampaignTime(time);
  return `Month ${monthOf(time.currentWeek)} · Week ${weekInMonth(time.currentWeek)} · Day ${time.currentCycleDay}`;
}

/**
 * The state after setting the day within the current week (the board's arc
 * icons). Throws when the day is invalid or unchanged.
 */
export function withCycleDay(current: CampaignTime, cycleDay: number): CampaignTime {
  assertValidCampaignTime(current);
  const day = toCampaignCycleDay(cycleDay);
  if (day === current.currentCycleDay) {
    throw new RangeError("The campaign is already on that day.");
  }
  return { ...current, currentCycleDay: day };
}
