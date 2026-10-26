import { describe, expect, it } from "vitest";

import type { ActorState, PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { parseFeatureId, featureId as idOf } from "@/lib/domain/feature-effects/ids";
import { featureAvailability, runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import type { Holdings } from "@/lib/domain/feature-effects/upgrades";
import { FEATURE_CLASSIFICATION, featureEffect } from "@/lib/srd/feature-effects";
import { SERAPH_WITCH_EFFECTS } from "@/lib/srd/feature-effects/seraph-witch";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-seraph-witch: every Seraph and Witch feature classified combat or passive, run through
// runFeature with fixed dice. Expected values come from the feature texts by hand (CB p.44-45, HF p.16-17); the readings
// are in docs/tasks/TASK-SD-FE-seraph-witch.md. RNG order: Hope die, Fear die, then dice in the order the steps need them.

const OWNERS = new Set(["seraph", "witch", "divine-wielder", "winged-sentinel", "hedge", "moon"]);

const entry = (id: string): FeatureEffect => {
  const found = SERAPH_WITCH_EFFECTS.find((e) => e.featureId === id);
  if (!found) throw new Error(`No entry for ${id}`);
  return found;
};

const ally = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "pc",
  evasion: 12,
  thresholds: { major: 6, severe: 12 },
  hp: 3,
  hpMax: 6,
  stress: 3,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const seraph = (over: Partial<ActorState> = {}) => actorOf(sheetOf("seraph", "divine-wielder"), { spellcast: 2, tier: 2, level: 3, ...over });
const witch = (over: Partial<ActorState> = {}) => actorOf(sheetOf("witch", "hedge"), { spellcast: 3, tier: 2, level: 3, ...over });

const NO_HOLDINGS: Holdings = { rank: "mastery", featureIds: new Set(), level: 3 };

/** Runs a use, checks every queued die was used, and returns the plan. */
function ok(id: string, useId: string | undefined, context: Omit<FeatureRunContext, "rng" | "gmFear"> & { dice?: number[]; gmFear?: number }): RunPlan {
  const { dice = [], gmFear = 2, ...rest } = context;
  const rng = queueRng(dice);
  const result = runFeature(entry(id), useId, { gmFear, rng, ...rest });
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

const refused = (id: string, useId: string | undefined, context: Omit<FeatureRunContext, "rng" | "gmFear">) =>
  runFeature(entry(id), useId, { gmFear: 2, rng: queueRng([]), ...context });

describe("the Seraph and Witch table", () => {
  it("has exactly one entry per Seraph and Witch feature classified combat or passive (20 of 22)", () => {
    const expected = Object.entries(FEATURE_CLASSIFICATION)
      .filter(([id, c]) => OWNERS.has(parseFeatureId(id)?.owner ?? "") && (c.usage === "combat" || c.usage === "passive"))
      .map(([id]) => id)
      .sort();
    const ids = SERAPH_WITCH_EFFECTS.map((e) => e.featureId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(expected);
    expect(ids).toHaveLength(20);
    // The two out-of-combat features have no entry.
    expect(ids).not.toContain("class:witch:commune");
    expect(ids).not.toContain("subclass:hedge:walk-between-worlds");
  });

  it("each entry's source, owner and subclass card match its id and the subclass data; the registry serves them", () => {
    for (const e of SERAPH_WITCH_EFFECTS) {
      const parsed = parseFeatureId(e.featureId);
      expect(parsed).toMatchObject({ source: e.source, owner: e.owner });
      expect(featureEffect(e.featureId)).toBe(e);
      if (e.source !== "subclass") {
        expect(e.card).toBeUndefined();
        continue;
      }
      const sub = SUBCLASSES.find((s) => s.id === e.owner)!;
      const card = (["foundation", "specialization", "mastery"] as const).find((rank) => sub[rank].some((f) => idOf("subclass", sub.id, f.name) === e.featureId));
      expect(e.card).toBe(card);
    }
  });

  it("every use id is unique within its entry, and passive uses carry no Use steps", () => {
    for (const e of SERAPH_WITCH_EFFECTS) {
      expect(new Set(e.uses.map((u) => u.id)).size).toBe(e.uses.length);
      for (const u of e.uses) if (u.activation.kind === "passive") expect(u.steps).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------- Seraph

describe("Life Support (CB p.44): 3 Hope, an ally within Close clears a Hit Point", () => {
  it("clears 1 HP on the ally and spends 3 Hope", () => {
    const plan = ok("hope:seraph", undefined, { actor: seraph({ hope: 3 }), targets: [ally("mira")] });
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "mira", track: "hp", amount: 1 }]);
    expect(plan.actor.after.hope).toBe(0);
    expect(entry("hope:seraph").uses[0]!.targets).toMatchObject({ side: "ally", range: "close", excludeSelf: true });
  });

  it("is refused with 2 Hope", () => {
    expect(refused("hope:seraph", undefined, { actor: seraph({ hope: 2 }), targets: [ally("mira")] })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Prayer Dice (CB p.44, p.107): spend any number on yourself or an ally within Far", () => {
  const heldDice = [
    { id: "prayer-1", kind: "prayer" as const, sides: 4, value: 3 },
    { id: "prayer-2", kind: "prayer" as const, sides: 4, value: 2 },
    { id: "rally-1", kind: "rally" as const, sides: 6 },
  ];

  it("reduces incoming damage by the spent dice's value, in the reaction window of an ally within Far", () => {
    const use = entry("class:seraph:prayer-dice").uses.find((u) => u.id === "damage")!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "far", includeSelf: true } });
    const plan = ok("class:seraph:prayer-dice", "damage", { actor: seraph({ heldDice }), choices: { dice: 2 }, trigger: { amount: 9, subject: ally("mira") } });
    expect(ofKind(plan, "pay")[0]!.costs).toEqual([{ resource: "tokens", amount: 2, pool: "prayer", values: [3, 2] }]);
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "reduceDamage" }, targetIds: ["mira"], amount: 5 });
    expect(plan.actor.after.heldDice).toEqual([{ id: "rally-1", kind: "rally", sides: 6 }]);
  });

  it("adds a die's value to a roll after it is made (the after-roll step, Q1)", () => {
    const plan = ok("class:seraph:prayer-dice", "roll", { actor: seraph({ heldDice }), choices: { dice: 1 }, trigger: { subject: seraph({ heldDice }) } });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyRoll", change: { kind: "add" } }, amount: 3 });
    expect(entry("class:seraph:prayer-dice").uses.find((u) => u.id === "roll")!.activation).toMatchObject({ trigger: { kind: "afterAllyRolls", range: "far", includeSelf: true } });
  });

  it("gives Hope equal to the result to an ally, or to yourself", () => {
    const toAlly = ok("class:seraph:prayer-dice", "hope", { actor: seraph({ heldDice }), choices: { dice: 2 }, targets: [ally("mira")] });
    expect(ofKind(toAlly, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: 5 }]);
    const toSelf = ok("class:seraph:prayer-dice", "hope", { actor: seraph({ heldDice, hope: 1 }), choices: { dice: 1 }, targets: [seraph()] });
    expect(toSelf.actor.after.hope).toBe(4);
  });

  it("is refused without enough Prayer Dice", () => {
    expect(refused("class:seraph:prayer-dice", "hope", { actor: seraph({ heldDice: heldDice.slice(1) }), choices: { dice: 2 }, targets: [ally("mira")] })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Spirit Weapon (CB p.44)", () => {
  it("lets a Melee or Very Close weapon attack within Close", () => {
    expect(entry("subclass:divine-wielder:spirit-weapon").uses.find((u) => u.id === "reach")!.mods).toEqual([{ kind: "set", stat: "meleeWeaponRange", to: { kind: "fixed", value: 2 } }]);
  });

  it("a Stress adds one more adversary within Close to the same attack roll", () => {
    const plan = ok("subclass:divine-wielder:spirit-weapon", "extra-target", { actor: seraph({ stress: 1 }), situations: ["You attack with your Spirit Weapon (an equipped weapon with a range of Melee or Very Close)"] });
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "addTargets", targets: { side: "enemy", range: "close" }, damage: "same" }, amount: 1 });
  });
});

describe("Sparing Touch (CB p.44) and Devout's second use", () => {
  it("clears 2 Hit Points or 2 Stress from a touched creature, once per long rest", () => {
    const hp = ok("subclass:divine-wielder:sparing-touch", undefined, { actor: seraph(), targets: [ally("mira")], options: { clear: ["hp"] } });
    expect(ofKind(hp, "clear")).toEqual([{ kind: "clear", targetId: "mira", track: "hp", amount: 2 }]);
    expect(hp.limit).toEqual({ key: "feat:subclass:divine-wielder:sparing-touch", until: "longRest", consumed: true });
    const stress = ok("subclass:divine-wielder:sparing-touch", undefined, { actor: seraph(), targets: [ally("mira")], options: { clear: ["stress"] } });
    expect(ofKind(stress, "clear")).toEqual([{ kind: "clear", targetId: "mira", track: "stress", amount: 2 }]);
  });

  it("is exhausted after one use, and twice per long rest with Devout", () => {
    const used = [{ key: "feat:subclass:divine-wielder:sparing-touch", until: "longRest" as const }];
    expect(refused("subclass:divine-wielder:sparing-touch", undefined, { actor: seraph({ featureUses: used }), targets: [ally("mira")] })).toMatchObject({ ok: false, reason: "exhausted" });
    const devout: Holdings = { rank: "specialization", featureIds: new Set(["subclass:divine-wielder:devout"]), level: 5 };
    const second = ok("subclass:divine-wielder:sparing-touch", undefined, { actor: seraph({ featureUses: used }), targets: [ally("mira")], options: { clear: ["hp"] }, holdings: devout });
    expect(second.limit?.consumed).toBe(true);
    expect(featureAvailability({ classId: "seraph", featureUses: [...used, ...used] }, entry("subclass:divine-wielder:sparing-touch"), undefined, { holdings: devout })).toMatchObject({ state: "exhausted" });
  });

  it("Devout itself adds no modifier (its extra Prayer Die is the session-start roll, SD8)", () => {
    expect(entry("subclass:divine-wielder:devout").uses).toEqual([{ id: "main", name: "Devout", activation: { kind: "passive" }, mods: [], steps: [] }]);
  });
});

describe("Sacred Resonance (CB p.44): matching Spirit Weapon damage dice are doubled", () => {
  it("rides on a successful weapon attack once the player confirms the Spirit Weapon", () => {
    const plan = ok("subclass:divine-wielder:sacred-resonance", undefined, { actor: seraph(), targets: [adversary("bandit")], situations: ["You roll damage for your Spirit Weapon"] });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyDamage", change: { kind: "doubleDice", which: "matching" } } });
    expect(refused("subclass:divine-wielder:sacred-resonance", undefined, { actor: seraph() })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Wings of Light (CB p.45) while flying (Q16) and Power of the Gods", () => {
  const flying = { facts: { flying: true } };

  it("spends a Hope for an extra 1d8 on a successful attack", () => {
    const plan = ok("subclass:winged-sentinel:wings-of-light", "strike", { actor: seraph({ ...flying, hope: 2 }), targets: [adversary("bandit")], dice: [6] });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyDamage", change: { kind: "add" } }, targetIds: ["bandit"], amount: 6 });
    expect(plan.actor.after.hope).toBe(1);
  });

  it("is refused while not flying", () => {
    expect(refused("subclass:winged-sentinel:wings-of-light", "strike", { actor: seraph({ facts: { flying: false } }) })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("deals 1d12 instead with Power of the Gods", () => {
    const holdings: Holdings = { ...NO_HOLDINGS, featureIds: new Set(["subclass:winged-sentinel:power-of-the-gods"]) };
    const plan = ok("subclass:winged-sentinel:wings-of-light", "strike", { actor: seraph(flying), targets: [adversary("bandit")], dice: [11], holdings });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ amount: 11 });
    expect(entry("subclass:winged-sentinel:power-of-the-gods").uses[0]!.mods).toEqual([]);
  });

  it("marks a Stress to carry a willing creature your size or smaller", () => {
    const plan = ok("subclass:winged-sentinel:wings-of-light", "carry", { actor: seraph({ ...flying, stress: 0 }), targets: [ally("mira")], situations: ["The creature is approximately your size or smaller"] });
    expect(plan.actor.after.stress).toBe(1);
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", targetIds: ["mira"] });
  });
});

describe("Ethereal Visage (CB p.45) and Ascendant (CB p.45)", () => {
  it("advantage on Presence Rolls while flying", () => {
    const use = entry("subclass:winged-sentinel:ethereal-visage").uses.find((u) => u.id === "presence")!;
    expect(use.mods).toEqual([{ kind: "advantage", on: "presence" }]);
    expect(refused("subclass:winged-sentinel:ethereal-visage", "presence", { actor: seraph({ facts: { flying: false } }) })).toMatchObject({ ok: false, reason: "requirement" });
    expect(ok("subclass:winged-sentinel:ethereal-visage", "presence", { actor: seraph({ facts: { flying: true } }) }).steps).toEqual([]);
  });

  it("a success with Hope on a Presence Roll removes a Fear instead of the Hope (folded into that roll)", () => {
    const use = entry("subclass:winged-sentinel:ethereal-visage").uses.find((u) => u.id === "fear")!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "presence", result: "withHope" } });
    const plan = ok("subclass:winged-sentinel:ethereal-visage", "fear", { actor: seraph() });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "replaceHopeGain", with: "removeFear" } });
  });

  it("Ascendant: +4 to the Severe threshold", () => {
    expect(entry("subclass:winged-sentinel:ascendant").uses[0]!.mods).toEqual([{ kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 4 } }]);
  });
});

// ---------------------------------------------------------------- Witch

describe("Witch's Charm (HF p.16): a failed action roll within Far becomes a success with Fear", () => {
  it("3 Hope; the subject's roll is set to a success with Fear", () => {
    const use = entry("hope:witch").uses[0]!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "afterAllyRolls", range: "far", result: "failure", includeSelf: true } });
    const plan = ok("hope:witch", undefined, { actor: witch({ hope: 4 }), trigger: { subject: ally("mira") } });
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyRoll", change: { kind: "setOutcome", outcome: "successWithFear" } }, targetIds: ["mira"] });
    expect(refused("hope:witch", undefined, { actor: witch({ hope: 2 }), trigger: { subject: ally("mira") } })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Hex (HF p.16): a Stress, a target within Far, - tier to its damage and Difficulty, up to Spellcast at once", () => {
  const sheet = sheetOf("witch", "hedge", { level: 3, traits: { agility: 0, strength: 0, finesse: 1, instinct: 1, presence: 1, knowledge: 2 } });

  it("marks a Stress, Hexes the target (D5 keeps the list) and lowers its Difficulty and damage by the tier", () => {
    const result = runFeature(entry("class:witch:hex"), undefined, { actor: actorOf(sheet, { spellcast: 2, tier: 2 }), gmFear: 2, rng: queueRng([]), sheet, targets: [adversary("bandit")] });
    if (!result.ok) throw new Error(result.detail);
    const plan = result.plan;
    expect(plan.actor.after.stress).toBe(sheet.stress + 1);
    expect(result.sheet!.classState.hexes).toEqual(["Target 1"]);
    expect(ofKind(plan, "delegate")[0]).toMatchObject({ feature: "hex", done: true, targetIds: ["bandit"] });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "bandit", condition: { kind: "tag", tag: "Hexed" }, duration: "temporary" });
    expect(ofKind(plan, "effect")[0]).toMatchObject({
      targetId: "bandit",
      mods: [
        { kind: "stat", stat: "difficulty", delta: -2 },
        { kind: "stat", stat: "damage", delta: -2 },
      ],
      duration: "temporary",
    });
    expect(plan.creatures.find((c) => c.id === "bandit")!.after.tags).toEqual(["Hexed"]);
    expect(plan.holdLimit).toBe(2);
  });

  it("D5 refuses a Hex past your Spellcast trait (question 2 in the task doc)", () => {
    const full = { ...sheet, classState: { ...sheet.classState, hexes: ["Target 1", "Target 2"] } };
    expect(runFeature(entry("class:witch:hex"), undefined, { actor: actorOf(full, { spellcast: 2, tier: 2 }), gmFear: 2, rng: queueRng([]), sheet: full, targets: [adversary("bandit")] })).toMatchObject({ ok: false, reason: "choice" });
  });

  it("at tier 4 the penalty is 4; without a sheet the plan carries the D5 step for the server", () => {
    const plan = ok("class:witch:hex", undefined, { actor: witch({ tier: 4 }), targets: [adversary("bandit")] });
    expect(ofKind(plan, "effect")[0]!.mods).toEqual([
      { kind: "stat", stat: "difficulty", delta: -4 },
      { kind: "stat", stat: "damage", delta: -4 },
    ]);
    expect(ofKind(plan, "delegate")[0]).toMatchObject({ feature: "hex", done: false, params: { targetId: "bandit" } });
  });
});

describe("Hedge: Herbal Remedies, Vexing Malison (HF p.16)", () => {
  it("consumables clear one more; advantage on attacks against Hexed creatures", () => {
    expect(entry("subclass:hedge:herbal-remedies").uses[0]!.mods).toEqual([{ kind: "stat", stat: "consumableClear", delta: { kind: "fixed", value: 1 } }]);
    expect(entry("subclass:hedge:vexing-malison").uses[0]!.mods).toEqual([{ kind: "advantage", on: "attack", versus: { creature: { kind: "hexed" }, on: "attacksAgainstThem" } }]);
  });
});

describe("Enchanted Talisman (HF p.16)", () => {
  it("once per rest, the Hope spent becomes tokens and the holder is tagged", () => {
    const plan = ok("subclass:hedge:enchanted-talisman", "imbue", { actor: witch({ hope: 3 }), choices: { hope: 2 }, targets: [ally("mira")] });
    expect(plan.actor.after).toMatchObject({ hope: 1, cardTokens: 2 });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "mira", condition: { kind: "tag", tag: "Enchanted Talisman" }, duration: "rest" });
    expect(plan.limit).toMatchObject({ key: "feat:subclass:hedge:enchanted-talisman:imbue", until: "rest" });
  });

  it("when the holder takes damage, a token makes them mark one fewer Hit Point", () => {
    const holder = { subject: { conditions: [], tags: ["Enchanted Talisman"], hp: 3, hpMax: 6 } };
    const plan = ok("subclass:hedge:enchanted-talisman", "protect", { actor: witch({ cardTokens: 2, facts: holder }), trigger: { amount: 8, subject: ally("mira") } });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "adjustHpMarked", change: "fewer" }, targetIds: ["mira"], amount: 1 });
    expect(plan.actor.after.cardTokens).toBe(1);
    // Not the holder, or no token left: refused.
    const other = { subject: { conditions: [], tags: [], hp: 3, hpMax: 6 } };
    expect(refused("subclass:hedge:enchanted-talisman", "protect", { actor: witch({ cardTokens: 2, facts: other }), trigger: { subject: ally("mira") } })).toMatchObject({ ok: false, reason: "requirement" });
    expect(refused("subclass:hedge:enchanted-talisman", "protect", { actor: witch({ cardTokens: 0, facts: holder }), trigger: { subject: ally("mira") } })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("clears its tokens when you take a rest", () => {
    const plan = ok("subclass:hedge:enchanted-talisman", "rest", { actor: witch({ cardTokens: 2 }) });
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "clear", before: 2, after: 0 }]);
  });
});

describe("Circle of Power (HF p.16, Q14)", () => {
  it("draws a Very Close circle with +2 thresholds, attack and Evasion and tokens equal to Spellcast, once per rest", () => {
    const plan = ok("subclass:hedge:circle-of-power", "main", { actor: witch({ spellcast: 3 }) });
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "set", before: 0, after: 3 }]);
    expect(ofKind(plan, "area")[0]).toMatchObject({
      centreId: null,
      area: {
        label: "Circle of Power",
        centre: "point",
        radius: "veryClose",
        side: "selfAndAllies",
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: 2 },
          { kind: "stat", stat: "severeThreshold", delta: 2 },
          { kind: "stat", stat: "attack", delta: 2 },
          { kind: "stat", stat: "evasion", delta: 2 },
        ],
      },
    });
    expect(plan.limit).toMatchObject({ until: "rest", consumed: true });
  });

  it("a roll or an evaded attack inside the circle removes a token", () => {
    expect(ofKind(ok("subclass:hedge:circle-of-power", "roll", { actor: witch({ cardTokens: 3 }) }), "tokens")).toEqual([{ kind: "tokens", op: "spend", before: 3, after: 2 }]);
    expect(ofKind(ok("subclass:hedge:circle-of-power", "evade", { actor: witch({ cardTokens: 1 }) }), "tokens")).toEqual([{ kind: "tokens", op: "spend", before: 1, after: 0 }]);
  });
});

describe("Night's Glamour (HF p.17)", () => {
  it("on a Spellcast Roll (13) success: Glamoured, attackers within Close mark a Stress; ends on marking HP or dealing damage", () => {
    // Hope 9, Fear 4, Spellcast 3: 16 ≥ 13.
    const plan = ok("subclass:moon:nights-glamour", "main", { actor: witch(), dice: [9, 4] });
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", label: "Glamoured", mods: [{ kind: "flag", flag: "attackersMarkStress" }], endsOn: ["markHp", "dealDamage"] });
    // Hope 3, Fear 2, Spellcast 3: 8 < 13.
    expect(ofKind(ok("subclass:moon:nights-glamour", "main", { actor: witch(), dice: [3, 2] }), "effect")).toEqual([]);
  });

  it("a Stress maintains it; the appearance advantage needs the Glamour", () => {
    const glamoured = { facts: { featureEffects: [{ featureId: "subclass:moon:nights-glamour" }] } };
    const plan = ok("subclass:moon:nights-glamour", "maintain-hp", { actor: witch({ ...glamoured, stress: 0 }) });
    expect(plan.actor.after.stress).toBe(1);
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual" });
    expect(refused("subclass:moon:nights-glamour", "maintain-damage", { actor: witch({ facts: { featureEffects: [] } }) })).toMatchObject({ ok: false, reason: "requirement" });
    expect(refused("subclass:moon:nights-glamour", "appearance", { actor: witch({ facts: { featureEffects: [] } }), situations: ["The roll leverages your illusory appearance"] })).toMatchObject({ ok: false, reason: "requirement" });
    expect(ok("subclass:moon:nights-glamour", "appearance", { actor: witch(glamoured), situations: ["The roll leverages your illusory appearance"] }).steps).toEqual([]);
  });
});

describe("Moonbeam, Ire of Pale Light, Lunar Phases (HF p.17)", () => {
  it("Moonbeam: once per session, Close moonlight until the end of the scene, +1 Spellcast", () => {
    const plan = ok("subclass:moon:moonbeam", undefined, { actor: witch() });
    expect(ofKind(plan, "area")[0]).toMatchObject({ centreId: "pc", area: { radius: "close", side: "selfAndAllies", mods: [{ kind: "stat", stat: "spellcast", delta: 1 }], duration: "scene" } });
    expect(plan.limit).toMatchObject({ key: "feat:subclass:moon:moonbeam", until: "session" });
  });

  it("Ire of Pale Light: a Hexed creature within Very Far that fails an attack marks a Stress", () => {
    expect(entry("subclass:moon:ire-of-pale-light").uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenEnemyFailsAttack", range: "veryFar", source: { kind: "hexed" } } });
    const plan = ok("subclass:moon:ire-of-pale-light", undefined, { actor: witch(), trigger: { source: adversary("bandit") } });
    expect(ofKind(plan, "mark")[0]).toMatchObject({ targetId: "bandit", track: "stress", amount: 1 });
  });

  it("Lunar Phases: New spends a Hope to negate Minor damage; the bump is once per rest for a Hope", () => {
    const plan = ok("subclass:moon:lunar-phases", "new", { actor: witch({ hope: 1 }), situations: ["Your moon die shows a 1 (New)"] });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "negate", what: "damage" } });
    expect(plan.actor.after.hope).toBe(0);
    expect(entry("subclass:moon:lunar-phases").uses.find((u) => u.id === "new")!.activation).toMatchObject({ trigger: { kind: "whenYouWouldTakeDamage", severity: "minor" } });
    const bump = ok("subclass:moon:lunar-phases", "bump", { actor: witch({ hope: 1 }) });
    expect(bump.limit).toMatchObject({ until: "rest", consumed: true });
    expect(ofKind(bump, "prompt")[0]).toMatchObject({ prompt: "manual" });
    expect(entry("subclass:moon:lunar-phases").uses.find((u) => u.id === "phases")!.mods).toEqual([]);
  });
});
