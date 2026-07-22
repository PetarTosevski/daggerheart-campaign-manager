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
