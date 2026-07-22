import { describe, expect, it } from "vitest";

import {
  amountForFearDirection,
  calculateFearAfterAdjustment,
  canDecreaseFear,
  canIncreaseFear,
  FearRangeError,
  MAX_FEAR,
  MIN_FEAR,
} from "@/lib/domain/fear";

describe("Fear domain rules", () => {
  it("maps increase and decrease controls to one-point changes", () => {
    expect(amountForFearDirection("increase")).toBe(1);
    expect(amountForFearDirection("decrease")).toBe(-1);
  });

  it("increments and decrements within the valid range", () => {
    expect(calculateFearAfterAdjustment(0, 1)).toBe(1);
    expect(calculateFearAfterAdjustment(12, -1)).toBe(11);
  });

  it("rejects results below zero and above twelve", () => {
    expect(() => calculateFearAfterAdjustment(MIN_FEAR, -1)).toThrow(
      FearRangeError,
    );
    expect(() => calculateFearAfterAdjustment(MAX_FEAR, 1)).toThrow(
      FearRangeError,
    );
  });

  it("rejects zero, fractional, and non-integer inputs", () => {
    expect(() => calculateFearAfterAdjustment(4, 0)).toThrow(TypeError);
    expect(() => calculateFearAfterAdjustment(4, 0.5)).toThrow(TypeError);
    expect(() => calculateFearAfterAdjustment(3.5, 1)).toThrow(TypeError);
  });

  it("disables the appropriate direction at each boundary", () => {
    expect(canDecreaseFear(MIN_FEAR)).toBe(false);
    expect(canIncreaseFear(MIN_FEAR)).toBe(true);
    expect(canDecreaseFear(MAX_FEAR)).toBe(true);
    expect(canIncreaseFear(MAX_FEAR)).toBe(false);
  });
});
