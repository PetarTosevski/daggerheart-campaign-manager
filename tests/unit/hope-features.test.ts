import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { withEffects } from "@/lib/domain/characters/effects";
import { expire } from "@/lib/domain/characters/expiry";
import { findFeature, hopeFeature, onRest } from "@/lib/domain/class-features/hooks";
import { CLASS_FEATURES, classFeaturesAvailable } from "@/lib/domain/class-features/index";
import type { FeatureUseInput, FeatureUseResult, OtherSheet } from "@/lib/domain/class-features/types";
import type { RollRecord } from "@/lib/domain/duality";
import { RuleError } from "@/lib/errors/app-error";
import { CLASSES } from "@/lib/srd/classes";
import type { CharacterSheet } from "@/lib/validation/characters";

function sheetOf(classId: string, patch: Partial<CharacterSheet> = {}): CharacterSheet {
  const sheet = readSheet({
    schemaVersion: 2,
    name: "Vex",
    pronouns: "",
    description: "",
    level: 1,
    classId,
    subclassId: "any",
    ancestry: { kind: "single", id: "elf" },
    communityId: "wildborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: {},
    evasion: 10,
    hpMax: 6,
    hp: 2,
    stressMax: 6,
    stress: 3,
    hope: 3,
    scars: 0,
    armorMarked: 3,
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
  return { ...sheet, ...patch };
}

/** A fixed die sequence: each call returns the next value. */
const dice = (...values: number[]) => {
  const queue = [...values];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("rng exhausted");
    return next;
  };
};

function use(classId: string, input: Partial<FeatureUseInput> & { sheet?: CharacterSheet } = {}): FeatureUseResult {
  const sheet = input.sheet ?? sheetOf(classId);
  const feature = hopeFeature(sheet);
  if (!feature?.use) throw new Error(`no usable Hope feature for ${classId}`);
  return feature.use({ sheet, params: {}, rng: dice(), others: [], ...input });
}

function refusal(run: () => unknown): string | undefined {
  try {
    run();
  } catch (e) {
    if (e instanceof RuleError) return e.code;
    throw e;
  }
  return undefined;
}

const ally = (patch: Partial<CharacterSheet> = {}): OtherSheet => ({ characterId: "ally-1", sheet: sheetOf("bard", { name: "Bryn", ...patch }) });

const actionRoll = (hope: number, fear: number, total: number, outcome: RollRecord["outcome"], extra: RollRecord["dice"] = []): RollRecord => ({
  kind: "action",
  dice: [
    { sides: 12, value: hope, role: "hope" },
    { sides: 12, value: fear, role: "fear" },
    ...extra,
  ],
  modifier: total - hope - fear - extra.reduce((s, d) => s + (d.dropped ? 0 : d.role === "disadvantage" ? -d.value : d.value), 0),
  total,
  difficulty: 15,
  outcome,
  manual: false,
});

describe("the registry", () => {
  it("has one module per class, each with its 3-Hope feature (CB 27)", () => {
    expect(Object.keys(CLASS_FEATURES).sort()).toEqual(CLASSES.map((c) => c.id).sort());
    for (const cls of CLASSES) {
      const feature = CLASS_FEATURES[cls.id]?.hopeFeature;
      expect(feature?.cost?.hope, cls.id).toBe(3);
      expect(feature?.name.replace("'", "’"), cls.id).toBe(cls.hopeFeature.name);
      expect(feature?.use, cls.id).toBeTypeOf("function");
    }
  });

  it("offers Hope & Fear classes only with the hopeAndFear option", () => {
    expect(classFeaturesAvailable("witch", false)).toBe(false);
    expect(classFeaturesAvailable("witch", true)).toBe(true);
    expect(classFeaturesAvailable("rogue", false)).toBe(true);
  });

  it("finds the Hope feature by key and never the multiclass's", () => {
    const sheet = sheetOf("rogue", { multiclass: { classId: "warrior", domainId: "blade", subclassId: "x" } });
    expect(findFeature(sheet, "roguesDodge")?.name).toBe("Rogue’s Dodge");
    expect(findFeature(sheet, "noMercy")).toBeUndefined();
  });
});

describe("automated Hope features", () => {
  it("Frontline Tank clears 2 Armor Slots (CB 36), never below 0", () => {
    expect(use("guardian").sheet.armorMarked).toBe(1);
    expect(use("guardian", { sheet: sheetOf("guardian", { armorMarked: 1 }) }).sheet.armorMarked).toBe(0);
    expect(refusal(() => use("guardian", { sheet: sheetOf("guardian", { armorMarked: 0 }) }))).toBe("CLASS_FEATURE_RULE");
  });

  it("Rogue's Dodge gives +2 Evasion until hit, and ends on a rest otherwise (CB 42)", () => {
    const { sheet } = use("rogue");
    expect(withEffects(sheet).evasion).toBe(12);
    expect(sheet.effects).toHaveLength(1);
    expect(use("rogue", { sheet }).sheet.effects).toHaveLength(1); // using it again does not stack
    expect(expire(sheet, "hit").effects).toEqual([]);
    expect(expire(sheet, "shortRest").effects).toHaveLength(1);
    expect(onRest(expire(sheet, "shortRest"), "short").effects).toEqual([]);
  });

  it("No Mercy gives +1 to attack rolls until the next rest (CB 48)", () => {
    const { sheet } = use("warrior");
    expect(withEffects(sheet).attackBonus).toBe(1);
    expect(expire(sheet, "shortRest").effects).toEqual([]);
  });

  it("Life Support clears a Hit Point on an ally and wakes them (CB 44, CB 106)", () => {
    const target = ally({ hp: 3, conditions: ["unconscious"] });
    const result = use("seraph", { others: [target] });
    expect(result.sheet).toEqual(sheetOf("seraph"));
    expect(result.others?.[0]?.characterId).toBe("ally-1");
    expect(result.others?.[0]?.sheet.hp).toBe(2);
    expect(result.others?.[0]?.sheet.conditions).toEqual([]);
    expect(refusal(() => use("seraph"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => use("seraph", { others: [ally({ hp: 0 })] }))).toBe("CLASS_FEATURE_RULE");
  });

  it("Volatile Magic rerolls the chosen damage dice of the latest damage roll (CB 46)", () => {
    const roll: RollRecord = {
      kind: "damage",
      dice: [
        { sides: 10, value: 2, role: "damage" },
        { sides: 10, value: 9, role: "damage" },
      ],
      modifier: 3,
      total: 14,
      outcome: "none",
      manual: true,
    };
    const result = use("sorcerer", { roll, params: { dieIndexes: [0] }, rng: dice(7) });
    expect(result.roll?.dice.map((d) => d.value)).toEqual([7, 9]);
    expect(result.roll?.total).toBe(19);
    expect(result.roll?.manual).toBe(false);
    expect(refusal(() => use("sorcerer", { roll, params: {} }))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => use("sorcerer", { roll, params: { dieIndexes: [5] } }))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => use("sorcerer", { roll: actionRoll(3, 5, 9, "failFear"), params: { dieIndexes: [0] } }))).toBe("CLASS_FEATURE_RULE");
  });

  it("Deadly Determination clears 2 Stress (HF 8)", () => {
    expect(use("assassin").sheet.stress).toBe(1);
    expect(refusal(() => use("assassin", { sheet: sheetOf("assassin", { stress: 0 }) }))).toBe("CLASS_FEATURE_RULE");
  });

  describe("Patron's Boon rerolls a failed roll with advantage (HF 14)", () => {
    it("a failure with Fear that becomes a success with Hope takes back the GM's Fear and gives Hope", () => {
      const result = use("warlock", { roll: actionRoll(3, 5, 10, "failFear"), rng: dice(10, 4, 5) });
      expect(result.roll?.dice).toEqual([
        { sides: 12, value: 10, role: "hope" },
        { sides: 12, value: 4, role: "fear" },
        { sides: 6, value: 5, role: "advantage" },
      ]);
      expect(result.roll?.total).toBe(21);
      expect(result.roll?.outcome).toBe("successHope");
      expect(result.fearDelta).toBe(-1);
      expect(result.sheet.hope).toBe(4);
    });

    it("a failure with Hope that fails again with Fear takes back that Hope and gives the GM 1 Fear", () => {
      const result = use("warlock", { roll: actionRoll(5, 3, 10, "failHope"), rng: dice(1, 2, 1) });
      expect(result.roll?.outcome).toBe("failFear");
      expect(result.fearDelta).toBe(1);
      expect(result.sheet.hope).toBe(2);
    });

    it("cancels an earlier disadvantage instead of adding a die (CB 100)", () => {
      const roll = actionRoll(3, 5, 6, "failFear", [{ sides: 6, value: 4, role: "disadvantage" }]);
      const result = use("warlock", { roll, rng: dice(6, 6) });
      expect(result.roll?.dice.map((d) => d.role)).toEqual(["hope", "fear"]);
      expect(result.roll?.outcome).toBe("critical");
      expect(result.roll?.total).toBe(6 - 8 + 4 + 12);
      expect(result.sheet.stress).toBe(2); // a critical clears a Stress
    });

    it("refuses a roll that did not fail", () => {
      expect(refusal(() => use("warlock", { roll: actionRoll(9, 3, 16, "successHope") }))).toBe("CLASS_FEATURE_RULE");
      expect(refusal(() => use("warlock"))).toBe("CLASS_FEATURE_RULE");
    });
  });

  describe("Witch's Charm turns a failed action roll into a success with Fear (HF 16, settled rule)", () => {
    it("with Hope: the ally loses that Hope and the GM gains 1 Fear", () => {
      const target = ally({ hope: 2 });
      const result = use("witch", { others: [target], roll: actionRoll(6, 2, 10, "failHope") });
      expect(result.roll?.outcome).toBe("successFear");
      expect(result.roll?.dice).toEqual(actionRoll(6, 2, 10, "failHope").dice);
      expect(result.fearDelta).toBe(1);
      expect(result.others).toEqual([{ characterId: "ally-1", sheet: { ...target.sheet, hope: 1 } }]);
      expect(result.sheet).toEqual(sheetOf("witch"));
    });

    it("with Fear: nothing else changes", () => {
      const result = use("witch", { others: [ally()], roll: actionRoll(2, 6, 10, "failFear") });
      expect(result.roll?.outcome).toBe("successFear");
      expect(result.fearDelta).toBeUndefined();
      expect(result.others).toEqual([]);
    });

    it("works on the Witch's own roll", () => {
      const result = use("witch", { roll: actionRoll(6, 2, 10, "failHope") });
      expect(result.sheet.hope).toBe(2);
      expect(result.fearDelta).toBe(1);
    });

    it("refuses a success, a reaction roll and no roll", () => {
      expect(refusal(() => use("witch", { roll: actionRoll(9, 2, 16, "successHope") }))).toBe("CLASS_FEATURE_RULE");
      expect(refusal(() => use("witch", { roll: { ...actionRoll(2, 6, 10, "failFear"), kind: "reaction" } }))).toBe("CLASS_FEATURE_RULE");
      expect(refusal(() => use("witch"))).toBe("CLASS_FEATURE_RULE");
    });
  });
});

describe("assisted Hope features: the cost is paid, the sheet is unchanged", () => {
  it.each(["bard", "ranger", "wizard", "brawler"])("%s", (classId) => {
    const sheet = sheetOf(classId);
    const result = use(classId, { sheet });
    expect(hopeFeature(sheet)?.automation).toBe("assist");
    expect(result.sheet).toBe(sheet);
    expect(result.summary).toMatch(/^used /);
  });

  it("Evolution adds +1 to the chosen trait until ended (CB 30)", () => {
    const { sheet } = use("druid", { params: { choice: "instinct" } });
    expect(withEffects(sheet).traits.instinct).toBe(1);
    expect(sheet.effects[0]?.until).toBe("manual");
    expect(expire(expire(sheet, "longRest"), "session").effects).toHaveLength(1);
    expect(refusal(() => use("druid", { params: { choice: "luck" } }))).toBe("CLASS_FEATURE_RULE");
  });
});
