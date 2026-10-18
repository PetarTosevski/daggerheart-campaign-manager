import { describe, expect, it } from "vitest";

import {
  applyCountdownAction,
  COUNTDOWN_VISIBILITY_PRESETS,
  countdownForPlayer,
  countdownVisibilityPreset,
  CountdownRuleError,
  normaliseCountdownVisibility,
  type CountdownState,
} from "@/lib/domain/countdowns";
import { assertFearValue, FearRangeError } from "@/lib/domain/fear";

const at = (currentValue: number, status: CountdownState["status"] = "active"): CountdownState => ({
  startingValue: 4,
  currentValue,
  status,
});

describe("applyCountdownAction", () => {
  it("advances by one and completes at zero, once", () => {
    expect(applyCountdownAction(at(4), "advance")).toMatchObject({ currentValue: 3, status: "active", completedNow: false });
    expect(applyCountdownAction(at(1), "advance")).toMatchObject({ currentValue: 0, status: "completed", completedNow: true });
  });

  it("refuses to advance a completed countdown and to leave the range", () => {
    expect(() => applyCountdownAction(at(0, "completed"), "advance")).toThrow(CountdownRuleError);
    expect(() => applyCountdownAction(at(4), "reverse")).toThrow(RangeError);
  });

  it("reopens a completed countdown by reversing", () => {
    expect(applyCountdownAction(at(0, "completed"), "reverse")).toMatchObject({
      currentValue: 1,
      status: "active",
      reopened: true,
      completedNow: false,
    });
  });

  it("blocks advance and reverse while paused but allows a correction", () => {
    expect(() => applyCountdownAction(at(3, "paused"), "advance")).toThrow("Resume the countdown");
    expect(() => applyCountdownAction(at(3, "paused"), "reverse")).toThrow("Resume the countdown");
    expect(applyCountdownAction(at(3, "paused"), "correction", -2)).toMatchObject({ currentValue: 1, status: "paused" });
    expect(applyCountdownAction(at(3, "paused"), "correction", -3)).toMatchObject({ currentValue: 0, status: "completed", completedNow: true });
  });

  it("reopens a completed countdown only with a positive correction", () => {
    expect(applyCountdownAction(at(0, "completed"), "correction", 2)).toMatchObject({ currentValue: 2, status: "active" });
    expect(() => applyCountdownAction(at(0, "completed"), "correction", -1)).toThrow(CountdownRuleError);
  });

  it("rejects a zero correction", () => {
    expect(() => applyCountdownAction(at(2), "correction", 0)).toThrow("must change");
  });

  it("pauses, resumes and cancels per status", () => {
    expect(applyCountdownAction(at(2), "pause").status).toBe("paused");
    expect(() => applyCountdownAction(at(2, "paused"), "pause")).toThrow(CountdownRuleError);
    expect(applyCountdownAction(at(2, "paused"), "resume").status).toBe("active");
    expect(() => applyCountdownAction(at(2), "resume")).toThrow(CountdownRuleError);
    expect(applyCountdownAction(at(2, "paused"), "cancel").status).toBe("cancelled");
    expect(() => applyCountdownAction(at(0, "completed"), "cancel")).toThrow(CountdownRuleError);
  });

  it("treats cancelled as final", () => {
    for (const action of ["advance", "reverse", "pause", "resume", "cancel"] as const) {
      expect(() => applyCountdownAction(at(2, "cancelled"), action)).toThrow("Cancelled countdowns");
    }
  });
});

describe("assertFearValue", () => {
  it("accepts 0 to 12 and rejects anything else", () => {
    expect(() => assertFearValue(0)).not.toThrow();
    expect(() => assertFearValue(12)).not.toThrow();
    for (const bad of [-1, 13, 2.5]) expect(() => assertFearValue(bad)).toThrow(FearRangeError);
  });
});

describe("countdown visibility", () => {
  const countdown = {
    _id: "cd1",
    name: "The dam breaks",
    description: "Secret plan",
    category: "threat" as const,
    consequence: "The valley floods.",
    startingValue: 6,
    currentValue: 4,
    status: "paused" as const,
  };

  it("drops a private countdown for players", () => {
    expect(countdownForPlayer(countdown, COUNTDOWN_VISIBILITY_PRESETS.private)).toBeNull();
  });

  it("blanks exactly the hidden fields and keeps the rest", () => {
    expect(countdownForPlayer(countdown, COUNTDOWN_VISIBILITY_PRESETS.partly)).toEqual({ ...countdown, name: null, description: null });
    expect(countdownForPlayer(countdown, { mode: "public", hidden: ["progress", "category", "consequence"] })).toEqual({
      ...countdown,
      category: null,
      consequence: null,
      startingValue: null,
      currentValue: null,
    });
    expect(countdownForPlayer(countdown, COUNTDOWN_VISIBILITY_PRESETS.public)).toEqual(countdown);
  });

  it("normalises hidden fields to one each, in order, and names the preset", () => {
    expect(normaliseCountdownVisibility({ mode: "public", hidden: ["progress", "name", "progress"] })).toEqual({
      mode: "public",
      hidden: ["name", "progress"],
    });
    expect(countdownVisibilityPreset({ mode: "private" })).toBe("private");
    expect(countdownVisibilityPreset({ mode: "public", hidden: ["category"] })).toBe("partly");
    expect(countdownVisibilityPreset({ mode: "public", hidden: [] })).toBe("public");
  });
});
