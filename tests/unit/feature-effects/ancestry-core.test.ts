import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, Mod } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { owned } from "@/lib/domain/feature-effects/owned";
import { featureAvailability, runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { FEATURE_CLASSIFICATION, featureEffect } from "@/lib/srd/feature-effects";
import { ANCESTRY_CORE_EFFECTS } from "@/lib/srd/feature-effects/ancestry-core";
import { ANCESTRIES } from "@/lib/srd/heritage";
import { actorOf, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-ancestry-core: every core ancestry feature classified combat or passive runs through
// runFeature with fixed dice. Expected numbers are worked out by hand from the feature texts (CB p.53-70, printed pages).
// RNG order: Hope die, Fear die, advantage die, then damage dice and checks in step order.

const sheet = sheetOf("guardian", "stalwart", { hope: 4, stress: 1, stressMax: 6, hp: 2, hpMax: 6, proficiency: 2 });
const actor = (over: Partial<ActorState> = {}): ActorState => actorOf(sheet, { proficiency: 2, ...over });

const adv = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 5,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const ally = (id: string): Combatant => ({
  id,
  side: "pc",
  evasion: 11,
  thresholds: { major: 6, severe: 12 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
});

function entry(featureId: string): FeatureEffect {
  const found = ANCESTRY_CORE_EFFECTS.find((e) => e.featureId === featureId);
  if (!found) throw new Error(`No entry for ${featureId}`);
  return found;
}

const ctx = (diceValues: number[], over: Partial<FeatureRunContext> = {}): FeatureRunContext => ({ actor: actor(), gmFear: 2, rng: queueRng(diceValues), ...over });

/** Runs a feature and checks the dice queue was used up exactly. */
function ok(featureId: string, context: FeatureRunContext, useId?: string): RunPlan {
  const result = runFeature(entry(featureId), useId, context);
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  (context.rng as ReturnType<typeof queueRng>).done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const folds = (plan: RunPlan) => ofKind(plan, "fold").map((f) => [f.step.kind, f.targetIds, f.amount]);

/** A passive use's mods resolved through an effect step, so run() does the arithmetic. */
function resolvedMods(mods: readonly Mod[], over: Partial<ActorState> = {}) {
  const probe: CardEffect = {
    cardId: "probe",
    uses: [{ id: "main", name: "probe", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "probe", mods, duration: "permanent" }] }],
  };
  const result = run(probe, { actor: actor(over), gmFear: 0, rng: queueRng([]) });
  if (!result.ok) throw new Error("refused");
  return ofKind(result.plan, "effect")[0]!.mods;
}

const CORE = new Set(ANCESTRIES.filter((a) => a.source === "core").map((a) => a.id));

describe("the core ancestry table", () => {
  it("has exactly one entry per core ancestry feature classified combat or passive", () => {
    const expected = Object.entries(FEATURE_CLASSIFICATION)
      .filter(([id, c]) => id.startsWith("ancestry:") && CORE.has(id.split(":")[1]!) && c.usage !== "outOfCombat" && c.usage !== "narrative")
      .map(([id]) => id)
      .sort();
    const ids = ANCESTRY_CORE_EFFECTS.map((e) => e.featureId);
    expect([...ids].sort()).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(28);
  });

  it("every entry is a real core ancestry feature, keyed as owned() keys it, with unique use ids", () => {
    for (const effect of ANCESTRY_CORE_EFFECTS) {
      expect(effect.source).toBe("ancestry");
      expect(effect.featureId.startsWith(`ancestry:${effect.owner}:`)).toBe(true);
      expect(CORE.has(effect.owner)).toBe(true);
      const ids = effect.uses.map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(featureEffect(effect.featureId)).toBe(effect);
    }
  });

  it("passive features have no action use (the drawer shows them without a Use button)", () => {
    for (const effect of ANCESTRY_CORE_EFFECTS) {
      // Luckbringer is classified passive but is a session-start timing use (delegated to the session features).
      if (FEATURE_CLASSIFICATION[effect.featureId]?.usage !== "passive" || effect.featureId === "ancestry:halfling:luckbringer") continue;
      expect(effect.uses.every((u) => u.activation.kind === "passive")).toBe(true);
    }
  });

  it("mixed ancestries resolve through owned() (CB p.71: the first feature of one, the second of the other)", () => {
    const mixed = sheetOf("guardian", "stalwart", { ancestry: { kind: "mixed", first: "dwarf", second: "faerie", name: "Dwarf-Faerie" } });
    const held = owned(mixed).filter((f) => f.source === "ancestry").map((f) => f.featureId);
    expect(held).toEqual(["ancestry:dwarf:thick-skin", "ancestry:faerie:wings"]);
    for (const id of held) expect(featureEffect(id)).toBeDefined();
    const single = owned(sheetOf("guardian", "stalwart", { ancestry: { kind: "single", id: "galapa" } })).filter((f) => f.source === "ancestry");
    expect(single.map((f) => featureEffect(f.featureId)?.featureId)).toEqual(["ancestry:galapa:shell", "ancestry:galapa:retract"]);
  });
});

describe("Drakona (CB p.54)", () => {
  it("Scales: on Severe damage a Stress marks 1 fewer Hit Point", () => {
    expect(entry("ancestry:drakona:scales").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", severity: "severe" } });
    const plan = ok("ancestry:drakona:scales", ctx([], { trigger: { amount: 16 } }));
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["adjustHpMarked", ["pc"], 1]]);
  });

  it("Elemental Breath: one Instinct Roll against a group within Very Close, d8 magic x Proficiency rolled once", () => {
    // Hope 9 + Fear 4 + Instinct 0 = 13: beats Difficulty 12, misses 14. Damage 2d8 = 5 + 3 = 8 (the bandit's Major).
    const plan = ok("ancestry:drakona:elemental-breath", ctx([9, 4, 5, 3], { targets: [adv("bandit"), adv("knight", { difficulty: 14 })] }));
    expect(plan.roll).toMatchObject({ withHope: true });
    expect(plan.hits.map((h) => [h.id, h.hit])).toEqual([
      ["bandit", true],
      ["knight", false],
    ]);
    const damage = ofKind(plan, "damage");
    expect(damage).toHaveLength(1);
    expect(damage[0]!.result).toMatchObject({ targetId: "bandit", incoming: 8, severity: "major", hpMarked: 2 });
    expect(ofKind(plan, "damageRoll").map((d) => d.type)).toEqual(["magic"]);
    const use = entry("ancestry:drakona:elemental-breath").uses[0]!;
    expect(use.targets).toEqual({ side: "enemy", range: "veryClose", count: { kind: "any" } });
  });
});

describe("Dwarf (CB p.55)", () => {
  it("Thick Skin: on Minor damage, 2 Stress instead of 1 Hit Point", () => {
    expect(entry("ancestry:dwarf:thick-skin").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", severity: "minor" } });
    const plan = ok("ancestry:dwarf:thick-skin", ctx([], { trigger: { amount: 5 } }));
    expect(plan.actor.before.stress).toBe(1);
    expect(plan.actor.after.stress).toBe(3);
    expect(plan.actor.after.hp).toBe(2);
    expect(folds(plan)).toEqual([["adjustHpMarked", ["pc"], 1]]);
  });

  it("Thick Skin can't be paid with fewer than 2 Stress slots free", () => {
    const result = runFeature(entry("ancestry:dwarf:thick-skin"), undefined, ctx([], { actor: actor({ stress: 5 }), trigger: { amount: 5 } }));
    expect(result).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Increased Fortitude: 3 Hope halve incoming physical damage, rounded up (Q6, CB p.107)", () => {
    expect(entry("ancestry:dwarf:increased-fortitude").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", damageType: "physical" } });
    const odd = ok("ancestry:dwarf:increased-fortitude", ctx([], { trigger: { amount: 13 } }));
    expect(odd.actor.after.hope).toBe(1);
    expect(folds(odd)).toEqual([["modifyDamage", ["pc"], 7]]);
    expect(folds(ok("ancestry:dwarf:increased-fortitude", ctx([], { trigger: { amount: 12 } })))).toEqual([["modifyDamage", ["pc"], 6]]);
    expect(runFeature(entry("ancestry:dwarf:increased-fortitude"), undefined, ctx([], { actor: actor({ hope: 2 }), trigger: { amount: 13 } }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Elf (CB p.56)", () => {
  it("Quick Reactions: a Stress for advantage on a reaction roll", () => {
    expect(entry("ancestry:elf:quick-reactions").uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "reaction" } });
    const plan = ok("ancestry:elf:quick-reactions", ctx([]));
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["modifyRoll", ["pc"], undefined]]);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ change: { kind: "advantage" } });
  });
});

describe("Faerie (CB p.57)", () => {
  it("Luckbender: once per session, 3 Hope reroll the Duality Dice of your or a Close ally's action roll (Q1)", () => {
    const use = entry("ancestry:faerie:luckbender").uses[0]!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "afterAllyRolls", range: "close", result: "any", includeSelf: true } });
    const plan = ok("ancestry:faerie:luckbender", ctx([], { trigger: { subject: ally("mira") } }));
    expect(plan.actor.after.hope).toBe(1);
    expect(folds(plan)).toEqual([["modifyRoll", ["mira"], undefined]]);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ change: { kind: "reroll", dice: "all" } });
    expect(plan.limit).toEqual({ key: "feat:ancestry:faerie:luckbender", until: "session", consumed: true });
    const used = { ...sheet, featureUses: plan.actor.featureUses };
    expect(featureAvailability(used, entry("ancestry:faerie:luckbender"))).toMatchObject({ state: "exhausted", until: "session" });
    expect(runFeature(entry("ancestry:faerie:luckbender"), undefined, ctx([], { actor: actor({ featureUses: plan.actor.featureUses }) }))).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Wings: while flying (Q16), after an attack roll against you (Q2), a Stress for +2 Evasion", () => {
    const use = entry("ancestry:faerie:wings").uses[0]!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "whenAttacked", stage: "rolled" } });
    const plan = ok("ancestry:faerie:wings", ctx([], { actor: actor({ facts: { flying: true } }) }));
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["modifyRoll", ["pc"], 2]]);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ change: { kind: "evasion" } });
    expect(runFeature(entry("ancestry:faerie:wings"), undefined, ctx([], { actor: actor({ facts: { flying: false } }) }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Faun (CB p.58)", () => {
  it("Kick: on a success against a Melee target, a Stress for +2d6 damage and a knock-back of you or the target", () => {
    const plan = ok("ancestry:faun:kick", ctx([4, 5], { situations: ["The target is within Melee range"], targets: [adv("bandit")], options: { knock: ["target"] } }));
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["modifyDamage", ["bandit"], 9]]);
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "move", targetIds: ["bandit"], text: "Knock the target back to Very Close range" }]);
    const self = ok("ancestry:faun:kick", ctx([1, 1], { situations: ["The target is within Melee range"], targets: [adv("bandit")], options: { knock: ["self"] } }));
    expect(ofKind(self, "prompt")).toMatchObject([{ prompt: "move", targetIds: ["pc"], text: "Knock yourself back to Very Close range" }]);
    expect(runFeature(entry("ancestry:faun:kick"), undefined, ctx([], { targets: [adv("bandit")] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Firbolg (CB p.59)", () => {
  it("Charge: a successful Agility Roll into Melee, a Stress deals 1d12 physical to every target in Melee", () => {
    const confirmed = ["You move from Far or Very Far range into Melee range with one or more targets"];
    // Hope 8 + Fear 3 + Agility 2 = 13 vs the GM's 12; 1d12 = 9 to both (Major for each: 2 HP).
    const plan = ok("ancestry:firbolg:charge", ctx([8, 3, 9], { situations: confirmed, roll: { difficulty: 12 }, targets: [adv("a"), adv("b")], optionals: ["stress"] }));
    expect(plan.success).toBe(true);
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 9],
      ["b", 9],
    ]);
    expect(ofKind(plan, "damageRoll").map((d) => d.type)).toEqual(["physical"]);
    // A failure: no Stress asked, no damage.
    const miss = ok("ancestry:firbolg:charge", ctx([2, 5], { situations: confirmed, roll: { difficulty: 12 }, targets: [adv("a")], optionals: ["stress"] }));
    expect(ofKind(miss, "damage")).toEqual([]);
    expect(miss.actor.after.stress).toBe(1);
  });

  it("Unshakable: when you would mark a Stress, a d6; only a 6 says don't mark it", () => {
    expect(entry("ancestry:firbolg:unshakable").uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "wouldMarkStress" } });
    const six = ok("ancestry:firbolg:unshakable", ctx([6]));
    expect(ofKind(six, "check")).toEqual([{ kind: "check", total: 6, dice: [6], passed: true }]);
    expect(ofKind(six, "prompt")).toMatchObject([{ prompt: "manual", text: "Unshakable rolled a 6: don't mark that Stress" }]);
    const five = ok("ancestry:firbolg:unshakable", ctx([5]));
    expect(ofKind(five, "check")[0]!.passed).toBe(false);
    expect(ofKind(five, "prompt")).toEqual([]);
  });
});

describe("Galapa (CB p.61)", () => {
  it("Shell: + Proficiency to both damage thresholds", () => {
    expect(resolvedMods(entry("ancestry:galapa:shell").uses[0]!.mods!)).toEqual([
      { kind: "stat", stat: "majorThreshold", delta: 2 },
      { kind: "stat", stat: "severeThreshold", delta: 2 },
    ]);
    expect(resolvedMods(entry("ancestry:galapa:shell").uses[0]!.mods!, { proficiency: 4 })[0]).toMatchObject({ delta: 4 });
  });

  it("Retract: a Stress for physical resistance, disadvantage on action rolls and no movement until you come out", () => {
    const plan = ok("ancestry:galapa:retract", ctx([]));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "effect")).toEqual([
      {
        kind: "effect",
        targetId: "pc",
        label: "Retracted into your shell",
        mods: [
          { kind: "resistance", type: "physical", level: "resistant" },
          { kind: "flag", flag: "actionDisadvantage" },
          { kind: "flag", flag: "cannotMove" },
        ],
        duration: "manual",
        endsWhen: "You come out of your shell",
      },
    ]);
  });
});

describe("Giant (CB p.62)", () => {
  it("Endurance is the slot table's (nothing to run); Reach treats Melee as Very Close", () => {
    expect(ok("ancestry:giant:endurance", ctx([])).steps).toEqual([]);
    expect(entry("ancestry:giant:endurance").uses[0]!.mods).toEqual([]);
    expect(resolvedMods(entry("ancestry:giant:reach").uses[0]!.mods!)).toEqual([{ kind: "set", stat: "meleeRange", to: 1 }]);
  });
});

describe("Goblin (CB p.63)", () => {
  it("Surefooted ignores disadvantage on Agility Rolls", () => {
    expect(entry("ancestry:goblin:surefooted").uses[0]!.mods).toEqual([{ kind: "flag", flag: "ignoreAgilityDisadvantage" }]);
    expect(ok("ancestry:goblin:surefooted", ctx([])).steps).toEqual([]);
  });

  it("Danger Sense: once per rest, a Stress forces the adversary to reroll an attack on you or an ally within Very Close", () => {
    const use = entry("ancestry:goblin:danger-sense").uses[0]!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "whenCreatureAttacked", subject: "selfOrAlly", subjectWithin: "veryClose", stage: "rolled" } });
    const plan = ok("ancestry:goblin:danger-sense", ctx([], { trigger: { source: adv("bandit"), subject: ally("mira") } }));
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["modifyRoll", ["bandit"], undefined]]);
    expect(plan.limit).toEqual({ key: "feat:ancestry:goblin:danger-sense", until: "rest", consumed: true });
  });
});

describe("Halfling (CB p.64)", () => {
  it("Luckbringer: a session-start use delegated to the session features, no cost", () => {
    expect(entry("ancestry:halfling:luckbringer").uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "timing", at: "sessionStart" } });
    const plan = ok("ancestry:halfling:luckbringer", ctx([]));
    expect(ofKind(plan, "delegate")).toEqual([expect.objectContaining({ feature: "luckbringer", done: false })]);
    expect(plan.actor.after).toMatchObject({ hope: 4, stress: 1 });
  });

  it("Internal Compass: a Use / Pass reroll of a Hope Die that rolled a 1", () => {
    const use = entry("ancestry:halfling:internal-compass").uses[0]!;
    expect(use.activation.kind).toBe("reaction");
    const plan = ok("ancestry:halfling:internal-compass", ctx([]));
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "reroll", dice: "hope", ifAtMost: 1 } });
    expect(plan.actor.after).toEqual(plan.actor.before);
  });
});

describe("Human (CB p.65)", () => {
  it("High Stamina is the slot table's (nothing to run)", () => {
    expect(ok("ancestry:human:high-stamina", ctx([])).steps).toEqual([]);
  });

  it("Adaptability: a failed roll that used an Experience, a Stress to reroll", () => {
    const use = entry("ancestry:human:adaptability").uses[0]!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "failure" } });
    const plan = ok("ancestry:human:adaptability", ctx([], { actor: actor({ facts: { rollUsedExperience: true } }) }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ change: { kind: "reroll", dice: "all" } });
    expect(runFeature(entry("ancestry:human:adaptability"), undefined, ctx([], { actor: actor({ facts: { rollUsedExperience: false } }) }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Infernis (CB p.66)", () => {
  it("Fearless: on a roll with Fear, 2 Stress make it a roll with Hope (Q1)", () => {
    const use = entry("ancestry:infernis:fearless").uses[0]!;
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "withFear" } });
    const plan = ok("ancestry:infernis:fearless", ctx([]));
    expect(plan.actor.after.stress).toBe(3);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "withHope" } });
  });
});

describe("Katari (CB p.67)", () => {
  it("Feline Instincts: on an Agility Roll, 2 Hope reroll the Hope Die", () => {
    const plan = ok("ancestry:katari:feline-instincts", ctx([]));
    expect(plan.actor.after.hope).toBe(2);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ change: { kind: "reroll", dice: "hope" } });
    expect(entry("ancestry:katari:feline-instincts").uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "afterYouRoll", roll: "agility", result: "any" } });
  });

  it("Retracting Claws: an Agility Roll against a Melee target; on a success it is temporarily Vulnerable", () => {
    // 7 + 4 + Agility 2 = 13 vs 12.
    const hit = ok("ancestry:katari:retracting-claws", ctx([7, 4], { targets: [adv("bandit")] }));
    expect(ofKind(hit, "condition")).toEqual([{ kind: "condition", targetId: "bandit", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }]);
    const miss = ok("ancestry:katari:retracting-claws", ctx([3, 4], { targets: [adv("bandit")] }));
    expect(ofKind(miss, "condition")).toEqual([]);
  });
});

describe("Orc (CB p.68)", () => {
  it("Sturdy: attacks against you have disadvantage only with 1 Hit Point remaining", () => {
    expect(entry("ancestry:orc:sturdy").uses[0]!.mods).toEqual([{ kind: "disadvantageAgainst", on: "attack" }]);
    expect(ok("ancestry:orc:sturdy", ctx([], { actor: actor({ hp: 5, hpMax: 6 }) })).steps).toEqual([]);
    expect(runFeature(entry("ancestry:orc:sturdy"), undefined, ctx([], { actor: actor({ hp: 4, hpMax: 6 }) }))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Tusks: on a success against a Melee target, a Hope for an extra 1d6 damage", () => {
    const plan = ok("ancestry:orc:tusks", ctx([5], { situations: ["The target is within Melee range"], targets: [adv("bandit")] }));
    expect(plan.actor.after.hope).toBe(3);
    expect(folds(plan)).toEqual([["modifyDamage", ["bandit"], 5]]);
    expect(entry("ancestry:orc:tusks").uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } });
  });
});

describe("Ribbet (CB p.69)", () => {
  it("Long Tongue: a Stress, a Finesse attack within Close, d12 physical x Proficiency", () => {
    // 10 + 2 + Finesse 1 = 13 vs 12; 2d12 = 7 + 8 = 15 (Severe: 3 HP).
    const plan = ok("ancestry:ribbet:long-tongue", ctx([10, 2, 7, 8], { targets: [adv("bandit")] }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ targetId: "bandit", incoming: 15, severity: "severe", hpMarked: 3 });
    expect(ofKind(plan, "damageRoll").map((d) => d.type)).toEqual(["physical"]);
  });
});

describe("Simiah (CB p.70)", () => {
  it("Nimble: +1 Evasion", () => {
    expect(resolvedMods(entry("ancestry:simiah:nimble").uses[0]!.mods!)).toEqual([{ kind: "stat", stat: "evasion", delta: 1 }]);
  });
});

describe("Clank (CB p.53)", () => {
  it("Purposeful Design is a manual note (no Experience modifier in the vocabulary)", () => {
    const use = entry("ancestry:clank:purposeful-design").uses[0]!;
    expect(use.activation).toEqual({ kind: "passive" });
    expect(use.steps).toMatchObject([{ kind: "manual" }]);
  });
});
