// Lunar Phases in derived Evasion and thresholds (session-features F0, K4, U6, E6).
import { describe, expect, it } from "vitest";

import { derivedDefense, derivedThresholds } from "@/lib/domain/characters/derived";

// Chainmail Armor: base thresholds 7 / 15 (CB 126). A Moon Witch at level 8 with the mastery.
const witch = { level: 8, armorId: "chainmail-armor", subclassId: "moon", subclassRank: "mastery" as const, evasion: 10, primaryWeaponId: "dagger" };
const at = (moonDie: number) => ({ ...witch, sessionFeatures: { moonDie } });
const BASE = { major: 15, severe: 23 };
const NO_HF = { hopeAndFear: false, ikonis: false };
// Chainmail is Heavy (-1 to Evasion): the base derived Evasion is 9.
const EVASION = 9;

describe("derived values with a moon die (HF 17)", () => {
  it("a sheet without a die is unchanged (E6)", () => {
    expect(derivedThresholds(witch)).toEqual(BASE);
    expect(derivedDefense(witch).evasion).toBe(EVASION);
    expect(derivedThresholds({ ...witch, sessionFeatures: {} })).toEqual(BASE);
  });

  it("New (1) and Waxing (2-3) change neither Evasion nor thresholds", () => {
    for (const die of [1, 2, 3]) {
      expect(derivedThresholds(at(die))).toEqual(BASE);
      expect(derivedDefense(at(die)).evasion).toBe(EVASION);
    }
  });

  it("Full (4) adds +3 to both thresholds", () => {
    expect(derivedThresholds(at(4))).toEqual({ major: 18, severe: 26 });
    expect(derivedDefense(at(4)).evasion).toBe(EVASION);
  });

  it("Waning (5-6) adds +1 Evasion", () => {
    for (const die of [5, 6]) {
      expect(derivedDefense(at(die)).evasion).toBe(EVASION + 1);
      expect(derivedThresholds(at(die))).toEqual(BASE);
    }
  });

  it("nothing for a Moon Witch below mastery, another subclass with a stray die, or outside Hope & Fear", () => {
    expect(derivedThresholds({ ...at(4), subclassRank: "specialization" })).toEqual(BASE);
    expect(derivedDefense({ ...at(6), subclassId: "hedge" }).evasion).toBe(EVASION);
    expect(derivedThresholds(at(4), NO_HF)).toEqual(BASE);
    expect(derivedDefense(at(6), [], NO_HF).evasion).toBe(EVASION);
  });

  it("the die adds to the other bonuses (unarmored thresholds use level and 2 x level)", () => {
    expect(derivedThresholds({ level: 3, subclassId: "moon", subclassRank: "mastery", sessionFeatures: { moonDie: 4 } })).toEqual({ major: 6, severe: 9 });
  });
});
