export const MIN_FEAR = 0;
export const MAX_FEAR = 12;

export type FearDirection = "increase" | "decrease";
export type FearEventType = "adjustment" | "correction";

export class FearRangeError extends RangeError {
  constructor() {
    super(`Fear must remain between ${MIN_FEAR} and ${MAX_FEAR}.`);
    this.name = "FearRangeError";
  }
}

export function amountForFearDirection(direction: FearDirection): 1 | -1 {
  return direction === "increase" ? 1 : -1;
}

export function calculateFearAfterAdjustment(
  currentFear: number,
  amount: number,
): number {
  if (!Number.isInteger(currentFear) || !Number.isInteger(amount) || amount === 0) {
    throw new TypeError("Fear values and changes must be non-zero integers.");
  }

  const nextFear = currentFear + amount;
  if (nextFear < MIN_FEAR || nextFear > MAX_FEAR) {
    throw new FearRangeError();
  }

  return nextFear;
}

export function canIncreaseFear(currentFear: number): boolean {
  return currentFear < MAX_FEAR;
}

export function canDecreaseFear(currentFear: number): boolean {
  return currentFear > MIN_FEAR;
}

/** Validates a Fear total set directly (the dashboard's tokens). */
export function assertFearValue(value: number): void {
  if (!Number.isInteger(value) || value < MIN_FEAR || value > MAX_FEAR) {
    throw new FearRangeError();
  }
}
