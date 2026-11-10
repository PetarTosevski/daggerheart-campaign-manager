import { describe, expect, it } from "vitest";

import type { RollOutcome, RollRecord } from "../../src/lib/domain/duality";
import { consequence } from "../../src/lib/party/roll-copy";

// dcm-bxp.134.6: the dice box's consequence line under R3 "Hope and Fear from rolls". Book gains them; Manual gains
// neither by itself (the player adds the Hope on the sheet, the GM gets a "gain 1 Fear?" note), and a critical keeps
// its Hope and Stress clear unless R2 is Manual too (user answers 2026-11-05 Q2 b, 2026-11-06).

const roll = (outcome: RollOutcome, kind: RollRecord["kind"] = "action"): RollRecord => ({
  kind,
  dice: [
    { sides: 12, value: 8, role: "hope" },
    { sides: 12, value: 5, role: "fear" },
  ],
  modifier: 0,
  total: 13,
  difficulty: 12,
  outcome,
  manual: false,
});

describe("consequence (R3)", () => {
  it("Book: a roll with Hope gains a Hope, with Fear the GM gains a Fear", () => {
    expect(consequence(roll("successHope"), undefined)).toBe("Rolled with Hope: you gain a Hope.");
    expect(consequence(roll("failFear"), 1)).toBe("Rolled with Fear: the GM gains a Fear.");
  });

  it("Manual: with Hope never says 'you gain a Hope'", () => {
    for (const o of ["successHope", "failHope"] as const) {
      const line = consequence(roll(o), undefined, false, false, true);
      expect(line).toBe("Rolled with Hope: add 1 Hope on your sheet.");
      expect(line).not.toMatch(/you gain/);
    }
  });

  it("Manual: with Fear leaves the Fear to the GM (not 'already full', not 'gains')", () => {
    for (const o of ["successFear", "failFear"] as const) {
      expect(consequence(roll(o), 0, false, false, true)).toBe("Rolled with Fear: the GM decides the Fear.");
      expect(consequence(roll(o), 0, true, false, true)).toBe("Rolled with Fear: the GM decides the Fear.");
    }
  });

  it("Manual: a critical keeps its Hope and Stress clear; R2 Manual hands those to the GM", () => {
    expect(consequence(roll("critical"), undefined, false, false, true)).toBe("Critical success: you gain a Hope and clear a Stress.");
    expect(consequence(roll("critical"), undefined, false, true, true)).toBe("Critical success: the GM decides your Hope and Stress.");
  });

  it("Manual: reaction and damage rolls are unchanged", () => {
    expect(consequence(roll("successHope", "reaction"), undefined, false, false, true)).toBe("Reaction rolls don’t generate Hope or Fear.");
    expect(consequence(roll("none", "damage"), undefined, false, false, true)).toBe("");
  });
});
