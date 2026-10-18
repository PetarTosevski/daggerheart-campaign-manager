import { describe, expect, it } from "vitest";

import {
  advantagePlan,
  applyDualityEffects,
  applyRollOptions,
  DiceRuleError,
  dualityEffects,
  experienceBonus,
  NotEnoughHopeError,
  queueRng,
  rollAdvantage,
  rollDamage,
  rollDuality,
  rollFree,
  spendHope,
  weaponDice,
  type DualityInput,
} from "../../src/lib/domain/dice";
import { ikonisWeapon } from "../../src/lib/domain/dice/ikonis";
import type { RollOption } from "../../src/lib/domain/class-features/types";
import { characterSheetSchema, type CharacterSheet } from "../../src/lib/validation/characters";

/** A fixed sequence of die results (each must fit its die). */
function seq(...values: number[]) {
  return queueRng(values);
}

const base: DualityInput = { kind: "action", trait: 2, modifier: 0, difficulty: 12, advantage: 0, disadvantage: 0, help: 0 };

function sheet(overrides: Partial<CharacterSheet> = {}): CharacterSheet {
  return characterSheetSchema.parse({
    name: "Ash",
    pronouns: "",
    description: "",
    level: 1,
    classId: "warrior",
    subclassId: "call-of-the-brave",
    ancestry: { kind: "single", id: "human" },
    communityId: "highborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: {},
    evasion: 11,
    hpMax: 6,
    hp: 0,
    stressMax: 6,
    stress: 2,
    hope: 2,
    scars: 0,
    armorMarked: 0,
    proficiency: 1,
    primaryWeaponId: "broadsword",
    inventory: [],
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: [
      { id: "e1", name: "Sellsword", value: 2 },
      { id: "e2", name: "Lockpick", value: 3 },
    ],
    domainCards: { owned: [], loadout: [] },
    background: [],
    connections: [],
    notes: "",
    ...overrides,
  });
}

describe("Duality outcomes (CB 94-95)", () => {
  it.each([
    // hope, fear, expected outcome against Difficulty 12 with +2 trait
    [8, 8, "critical"],
    [1, 1, "critical"], // a critical succeeds even below the Difficulty
    [10, 6, "successHope"],
    [5, 9, "successFear"],
    [6, 3, "failHope"],
    [3, 6, "failFear"],
  ] as const)("hope %i, fear %i → %s", (hope, fear, outcome) => {
    const { roll } = rollDuality(base, seq(hope, fear));
    expect(roll.outcome).toBe(outcome);
    expect(roll.total).toBe(hope + fear + 2);
  });

  it("meeting the Difficulty exactly succeeds", () => {
    expect(rollDuality(base, seq(6, 4)).roll.outcome).toBe("successHope"); // 6 + 4 + 2 = 12
  });

  it("without a Difficulty only Hope or Fear matters", () => {
    expect(rollDuality({ ...base, difficulty: undefined }, seq(1, 2)).roll.outcome).toBe("successFear");
  });

  it("maps outcomes to Hope, Stress and Fear; reaction rolls change nothing (CB 99)", () => {
    expect(dualityEffects("action", "critical")).toEqual({ hope: 1, clearStress: 1, fear: 0 });
    expect(dualityEffects("action", "failHope")).toEqual({ hope: 1, clearStress: 0, fear: 0 });
    expect(dualityEffects("action", "successFear")).toEqual({ hope: 0, clearStress: 0, fear: 1 });
    expect(dualityEffects("reaction", "critical")).toEqual({ hope: 0, clearStress: 0, fear: 0 });
    expect(dualityEffects("reaction", "failFear")).toEqual({ hope: 0, clearStress: 0, fear: 0 });
  });

  it("caps Hope at the maximum and clears Stress on a critical", () => {
    const crit = applyDualityEffects(sheet({ hope: 6, stress: 2 }), dualityEffects("action", "critical"));
    expect(crit.hope).toBe(6);
    expect(crit.stress).toBe(1);
    const scarred = applyDualityEffects(sheet({ hope: 5, scars: 1 }), dualityEffects("action", "successHope"));
    expect(scarred.hope).toBe(5); // 6 − 1 scar
  });
});

describe("advantage and help (CB 90, 100)", () => {
  it("cancels one for one down to a single die", () => {
    expect(advantagePlan(1, 1, 0)).toEqual([]);
    expect(advantagePlan(2, 1, 0)).toEqual(["advantage"]);
    expect(advantagePlan(3, 0, 0)).toEqual(["advantage"]);
    expect(advantagePlan(0, 2, 0)).toEqual(["disadvantage"]);
    expect(advantagePlan(1, 3, 0)).toEqual(["disadvantage"]);
  });

  it("adds a die per helper and keeps the highest", () => {
    expect(advantagePlan(1, 0, 2)).toEqual(["advantage", "help", "help"]);
    expect(advantagePlan(0, 1, 2)).toEqual(["help"]);
    const { dice, value } = rollAdvantage(["advantage", "help", "help"], seq(2, 5, 3));
    expect(value).toBe(5);
    expect(dice.map((d) => Boolean(d.dropped))).toEqual([true, false, true]);
  });

  it("subtracts a disadvantage die", () => {
    const { roll } = rollDuality({ ...base, disadvantage: 1 }, seq(6, 5, 4));
    expect(roll.total).toBe(6 + 5 - 4 + 2);
  });

  it("refuses help on a reaction roll", () => {
    expect(() => rollDuality({ ...base, kind: "reaction", help: 1 }, seq(1, 2, 3))).toThrow(DiceRuleError);
  });
});

describe("Experiences and Hope (CB 90)", () => {
  it("adds each Experience's value for 1 Hope each", () => {
    expect(experienceBonus(sheet().experiences, ["e1", "e2"])).toEqual({ value: 5, hope: 2, names: ["Sellsword", "Lockpick"] });
    expect(() => experienceBonus(sheet().experiences, ["nope"])).toThrow(DiceRuleError);
    expect(() => experienceBonus(sheet().experiences, ["e1", "e1"])).toThrow(DiceRuleError);
  });

  it("refuses to spend Hope the sheet doesn't have", () => {
    expect(spendHope(sheet({ hope: 2 }), 2).hope).toBe(0);
    expect(() => spendHope(sheet({ hope: 1 }), 2)).toThrow(NotEnoughHopeError);
  });
});

describe("roll options (class-feature hooks)", () => {
  const options: RollOption[] = [
    { key: "training", label: "Combat Training", effect: { kind: "modifier", value: 1 }, auto: true },
    { key: "rally", label: "Rally Die", effect: { kind: "heldDie", heldDieId: "r1" } },
    { key: "sneak", label: "Sneak Attack", effect: { kind: "dice", count: 1, sides: 6 }, cost: { use: { key: "sneak", until: "rest" } } },
  ];

  it("applies auto options, spends held dice and marks uses", () => {
    const s = sheet({ heldDice: [{ id: "r1", kind: "rally", sides: 8, until: "session" }] });
    const out = applyRollOptions(s, options, ["rally", "sneak"]);
    expect(out.modifier).toBe(1);
    expect(out.extraDice).toEqual([{ count: 1, sides: 8 }, { count: 1, sides: 6 }]);
    expect(out.sheet.heldDice).toEqual([]);
    expect(out.sheet.featureUses).toEqual([{ key: "sneak", until: "rest" }]);
    expect(() => applyRollOptions(out.sheet, options, ["sneak"])).toThrow(DiceRuleError);
    expect(() => applyRollOptions(s, options, ["unknown"])).toThrow(DiceRuleError);
  });
});

describe("damage (CB 98)", () => {
  it("rolls Proficiency-many weapon dice", () => {
    expect(weaponDice("d8+1 phy", 2)).toEqual({ dice: [{ count: 2, sides: 8 }], flat: 1 });
    expect(weaponDice("d6 mag", 3)).toEqual({ dice: [{ count: 3, sides: 6 }], flat: 0 });
    expect(weaponDice("d8+d6 phy", 2)).toEqual({ dice: [{ count: 2, sides: 8 }, { count: 1, sides: 6 }], flat: 0 });
    expect(() => weaponDice("lots", 1)).toThrow(DiceRuleError);
  });

  it("a critical adds the dice's maximum to the roll (the wand example: 12 + 9 + 1 = 22)", () => {
    const roll = rollDamage({ dice: [{ count: 2, sides: 6 }], flat: 1, critical: true }, seq(4, 5));
    expect(roll.total).toBe(22);
    expect(roll.modifier).toBe(13);
    expect(roll.kind).toBe("damage");
  });

  it("a critical with a crit base uses it instead (Brawler)", () => {
    expect(rollDamage({ dice: [{ count: 1, sides: 8 }], flat: 0, critical: true, critBase: 14 }, seq(3)).total).toBe(17);
  });

  it("refuses dice the app doesn't roll", () => {
    expect(() => rollDamage({ dice: [{ count: 1, sides: 7 }], flat: 0, critical: false }, seq(3))).toThrow(DiceRuleError);
    expect(() => rollFree([], 0, seq())).toThrow(DiceRuleError);
  });
});

describe("integration (D5 TI-a)", () => {
  it("weaponDice scaleAll scales every die (Brawler's Strike d8+d6 at Proficiency 2 → 2d8 + 2d6)", () => {
    expect(weaponDice("d8+d6 phy", 2).dice).toEqual([
      { count: 2, sides: 8 },
      { count: 1, sides: 6 },
    ]);
    expect(weaponDice("d8+d6 phy", 2, true).dice).toEqual([
      { count: 2, sides: 8 },
      { count: 2, sides: 6 },
    ]);
  });

  it("a critical maxes option bonus dice too (CB 98), after critBase or the base dice", () => {
    const plain = rollDamage({ dice: [{ count: 1, sides: 8 }], flat: 1, critical: true, bonusDice: [{ count: 1, sides: 6 }] }, seq(2, 3));
    expect(plain.dice.map((d) => d.sides)).toEqual([8, 6]);
    expect(plain.total).toBe(8 + 6 + 2 + 3 + 1);
    expect(rollDamage({ dice: [{ count: 1, sides: 8 }], flat: 0, critical: false, bonusDice: [{ count: 1, sides: 6 }] }, seq(2, 3)).total).toBe(5);
  });

  it("an option with cost.effectId ends that effect, and refuses once it is gone", () => {
    const withEffect = sheet({ effects: [{ id: "way-in", source: "Get In & Get Out", text: "x", until: "session" }] });
    const option: RollOption = { key: "way", label: "Way in", effect: { kind: "advantage" }, cost: { effectId: "way-in" } };
    const applied = applyRollOptions(withEffect, [option], ["way"]);
    expect(applied.advantage).toBe(1);
    expect(applied.sheet.effects).toEqual([]);
    expect(() => applyRollOptions(applied.sheet, [option], ["way"])).toThrow(DiceRuleError);
  });

  it("the Ikonis: range dice at Proficiency, Bonded (+level) and augments (CB 301, module sheet)", () => {
    const ikonis = { name: "Spark rod", description: "", trait: "strength" as const, range: "Melee" as const, damageType: "physical" as const };
    expect(ikonisWeapon({ ...ikonis, range: null }, [], 1, 1)).toBeNull();
    expect(ikonisWeapon(ikonis, [], 3, 2)).toEqual({ label: "Spark rod", trait: "strength", dice: [{ count: 2, sides: 12 }], flat: 1 + 3, attack: 0, advantage: false, augments: [] });
    const built = ikonisWeapon(ikonis, ["force", "sear", "target", "converge", "override", "guard"], 1, 1)!;
    expect(built).toMatchObject({ flat: 1 + 1 + 1 + 2, attack: 3, advantage: true });
    expect(built.augments).toEqual(["Force", "Sear", "Target", "Converge", "Override"]);
  });
});

describe("manual entry", () => {
  it("takes typed-in dice in order and refuses bad values", () => {
    const rng = queueRng([12, 3]);
    expect(rollDuality(base, rng).roll.outcome).toBe("successHope");
    expect(() => rng.done()).not.toThrow();
    expect(() => rollDuality(base, queueRng([13, 3]))).toThrow(DiceRuleError);
    expect(() => rollDuality(base, queueRng([5]))).toThrow(DiceRuleError);
    const extra = queueRng([5, 5, 2]);
    rollDuality(base, extra);
    expect(() => extra.done()).toThrow(DiceRuleError);
  });
});
