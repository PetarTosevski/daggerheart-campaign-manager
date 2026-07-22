import { describe, expect, it } from "vitest";

import {
  amountForCountdownIntent,
  calculateCountdownValue,
  canAdvanceCountdown,
  canCancelCountdown,
  canPauseCountdown,
  canResumeCountdown,
  canReverseCountdown,
  CountdownRangeError,
  statusAfterCountdownChange,
} from "@/lib/domain/countdowns";

describe("countdown domain", () => {
  it("calculates advances and reversals within the initial range", () => {
    expect(calculateCountdownValue(6, -1, 6)).toBe(5);
    expect(calculateCountdownValue(5, 1, 6)).toBe(6);
  });

  it("rejects values below zero, above the initial value, or non-integers", () => {
    expect(() => calculateCountdownValue(0, -1, 6)).toThrow(CountdownRangeError);
    expect(() => calculateCountdownValue(6, 1, 6)).toThrow(CountdownRangeError);
    expect(() => calculateCountdownValue(3, 0.5, 6)).toThrow(
      "Countdown values must be integers.",
    );
  });

  it("completes at zero and reopens when reversed above zero", () => {
    expect(statusAfterCountdownChange("active", 0)).toBe("completed");
    expect(statusAfterCountdownChange("completed", 1)).toBe("active");
    expect(() => statusAfterCountdownChange("cancelled", 1)).toThrow(
      "Cancelled countdowns cannot be changed.",
    );
  });

  it("enforces value and status control availability", () => {
    expect(canAdvanceCountdown("active", 1)).toBe(true);
    expect(canAdvanceCountdown("paused", 1)).toBe(false);
    expect(canReverseCountdown("completed", 0, 6)).toBe(true);
    expect(canReverseCountdown("active", 6, 6)).toBe(false);
    expect(canPauseCountdown("active")).toBe(true);
    expect(canResumeCountdown("paused")).toBe(true);
    expect(canCancelCountdown("paused")).toBe(true);
    expect(canCancelCountdown("completed")).toBe(false);
  });

  it("maps one-point intents to signed changes", () => {
    expect(amountForCountdownIntent("advance")).toBe(-1);
    expect(amountForCountdownIntent("reverse")).toBe(1);
    expect(amountForCountdownIntent("pause")).toBe(0);
    expect(amountForCountdownIntent("resume")).toBe(0);
    expect(amountForCountdownIntent("cancel")).toBe(0);
  });
});
