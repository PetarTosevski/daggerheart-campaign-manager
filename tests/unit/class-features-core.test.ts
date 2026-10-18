import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { withEffects } from "@/lib/domain/characters/effects";
import { expire } from "@/lib/domain/characters/expiry";
import { afterDualityRoll, classActions, findFeature, onSessionEnd, onSessionStart, rollOptions } from "@/lib/domain/class-features/hooks";
import type { FeatureParams, FeatureUseResult, OtherSheet } from "@/lib/domain/class-features/types";
import { applyRollOptions } from "@/lib/domain/dice/index";
import type { RollRecord } from "@/lib/domain/duality";
import { RuleError } from "@/lib/errors/app-error";
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

type Input = { params?: FeatureParams; others?: OtherSheet[]; roll?: RollRecord; rng?: (sides: number) => number };

/** Uses a class action (cost not paid: the dispatcher pays it; see the convex test). */
function act(sheet: CharacterSheet, key: string, input: Input = {}): FeatureUseResult {
  const feature = findFeature(sheet, key);
  if (!feature?.use) throw new Error(`no usable ${key} for ${sheet.classId}`);
  return feature.use({ sheet, params: input.params ?? {}, rng: input.rng ?? dice(), others: input.others ?? [], ...(input.roll ? { roll: input.roll } : {}) });
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

const other = (id: string, classId: string, patch: Partial<CharacterSheet> = {}): OtherSheet => ({ characterId: id, sheet: sheetOf(classId, { name: id, ...patch }) });

const duality = (hope: number, fear: number, total: number, outcome: RollRecord["outcome"], kind: "action" | "reaction" = "action"): RollRecord => ({
  kind,
  dice: [
    { sides: 12, value: hope, role: "hope" },
    { sides: 12, value: fear, role: "fear" },
  ],
  modifier: total - hope - fear,
  total,
  difficulty: 12,
  outcome,
  manual: false,
});

describe("Bard Rally (CB 28)", () => {
  it("gives the Bard and every ally a d6 Rally Die held until session end, d8 from level 5, once per session", () => {
    const bard = sheetOf("bard");
    const rally = findFeature(bard, "rally");
    expect(rally?.target).toBe("party");
    expect(rally?.cost?.use).toEqual({ key: "rally", until: "session" });
    const result = act(bard, "rally", { others: [other("a", "warrior"), other("b", "seraph")] });
    expect(result.sheet.heldDice).toEqual([{ id: "rally-1", kind: "rally", sides: 6, until: "session" }]);
    expect(result.others?.map((o) => o.sheet.heldDice[0]?.sides)).toEqual([6, 6]);
    expect(act(sheetOf("bard", { level: 5 }), "rally").sheet.heldDice[0]?.sides).toBe(8);
    // A second Bard's die gets its own id; session end clears every unspent die.
    const twice = act(result.sheet, "rally").sheet;
    expect(twice.heldDice.map((d) => d.id)).toEqual(["rally-1", "rally-2"]);
    expect(onSessionEnd(expire(twice, "session")).heldDice).toEqual([]);
  });

  it("any Core class spends a Rally Die on a roll or damage in the dice box, offered once for a multiclass", () => {
    const warrior = sheetOf("warrior", { heldDice: [{ id: "rally-1", kind: "rally", sides: 6, until: "session" }] });
    for (const kind of ["action", "reaction", "damage"] as const) {
      expect(rollOptions(warrior, kind).filter((o) => o.key === "rally:rally-1")).toHaveLength(1);
    }
    const applied = applyRollOptions(warrior, rollOptions(warrior, "action"), ["rally:rally-1"]);
    expect(applied.extraDice).toEqual([{ count: 1, sides: 6 }]);
    expect(applied.sheet.heldDice).toEqual([]);
    const multi = { ...warrior, multiclass: { classId: "bard", domainId: "grace", subclassId: "troubadour" } };
    expect(rollOptions(multi, "damage").filter((o) => o.key.startsWith("rally:"))).toHaveLength(1);
  });

  it("a Rally Die rolls to clear that much Stress", () => {
    const sheet = sheetOf("rogue", { stress: 4, heldDice: [{ id: "rally-1", kind: "rally", sides: 8, until: "session" }] });
    const result = act(sheet, "rallyDieStress", { rng: dice(3) });
    expect(result.sheet.stress).toBe(1);
    expect(result.sheet.heldDice).toEqual([]);
    expect(refusal(() => act(sheetOf("rogue"), "rallyDieStress"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => act({ ...sheet, stress: 0 }, "rallyDieStress"))).toBe("CLASS_FEATURE_RULE");
  });
});

describe("Guardian Unstoppable (CB 36)", () => {
  it("starts a d4 at 1 (d6 from level 5), adds it to damage, rises per damage roll that deals HP and ends past its maximum", () => {
    const guardian = sheetOf("guardian", { conditions: ["vulnerable", "hidden"] });
    expect(findFeature(guardian, "unstoppable")?.cost?.use).toEqual({ key: "unstoppable", until: "longRest" });
    let sheet = act(guardian, "unstoppable").sheet;
    expect(sheet.classState.unstoppable).toEqual({ value: 1, max: 4 });
    expect(sheet.conditions).toEqual(["hidden"]);
    expect(act(sheetOf("guardian", { level: 5 }), "unstoppable").sheet.classState.unstoppable?.max).toBe(6);
    expect(rollOptions(sheet, "damage").find((o) => o.key === "unstoppable")).toMatchObject({ auto: true, effect: { kind: "modifier", value: 1 } });
    expect(rollOptions(sheet, "action").find((o) => o.key === "unstoppable")).toBeUndefined();
    for (let v = 2; v <= 4; v += 1) {
      sheet = act(sheet, "unstoppableHit").sheet;
      expect(sheet.classState.unstoppable?.value).toBe(v);
    }
    sheet = act(sheet, "unstoppableHit").sheet;
    expect(sheet.classState.unstoppable).toBeUndefined();
    expect(refusal(() => act(sheet, "unstoppableHit"))).toBe("CLASS_FEATURE_RULE");
  });

  it("ends with the scene: End Unstoppable or session end", () => {
    const sheet = act(sheetOf("guardian"), "unstoppable").sheet;
    expect(act(sheet, "endUnstoppable").sheet.classState.unstoppable).toBeUndefined();
    expect(onSessionEnd(sheet).classState.unstoppable).toBeUndefined();
  });
});

describe("Ranger's Focus (CB 38)", () => {
  it("costs 1 Hope; a successful attack sets the Focus, a failed one does not", () => {
    const ranger = sheetOf("ranger");
    expect(findFeature(ranger, "rangersFocus")?.cost).toEqual({ hope: 1 });
    const set = act(ranger, "rangersFocus", { roll: duality(8, 3, 14, "successHope"), params: { choice: "the ogre" } });
    expect(set.sheet.classState.focus).toBe("the ogre");
    expect(act(ranger, "rangersFocus", { roll: duality(2, 3, 7, "failFear") }).sheet.classState.focus).toBeUndefined();
    expect(refusal(() => act(ranger, "rangersFocus"))).toBe("CLASS_FEATURE_RULE");
  });

  it("ends the Focus to reroll the Duality Dice of a failed attack, swapping what the roll gave", () => {
    const ranger = sheetOf("ranger", { hope: 2, classState: { focus: "the ogre" } });
    // Failed with Fear (the GM gained 1), rerolled to 10/4: success with Hope.
    const result = act(ranger, "focusReroll", { roll: duality(2, 3, 7, "failFear"), rng: dice(10, 4) });
    expect(result.roll).toMatchObject({ total: 16, outcome: "successHope" });
    expect(result.fearDelta).toBe(-1);
    expect(result.sheet.hope).toBe(3);
    expect(result.sheet.classState.focus).toBeUndefined();
    expect(refusal(() => act(ranger, "focusReroll", { roll: duality(8, 3, 14, "successHope") }))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => act(sheetOf("ranger"), "focusReroll", { roll: duality(2, 3, 7, "failFear") }))).toBe("CLASS_FEATURE_RULE");
    expect(act(ranger, "endFocus").sheet.classState.focus).toBeUndefined();
  });
});

describe("Rogue (CB 42)", () => {
  it("Cloaked replaces Hidden and toggles off", () => {
    const on = act(sheetOf("rogue", { conditions: ["hidden"] }), "cloaked").sheet;
    expect(on.conditions).toEqual(["cloaked"]);
    expect(act(on, "cloaked").sheet.conditions).toEqual([]);
  });

  it("Sneak Attack adds tier-many d6 to damage", () => {
    expect(rollOptions(sheetOf("rogue"), "damage").find((o) => o.key === "sneakAttack")?.effect).toEqual({ kind: "dice", count: 1, sides: 6 });
    expect(rollOptions(sheetOf("rogue", { level: 5 }), "damage").find((o) => o.key === "sneakAttack")?.effect).toEqual({ kind: "dice", count: 3, sides: 6 });
    expect(rollOptions(sheetOf("rogue"), "action").find((o) => o.key === "sneakAttack")).toBeUndefined();
  });
});

describe("Seraph Prayer Dice (CB 44; settled rule)", () => {
  const seraph = (patch: Partial<CharacterSheet> = {}) => sheetOf("seraph", { subclassId: "divine-wielder", ...patch });
  const held = (...values: number[]) => values.map((value, i) => ({ id: `prayer-${i + 1}`, kind: "prayer" as const, sides: 4, value, until: "session" as const }));

  it("rolls Spellcast-trait d4s at session start, none at 0 or less, cleared at session end", () => {
    const sheet = onSessionStart(seraph({ traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 } }), dice(3, 1));
    expect(sheet.heldDice).toEqual(held(3, 1));
    expect(onSessionStart(seraph({ traits: { agility: 2, strength: -1, finesse: 1, instinct: 1, presence: 0, knowledge: 0 } }), dice()).heldDice).toEqual([]);
    expect(onSessionEnd(expire(sheet, "session")).heldDice).toEqual([]);
  });

  it("spends dice for Hope, on an ally too", () => {
    const sheet = seraph({ hope: 1, heldDice: held(3, 2) });
    expect(act(sheet, "prayerHope").sheet).toMatchObject({ hope: 4, heldDice: held(2).map((d) => ({ ...d, id: "prayer-2" })) });
    const both = act(sheet, "prayerHope", { params: { dieIndexes: [0, 1] } }).sheet;
    expect(both.hope).toBe(6);
    expect(both.heldDice).toEqual([]);
    const ally = other("ally-1", "warrior", { hope: 0 });
    const aided = act(sheet, "prayerHope", { params: { targetId: "ally-1" }, others: [ally] });
    expect(aided.others?.[0]?.sheet.hope).toBe(3);
    expect(aided.sheet.hope).toBe(1);
    expect(refusal(() => act(sheet, "prayerHope", { params: { targetId: "stranger" }, others: [ally] }))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => act(seraph(), "prayerHope"))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => act(sheet, "prayerHope", { params: { dieIndexes: [5] } }))).toBe("CLASS_FEATURE_RULE");
  });

  it("spends dice to reduce damage (a reminder) or to add to the latest roll after it is made", () => {
    const sheet = seraph({ heldDice: held(4) });
    expect(act(sheet, "prayerDamage").summary).toMatch(/reduce incoming damage by 4/);
    const raised = act(sheet, "prayerRoll", { roll: duality(5, 3, 10, "failHope") });
    expect(raised.roll).toMatchObject({ total: 14, outcome: "successHope" });
    expect(raised.sheet.heldDice).toEqual([]);
    expect(refusal(() => act(sheet, "prayerRoll"))).toBe("CLASS_FEATURE_RULE");
  });
});

describe("Sorcerer Channel Raw Power (CB 46)", () => {
  const sorcerer = (patch: Partial<CharacterSheet> = {}) =>
    sheetOf("sorcerer", { hope: 1, domainCards: { owned: ["a-soldier-s-bond"], loadout: ["a-soldier-s-bond"] }, ...patch });

  it("is once per long rest and vaults a loadout card for Hope equal to its level", () => {
    expect(findFeature(sorcerer(), "channelRawPower")?.cost?.use).toEqual({ key: "channelRawPower", until: "longRest" });
    const { sheet } = act(sorcerer(), "channelRawPower", { params: { choice: "hope:a-soldier-s-bond" } });
    expect(sheet.hope).toBe(3);
    expect(sheet.domainCards).toEqual({ owned: ["a-soldier-s-bond"], loadout: [] });
  });

  it("or for +2× its level to a spell's damage roll, offered in the dice box until ended", () => {
    const { sheet } = act(sorcerer(), "channelRawPower", { params: { choice: "damage:a-soldier-s-bond" } });
    expect(rollOptions(sheet, "damage").find((o) => o.key === "channelRawPower")?.effect).toEqual({ kind: "modifier", value: 4 });
    expect(rollOptions(sorcerer(), "damage").find((o) => o.key === "channelRawPower")).toBeUndefined();
    expect(withEffects(sheet).damageBonus).toBe(0);
    expect(refusal(() => act(sorcerer(), "channelRawPower", { params: { choice: "hope:not-in-loadout" } }))).toBe("CLASS_FEATURE_RULE");
    expect(refusal(() => act(sorcerer(), "channelRawPower"))).toBe("CLASS_FEATURE_RULE");
  });
});

describe("Warrior (CB 48)", () => {
  it("Combat Training adds the level to damage automatically", () => {
    expect(rollOptions(sheetOf("warrior", { level: 3 }), "damage").find((o) => o.key === "combatTraining")).toMatchObject({ auto: true, effect: { kind: "modifier", value: 3 } });
    expect(rollOptions(sheetOf("warrior"), "action").find((o) => o.key === "combatTraining")).toBeUndefined();
  });

  it("Attack of Opportunity is an assisted reaction roll", () => {
    const sheet = sheetOf("warrior");
    expect(findFeature(sheet, "attackOfOpportunity")).toMatchObject({ automation: "assist" });
    expect(act(sheet, "attackOfOpportunity").sheet).toEqual(sheet);
  });
});

describe("Wizard Strange Patterns (CB 50; decision 6)", () => {
  it("chooses a number 1-12, changeable after a long rest", () => {
    const sheet = act(sheetOf("wizard"), "strangePatterns", { params: { amount: 7 } }).sheet;
    expect(sheet.classState.strangeNumber).toBe(7);
    expect(refusal(() => act(sheet, "strangePatterns", { params: { amount: 3 } }))).toBe("CLASS_FEATURE_RULE");
    expect(act(expire(sheet, "longRest"), "strangePatterns", { params: { amount: 3 } }).sheet.classState.strangeNumber).toBe(3);
    expect(refusal(() => act(sheetOf("wizard"), "strangePatterns", { params: { amount: 13 } }))).toBe("CLASS_FEATURE_RULE");
  });

  it("prompts after a matching Duality Die, once even when both dice match", () => {
    const sheet = sheetOf("wizard", { classState: { strangeNumber: 7 } });
    const prompts = (h: number, f: number) => afterDualityRoll(sheet, { hope: h, fear: f, roll: duality(h, f, h + f, "successHope") });
    expect(prompts(7, 3)).toHaveLength(1);
    expect(prompts(2, 7)[0]).toMatchObject({ featureKey: "strangePatternsBenefit", choices: [{ key: "hope" }, { key: "stress" }] });
    expect(prompts(7, 7)).toHaveLength(1);
    expect(prompts(2, 3)).toEqual([]);
  });

  it("gives one benefit per matching roll: +1 Hope or clear 1 Stress", () => {
    const sheet = sheetOf("wizard", { classState: { strangeNumber: 7 } });
    const roll = duality(7, 7, 18, "critical");
    const hope = act(sheet, "strangePatternsBenefit", { roll, params: { choice: "hope" } }).sheet;
    expect(hope.hope).toBe(4);
    expect(refusal(() => act(hope, "strangePatternsBenefit", { roll, params: { choice: "stress" } }))).toBe("CLASS_FEATURE_RULE");
    expect(act(sheet, "strangePatternsBenefit", { roll, params: { choice: "stress" } }).sheet.stress).toBe(2);
    expect(act(sheetOf("wizard", { hope: 6, classState: { strangeNumber: 7 } }), "strangePatternsBenefit", { roll }).sheet.stress).toBe(2);
    expect(refusal(() => act(sheet, "strangePatternsBenefit", { roll: duality(2, 3, 9, "successFear") }))).toBe("CLASS_FEATURE_RULE");
  });
});

describe("Druid (CB 30)", () => {
  it("Beastform marks a Stress and shows the form as an effect; Wildtouch is text", () => {
    const druid = sheetOf("druid");
    expect(findFeature(druid, "beastform")?.cost).toEqual({ stress: 1 });
    const { sheet } = act(druid, "beastform", { params: { choice: "agile-scout" } });
    expect(sheet.effects[0]).toMatchObject({ id: "beastform", until: "manual" });
    expect(withEffects(sheet).evasion).toBe(12);
    expect(withEffects(sheet).traits.agility).toBe(3);
    expect(act(druid, "beastform").sheet.effects[0]?.text).toMatch(/^Transformed/);
    expect(refusal(() => act(druid, "beastform", { params: { choice: "armored-sentry" } }))).toBe("CLASS_FEATURE_RULE");
    expect(findFeature(druid, "wildtouch")).toMatchObject({ automation: "text" });
    expect(findFeature(druid, "wildtouch")?.use).toBeUndefined();
  });

  it("every Core class lists the Rally Die Stress action", () => {
    for (const id of ["bard", "druid", "guardian", "ranger", "rogue", "seraph", "sorcerer", "warrior", "wizard"]) {
      expect(classActions(sheetOf(id)).some((f) => f.key === "rallyDieStress"), id).toBe(true);
    }
  });
});

describe("integration (D5 TI-a)", () => {
  it("Combat Training is not offered in Motherboard, where Ikonis Training replaces it (CB 295)", () => {
    const warrior = sheetOf("warrior", { level: 3 });
    expect(rollOptions(warrior, "damage", undefined, { hopeAndFear: true, ikonis: true }).map((o) => o.key)).not.toContain("combatTraining");
    expect(rollOptions(warrior, "damage", undefined, { hopeAndFear: false, ikonis: false }).map((o) => o.key)).toContain("combatTraining");
  });

  it("panel inputs: Strange Patterns' number, Channel Raw Power's cards, Beastform's forms, Evolution's traits, Ranger's Focus target, Prayer Dice", () => {
    expect(findFeature(sheetOf("wizard"), "strangePatterns")?.inputs).toEqual([{ kind: "number", param: "amount", label: "Number (1-12)", min: 1, max: 12 }]);
    const sorcerer = sheetOf("sorcerer", { domainCards: { owned: ["a-soldier-s-bond"], loadout: ["a-soldier-s-bond"] } });
    const [channel] = findFeature(sorcerer, "channelRawPower")!.inputs!;
    expect(channel?.kind === "select" && channel.options(sorcerer).map((o) => o.value)).toEqual(["hope:a-soldier-s-bond", "damage:a-soldier-s-bond"]);
    const druid = sheetOf("druid", { level: 1 });
    const [form] = findFeature(druid, "beastform")!.inputs!;
    const forms = form?.kind === "select" ? form.options(druid) : [];
    expect(forms.length).toBeGreaterThan(0);
    // A form from the list is accepted by Beastform.
    expect(act(druid, "beastform", { params: { choice: forms[0]!.value } }).sheet.effects[0]?.id).toBe("beastform");
    const [trait] = findFeature(druid, "evolution")!.inputs!;
    expect(trait?.kind === "select" && trait.options(druid).map((o) => o.value)).toEqual(["agility", "strength", "finesse", "instinct", "presence", "knowledge"]);
    expect(findFeature(sheetOf("ranger"), "rangersFocus")?.inputs?.[0]).toMatchObject({ kind: "text", param: "choice" });
    const seraph = sheetOf("seraph");
    expect(findFeature(seraph, "prayerHope")?.inputs?.map((i) => i.kind)).toEqual(["heldDice", "ally"]);
    expect(findFeature(seraph, "prayerRoll")?.inputs?.map((i) => i.kind)).toEqual(["heldDice"]);
    expect(findFeature(sheetOf("sorcerer"), "volatileMagic")?.inputs?.map((i) => i.kind)).toEqual(["rollDice"]);
  });
});
