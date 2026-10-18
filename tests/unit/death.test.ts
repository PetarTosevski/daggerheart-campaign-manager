import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { applyResourceDelta } from "@/lib/domain/characters/index";
import {
  avoidDeath,
  canMakeDeathMove,
  clearAllHpAndStress,
  DeathMoveError,
  deathStatus,
  deathSummary,
  pendingDeathMove,
  riskItAll,
  splitRiskItAll,
} from "@/lib/domain/death/index";

// A level-3 rogue at their last Hit Point (6 of 6) with 4 Stress marked.
const base = readSheet({
  schemaVersion: 2,
  name: "Vex",
  pronouns: "",
  description: "",
  level: 3,
  classId: "rogue",
  subclassId: "nightwalker",
  ancestry: { kind: "single", id: "elf" },
  communityId: "wildborne",
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
  traitMarks: {},
  evasion: 12,
  hpMax: 6,
  hp: 6,
  stressMax: 6,
  stress: 4,
  hope: 5,
  scars: 0,
  armorMarked: 0,
  proficiency: 1,
  primaryWeaponId: "dagger",
  inventory: [],
  gold: { handfuls: 1, bags: 0, chest: false },
  experiences: [],
  domainCards: { owned: [], loadout: [] },
  background: [],
  connections: [],
  notes: "",
});

describe("canMakeDeathMove (CB 106: marking the last Hit Point)", () => {
  it("needs an active, conscious character with every Hit Point marked", () => {
    expect(canMakeDeathMove({ status: "active", hp: 6, hpMax: 6, conditions: [] })).toBe(true);
    expect(canMakeDeathMove({ status: "active", hp: 5, hpMax: 6, conditions: [] })).toBe(false);
    expect(canMakeDeathMove({ status: "dead", hp: 6, hpMax: 6, conditions: [] })).toBe(false);
    expect(canMakeDeathMove({ status: "away", hp: 6, hpMax: 6, conditions: [] })).toBe(false);
    expect(canMakeDeathMove({ status: "active", hp: 6, hpMax: 6, conditions: ["unconscious"] })).toBe(false);
  });
});

describe("Avoid Death (CB 106)", () => {
  it("drops the character unconscious with no scar when the Hope Die beats the level", () => {
    const { sheet, scarred, journeyEnds } = avoidDeath(base, 4);
    expect(sheet.conditions).toEqual(["unconscious"]);
    expect(scarred).toBe(false);
    expect(journeyEnds).toBe(false);
    expect(sheet.scars).toBe(0);
  });

  it("adds a scar when the Hope Die is at or under the level, and Hope stops at the smaller maximum", () => {
    const atLevel = avoidDeath({ ...base, hope: 6 }, 3);
    expect(atLevel.scarred).toBe(true);
    expect(atLevel.sheet.scars).toBe(1);
    expect(atLevel.sheet.hope).toBe(5);
    expect(avoidDeath(base, 1).scarred).toBe(true);
  });

  it("ends the journey when the scar takes the last Hope slot", () => {
    const lastSlot = avoidDeath({ ...base, scars: 5, hope: 1 }, 1);
    expect(lastSlot.journeyEnds).toBe(true);
    expect(lastSlot.sheet.journeyEnds).toBe(true);
    expect(lastSlot.sheet.scars).toBe(6);
    expect(lastSlot.sheet.hope).toBe(0);
    // A seventh Hope slot (Light in the Dark) keeps one slot after the sixth scar.
    expect(avoidDeath({ ...base, scars: 5, hopeSlotBonus: 1 }, 1).journeyEnds).toBe(false);
  });

  it("wakes up when an ally clears a Hit Point", () => {
    const { sheet } = avoidDeath(base, 6);
    expect(applyResourceDelta(sheet, "hp", -1).conditions).toEqual([]);
  });
});

describe("Risk It All (CB 106)", () => {
  it("names the winning die and keeps the Hope Die's value", () => {
    expect(riskItAll(9, 4)).toEqual({ result: "hope", value: 9 });
    expect(riskItAll(2, 11)).toEqual({ result: "fear", value: 2 });
    expect(riskItAll(7, 7)).toEqual({ result: "critical", value: 7 });
  });

  it("matching dice clear every Hit Point and Stress", () => {
    const sheet = clearAllHpAndStress(base);
    expect(sheet.hp).toBe(0);
    expect(sheet.stress).toBe(0);
  });

  it("Hope higher clears Hit Points and Stress totalling the Hope Die, split by the player", () => {
    const sheet = splitRiskItAll(base, 5, 3, 2);
    expect(sheet.hp).toBe(3);
    expect(sheet.stress).toBe(2);
    // Less marked than the die: clear everything.
    expect(splitRiskItAll(base, 12, 6, 4)).toMatchObject({ hp: 0, stress: 0 });
  });

  it("refuses a split that misses the total or clears more than is marked", () => {
    expect(() => splitRiskItAll(base, 5, 2, 2)).toThrow(DeathMoveError);
    expect(() => splitRiskItAll(base, 5, 0, 5)).toThrow(DeathMoveError);
    expect(() => splitRiskItAll(base, 12, 6, 3)).toThrow(DeathMoveError);
    expect(() => splitRiskItAll(base, 5, -1, 6)).toThrow(DeathMoveError);
  });
});

describe("dying", () => {
  it("is death, or away under Castle High's less-lethal rule (HF 127)", () => {
    expect(deathStatus(false)).toEqual({ status: "dead" });
    expect(deathStatus(true)).toEqual({ status: "away", away: { reason: "infirmary" } });
    expect(deathStatus(true, "sentHome")).toEqual({ status: "away", away: { reason: "sentHome" } });
  });

  it("says when the Witherwild takes the body (CB 261)", () => {
    expect(deathSummary("Vex", { status: "dead" }, 2)).toContain("taken by the Witherwild");
    expect(deathSummary("Vex", { status: "dead" }, 0)).not.toContain("Witherwild");
    expect(deathSummary("Vex", { status: "away", away: { reason: "sentHome" } }, 2)).toContain("sent home");
  });
});

describe("pendingDeathMove", () => {
  const roll = (outcome: string, dice: { role: string; value: number }[]) => ({ kind: "death", roll: { outcome, dice } });

  it("reads a Blaze of Glory waiting for its action and a Risk It All waiting for its split", () => {
    expect(pendingDeathMove(roll("critical", []))).toEqual({ move: "blazeOfGlory" });
    expect(pendingDeathMove(roll("successHope", [{ role: "hope", value: 8 }, { role: "fear", value: 3 }]))).toEqual({ move: "riskItAll", value: 8 });
  });

  it("finds nothing pending after Avoid Death, a critical Risk It All, or another kind of row", () => {
    expect(pendingDeathMove(roll("none", [{ role: "hope", value: 4 }]))).toBeNull();
    expect(pendingDeathMove(roll("critical", [{ role: "hope", value: 5 }, { role: "fear", value: 5 }]))).toBeNull();
    expect(pendingDeathMove({ kind: "roll", roll: { outcome: "critical", dice: [] } })).toBeNull();
    expect(pendingDeathMove({ kind: "death" })).toBeNull();
    expect(pendingDeathMove(null)).toBeNull();
  });
});
