// Class features of the four Hope & Fear classes (D5 T8c; HF 8, 10, 14, 16).
import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { expire } from "@/lib/domain/characters/expiry";
import { BRAWLERS_STRIKE, COMBO_MAX, comboChain } from "@/lib/domain/class-features/classes/brawler";
import { warlockSpellcast } from "@/lib/domain/class-features/classes/warlock";
import { afterDualityRoll, classActions, findFeature, onRest, onSessionEnd, onSessionStart, rollOptions, weaponOverrides } from "@/lib/domain/class-features/hooks";
import { classFeaturesAvailable } from "@/lib/domain/class-features/index";
import type { FeatureUseInput, FeatureUseResult } from "@/lib/domain/class-features/types";
import { applyRollOptions, rollDamage } from "@/lib/domain/dice/index";
import type { RollRecord } from "@/lib/domain/duality";
import { RuleError } from "@/lib/errors/app-error";
import type { CharacterSheet } from "@/lib/validation/characters";

const SUBCLASS: Record<string, string> = { assassin: "poisoners-guild", brawler: "juggernaut", warlock: "pact-of-the-endless", witch: "hedge" };

function sheetOf(classId: string, patch: Partial<CharacterSheet> = {}): CharacterSheet {
  const sheet = readSheet({
    schemaVersion: 2,
    name: "Vex",
    pronouns: "",
    description: "",
    level: 1,
    classId,
    subclassId: SUBCLASS[classId] ?? "any",
    ancestry: { kind: "single", id: "elf" },
    communityId: "wildborne",
    // Presence (warlock) 2, Knowledge (hedge witch) 2.
    traits: { agility: 1, strength: 0, finesse: 0, instinct: 1, presence: 2, knowledge: 2 },
    traitMarks: {},
    evasion: 10,
    hpMax: 6,
    hp: 0,
    stressMax: 6,
    stress: 0,
    hope: 3,
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

/** Runs a class action by key (the dispatcher has already paid its cost). */
function act(sheet: CharacterSheet, key: string, input: Partial<FeatureUseInput> = {}): FeatureUseResult {
  const feature = findFeature(sheet, key);
  if (!feature?.use) throw new Error(`no ${key}`);
  return feature.use({ sheet, params: {}, rng: dice(), others: [], ...input });
}

const ruleMessage = (run: () => unknown): string => {
  try {
    run();
  } catch (e) {
    if (e instanceof RuleError) return e.message;
    throw e;
  }
  throw new Error("expected a refusal");
};

const action = (outcome: RollRecord["outcome"], hope = 8, fear = 4): RollRecord => ({
  kind: "action",
  dice: [
    { sides: 12, value: hope, role: "hope" },
    { sides: 12, value: fear, role: "fear" },
  ],
  modifier: 1,
  total: hope + fear + 1,
  outcome,
  manual: false,
});
const damage = (values: number[]): RollRecord => ({
  kind: "damage",
  dice: values.map((value) => ({ sides: 8, value, role: "damage" })),
  modifier: 0,
  total: values.reduce((s, n) => s + n, 0),
  outcome: "none",
  manual: false,
});

describe("Hope & Fear gating", () => {
  it("offers the four classes' features only with the hopeAndFear option", () => {
    for (const id of ["assassin", "brawler", "warlock", "witch"]) {
      expect(classFeaturesAvailable(id, true)).toBe(true);
      expect(classFeaturesAvailable(id, false)).toBe(false);
      expect(classActions(sheetOf(id)).length).toBeGreaterThan(0);
    }
  });
});

describe("Assassin (HF 8)", () => {
  it("Marked for Death needs a successful attack and adds tier d4s to damage against the target", () => {
    const sheet = sheetOf("assassin", { level: 5 });
    expect(ruleMessage(() => act(sheet, "markedForDeath", { roll: action("failHope") }))).toMatch(/not a successful attack/);
    expect(ruleMessage(() => act(sheet, "markedForDeath"))).toMatch(/not a successful attack/);
    expect(rollOptions(sheet, "damage")).toEqual([]);

    const marked = act(sheet, "markedForDeath", { roll: action("successFear"), params: { choice: "Baron Vey" } }).sheet;
    expect(marked.effects).toEqual([expect.objectContaining({ id: "marked-for-death", until: "rest" })]);
    expect(marked.effects[0]!.text).toContain("Baron Vey");
    const options = rollOptions(marked, "damage");
    expect(options).toEqual([{ key: "markedForDeath", label: "Marked for Death (+3d4)", effect: { kind: "dice", count: 3, sides: 4 } }]);
    expect(applyRollOptions(marked, options, ["markedForDeath"]).extraDice).toEqual([{ count: 3, sides: 4 }]);
    // One target at a time: marking again replaces it. A rest ends it.
    const again = act(marked, "markedForDeath", { roll: action("critical", 5, 5) }).sheet;
    expect(again.effects).toHaveLength(1);
    expect(expire(again, "shortRest").effects).toEqual([]);
  });

  it("Executioners Guild uses d6s (Ambush), d8s at mastery (Backstab)", () => {
    const roll = action("successHope");
    const foundation = act(sheetOf("assassin", { subclassId: "executioners-guild", level: 2 }), "markedForDeath", { roll }).sheet;
    expect(rollOptions(foundation, "damage")[0]!.effect).toEqual({ kind: "dice", count: 2, sides: 6 });
    const mastery = act(sheetOf("assassin", { subclassId: "executioners-guild", subclassRank: "mastery", level: 8 }), "markedForDeath", { roll }).sheet;
    expect(rollOptions(mastery, "damage")[0]!.effect).toEqual({ kind: "dice", count: 4, sides: 8 });
  });

  it("Get In & Get Out costs a Hope and gives the next roll advantage once", () => {
    const sheet = sheetOf("assassin");
    expect(findFeature(sheet, "getInGetOut")?.cost).toEqual({ hope: 1 });
    expect(rollOptions(sheet, "action")).toEqual([]);
    const ready = act(sheet, "getInGetOut").sheet;
    const options = rollOptions(ready, "action");
    expect(options.map((o) => o.effect)).toEqual([{ kind: "advantage" }]);
    expect(rollOptions(ready, "reaction")).toHaveLength(1);

    const applied = applyRollOptions(ready, options, ["getInGetOut"]);
    expect(applied.advantage).toBe(1);
    expect(rollOptions(applied.sheet, "action")).toEqual([]);
    // Unchosen, it does not apply.
    expect(applyRollOptions(ready, options, []).advantage).toBe(0);
    // Using the feature again offers it again.
    expect(rollOptions(act(applied.sheet, "getInGetOut").sheet, "action")).toHaveLength(1);
  });
});

describe("Brawler (HF 10)", () => {
  it("I Am the Weapon: Brawler's Strike with Proficiency d8 + Proficiency d6 and +1 Evasion, only without another weapon", () => {
    expect(weaponOverrides(sheetOf("brawler"))).toEqual([]);
    const bare = sheetOf("brawler", { primaryWeaponId: BRAWLERS_STRIKE, proficiency: 3 });
    expect(weaponOverrides(bare)).toEqual([
      {
        key: "brawlersStrike",
        label: "Brawler’s Strike (I Am the Weapon)",
        dice: [
          { count: 3, sides: 8 },
          { count: 3, sides: 6 },
        ],
        flat: 0,
        critBase: 42,
        evasionBonus: 1,
      },
    ]);
    expect(weaponOverrides({ ...bare, secondaryWeaponId: "small-dagger" })).toEqual([]);
  });

  it("a critical deals 14 × Proficiency plus the roll (settled rule)", () => {
    const strike = weaponOverrides(sheetOf("brawler", { primaryWeaponId: BRAWLERS_STRIKE, proficiency: 2 }))[0]!;
    const roll = rollDamage({ dice: strike.dice, flat: strike.flat, critical: true, critBase: strike.critBase }, dice(3, 5, 2, 1));
    expect(roll.dice.map((d) => d.sides)).toEqual([8, 8, 6, 6]);
    expect(roll.total).toBe(28 + 3 + 5 + 2 + 1);
    expect(rollDamage({ dice: strike.dice, flat: 0, critical: false, critBase: strike.critBase }, dice(3, 5, 2, 1)).total).toBe(11);
  });

  it("Combo Strike rolls the combo die along the chain until a lower result and adds every result", () => {
    expect(comboChain(4, dice(1, 2, 2, 4, 3))).toEqual([1, 2, 2, 4, 3]);
    expect(comboChain(4, dice(3, 1))).toEqual([3, 1]);
    expect(comboChain(4, () => 4)).toHaveLength(COMBO_MAX);

    const sheet = sheetOf("brawler");
    expect(findFeature(sheet, "comboStrike")?.cost).toEqual({ stress: 1 });
    expect(ruleMessage(() => act(sheet, "comboStrike", { roll: action("successHope") }))).toMatch(/not a damage roll/);
    const result = act(sheet, "comboStrike", { roll: damage([5, 2]), rng: dice(2, 3, 1) });
    expect(result.roll!.total).toBe(7 + 6);
    expect(result.roll!.dice.filter((d) => d.role === "extra").map((d) => [d.sides, d.value])).toEqual([
      [4, 2],
      [4, 3],
      [4, 1],
    ]);
    expect(ruleMessage(() => act(sheet, "comboStrike", { roll: result.roll! }))).toMatch(/already/);
    // A raised Combo Die (level-up advancement) rolls bigger.
    const d8 = act(sheetOf("brawler", { classState: { comboDie: 8 } }), "comboStrike", { roll: damage([1]), rng: dice(7, 2) });
    expect(d8.roll!.dice.filter((d) => d.role === "extra").map((d) => d.sides)).toEqual([8, 8]);
  });
});

describe("Warlock (HF 14)", () => {
  it("Favor starts at 3 and pays for the Patron Die, d6 then d8 from level 5", () => {
    const sheet = sheetOf("warlock");
    expect(onSessionStart(sheet, dice()).classState.favor).toBe(3);
    expect(onSessionStart({ ...sheet, classState: { favor: 1 } }, dice()).classState.favor).toBe(1);

    const called = act(sheet, "patronsPact").sheet;
    expect(called.classState.favor).toBe(2);
    expect(called.heldDice).toEqual([{ id: "patron-die", kind: "patron", sides: 6, until: "manual" }]);
    expect(ruleMessage(() => act(called, "patronsPact"))).toMatch(/already hold/);
    const options = rollOptions(called, "action");
    expect(options).toEqual([{ key: "patronDie", label: "Patron Die (d6)", effect: { kind: "heldDie", heldDieId: "patron-die" } }]);
    expect(rollOptions(called, "damage")).toEqual([]);
    const applied = applyRollOptions(called, options, ["patronDie"]);
    expect(applied.extraDice).toEqual([{ count: 1, sides: 6 }]);
    expect(applied.sheet.heldDice).toEqual([]);

    expect(act(sheetOf("warlock", { level: 5 }), "patronsPact").sheet.heldDice[0]!.sides).toBe(8);
    expect(ruleMessage(() => act(sheetOf("warlock", { classState: { favor: 0 } }), "patronsPact"))).toMatch(/no Favor/);
  });

  it("tribute is a rest move, not a class action; its gain is the Spellcast trait, never negative", () => {
    const sheet = sheetOf("warlock", { classState: { favor: 1 } });
    expect(findFeature(sheet, "tribute")).toBeUndefined();
    expect(warlockSpellcast(sheet)).toBe(2);
    expect(warlockSpellcast({ ...sheet, traits: { ...sheet.traits, presence: -1 } })).toBe(0);
  });

  it("a success with Hope can take a Favor instead of the Hope, once per roll", () => {
    const sheet = sheetOf("warlock", { hope: 4 });
    expect(afterDualityRoll(sheet, { hope: 8, fear: 4, roll: action("successHope") }).map((p) => p.featureKey)).toEqual(["favorForHope"]);
    expect(afterDualityRoll(sheet, { hope: 4, fear: 8, roll: action("successFear", 4, 8) })).toEqual([]);
    expect(ruleMessage(() => act(sheet, "favorForHope", { roll: action("successFear", 4, 8) }))).toMatch(/not a success with Hope/);

    const roll = action("successHope");
    const traded = act(sheet, "favorForHope", { roll }).sheet;
    expect(traded.hope).toBe(3);
    expect(traded.classState.favor).toBe(4);
    expect(ruleMessage(() => act(traded, "favorForHope", { roll }))).toMatch(/already/);
    // The next roll's Hope can be traded; only one mark is kept.
    const next = act(traded, "favorForHope", { roll: action("critical", 6, 6) }).sheet;
    expect(next.classState.favor).toBe(5);
    expect(next.featureUses.filter((u) => u.key.startsWith("favorForHope:"))).toHaveLength(1);
  });
});

describe("Witch (HF 16)", () => {
  it("Hex marks a Stress and Hexes up to Spellcast-trait targets; a rest or session end clears them", () => {
    const sheet = sheetOf("witch");
    expect(findFeature(sheet, "hex")?.cost).toEqual({ stress: 1 });
    const one = act(sheet, "hex", { params: { choice: "Ghoul" } }).sheet;
    const two = act(one, "hex").sheet;
    expect(two.classState.hexes).toEqual(["Ghoul", "Target 1"]);
    expect(ruleMessage(() => act(two, "hex"))).toMatch(/at most 2/);
    expect(ruleMessage(() => act(one, "hex", { params: { choice: "Ghoul" } }))).toMatch(/already Hexed/);
    expect(ruleMessage(() => act(sheetOf("witch", { traits: { ...sheet.traits, knowledge: 0 } }), "hex"))).toMatch(/no Hexes/);

    expect(act(two, "clearHexes").sheet.classState.hexes).toBeUndefined();
    expect(ruleMessage(() => act(sheet, "clearHexes"))).toMatch(/Nothing is Hexed/);
    expect(onRest(two, "short").classState.hexes).toBeUndefined();
    expect(onSessionEnd(two).classState.hexes).toBeUndefined();
  });

  it("Commune rolls Spellcast-trait d6s once per long rest", () => {
    const sheet = sheetOf("witch");
    expect(findFeature(sheet, "commune")?.cost).toEqual({ use: { key: "commune", until: "longRest" } });
    const result = act(sheet, "commune", { rng: dice(2, 6) });
    expect(result.roll).toEqual(expect.objectContaining({ kind: "free", total: 6 }));
    expect(result.roll!.dice.map((d) => d.value)).toEqual([2, 6]);
    expect(result.summary).toMatch(/psychically experience a scene/);
    const used = { ...sheet, featureUses: [{ key: "commune", until: "longRest" as const }] };
    expect(expire(used, "shortRest").featureUses).toHaveLength(1);
    expect(expire(used, "longRest").featureUses).toEqual([]);
  });
});

describe("integration (D5 TI-a)", () => {
  it("Get In & Get Out's advantage ends the effect when taken, so it is spent once", () => {
    const ready = act(sheetOf("assassin"), "getInGetOut").sheet;
    const applied = applyRollOptions(ready, rollOptions(ready, "action"), ["getInGetOut"]);
    expect(applied.sheet.effects).toEqual([]);
    expect(applied.sheet.featureUses).toEqual([]);
    // A stale option list can't spend it twice.
    expect(() => applyRollOptions(applied.sheet, rollOptions(ready, "action"), ["getInGetOut"])).toThrow(/already used/);
  });

  it("a FeatureScope without hopeAndFear drops a Hope & Fear class's options, overrides and prompts, but not held Rally Dice", () => {
    const off = { hopeAndFear: false, ikonis: false };
    const bare = sheetOf("brawler", { primaryWeaponId: BRAWLERS_STRIKE, heldDice: [{ id: "rally-1", kind: "rally", sides: 6, until: "session" }] });
    expect(weaponOverrides(bare, undefined, off)).toEqual([]);
    expect(weaponOverrides(bare).map((o) => o.key)).toEqual(["brawlersStrike"]);
    expect(rollOptions(bare, "damage", undefined, off).map((o) => o.key)).toEqual(["rally:rally-1"]);
    const warlock = sheetOf("warlock", { heldDice: [{ id: "patron-die", kind: "patron", sides: 6, until: "manual" }] });
    expect(rollOptions(warlock, "action").map((o) => o.key)).toEqual(["patronDie"]);
    expect(rollOptions(warlock, "action", undefined, off)).toEqual([]);
    expect(afterDualityRoll(warlock, { hope: 8, fear: 4, roll: action("successHope") }, undefined, off)).toEqual([]);
  });

  it("any class holding a Rally Die can spend it: Hope & Fear classes too, listed once for a multiclass", () => {
    const rally = { id: "rally-1", kind: "rally" as const, sides: 6, until: "session" as const };
    const brawler = sheetOf("brawler", { heldDice: [rally], stress: 3 });
    expect(rollOptions(brawler, "action").map((o) => o.key)).toEqual(["rally:rally-1"]);
    expect(act(brawler, "rallyDieStress", { rng: dice(2) }).sheet).toMatchObject({ stress: 1, heldDice: [] });
    const multi = sheetOf("witch", { heldDice: [rally], multiclass: { classId: "bard", domainId: "grace", subclassId: "troubadour" } });
    expect(classActions(multi).filter((f) => f.key === "rallyDieStress")).toHaveLength(1);
    expect(rollOptions(multi, "damage").filter((o) => o.key === "rally:rally-1")).toHaveLength(1);
  });

  it("Brawler crit with Marked for Death bonus dice: 14 × Proficiency plus every bonus die's maximum, plus the roll", () => {
    const strike = weaponOverrides(sheetOf("brawler", { primaryWeaponId: BRAWLERS_STRIKE, proficiency: 1 }))[0]!;
    const roll = rollDamage({ dice: strike.dice, flat: 0, critical: true, critBase: strike.critBase, bonusDice: [{ count: 2, sides: 4 }] }, dice(1, 1, 1, 1));
    expect(roll.dice.map((d) => d.sides)).toEqual([8, 6, 4, 4]);
    expect(roll.total).toBe(14 + 8 + 4);
  });

  it("Marked for Death and Hex take a target name from the panel's text input (params.choice)", () => {
    for (const [classId, key] of [
      ["assassin", "markedForDeath"],
      ["witch", "hex"],
    ] as const) {
      expect(findFeature(sheetOf(classId), key)?.inputs).toEqual([expect.objectContaining({ kind: "text", param: "choice", label: "Target name" })]);
    }
    expect(act(sheetOf("witch"), "hex", { params: { choice: "Grak" } }).sheet.classState.hexes).toEqual(["Grak"]);
  });
});
