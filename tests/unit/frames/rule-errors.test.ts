import { describe, expect, it } from "vitest";

import { RuleError } from "../../../src/lib/errors/app-error";
import { removeIngredient } from "../../../src/lib/frames/extras/beast-feast";
import { sellRelic } from "../../../src/lib/frames/extras/motherboard";
import { addPyre, adjustBranches, INITIAL_UMBRA, lurkingOutcome } from "../../../src/lib/frames/trackers/age-of-umbra";
import { defaultAndaluriaState, removeHunt } from "../../../src/lib/frames/trackers/andaluria";
import { INITIAL_COLOSSUS, markRest } from "../../../src/lib/frames/trackers/colossus";
import { loadState, pairKey, planWeekAdvance } from "../../../src/lib/frames/trackers/five-banners";
import { parseHorizonState } from "../../../src/lib/frames/trackers/horizon";
import { assertAssignment } from "../../../src/lib/frames/trackers/weredragon";

// dcm-bxp.27: the frame tracker and character extra modules throw RuleError with their wrapper's code for an expected
// rule violation (never a plain Error), so convex/lib/trackers.ts applyTrackerRule passes them through unchanged.

function ruleCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RuleError);
    return (error as RuleError).code;
  }
  throw new Error("expected a RuleError");
}

describe("frame tracker rule errors", () => {
  it("Andaluria and Weredragon refuse with INVALID", () => {
    expect(ruleCode(() => removeHunt(defaultAndaluriaState(), "no-such-hunt"))).toBe("INVALID");
    expect(ruleCode(() => assertAssignment([1, 2, 3], [0, 1, 2]))).toBe("INVALID");
  });

  it("Colossus and Age of Umbra refuse with TRACKER_RULE", () => {
    expect(ruleCode(() => markRest({ ...INITIAL_COLOSSUS, phase: "interlude" }, "short", () => [], 0))).toBe("TRACKER_RULE");
    expect(ruleCode(() => adjustBranches(INITIAL_UMBRA, -1))).toBe("TRACKER_RULE");
    expect(ruleCode(() => lurkingOutcome(13))).toBe("TRACKER_RULE");
    expect(addPyre(INITIAL_UMBRA, "Ashford", false).pyreId).toBeTruthy();
  });

  it("Five Banners: a pair of one nation is INVALID, a bad week plan WEEK_RULE, damaged data TRACKER_CORRUPT", () => {
    expect(ruleCode(() => pairKey("armada", "armada"))).toBe("INVALID");
    expect(ruleCode(() => planWeekAdvance([], [{ nation: "armada", objectiveId: "missing" }]))).toBe("WEEK_RULE");
    expect(ruleCode(() => loadState({ week: "not a number" }))).toBe("TRACKER_CORRUPT");
  });

  it("Horizon: damaged stored state is TRACKER_CORRUPT", () => {
    expect(ruleCode(() => parseHorizonState({ boxes: {}, echoesCollected: 11 }))).toBe("TRACKER_CORRUPT");
  });
});

describe("character extra rule errors", () => {
  it("refuse with EXTRA_RULE", () => {
    expect(ruleCode(() => removeIngredient({ ingredients: [] }, "gone"))).toBe("EXTRA_RULE");
    expect(ruleCode(() => sellRelic({ relics: [] } as unknown as Parameters<typeof sellRelic>[0], "gone"))).toBe("EXTRA_RULE");
  });
});
