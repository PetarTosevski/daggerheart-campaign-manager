import { describe, expect, it } from "vitest";

import { fearWithheldBy, outcomeSucceeds, outcomeWithFear } from "../../../convex/lib/rollAftermath";
import { dualityEffects } from "../../../src/lib/domain/dice/index";
import type { RollOutcome } from "../../../src/lib/domain/duality";

/**
 * Plan rule-switches RA, R3 "Hope and Fear from rolls" (CB p.90: a roll with Hope gives a Hope; CB p.154: "Whenever a PC
 * rolls with Fear, you gain a Fear"). User answer Q2 b (2026-11-05): in Manual both stop. A critical keeps R2's own Hope
 * and Stress (CB p.90, Book-only).
 */
const OUTCOMES: RollOutcome[] = ["critical", "successHope", "failHope", "successFear", "failFear", "none"];

describe("dualityEffects with the R3 mode", () => {
  it("Book is the default and matches the book for every outcome", () => {
    for (const o of OUTCOMES) expect(dualityEffects("action", o, "book")).toEqual(dualityEffects("action", o));
    expect(dualityEffects("action", "successHope")).toEqual({ hope: 1, clearStress: 0, fear: 0 });
    expect(dualityEffects("action", "failFear")).toEqual({ hope: 0, clearStress: 0, fear: 1 });
    expect(dualityEffects("action", "critical")).toEqual({ hope: 1, clearStress: 1, fear: 0 });
  });

  it("Manual gains neither Hope nor Fear on a roll with Hope or with Fear", () => {
    for (const o of ["successHope", "failHope", "successFear", "failFear", "none"] as const) {
      expect(dualityEffects("action", o, "manual")).toEqual({ hope: 0, clearStress: 0, fear: 0 });
    }
  });

  it("Manual keeps a critical's Hope and cleared Stress (R2, Book-only)", () => {
    expect(dualityEffects("action", "critical", "manual")).toEqual({ hope: 1, clearStress: 1, fear: 0 });
  });

  it("a reaction roll gives nothing in either mode (CB p.99)", () => {
    for (const mode of ["book", "manual"] as const) for (const o of OUTCOMES) expect(dualityEffects("reaction", o, mode)).toEqual({ hope: 0, clearStress: 0, fear: 0 });
  });
});

describe("the aftermath's pure helpers", () => {
  it("withFear and success follow the outcome (a critical always succeeds, never with Fear)", () => {
    expect(OUTCOMES.filter(outcomeWithFear)).toEqual(["successFear", "failFear"]);
    expect(OUTCOMES.filter(outcomeSucceeds)).toEqual(["critical", "successHope", "successFear"]);
  });

  it("fearWithheldBy: only Manual action rolls with Fear withhold, one per PC (a Tag Team: two)", () => {
    expect(fearWithheldBy("book", "action", "failFear")).toBe(0);
    expect(fearWithheldBy("manual", "action", "failFear")).toBe(1);
    expect(fearWithheldBy("manual", "action", "successFear", 2)).toBe(2);
    expect(fearWithheldBy("manual", "action", "successHope")).toBe(0);
    expect(fearWithheldBy("manual", "action", "critical")).toBe(0);
    expect(fearWithheldBy("manual", "reaction", "failFear")).toBe(0);
  });
});
