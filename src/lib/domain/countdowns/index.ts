export const COUNTDOWN_CATEGORIES = [
  "threat",
  "project",
  "consequence",
  "other",
] as const;

export type CountdownCategory = (typeof COUNTDOWN_CATEGORIES)[number];

export const COUNTDOWN_STATUSES = [
  "active",
  "paused",
  "completed",
  "cancelled",
] as const;

export type CountdownStatus = (typeof COUNTDOWN_STATUSES)[number];

export const COUNTDOWN_INTENTS = [
  "advance",
  "reverse",
  "pause",
  "resume",
  "cancel",
] as const;

export type CountdownIntent = (typeof COUNTDOWN_INTENTS)[number];

export class CountdownRangeError extends RangeError {
  constructor(message = "Countdown value must remain between 0 and its starting value.") {
    super(message);
    this.name = "CountdownRangeError";
  }
}

export function calculateCountdownValue(
  currentValue: number,
  changeAmount: number,
  startingValue: number,
): number {
  if (![currentValue, changeAmount, startingValue].every(Number.isInteger)) {
    throw new CountdownRangeError("Countdown values must be integers.");
  }

  const nextValue = currentValue + changeAmount;
  if (startingValue <= 0 || nextValue < 0 || nextValue > startingValue) {
    throw new CountdownRangeError();
  }

  return nextValue;
}

export function statusAfterCountdownChange(
  previousStatus: CountdownStatus,
  newValue: number,
): CountdownStatus {
  if (previousStatus === "cancelled") {
    throw new Error("Cancelled countdowns cannot be changed.");
  }

  if (newValue === 0) {
    return "completed";
  }

  return previousStatus === "completed" ? "active" : previousStatus;
}

export function canPauseCountdown(status: CountdownStatus): boolean {
  return status === "active";
}

export function canResumeCountdown(status: CountdownStatus): boolean {
  return status === "paused";
}

export function canCancelCountdown(status: CountdownStatus): boolean {
  return status === "active" || status === "paused";
}

export function canAdvanceCountdown(
  status: CountdownStatus,
  currentValue: number,
): boolean {
  return status === "active" && currentValue > 0;
}

export function canReverseCountdown(
  status: CountdownStatus,
  currentValue: number,
  startingValue: number,
): boolean {
  return (
    (status === "active" || status === "completed") &&
    currentValue < startingValue
  );
}

export function amountForCountdownIntent(intent: CountdownIntent): number {
  if (intent === "advance") return -1;
  if (intent === "reverse") return 1;
  return 0;
}

/** Starting values offered by the dashboard's countdown picker. */
export const MAX_COUNTDOWN_START = 20;

export type CountdownAction = CountdownIntent | "correction";

export type CountdownState = {
  startingValue: number;
  currentValue: number;
  status: CountdownStatus;
};

export class CountdownRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CountdownRuleError";
  }
}

/**
 * Applies one countdown action, matching the legacy
 * `operate_campaign_countdown` SQL: advance/reverse move ±1 and are blocked
 * while paused; a correction moves by any non-zero amount, also while paused;
 * a completed countdown reopens only by a positive reverse or correction;
 * reaching 0 completes it; a cancelled countdown is final.
 * `completedNow` is true when this change completes an open countdown, so the
 * completion time is recorded once per active lifecycle.
 */
export function applyCountdownAction(
  state: CountdownState,
  action: CountdownAction,
  correctionAmount = 0,
): CountdownState & { completedNow: boolean; reopened: boolean } {
  if (state.status === "cancelled") {
    throw new CountdownRuleError("Cancelled countdowns cannot be changed.");
  }
  const unchanged = { ...state, completedNow: false, reopened: false };

  if (action === "pause") {
    if (state.status !== "active") throw new CountdownRuleError("Only an active countdown can be paused.");
    return { ...unchanged, status: "paused" };
  }
  if (action === "resume") {
    if (state.status !== "paused") throw new CountdownRuleError("Only a paused countdown can be resumed.");
    return { ...unchanged, status: "active" };
  }
  if (action === "cancel") {
    if (!canCancelCountdown(state.status)) {
      throw new CountdownRuleError("Only an active or paused countdown can be cancelled.");
    }
    return { ...unchanged, status: "cancelled" };
  }

  const amount = action === "correction" ? correctionAmount : amountForCountdownIntent(action);
  if (!Number.isInteger(amount) || amount === 0) {
    throw new CountdownRuleError("A correction must change the value.");
  }
  if (action !== "correction" && state.status === "paused") {
    throw new CountdownRuleError("Resume the countdown before changing its value.");
  }
  if (state.status === "completed" && amount < 0) {
    throw new CountdownRuleError("A completed countdown must be reversed to reopen it.");
  }

  const currentValue = calculateCountdownValue(state.currentValue, amount, state.startingValue);
  const status = statusAfterCountdownChange(state.status, currentValue);
  return {
    startingValue: state.startingValue,
    currentValue,
    status,
    completedNow: status === "completed" && state.status !== "completed",
    reopened: state.status === "completed" && status !== "completed",
  };
}

/** Countdown fields the GM can hide from players on a public countdown ("progress" = current and starting value). */
export const COUNTDOWN_HIDEABLE_FIELDS = ["name", "description", "category", "consequence", "progress"] as const;

export type CountdownHideableField = (typeof COUNTDOWN_HIDEABLE_FIELDS)[number];

/** Who sees a dashboard countdown. Stored countdowns without one are fully public. */
export type CountdownVisibility = { mode: "private" } | { mode: "public"; hidden: CountdownHideableField[] };

export type CountdownVisibilityPreset = "private" | "partly" | "public";

/** What "Public, details hidden" hides until the GM ticks other fields. */
export const DEFAULT_HIDDEN_COUNTDOWN_FIELDS: CountdownHideableField[] = ["name", "description"];

/** The three presets: A private, B public with name and description hidden, C public. */
export const COUNTDOWN_VISIBILITY_PRESETS: Record<CountdownVisibilityPreset, CountdownVisibility> = {
  private: { mode: "private" },
  partly: { mode: "public", hidden: DEFAULT_HIDDEN_COUNTDOWN_FIELDS },
  public: { mode: "public", hidden: [] },
};

/** One entry per hidden field, in the canonical order, so the stored array stays capped at five. */
export function normaliseCountdownVisibility(visibility: CountdownVisibility): CountdownVisibility {
  if (visibility.mode === "private") return { mode: "private" };
  return { mode: "public", hidden: COUNTDOWN_HIDEABLE_FIELDS.filter((f) => visibility.hidden.includes(f)) };
}

/** Private, Partly hidden (public with at least one hidden field) or Public. */
export function countdownVisibilityPreset(visibility: CountdownVisibility): CountdownVisibilityPreset {
  if (visibility.mode === "private") return "private";
  return visibility.hidden.length > 0 ? "partly" : "public";
}

type CountdownDetails = {
  name: string;
  description: string;
  category: CountdownCategory;
  consequence: string;
  startingValue: number;
  currentValue: number;
};

/**
 * What a player may see of a countdown: `null` for a private one (players never receive it), otherwise
 * the countdown with every hidden field set to `null` (hidden progress blanks both values; the status stays).
 */
export function countdownForPlayer<T extends CountdownDetails>(countdown: T, visibility: CountdownVisibility) {
  if (visibility.mode === "private") return null;
  const hide = (field: CountdownHideableField) => visibility.hidden.includes(field);
  return {
    ...countdown,
    name: hide("name") ? null : countdown.name,
    description: hide("description") ? null : countdown.description,
    category: hide("category") ? null : countdown.category,
    consequence: hide("consequence") ? null : countdown.consequence,
    startingValue: hide("progress") ? null : countdown.startingValue,
    currentValue: hide("progress") ? null : countdown.currentValue,
  };
}
