import { describe, expect, it } from "vitest";

import { areaPick, attackFooter, darkHeartedOption, fearReasons } from "@/components/combat-map/hud/statblock/model";
import { fearByHandText, hordeNote, outOfRangeNote, unconsciousTargetText } from "@/lib/domain/adversary-actions/rule-notes";
import { withoutFearCosts } from "@/lib/domain/adversary-effects/run";

import type { Id } from "../../convex/_generated/dataModel";

const fixed = (value: number) => ({ kind: "fixed" as const, value });

describe("rule switches WF: pure helpers", () => {
  it("F4 / F5 Manual: the GM's line and the costs without their Fear", () => {
    expect(fearByHandText(2)).toBe("Spend 2 Fear by hand");
    const costs = [
      { kind: "fear" as const, amount: fixed(1) },
      { kind: "stress" as const, amount: fixed(1) },
      { kind: "either" as const, options: [[{ kind: "fear" as const, amount: fixed(1) }], [{ kind: "hp" as const, amount: fixed(1) }]] },
    ];
    expect(withoutFearCosts(costs)).toEqual([costs[1], { kind: "either", options: [[], [{ kind: "hp", amount: fixed(1) }]] }]);
    expect(withoutFearCosts(undefined)).toBeUndefined();
  });

  it("D7 Manual: the note only at half HP or more with a Horde value", () => {
    expect(hordeNote("Mosquitoes", "1d4+1", { hp: 3, hpMax: 6 })).toBe("Mosquitoes: Horde at half HP: it deals 1d4+1 instead?");
    expect(hordeNote("Mosquitoes", "1d4+1", { hp: 2, hpMax: 6 })).toBeNull();
    expect(hordeNote("Bear", null, { hp: 6, hpMax: 6 })).toBeNull();
  });

  it("M4 Manual and C4 Book texts", () => {
    expect(outOfRangeNote("Mira", ["Theo"])).toBe("Mira attacked Theo out of range");
    expect(outOfRangeNote("Mira", ["Bandit", "Bear"], "Fireball")).toBe("Mira used Fireball on Bandit, Bear out of range");
    expect(unconsciousTargetText(["Ash"])).toBe("Ash is unconscious and can't be targeted by an attack.");
  });

  it("the map stat block: Dark-Hearted option and reasons, F4 Manual footer, C4 pre-pick", () => {
    expect(darkHeartedOption(false)).toEqual([]);
    expect(darkHeartedOption(true)[0]).toMatchObject({ label: "Dark-Hearted: advantage", cost: { amount: 1, resource: "fear" } });
    expect(fearReasons({ spotlight: 1, feature: 0, experience: 0, darkHearted: 1 }, "the Ogre", null, null)).toEqual(["1 to spotlight the Ogre", "1 for Dark-Hearted"]);
    expect(attackFooter({ spotlightFear: 0, experienceFear: 1, momentum: false, experienceByHand: true, darkHearted: true })).toBe("Experience: spend 1 Fear by hand · Dark-Hearted: 1 Fear");
    const rows = [
      { tokenId: "a" as Id<"combatTokens">, reach: "in" as const, conditions: ["Unconscious"] },
      { tokenId: "b" as Id<"combatTokens">, reach: "in" as const, conditions: [] },
    ];
    expect(areaPick({ area: "front", range: "far" }, "the Ogre", true, rows, true).picked).toEqual(["b"]);
    expect(areaPick({ area: "front", range: "far" }, "the Ogre", true, rows).picked).toEqual(["a", "b"]);
  });
});
