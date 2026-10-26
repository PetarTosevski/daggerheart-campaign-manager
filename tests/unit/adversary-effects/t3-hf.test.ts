import { describe, expect, it } from "vitest";

import { activePassives, matchesTrigger, passiveSummary, type AdversaryState } from "@/lib/domain/adversary-actions/features";
import { run, runStandardAttack, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext, type AdversaryRunResult } from "@/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryStep, AdversaryTrigger } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryEffects, adversaryGroup } from "@/lib/srd/adversary-effects";
import { T3_HF_EFFECTS } from "@/lib/srd/adversary-effects/t3-hf";
import type { AdversaryDef } from "@/lib/srd/types";

// Plan combat-actions, tracer AE-t3-hf: every feature of every tier 3 Hope & Fear adversary (HF p.81-89) run through the
// AA1 runner with fixed dice. Expected values are worked out by hand from the feature text and the stat block. RNG order:
// target-count dice, the d20(s), then damage dice, `check` dice and prompt numbers in step order. Every successful run
// checks that all queued dice were used. PCs here have Evasion 12 unless stated.

const GROUP = ADVERSARIES.filter((a) => adversaryGroup(a) === "t3-hf");

const defOf = (id: string): AdversaryDef => {
  const def = GROUP.find((a) => a.id === id);
  if (!def) throw new Error(`No tier 3 Hope & Fear adversary ${id}`);
  return def;
};

const effectOf = (adversaryId: string, feature: string): AdversaryFeatureEffect => {
  const effect = T3_HF_EFFECTS.find((e) => e.adversaryId === adversaryId && e.feature === feature);
  if (!effect) throw new Error(`No entry for ${adversaryId}/${feature}`);
  return effect;
};

const selfOf = (id: string, over: Partial<Combatant> = {}): Combatant => {
  const def = defOf(id);
  return {
    id: "inst1",
    side: "adversary",
    difficulty: def.difficulty,
    thresholds: { major: def.thresholds.major ?? 0, severe: def.thresholds.severe ?? 0 },
    hp: 0,
    hpMax: def.hp,
    stress: 0,
    stressMax: def.stress ?? 0,
    defeated: false,
    conditions: [],
    ...over,
  };
};

const pc = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "pc",
  evasion: 12,
  thresholds: { major: 7, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const ally = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 13,
  thresholds: { major: 8, severe: 16 },
  hp: 0,
  hpMax: 4,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const stateOf = (self: Combatant, tokens = 0, extra: Partial<AdversaryState> = {}): AdversaryState => ({
  hp: self.hp,
  hpMax: self.hpMax,
  stress: self.stress,
  stressMax: self.stressMax,
  conditions: self.conditions,
  tags: self.tags ?? [],
  tokens,
  ...extra,
});

const mira = pc("mira");
const bram = pc("bram", { evasion: 14 });
const cora = pc("cora");

/** Runs one use with queued dice (the instance's passives in force, Fear confirmed) and checks every die was used. */
function runF(adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunResult {
  const def = defOf(adversaryId);
  const self = over.self ?? selfOf(adversaryId);
  const rng = queueRng(dice);
  const result = run(effectOf(adversaryId, feature), {
    adversaryId,
    self,
    attack: { name: def.attack.name, modifier: def.attack.modifier, range: def.attack.range, damage: def.attack.damage },
    tier: 3,
    gmFear: 5,
    spotlit: true,
    fearConfirmed: true,
    targets: [mira],
    passives: passiveSummary(adversaryEffects(adversaryId), stateOf(self, over.tokens ?? 0), 3),
    rng,
    ...over,
  });
  if (result.ok) rng.done();
  return result;
}

function ok(result: AdversaryRunResult): AdversaryPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const plan = (adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}) => ok(runF(adversaryId, feature, dice, over));
/** A triggered or passive use: no spotlight, no targets unless given. */
const quiet = (over: Partial<AdversaryRunContext> = {}): Partial<AdversaryRunContext> => ({ spotlit: false, targets: [], ...over });

const stepsOf = <K extends AdversaryPlanStep["kind"]>(p: AdversaryPlan, kind: K) => p.steps.filter((s): s is Extract<AdversaryPlanStep, { kind: K }> => s.kind === kind);
const prompts = (p: AdversaryPlan, prompt: string) => stepsOf(p, "prompt").filter((s) => s.prompt === prompt);
const folds = (p: AdversaryPlan) => stepsOf(p, "fold");
const creature = (p: AdversaryPlan, id: string) => p.creatures.find((c) => c.id === id)?.after;
const triggerOf = (adversaryId: string, feature: string, useId = "main"): AdversaryTrigger => {
  const use = effectOf(adversaryId, feature).uses.find((u) => u.id === useId);
  if (!use) throw new Error(`${feature} has no use ${useId}`);
  const a = use.activation;
  if (a.kind !== "reaction" && a.kind !== "auto") throw new Error(`${feature} has no trigger`);
  return a.trigger;
};
const summaryOf = (adversaryId: string, self = selfOf(adversaryId), extra: Partial<AdversaryState> = {}, tokens = 0) =>
  passiveSummary(adversaryEffects(adversaryId), stateOf(self, tokens, extra), 3);
const actionRoll = (over: Partial<{ trait: "knowledge"; spellcast: boolean; success: boolean; withHope: boolean; withFear: boolean; total: number }> = {}) => ({
  kind: "action" as const,
  success: true,
  withHope: true,
  withFear: false,
  ...over,
});

/** Every Fear cost in a use, nested ones included. */
function fearCosts(costs: readonly AdversaryCost[] | undefined, steps: readonly AdversaryStep[]): number[] {
  const out: number[] = [];
  const fromCosts = (list: readonly AdversaryCost[] | undefined) => {
    for (const c of list ?? []) {
      if (c.kind === "fear" && c.amount.kind === "fixed") out.push(c.amount.value);
      if (c.kind === "either") c.options.forEach(fromCosts);
    }
  };
  const walk = (list: readonly AdversaryStep[]) => {
    for (const s of list) {
      if (s.kind === "pay" || s.kind === "optional") fromCosts(s.costs);
      if (s.kind === "optional" || s.kind === "followUp") walk(s.steps);
      if (s.kind === "choose") s.options.forEach((o) => walk(o.steps));
      if (s.kind === "save") walk([...s.onFail, ...s.onSuccess]);
      if (s.kind === "check") walk([...s.then, ...s.otherwise]);
    }
  };
  fromCosts(costs);
  walk(steps);
  return out;
}

// ---------------------------------------------------------------- coverage (Q15)

describe("coverage: exactly one entry per printed feature (Q15)", () => {
  it("covers the 32 tier 3 Hope & Fear adversaries and their 135 features, nothing missing, nothing extra", () => {
    expect(GROUP).toHaveLength(32);
    const printed = GROUP.flatMap((a) => a.features.map((f) => `${a.id}/${f.name}`)).sort();
    const entries = T3_HF_EFFECTS.map((e) => `${e.adversaryId}/${e.feature}`).sort();
    expect(printed).toHaveLength(135);
    expect(entries).toEqual(printed);
    expect(new Set(entries).size).toBe(entries.length);
  });

  it("every entry is reachable through the registry and its use ids are unique", () => {
    for (const e of T3_HF_EFFECTS) {
      expect(adversaryEffects(e.adversaryId)).toContain(e);
      const ids = e.uses.map((u) => u.id);
      expect(new Set(ids).size, e.feature).toBe(ids.length);
    }
  });

  it("a printed Fear cost appears in the entry with its amount; passives and reactions never need the spotlight", () => {
    // Intimidating's "When you spend a Fear to spotlight the Dragon" is the spotlight's own Fear (CB p.153), not a cost.
    const spotlightFear = new Set(["young-fire-dragon/Intimidating"]);
    for (const a of GROUP) {
      for (const f of a.features) {
        const e = effectOf(a.id, f.name);
        const fears = e.uses.flatMap((u) => fearCosts(u.costs, u.steps));
        if (f.fearCost && !spotlightFear.has(`${a.id}/${f.name}`)) expect(fears, `${a.id}/${f.name}`).toContain(f.fearCost);
        for (const u of e.uses) {
          if (u.activation.kind !== "action") expect(u.needsSpotlight, `${a.id}/${f.name}:${u.id}`).toBe(false);
        }
      }
    }
    expect(effectOf("young-fire-dragon", "Intimidating").uses.flatMap((u) => fearCosts(u.costs, u.steps))).toEqual([]);
  });
});

// ---------------------------------------------------------------- shared shapes

describe("Relentless, Horde, resistance, Momentum and Terrifying", () => {
  it.each([
    ["archmage", 3],
    ["crimson-lepus", 3],
    ["drake", 2],
    ["fire-titan", 3],
    ["frost-titan", 2],
    ["gargantuan-sea-turtle", 3],
    ["manticore", 3],
    ["roc", 3],
    ["shapeshifting-fiend-revealed", 3],
    ["storm-titan", 3],
    ["vampire-lord", 3],
    ["young-fire-dragon", 3],
  ] as const)("%s Relentless (%i): spotlighted up to X times per GM turn", (id, times) => {
    expect(summaryOf(id).relentless).toBe(times);
    expect(plan(id, `Relentless (${times})`, [], quiet()).modifiers).toEqual([{ kind: "relentless", times }]);
  });

  it.each([
    // id, Horde X, HP marked (half or more), dice after the d20, expected damage
    ["night-children", "Horde (2d6+2)", "2d6+2", 4, [1, 2], 5],
    ["vampire-bat-swarm", "Horde (2d6)", "2d6", 4, [2, 3], 5],
  ] as const)("%s %s: once half the HP is marked the standard attack deals %s (CB p.199)", (id, feature, x, hp, dice, amount) => {
    const self = selfOf(id, { hp });
    expect(summaryOf(id, self).horde).toBe(x);
    const rng = queueRng([15, ...dice]);
    const p = ok(runStandardAttack({ adversaryId: id, self, attack: defOf(id).attack, tier: 3, gmFear: 0, spotlit: true, targets: [mira], passives: summaryOf(id, self), rng }));
    rng.done();
    expect(p.incoming[0]).toMatchObject({ amount, type: "physical" });
    expect(plan(id, feature, [], quiet()).modifiers).toHaveLength(1);
  });

  it.each([
    ["dullahan", "physical"],
    ["shapeshifting-fiend", "magic"],
    ["shapeshifting-fiend-revealed", "magic"],
    ["whisper-wraith", "physical"],
  ] as const)("%s has resistance to %s damage (CB p.99)", (id, type) => {
    const r = summaryOf(id).resistance!;
    expect(r[type]).toBe("resistant");
    expect(r[type === "physical" ? "magic" : "physical"]).toBe("none");
  });

  it.each([
    ["shapeshifting-fiend", "Fiendish Nature", "It can't be fooled by magic illusions."],
    ["shapeshifting-fiend-revealed", "Fiendish Resistance", "It can't be fooled by magic illusions."],
    ["whisper-wraith", "Greater Specter", "It can move through solid objects."],
  ] as const)("%s %s: the resistance plus a reminder", (id, feature, text) => {
    const p = plan(id, feature, [], quiet());
    expect(p.modifiers).toHaveLength(1);
    expect(prompts(p, "manual").map((s) => s.text)).toEqual([text]);
  });

  it.each(["fire-titan", "storm-titan"])("%s Momentum: a Fear on any successful attack against a PC, automatic (Q19)", (id) => {
    expect(matchesTrigger(triggerOf(id, "Momentum"), { kind: "onHit", attack: "feature" })).toBe(true);
    expect(plan(id, "Momentum", [], quiet())).toMatchObject({ activation: "auto", gmFearDelta: 1, fearSpent: 0 });
  });

  it.each(["crimson-lepus", "cryptimoth", "vampire-lord"])("%s Terrifying: on a hit every PC within Close range loses a Hope and the GM gains a Fear", (id) => {
    expect(matchesTrigger(triggerOf(id, "Terrifying"), { kind: "onHit", attack: "standard" })).toBe(true);
    expect(matchesTrigger(triggerOf(id, "Terrifying"), { kind: "onMiss", attack: "standard" })).toBe(false);
    const p = plan(id, "Terrifying", [], quiet({ picked: [mira, bram] }));
    expect(stepsOf(p, "hope")).toEqual([
      { kind: "hope", targetId: "mira", delta: -1 },
      { kind: "hope", targetId: "bram", delta: -1 },
    ]);
    expect(p.gmFearDelta).toBe(1);
  });

  it.each([
    // id, feature, ATK, range, first d20, damage dice of attack 1, second d20, damage dice of attack 2, expected total
    ["chimera", "Double Claw", 5, [10, 1, 2, 3, 10, 4, 5, 6], 6 + 15],
    ["wyvern", "Double Strike", 2, [10, 1, 2, 3, 10, 1, 1, 1], 11 + 8],
  ] as const)("%s %s: a Stress, two attack rolls (both with ATK +%i), hits on one PC combine", (id, feature, atk, dice, total) => {
    const p = plan(id, feature, [...dice], { followUp: [mira] });
    expect(p.self.after.stress).toBe(1);
    expect(stepsOf(p, "roll").map((s) => s.roll.record.total)).toEqual([10 + atk, 10 + atk]);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: total, type: "physical" })]);
    expect(runF(id, feature, [], { spotlit: false })).toMatchObject({ ok: false, code: "ADVERSARY_NOT_SPOTLIT" });
  });
});

// ---------------------------------------------------------------- per adversary

describe("Archmage (HF p.81)", () => {
  const aegis = (n: number) => selfOf("archmage", { tags: [`Aegis Die ${n}`] });

  it("Orbiting Aegis: the d6 Aegis Die starts at 6; a d6 at or under its value ticks it down and ignores the damage", () => {
    expect(plan("archmage", "Orbiting Aegis", [], quiet({ useId: "place" })).self.after.tags).toEqual(["Aegis Die 6"]);
    expect(matchesTrigger(triggerOf("archmage", "Orbiting Aegis", "ward-6"), { kind: "onAttacked", stage: "succeeded" })).toBe(true);
    expect(matchesTrigger(triggerOf("archmage", "Orbiting Aegis", "ward-6"), { kind: "onAttacked", stage: "failed" })).toBe(false);
    const warded = plan("archmage", "Orbiting Aegis", [4], quiet({ useId: "ward-6", self: aegis(6) }));
    expect(warded.self.after.tags).toEqual(["Aegis Die 5"]);
    expect(folds(warded).map((f) => f.step.kind)).toEqual(["negate"]);
    const through = plan("archmage", "Orbiting Aegis", [5], quiet({ useId: "ward-3", self: aegis(3) }));
    expect(through.self.after.tags).toEqual(["Aegis Die 3"]);
    expect(folds(through)).toEqual([]);
    const last = plan("archmage", "Orbiting Aegis", [1], quiet({ useId: "ward-1", self: aegis(1) }));
    expect(last.self.after.tags).toEqual([]);
    expect(runF("archmage", "Orbiting Aegis", [], quiet({ useId: "ward-5", self: aegis(6) }))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Orbiting Aegis: a PC's Knowledge Roll ticks it down by 1, or 2 with Hope", () => {
    const study = "The Knowledge Roll was made against the Aegis";
    expect(matchesTrigger(triggerOf("archmage", "Orbiting Aegis", "study-4"), { kind: "pcRolls", roll: actionRoll({ trait: "knowledge" }) })).toBe(true);
    expect(matchesTrigger(triggerOf("archmage", "Orbiting Aegis", "study-4"), { kind: "pcRolls", roll: actionRoll({ trait: "knowledge", success: false }) })).toBe(false);
    expect(runF("archmage", "Orbiting Aegis", [], quiet({ useId: "study-4", self: aegis(4) }))).toMatchObject({ ok: false, reason: "requirement" });
    const asked = plan("archmage", "Orbiting Aegis", [], quiet({ useId: "study-4", self: aegis(4), situations: [study] }));
    expect(prompts(asked, "choose")).toHaveLength(1);
    expect(plan("archmage", "Orbiting Aegis", [], quiet({ useId: "study-4", self: aegis(4), situations: [study], options: { study: ["success"] } })).self.after.tags).toEqual(["Aegis Die 3"]);
    expect(plan("archmage", "Orbiting Aegis", [], quiet({ useId: "study-4", self: aegis(4), situations: [study], options: { study: ["hope"] } })).self.after.tags).toEqual(["Aegis Die 2"]);
    expect(plan("archmage", "Orbiting Aegis", [], quiet({ useId: "study-2", self: aegis(2), situations: [study], options: { study: ["hope"] } })).self.after.tags).toEqual([]);
  });

  it("Force Salvo: any number of Fear, that many d4s; the total is the bolts (placed by the GM)", () => {
    expect(prompts(plan("archmage", "Force Salvo", [], { targets: [] }), "choose")).toHaveLength(1);
    const p = plan("archmage", "Force Salvo", [1, 2, 4], { targets: [], options: { salvo: ["3"] } });
    expect(p).toMatchObject({ fearSpent: 3, gmFearDelta: -3 });
    expect(stepsOf(p, "check")).toEqual([expect.objectContaining({ total: 7, dice: [1, 2, 4] })]);
    expect(prompts(p, "manual")).toHaveLength(1);
    const short = plan("archmage", "Force Salvo", [], { targets: [], gmFear: 2, options: { salvo: ["3"] } });
    expect(stepsOf(short, "pay")).toEqual([expect.objectContaining({ paid: false })]);
    expect(stepsOf(short, "check")).toEqual([]);
  });

  it("Fireball: N Stress for up to N PCs within Far range, each makes an Agility Reaction Roll", () => {
    const p = plan("archmage", "Fireball", [], { useId: "fireball-3", targets: [mira, bram, cora] });
    expect(p.self.after.stress).toBe(3);
    expect(prompts(p, "pcSave").map((s) => s.targetIds)).toEqual([["mira"], ["bram"], ["cora"]]);
    expect(runF("archmage", "Fireball", [], { useId: "fireball-2", targets: [mira, bram, cora] })).toMatchObject({ ok: false, reason: "targets" });
    expect(runF("archmage", "Fireball", [], { useId: "fireball-3", self: selfOf("archmage", { stress: 6 }) })).toMatchObject({ ok: false, reason: "cost", code: "ADVERSARY_FEATURE_UNAVAILABLE" });
  });

  it("Counterspell: a Fear plus one per token; a d20 against the Spellcast total makes it fail and places a token", () => {
    const trigger = triggerOf("archmage", "Counterspell");
    expect(matchesTrigger(trigger, { kind: "pcRolls", roll: actionRoll({ spellcast: true }) })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "pcRolls", roll: actionRoll({ spellcast: true, success: false }) })).toBe(false);
    const ctx = quiet({ trigger: { amount: 15, subject: mira } });
    expect(runF("archmage", "Counterspell", [], { ...ctx, fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    expect(runF("archmage", "Counterspell", [], { ...ctx, fearConfirmed: false, tokens: 2 })).toMatchObject({ ok: false, reason: "confirmFear", detail: "3" });
    const stopped = plan("archmage", "Counterspell", [16], ctx);
    expect(stopped).toMatchObject({ fearSpent: 1, self: { tokens: { before: 0, after: 1 } } });
    expect(stepsOf(stopped, "save")).toEqual([expect.objectContaining({ targetId: "inst1", difficulty: 15, success: true })]);
    expect(folds(stopped)).toEqual([expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ kind: "modifyRoll", change: { kind: "fail" } }) })]);
    const again = plan("archmage", "Counterspell", [10], { ...ctx, tokens: 1 });
    expect(again).toMatchObject({ fearSpent: 2, self: { tokens: { before: 1, after: 1 } } });
    expect(folds(again)).toEqual([]);
    expect(runF("archmage", "Counterspell", [], { ...ctx, tokens: 2, gmFear: 2 })).toMatchObject({ ok: false, reason: "cost", code: "NOT_ENOUGH_FEAR" });
  });
});

describe("Catrin (HF p.81)", () => {
  it("Attracted to Wealth: PCs carrying gold have advantage on Presence Rolls to influence it (a GM-confirmed aura)", () => {
    const text = "The PC carries at least a bag of gold and rolls to influence the Catrin";
    expect(summaryOf("catrin", selfOf("catrin"), { situations: [text] }).auras).toEqual([{ kind: "mod", mod: { kind: "advantage", on: "presence" }, to: "pcs" }]);
    expect(summaryOf("catrin").auras).toEqual([]);
  });

  it("The Weight of Opulence: a Fear, an Instinct Reaction Roll; the Hope per bag of gold is manual", () => {
    expect(runF("catrin", "The Weight of Opulence", [], { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const p = plan("catrin", "The Weight of Opulence", []);
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Expensive Failure: a PC in Melee fails an action roll; a Stress to steal a handful of gold (manual)", () => {
    const trigger = triggerOf("catrin", "Expensive Failure");
    expect(matchesTrigger(trigger, { kind: "pcRolls", roll: actionRoll({ success: false }), band: "melee" })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "pcRolls", roll: actionRoll({ success: false }), band: "close" })).toBe(false);
    const p = plan("catrin", "Expensive Failure", [], quiet({ trigger: { subject: mira } }));
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });
});

describe("Chimera (HF p.81)", () => {
  it("Rending Jaws: on a hit the PC needs 2 Armor Slots per severity step (manual)", () => {
    expect(matchesTrigger(triggerOf("chimera", "Rending Jaws"), { kind: "onHit", attack: "feature" })).toBe(true);
    expect(prompts(plan("chimera", "Rending Jaws", [], quiet({ trigger: { subject: mira } })), "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Breath of Fire: a Fear, up to three PCs, Agility Reaction Roll (20)", () => {
    const p = plan("chimera", "Breath of Fire", [], { targets: [mira, bram, cora] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(3);
    expect(runF("chimera", "Breath of Fire", [], { targets: [mira, bram, cora, pc("dax")] })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("Serpent Strike: when a PC within Close targets it, a Stress to attack first: 4d4+10 and Poisoned", () => {
    const trigger = triggerOf("chimera", "Serpent Strike");
    expect(matchesTrigger(trigger, { kind: "onAttacked", stage: "targeted", attackerBand: "close" })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "onAttacked", stage: "targeted", attackerBand: "far" })).toBe(false);
    // d20 15 + 5 = 20 hits; 4d4+10 = 1+2+3+4+10.
    const p = plan("chimera", "Serpent Strike", [15, 1, 2, 3, 4], quiet({ trigger: { source: mira } }));
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 20, type: "physical" })]);
    expect(creature(p, "mira")!.tags).toEqual(["Poisoned"]);
    expect(prompts(p, "manual")).toHaveLength(1);
    const miss = plan("chimera", "Serpent Strike", [2], quiet({ trigger: { source: mira } }));
    expect(miss.incoming).toEqual([]);
    expect(creature(miss, "mira")).toBeUndefined();
  });
});

describe("Crimson Lepus (HF p.82)", () => {
  const cute = selfOf("crimson-lepus", { tags: ["Too Cute"] });

  it("“Awww...”: Too Cute when it appears; an attacker must make an Instinct Reaction Roll (20); damage or its attack clears it", () => {
    expect(plan("crimson-lepus", "“Awww...”", [], quiet({ useId: "appear" })).self.after.tags).toEqual(["Too Cute"]);
    const attacked = plan("crimson-lepus", "“Awww...”", [], quiet({ useId: "attacked", self: cute, trigger: { source: mira } }));
    expect(prompts(attacked, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(runF("crimson-lepus", "“Awww...”", [], quiet({ useId: "attacked", trigger: { source: mira } }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(matchesTrigger(triggerOf("crimson-lepus", "“Awww...”", "hurt"), { kind: "onDamaged", stage: "did" })).toBe(true);
    expect(plan("crimson-lepus", "“Awww...”", [], quiet({ useId: "hurt", self: cute })).self.after.tags).toEqual([]);
    expect(matchesTrigger(triggerOf("crimson-lepus", "“Awww...”", "attacks"), { kind: "onAttack", stage: "before", attack: "standard" })).toBe(true);
    expect(plan("crimson-lepus", "“Awww...”", [], quiet({ useId: "attacks", self: cute })).self.after.tags).toEqual([]);
  });

  it("Leaping Jugular Strike: a Fear, leap, 3d20 direct physical; the Vulnerable rider after HP is marked is manual", () => {
    // d20 17 + 3 = 20; 3d20 = 5 + 6 + 7.
    const p = plan("crimson-lepus", "Leaping Jugular Strike", [17, 5, 6, 7]);
    expect(p.fearSpent).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 18, type: "physical", direct: true })]);
    expect(prompts(p, "move")).toHaveLength(1);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Evasive: when it would take damage, a d6 of 4+ halves it (or negates damage already halved)", () => {
    expect(matchesTrigger(triggerOf("crimson-lepus", "Evasive"), { kind: "onDamaged", stage: "would" })).toBe(true);
    expect(matchesTrigger(triggerOf("crimson-lepus", "Evasive"), { kind: "onDamaged", stage: "did" })).toBe(false);
    const halved = plan("crimson-lepus", "Evasive", [4], quiet({ options: { halved: ["no"] } }));
    expect(folds(halved)).toEqual([expect.objectContaining({ targetIds: ["inst1"], step: expect.objectContaining({ kind: "modifyDamage", change: { kind: "halve" } }) })]);
    expect(folds(plan("crimson-lepus", "Evasive", [6], quiet({ options: { halved: ["yes"] } })))).toEqual([expect.objectContaining({ step: expect.objectContaining({ kind: "negate", what: "damage" }) })]);
    expect(folds(plan("crimson-lepus", "Evasive", [3], quiet({ options: { halved: ["no"] } })))).toEqual([]);
  });

  it("“Run Away!”: a PC with no Hope takes the spotlight within Very Far range: Presence Reaction Roll or flee", () => {
    const trigger = triggerOf("crimson-lepus", "“Run Away!”");
    expect(matchesTrigger(trigger, { kind: "pcHope", change: "none", band: "far" })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "pcHope", change: "gain", band: "far" })).toBe(false);
    expect(prompts(plan("crimson-lepus", "“Run Away!”", [], quiet({ trigger: { subject: mira } })), "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });
});

describe("Cryptimoth (HF p.82)", () => {
  it("Psychic Screech: 2 Fear, each PC within Far range makes a reaction roll (16)", () => {
    expect(runF("cryptimoth", "Psychic Screech", [], { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "2" });
    const p = plan("cryptimoth", "Psychic Screech", [], { targets: [mira, bram] });
    expect(p).toMatchObject({ fearSpent: 2, gmFearDelta: -2 });
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Shadow Swarm: a Fear; the swarm's area is manual", () => {
    const p = plan("cryptimoth", "Shadow Swarm", [], { targets: [] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Paranoia Glare: a Fear, the PC is Paranoid (its rule is manual)", () => {
    const p = plan("cryptimoth", "Paranoia Glare", []);
    expect(p.fearSpent).toBe(1);
    expect(creature(p, "mira")!.tags).toEqual(["Paranoid"]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Cursed Merfolk (HF p.82)", () => {
  it("Fish-Tailed: Vulnerable out of the water (GM buttons for leaving and returning)", () => {
    const out = plan("cursed-merfolk", "Fish-Tailed", [], quiet({ useId: "leave" })).self.after;
    expect(out.conditions).toEqual(["vulnerable"]);
    expect(plan("cursed-merfolk", "Fish-Tailed", [], quiet({ useId: "return", self: out })).self.after.conditions).toEqual([]);
  });

  it("Gang Up: +2 against a target in Melee of an ally (no map: holds, Q18)", () => {
    expect(summaryOf("cursed-merfolk").attackBonus).toBe(2);
    expect(summaryOf("cursed-merfolk", selfOf("cursed-merfolk"), { allyWithin: () => false }).attackBonus).toBe(0);
  });

  it("“Get Over Here!”: a Stress to pull a PC hit beyond Melee; an optional Fear for an attack with advantage", () => {
    const trigger = triggerOf("cursed-merfolk", "“Get Over Here!”");
    expect(matchesTrigger(trigger, { kind: "onHit", attack: "standard", band: "far" })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "onHit", attack: "standard", band: "melee" })).toBe(false);
    const pull = plan("cursed-merfolk", "“Get Over Here!”", [], quiet({ trigger: { subject: mira } }));
    expect(pull).toMatchObject({ fearSpent: 0, roll: null });
    expect(pull.self.after.stress).toBe(1);
    expect(prompts(pull, "move")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    // d20s 10 and 4 with advantage keep 10, + ATK 3 = 13 hits; 3d6 = 1 + 2 + 3.
    const attack = plan("cursed-merfolk", "“Get Over Here!”", [10, 4, 1, 2, 3], quiet({ trigger: { subject: mira }, followUp: [mira], optionals: ["attack"] }));
    expect(attack.fearSpent).toBe(1);
    expect(stepsOf(attack, "roll")[0]!.roll.record.total).toBe(13);
    expect(attack.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 6 })]);
  });
});

describe("Deep Dweller (HF p.83)", () => {
  it("Psychic Blast: a Fear, up to three targets make an Instinct or Knowledge Reaction Roll", () => {
    const p = plan("deep-dweller", "Psychic Blast", [], { targets: [mira, bram, cora] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(3);
    expect(runF("deep-dweller", "Psychic Blast", [], { targets: [mira, bram, cora, pc("dax")] })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("Brain Drain: a Stress; a Vulnerable PC marks 1d4 Stress and it clears as many HP", () => {
    const self = selfOf("deep-dweller", { hp: 4 });
    const p = plan("deep-dweller", "Brain Drain", [3], { self, targets: [pc("mira", { conditions: ["vulnerable"] })] });
    expect(creature(p, "mira")!.stress).toBe(3);
    expect(p.self.after).toMatchObject({ hp: 1, stress: 1 });
    const calm = plan("deep-dweller", "Brain Drain", [], { self });
    expect(calm.self.after.hp).toBe(4);
    expect(creature(calm, "mira")).toBeUndefined();
  });

  it("Call of the Deep: 2 Fear, summon 1d4 Cursed Merfolk at Far range who take the spotlight", () => {
    const p = plan("deep-dweller", "Call of the Deep", [3], { targets: [] });
    expect(p.fearSpent).toBe(2);
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ count: 3, adversaryId: "cursed-merfolk", range: "far" })]);
    expect(stepsOf(p, "spotlight")).toHaveLength(1);
  });

  it("Mucosal Contamination: an attack Restrains (Slimed); each spotlight deals 3d8 direct; Severe damage or defeat releases", () => {
    const p = plan("deep-dweller", "Mucosal Contamination", [15]);
    expect(creature(p, "mira")).toMatchObject({ tags: ["Slimed"], conditions: ["restrained"] });
    expect(p.incoming).toEqual([]);
    const slimed = pc("mira", { tags: ["Slimed"], conditions: ["restrained"] });
    const tick = plan("deep-dweller", "Mucosal Contamination", [1, 2, 3], quiet({ useId: "spotlight", targets: [slimed, bram] }));
    expect(tick.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 6, direct: true, type: "physical" })]);
    expect(matchesTrigger(triggerOf("deep-dweller", "Mucosal Contamination", "release"), { kind: "onDamaged", stage: "did", severity: "severe" })).toBe(true);
    expect(matchesTrigger(triggerOf("deep-dweller", "Mucosal Contamination", "release"), { kind: "onDamaged", stage: "did", severity: "major" })).toBe(false);
    expect(creature(plan("deep-dweller", "Mucosal Contamination", [], quiet({ useId: "release", targets: [slimed] })), "mira")).toMatchObject({ tags: [], conditions: [] });
    expect(creature(plan("deep-dweller", "Mucosal Contamination", [], quiet({ useId: "defeated", targets: [slimed] })), "mira")).toMatchObject({ tags: [], conditions: [] });
  });
});

describe("Drake (HF p.83)", () => {
  it("Guard Dog: a Stress to intercept and take the damage; a free spotlight if the attacker is in Melee", () => {
    const p = plan("drake", "Guard Dog", [], quiet());
    expect(p.self.after.stress).toBe(1);
    expect(folds(p)).toEqual([expect.objectContaining({ targetIds: ["inst1"], step: expect.objectContaining({ kind: "redirectDamage", target: "self" }) })]);
    expect(stepsOf(plan("drake", "Guard Dog", [], quiet({ optionals: ["spotlight"] })), "spotlight")).toEqual([]);
    const free = plan("drake", "Guard Dog", [], quiet({ optionals: ["spotlight"], situations: ["The attacker is within Melee range of the Drake's new position"] }));
    expect(stepsOf(free, "spotlight")).toEqual([expect.objectContaining({ who: "self" })]);
    expect(free.fearSpent).toBe(0);
  });
});

describe("Dullahan (HF p.83)", () => {
  it("Specter: physical resistance; Mark a Stress to move through solid objects", () => {
    const p = plan("dullahan", "Specter", [], { useId: "phase", targets: [] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "move")).toHaveLength(1);
  });

  it("Spectral Mount: Far movement while mounted; unhorsed it is Vulnerable until a Stress summons the mount", () => {
    expect(prompts(plan("dullahan", "Spectral Mount", [], quiet({ useId: "ride" })), "move")).toHaveLength(1);
    const unhorsed = plan("dullahan", "Spectral Mount", [], quiet({ useId: "unhorsed" })).self.after;
    expect(unhorsed).toMatchObject({ tags: ["Unhorsed"], conditions: ["vulnerable"] });
    const back = plan("dullahan", "Spectral Mount", [], quiet({ useId: "summon", self: unhorsed }));
    expect(back.self.after).toMatchObject({ tags: [], conditions: [], stress: 1 });
    expect(runF("dullahan", "Spectral Mount", [], quiet({ useId: "summon" }))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Bone Whip Strike: a Stress, an attack in Melee: 4d4+10 direct physical and Vulnerable", () => {
    // d20 15 + 3 = 18; 4d4+10 = 1+2+3+4+10.
    const p = plan("dullahan", "Bone Whip Strike", [15, 1, 2, 3, 4]);
    expect(p.incoming).toEqual([expect.objectContaining({ amount: 20, direct: true, type: "physical" })]);
    expect(creature(p, "mira")!.conditions).toEqual(["vulnerable"]);
  });

  it("Death Glare: a Fear, Presence Reaction Roll (19); the Doom Countdown ticks on spotlight and ends on defeat", () => {
    const p = plan("dullahan", "Death Glare", []);
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(1);
    expect(stepsOf(plan("dullahan", "Death Glare", [], quiet({ useId: "tick" })), "countdown")).toEqual([expect.objectContaining({ op: "tick", label: "Doom Countdown", amount: 1 })]);
    expect(stepsOf(plan("dullahan", "Death Glare", [], quiet({ useId: "end" })), "countdown")).toEqual([expect.objectContaining({ op: "prompt" })]);
  });
});

describe("Fellmounted Shadow King (HF p.83)", () => {
  it("Fellmount: +2 Difficulty while mounted; Severe damage unmounts; a Stress summons the mount", () => {
    expect(summaryOf("fellmounted-shadow-king", selfOf("fellmounted-shadow-king"), { situations: ["The Shadow King is on his mount"] }).difficulty).toBe(2);
    expect(summaryOf("fellmounted-shadow-king").difficulty).toBe(0);
    expect(matchesTrigger(triggerOf("fellmounted-shadow-king", "Fellmount", "knocked"), { kind: "onDamaged", stage: "did", severity: "severe" })).toBe(true);
    const off = plan("fellmounted-shadow-king", "Fellmount", [], quiet({ useId: "knocked" }));
    expect(off.self.after.tags).toEqual(["Unmounted"]);
    expect(prompts(off, "manual")).toHaveLength(1);
    expect(plan("fellmounted-shadow-king", "Fellmount", [], quiet({ useId: "summon", self: off.self.after })).self.after).toMatchObject({ tags: [], stress: 1 });
  });

  it("Light and Shadow: advantage in shadow, a disadvantage reminder in bright light", () => {
    const effects = adversaryEffects("fellmounted-shadow-king");
    const s = selfOf("fellmounted-shadow-king");
    expect(activePassives(effects, stateOf(s, 0, { situations: ["The Shadow King is in shadow or darkness"] })).map((x) => x.use.id)).toContain("shadow");
    expect(activePassives(effects, stateOf(s)).map((x) => x.use.id)).not.toContain("shadow");
    expect(runF("fellmounted-shadow-king", "Light and Shadow", [], quiet({ useId: "light" }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(prompts(plan("fellmounted-shadow-king", "Light and Shadow", [], quiet({ useId: "light", situations: ["The Shadow King is in bright light"] })), "manual")).toHaveLength(1);
  });

  it("Relic Hunter: advantage against PCs with magic weapons or armor", () => {
    const s = selfOf("fellmounted-shadow-king");
    const active = activePassives(adversaryEffects("fellmounted-shadow-king"), stateOf(s, 0, { situations: ["The target has magic weapons or armor equipped"] }));
    expect(active.map((x) => x.effect.feature)).toContain("Relic Hunter");
  });

  it("Hellsong: 2 Fear, a Presence Reaction Roll (18) for each PC within Far range", () => {
    const p = plan("fellmounted-shadow-king", "Hellsong", [], { targets: [mira, bram] });
    expect(p.fearSpent).toBe(2);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Air Support: three times per scene, a Fear for an ally's reroll with advantage", () => {
    const a1 = ally("a1");
    const p = plan("fellmounted-shadow-king", "Air Support", [], quiet({ picked: [a1] }));
    expect(p.fearSpent).toBe(1);
    expect(folds(p)).toEqual([expect.objectContaining({ targetIds: ["a1"], step: expect.objectContaining({ kind: "modifyRoll" }) })]);
    let uses = p.self.featureUses;
    uses = plan("fellmounted-shadow-king", "Air Support", [], quiet({ picked: [a1], featureUses: uses })).self.featureUses;
    uses = plan("fellmounted-shadow-king", "Air Support", [], quiet({ picked: [a1], featureUses: uses })).self.featureUses;
    expect(runF("fellmounted-shadow-king", "Air Support", [], quiet({ picked: [a1], featureUses: uses }))).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Fire Titan (HF p.84)", () => {
  it("Masterwork Armor: Countdown (3) from its first appearance; 1d12 off incoming damage; +1 Difficulty and attack once broken", () => {
    const start = plan("fire-titan", "Masterwork Armor", [], quiet({ useId: "start" }));
    expect(stepsOf(start, "countdown")).toEqual([expect.objectContaining({ op: "start", start: 3 })]);
    const armored = start.self.after;
    expect(armored.tags).toEqual(["Masterwork Armor"]);
    expect(matchesTrigger(triggerOf("fire-titan", "Masterwork Armor", "tick"), { kind: "onDamaged", stage: "did", severity: "minor" })).toBe(false);
    expect(stepsOf(plan("fire-titan", "Masterwork Armor", [], quiet({ useId: "tick", self: armored })), "countdown")).toEqual([expect.objectContaining({ op: "tick", amount: 1 })]);
    expect(folds(plan("fire-titan", "Masterwork Armor", [7], quiet({ useId: "armor", self: armored })))).toEqual([expect.objectContaining({ amount: 7, step: expect.objectContaining({ kind: "reduceDamage" }) })]);
    expect(runF("fire-titan", "Masterwork Armor", [], quiet({ useId: "armor" }))).toMatchObject({ ok: false, reason: "requirement" });
    const broken = plan("fire-titan", "Masterwork Armor", [], quiet({ useId: "triggered", self: armored })).self.after;
    expect(broken.tags).toEqual(["Armor Broken"]);
    expect(summaryOf("fire-titan", broken)).toMatchObject({ difficulty: 1, attackBonus: 1 });
    expect(summaryOf("fire-titan", armored)).toMatchObject({ difficulty: 0, attackBonus: 0 });
  });

  it("Hurl Rock: a Stress, one attack roll against everyone between it and the point: 3d12 physical", () => {
    // d20 10 + 3 = 13: hits Evasion 12, misses 14.
    const p = plan("fire-titan", "Hurl Rock", [10, 1, 2, 3], { targets: [mira, bram] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 6 })]);
  });

  it("Skull Splitter: a Stress places a token; the next spotlight spends it on an attack: 3d20+5 direct, or a Stress on a miss", () => {
    expect(plan("fire-titan", "Skull Splitter", [], { useId: "prepare", targets: [] }).self).toMatchObject({ after: { stress: 1 }, tokens: { before: 0, after: 1 } });
    expect(runF("fire-titan", "Skull Splitter", [], quiet({ useId: "strike", targets: [mira] }))).toMatchObject({ ok: false, reason: "requirement" });
    const hit = plan("fire-titan", "Skull Splitter", [15, 1, 2, 3], quiet({ useId: "strike", targets: [mira], tokens: 1 }));
    expect(hit.self.tokens.after).toBe(0);
    expect(hit.incoming).toEqual([expect.objectContaining({ amount: 11, direct: true })]);
    const miss = plan("fire-titan", "Skull Splitter", [2], quiet({ useId: "strike", targets: [mira], tokens: 1 }));
    expect(miss.incoming).toEqual([]);
    expect(creature(miss, "mira")!.stress).toBe(1);
  });

  it("Blazing Heart: at half HP marked, a Fear and N Stress clear N HP", () => {
    expect(matchesTrigger(triggerOf("fire-titan", "Blazing Heart"), { kind: "onHpMarked", before: 4, after: 5, hpMax: 10 })).toBe(true);
    expect(matchesTrigger(triggerOf("fire-titan", "Blazing Heart"), { kind: "onHpMarked", before: 2, after: 4, hpMax: 10 })).toBe(false);
    const self = selfOf("fire-titan", { hp: 6 });
    expect(runF("fire-titan", "Blazing Heart", [], quiet({ self, fearConfirmed: false }))).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const p = plan("fire-titan", "Blazing Heart", [], quiet({ self, options: { heart: ["3"] } }));
    expect(p.fearSpent).toBe(1);
    expect(p.self.after).toMatchObject({ hp: 3, stress: 3 });
  });
});

describe("Frost Titan (HF p.84)", () => {
  it("War Horn: a Stress, Presence Reaction Roll for each PC within Far range", () => {
    const p = plan("frost-titan", "War Horn", [], { targets: [mira, bram] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Bull Rush: a Stress, move, attack: 4d10+2 physical and knocked back", () => {
    // d20 10 + 7 = 17; 4d10+2 = 1+2+3+4+2.
    const p = plan("frost-titan", "Bull Rush", [10, 1, 2, 3, 4]);
    expect(p.incoming).toEqual([expect.objectContaining({ amount: 12 })]);
    expect(prompts(p, "move")).toHaveLength(2);
  });

  it("Cleaving Strike: a Stress; another PC marks the same number of HP", () => {
    expect(matchesTrigger(triggerOf("frost-titan", "Cleaving Strike"), { kind: "onTargetMarksHp", attack: "standard" })).toBe(true);
    expect(matchesTrigger(triggerOf("frost-titan", "Cleaving Strike"), { kind: "onTargetMarksHp", attack: "feature" })).toBe(false);
    const p = plan("frost-titan", "Cleaving Strike", [], quiet({ trigger: { amount: 2, subject: mira }, picked: [bram] }));
    expect(creature(p, "bram")!.hp).toBe(2);
    expect(p.self.after.stress).toBe(1);
  });

  it("Trophy Hunter: when it defeats a PC it takes a trophy (manual)", () => {
    expect(matchesTrigger(triggerOf("frost-titan", "Trophy Hunter"), { kind: "onDefeatPc" })).toBe(true);
    expect(prompts(plan("frost-titan", "Trophy Hunter", [], quiet({ trigger: { subject: mira } })), "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });
});

describe("Gargantuan Sea Turtle (HF p.84)", () => {
  it("Piercing Bite: the hit PC marks an Armor Slot without its benefit or takes double damage", () => {
    expect(matchesTrigger(triggerOf("gargantuan-sea-turtle", "Piercing Bite"), { kind: "onHit", attack: "standard" })).toBe(true);
    expect(matchesTrigger(triggerOf("gargantuan-sea-turtle", "Piercing Bite"), { kind: "onHit", attack: "feature" })).toBe(false);
    const armor = plan("gargantuan-sea-turtle", "Piercing Bite", [], quiet({ trigger: { subject: mira }, options: { bite: ["armor"] } }));
    expect(stepsOf(armor, "mark")).toEqual([expect.objectContaining({ targetId: "mira", track: "armor", amount: 1, noBenefit: true })]);
    const double = plan("gargantuan-sea-turtle", "Piercing Bite", [], quiet({ trigger: { subject: mira }, options: { bite: ["double"] } }));
    expect(folds(double)).toEqual([expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ change: { kind: "multiply", factor: 2 } }) })]);
  });

  it("Tail Bash: a Stress, a standard attack on all behind it; +1d12 and pushed to Close on a hit", () => {
    // d20 5 + 7 = 12: hits 12, misses 14. 3d12+7 = 1+2+3+7, +1d12 4.
    const p = plan("gargantuan-sea-turtle", "Tail Bash", [5, 1, 2, 3, 4], { targets: [mira, bram] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 17 })]);
    expect(prompts(p, "move")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Gigaton Splash: a Fear, a Strength Reaction Roll for every PC within Far range", () => {
    const p = plan("gargantuan-sea-turtle", "Gigaton Splash", [], { targets: [mira, bram] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Steam Breath: 2 Fear, an Agility Reaction Roll for the PCs in front of it", () => {
    expect(runF("gargantuan-sea-turtle", "Steam Breath", [], { fearConfirmed: false })).toMatchObject({ ok: false, detail: "2" });
    expect(plan("gargantuan-sea-turtle", "Steam Breath", [], { targets: [mira, bram] }).fearSpent).toBe(2);
  });
});

describe("Lamia (HF p.84)", () => {
  const constricted = pc("mira", { tags: ["Constricted"], conditions: ["restrained"] });

  it("Constriction: a Stress, a Finesse Reaction Roll; a Constricted PC marks a Stress on each spotlight; Major damage frees them", () => {
    const p = plan("lamia", "Constriction", []);
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(1);
    const squeeze = plan("lamia", "Constriction", [], quiet({ useId: "squeeze", targets: [constricted, bram] }));
    expect(creature(squeeze, "mira")!.stress).toBe(1);
    expect(creature(squeeze, "bram")).toBeUndefined();
    expect(creature(plan("lamia", "Constriction", [], quiet({ useId: "release", targets: [constricted] })), "mira")).toMatchObject({ tags: [], conditions: [] });
  });

  it("Life Leech: a Stress; a Vulnerable or Restrained target marks 1d4-1 HP and the Lamia clears as many", () => {
    const self = selfOf("lamia", { hp: 4 });
    const p = plan("lamia", "Life Leech", [4], { self, targets: [pc("mira", { conditions: ["vulnerable"] })], options: { leech: ["vulnerable"] } });
    expect(creature(p, "mira")!.hp).toBe(3);
    expect(p.self.after).toMatchObject({ hp: 1, stress: 1 });
    const wrong = plan("lamia", "Life Leech", [], { self, targets: [mira], options: { leech: ["restrained"] } });
    expect(wrong.self.after.hp).toBe(4);
  });

  it("Sleep Toxin: a Fear after a standard hit: Vulnerable until an Instinct Roll (19)", () => {
    const p = plan("lamia", "Sleep Toxin", [], quiet({ trigger: { subject: mira } }));
    expect(p.fearSpent).toBe(1);
    expect(creature(p, "mira")!.conditions).toEqual(["vulnerable"]);
  });
});

describe("Lamplight Beguiler (HF p.85)", () => {
  it("Doppel-Dangler: a Stress; the head stalk takes a trusted form (tag plus manual)", () => {
    const p = plan("lamplight-beguiler", "Doppel-Dangler", []);
    expect(p.self.after).toMatchObject({ stress: 1, tags: ["Trusted Form"] });
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Entice: a Fear, a Presence Reaction Roll (18); disadvantage for a trusted form is manual", () => {
    const p = plan("lamplight-beguiler", "Entice", []);
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(1);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Gulp: a PC moves into Melee; a Fear for an attack: 3d6 and Swallowed; 3d6 on each spotlight; Major damage disgorges", () => {
    expect(matchesTrigger(triggerOf("lamplight-beguiler", "Gulp"), { kind: "pcMoves", into: "melee" })).toBe(true);
    expect(matchesTrigger(triggerOf("lamplight-beguiler", "Gulp"), { kind: "pcMoves", into: "close" })).toBe(false);
    // d20 15 + 3 = 18; 3d6 = 1 + 2 + 3.
    const p = plan("lamplight-beguiler", "Gulp", [15, 1, 2, 3], quiet({ trigger: { subject: mira } }));
    expect(p.fearSpent).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ amount: 6 })]);
    expect(creature(p, "mira")).toMatchObject({ tags: ["Swallowed"], conditions: ["restrained"] });
    const swallowed = pc("mira", { tags: ["Swallowed"], conditions: ["restrained"] });
    expect(plan("lamplight-beguiler", "Gulp", [2, 2, 2], quiet({ useId: "digest", targets: [swallowed, bram] })).incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 6 })]);
    expect(creature(plan("lamplight-beguiler", "Gulp", [], quiet({ useId: "disgorge", targets: [swallowed] })), "mira")).toMatchObject({ tags: [], conditions: [] });
  });
});

describe("Manticore (HF p.85)", () => {
  it("Riddle Me This: a reminder", () => {
    expect(prompts(plan("manticore", "Riddle Me This", [], quiet()), "manual")).toHaveLength(1);
  });

  it("Winged: +2 Difficulty and attack while airborne", () => {
    expect(summaryOf("manticore", selfOf("manticore"), { situations: ["The Manticore is airborne"] })).toMatchObject({ difficulty: 2, attackBonus: 2 });
    expect(summaryOf("manticore")).toMatchObject({ difficulty: 0, attackBonus: 0 });
  });

  it("Pouncing Attack: a Fear, pounce, 3d20+6 physical, Shaky (its disadvantage is manual)", () => {
    // d20 10 + 6 = 16; 3d20+6 = 1+2+3+6.
    const p = plan("manticore", "Pouncing Attack", [10, 1, 2, 3]);
    expect(p.fearSpent).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ amount: 12 })]);
    expect(creature(p, "mira")!.tags).toEqual(["Shaky"]);
  });

  it("Paralyzing Tail Spike: a Stress, 3d8 physical and Restrained", () => {
    const p = plan("manticore", "Paralyzing Tail Spike", [10, 1, 2, 3]);
    expect(p.incoming).toEqual([expect.objectContaining({ amount: 6 })]);
    expect(creature(p, "mira")!.conditions).toEqual(["restrained"]);
  });

  it("Locking Jaws: a Stress after a standard hit in Melee: Restrained and Vulnerable", () => {
    expect(matchesTrigger(triggerOf("manticore", "Locking Jaws"), { kind: "onHit", attack: "standard", band: "melee" })).toBe(true);
    expect(matchesTrigger(triggerOf("manticore", "Locking Jaws"), { kind: "onHit", attack: "standard", band: "close" })).toBe(false);
    expect(creature(plan("manticore", "Locking Jaws", [], quiet({ trigger: { subject: mira } })), "mira")!.conditions).toEqual(["restrained", "vulnerable"]);
  });
});

describe("Night Children (HF p.85)", () => {
  it("Swell Ranks: once per scene, N Stress clear N HP", () => {
    const self = selfOf("night-children", { hp: 4 });
    const p = plan("night-children", "Swell Ranks", [], { self, targets: [], options: { ranks: ["2"] } });
    expect(p.self.after).toMatchObject({ hp: 2, stress: 2 });
    expect(runF("night-children", "Swell Ranks", [], { self, targets: [], featureUses: p.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Overwhelm: marking HP from a Melee attack, a Stress for a standard attack on the attacker", () => {
    expect(matchesTrigger(triggerOf("night-children", "Overwhelm"), { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "melee" })).toBe(true);
    expect(matchesTrigger(triggerOf("night-children", "Overwhelm"), { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "far" })).toBe(false);
    // d20 15 + 1 = 16; 3d6+8 = 1+2+3+8.
    const p = plan("night-children", "Overwhelm", [15, 1, 2, 3], quiet({ trigger: { source: mira } }));
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 14 })]);
  });
});

describe("Pain Priest (HF p.86)", () => {
  it("Walk Between Worlds: a Stress, teleport within Very Far, spotlight again", () => {
    const p = plan("pain-priest", "Walk Between Worlds", [], { targets: [] });
    expect(p.self.after.stress).toBe(1);
    expect(stepsOf(p, "spotlight")).toEqual([expect.objectContaining({ who: "self" })]);
  });

  it("Pleasure and Pain: a PC within Close gains Hope or marks HP: on a d8 of 8 it flees with a PC and you gain 1d6 Fear", () => {
    expect(matchesTrigger(triggerOf("pain-priest", "Pleasure and Pain", "hope"), { kind: "pcHope", change: "gain", band: "close" })).toBe(true);
    expect(matchesTrigger(triggerOf("pain-priest", "Pleasure and Pain", "hp"), { kind: "pcMarksHp", band: "close" })).toBe(true);
    expect(matchesTrigger(triggerOf("pain-priest", "Pleasure and Pain", "hp"), { kind: "pcMarksHp", band: "far" })).toBe(false);
    const fled = plan("pain-priest", "Pleasure and Pain", [8, 4], quiet({ useId: "hope" }));
    expect(fled.gmFearDelta).toBe(4);
    expect(prompts(fled, "manual")).toHaveLength(1);
    expect(plan("pain-priest", "Pleasure and Pain", [7], quiet({ useId: "hp" })).gmFearDelta).toBe(0);
  });
});

describe("Phoenix (HF p.86)", () => {
  it("Purifying Aura: a PC acting in Melee spends a Hope to clear a HP or Stress and its conditions", () => {
    expect(matchesTrigger(triggerOf("phoenix", "Purifying Aura"), { kind: "pcRolls", roll: actionRoll(), band: "melee" })).toBe(true);
    expect(matchesTrigger(triggerOf("phoenix", "Purifying Aura"), { kind: "pcRolls", roll: actionRoll(), band: "close" })).toBe(false);
    const hurt = pc("mira", { stress: 2, conditions: ["vulnerable"] });
    const p = plan("phoenix", "Purifying Aura", [], quiet({ trigger: { subject: hurt }, options: { purify: ["stress"] } }));
    expect(stepsOf(p, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: -1 }]);
    expect(creature(p, "mira")).toMatchObject({ stress: 1, conditions: [] });
  });

  it("Fireseed: when it marks HP, summon a Minor Fire Elemental", () => {
    expect(matchesTrigger(triggerOf("phoenix", "Fireseed"), { kind: "onMarkHp", stage: "did", amount: 1, last: false })).toBe(true);
    expect(stepsOf(plan("phoenix", "Fireseed", [], quiet()), "summon")).toEqual([expect.objectContaining({ count: 1, adversaryId: "minor-fire-elemental" })]);
  });

  it("Resurrection: defeated it becomes a Smoldering Egg, immune to all damage; touching it deals 3d4 direct magic", () => {
    const egg = plan("phoenix", "Resurrection", [], quiet({ useId: "egg" })).self.after;
    expect(egg.tags).toEqual(["Smoldering Egg"]);
    expect(summaryOf("phoenix", egg).resistance).toEqual({ physical: "immune", magic: "immune" });
    expect(summaryOf("phoenix").resistance).toBeUndefined();
    const touch = plan("phoenix", "Resurrection", [1, 2, 3], quiet({ useId: "touch", self: egg, targets: [mira] }));
    expect(touch.incoming).toEqual([expect.objectContaining({ amount: 6, type: "magic", direct: true })]);
  });
});

describe("Plesiosaurus (HF p.86)", () => {
  it("Only a Rumor: can't be targeted while deep underwater", () => {
    expect(summaryOf("plesiosaurus", selfOf("plesiosaurus"), { situations: ["The Plesiosaurus is deep underwater"] }).flags).toEqual(["cannotBeTargeted"]);
    expect(summaryOf("plesiosaurus").flags).toEqual([]);
  });

  it("Wall of Water: a Stress, an Agility Reaction Roll (18) for the PCs on that side", () => {
    const p = plan("plesiosaurus", "Wall of Water", [], { targets: [mira, bram] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });
});

describe("Roc (HF p.86)", () => {
  const warden = selfOf("roc", { tags: ["Nest Warden"], stress: 2 });

  it("Bird of Prey: a Very Far move prompt on its spotlight", () => {
    expect(prompts(plan("roc", "Bird of Prey", [], quiet()), "move")).toHaveLength(1);
  });

  it("Here Comes the Boom: a Fear, one attack against 1d4+1 targets (3d12 magic), then an Agility Reaction Roll (20) for all within Far", () => {
    // d4 2 -> up to 3 targets; d20 10 + 3 = 13 hits 12 (mira, cora), misses 14 (bram); 3d12 = 1+2+3.
    const p = plan("roc", "Here Comes the Boom", [2, 10, 1, 2, 3], { targets: [mira, bram, cora], picked: [mira, bram, cora] });
    expect(p.fearSpent).toBe(1);
    expect(p.incoming.map((h) => [h.targetId, h.amount, h.type])).toEqual([
      ["mira", 6, "magic"],
      ["cora", 6, "magic"],
    ]);
    expect(prompts(p, "pcSave")).toHaveLength(3);
    expect(runF("roc", "Here Comes the Boom", [1], { targets: [mira, bram, cora] })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("Crushing Grasp: a Stress after a standard hit: 1d4 Stress and Restrained", () => {
    const p = plan("roc", "Crushing Grasp", [3], quiet({ trigger: { subject: mira } }));
    expect(creature(p, "mira")).toMatchObject({ stress: 3, conditions: ["restrained"] });
  });

  it("Nest Warden: its eggs threatened, it gains Wrathful and Electrifying Aura", () => {
    expect(plan("roc", "Nest Warden", [], quiet()).self.after.tags).toEqual(["Nest Warden"]);
    expect(summaryOf("roc", warden)).toMatchObject({ difficulty: 2, attackDamageAdd: 2, resistance: { physical: "none", magic: "resistant" } });
    expect(summaryOf("roc", selfOf("roc", { stress: 2 }))).toMatchObject({ difficulty: 0, attackDamageAdd: 0 });
    expect(summaryOf("roc").resistance).toBeUndefined();
  });

  it("Wrathful runs as a passive; Electrifying Aura: a PC failing within Very Close spends a Hope or marks 1d4 Stress", () => {
    expect(plan("roc", "Wrathful", [], quiet({ self: warden })).modifiers).toHaveLength(2);
    expect(matchesTrigger(triggerOf("roc", "Electrifying Aura", "shock"), { kind: "pcRolls", roll: actionRoll({ success: false }), band: "veryClose" })).toBe(true);
    expect(runF("roc", "Electrifying Aura", [], quiet({ useId: "shock", trigger: { subject: mira } }))).toMatchObject({ ok: false, reason: "requirement" });
    const shocked = plan("roc", "Electrifying Aura", [3], quiet({ useId: "shock", self: warden, trigger: { subject: mira }, options: { shock: ["stress"] } }));
    expect(creature(shocked, "mira")!.stress).toBe(3);
    const hope = plan("roc", "Electrifying Aura", [], quiet({ useId: "shock", self: warden, trigger: { subject: mira }, options: { shock: ["hope"] } }));
    expect(stepsOf(hope, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: -1 }]);
  });
});

describe("Sandwyrm (HF p.87)", () => {
  it("Venomous Tail Stinger: a Stress, 3d10+2 physical, then a Strength Reaction Roll for the PC hit", () => {
    // d20 15 + 1 = 16; 3d10+2 = 1+2+3+2.
    const p = plan("sandwyrm", "Venomous Tail Stinger", [15, 1, 2, 3]);
    expect(p.incoming).toEqual([expect.objectContaining({ amount: 8 })]);
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(prompts(plan("sandwyrm", "Venomous Tail Stinger", [2]), "pcSave")).toEqual([]);
  });

  it("Devour: an attack Swallows; the Swallowed PC marks a HP on each spotlight; Major damage disgorges", () => {
    expect(creature(plan("sandwyrm", "Devour", [15]), "mira")).toMatchObject({ tags: ["Swallowed"], conditions: ["restrained"] });
    const swallowed = pc("mira", { tags: ["Swallowed"], conditions: ["restrained"] });
    expect(creature(plan("sandwyrm", "Devour", [], quiet({ useId: "digest", targets: [swallowed] })), "mira")!.hp).toBe(1);
    expect(creature(plan("sandwyrm", "Devour", [], quiet({ useId: "disgorge", targets: [swallowed] })), "mira")).toMatchObject({ tags: [], conditions: [] });
  });

  it("Hungry, Not Stupid: at half HP or after a Swallow, a d6 of 3 or lower and it retreats", () => {
    expect(matchesTrigger(triggerOf("sandwyrm", "Hungry, Not Stupid"), { kind: "onHpMarked", before: 2, after: 3, hpMax: 6 })).toBe(true);
    expect(prompts(plan("sandwyrm", "Hungry, Not Stupid", [3], quiet()), "manual")).toHaveLength(1);
    expect(prompts(plan("sandwyrm", "Hungry, Not Stupid", [4], quiet({ useId: "swallow" })), "manual")).toEqual([]);
  });
});

describe("Shapeshifting Fiend (HF p.87)", () => {
  it("Impersonate: a Fear to take a form; an attacker who cares for that person rolls Instinct or the attack fails", () => {
    const disguised = plan("shapeshifting-fiend", "Impersonate", [], { targets: [] });
    expect(disguised.fearSpent).toBe(1);
    expect(disguised.self.after.tags).toEqual(["Impersonating"]);
    const cares = "The attacker cares for the person the Fiend impersonates";
    expect(runF("shapeshifting-fiend", "Impersonate", [], quiet({ useId: "targeted", self: disguised.self.after, trigger: { source: mira } }))).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("shapeshifting-fiend", "Impersonate", [], quiet({ useId: "targeted", self: disguised.self.after, trigger: { source: mira }, situations: [cares] }));
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Turn Invisible: a Stress for Hidden until it attacks or takes damage", () => {
    const hidden = plan("shapeshifting-fiend", "Turn Invisible", [], { targets: [] }).self.after;
    expect(hidden).toMatchObject({ stress: 1, conditions: ["hidden"] });
    expect(plan("shapeshifting-fiend", "Turn Invisible", [], quiet({ useId: "damaged", self: hidden })).self.after.conditions).toEqual([]);
    expect(plan("shapeshifting-fiend", "Turn Invisible", [], quiet({ useId: "rolls", self: hidden })).self.after.conditions).toEqual([]);
  });

  it("Backhanded Guidance: a Stress on a PC's action roll; the d6 for the Fear Die is rolled, adding it is manual", () => {
    expect(matchesTrigger(triggerOf("shapeshifting-fiend", "Backhanded Guidance"), { kind: "pcRolls", roll: actionRoll() })).toBe(true);
    expect(matchesTrigger(triggerOf("shapeshifting-fiend", "Backhanded Guidance"), { kind: "pcRolls", roll: { ...actionRoll(), kind: "reaction" } })).toBe(false);
    const p = plan("shapeshifting-fiend", "Backhanded Guidance", [4], quiet({ trigger: { subject: mira } }));
    expect(p.self.after.stress).toBe(1);
    expect(stepsOf(p, "check")).toEqual([expect.objectContaining({ total: 4 })]);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Exposed! (Phase Change): defeated or discovered, it becomes the Fiend Revealed and takes the spotlight", () => {
    for (const useId of ["main", "discovered"]) {
      const p = plan("shapeshifting-fiend", "Exposed! (Phase Change)", [], quiet({ useId }));
      expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ adversaryId: "shapeshifting-fiend-revealed", count: 1 })]);
      expect(stepsOf(p, "spotlight")).toHaveLength(1);
    }
  });
});

describe("Shapeshifting Fiend Revealed (HF p.87)", () => {
  it("Demonic Rage: a Fear, a standard attack + marked Stress, direct damage on a hit", () => {
    // d20 8 + 3 ATK + 3 Stress = 14 hits; 3d12+5 = 1+2+3+5.
    const p = plan("shapeshifting-fiend-revealed", "Demonic Rage", [8, 1, 2, 3], { self: selfOf("shapeshifting-fiend-revealed", { stress: 3 }) });
    expect(p.roll!.record.total).toBe(14);
    expect(p.incoming).toEqual([expect.objectContaining({ amount: 11, direct: true })]);
    expect(plan("shapeshifting-fiend-revealed", "Demonic Rage", [8]).incoming).toEqual([]); // 8 + 3 = 11 misses
  });

  it("Hall of Mirrors: 2 Stress; the Duplicate Countdown (4) adds to its Difficulty and ticks on a failed attack", () => {
    const p = plan("shapeshifting-fiend-revealed", "Hall of Mirrors", [], { targets: [] });
    expect(p.self).toMatchObject({ after: { stress: 2 }, tokens: { after: 4 } });
    expect(summaryOf("shapeshifting-fiend-revealed", selfOf("shapeshifting-fiend-revealed"), {}, 4).difficulty).toBe(4);
    expect(summaryOf("shapeshifting-fiend-revealed").difficulty).toBe(0);
    expect(matchesTrigger(triggerOf("shapeshifting-fiend-revealed", "Hall of Mirrors", "tick"), { kind: "onAttacked", stage: "failed" })).toBe(true);
    expect(plan("shapeshifting-fiend-revealed", "Hall of Mirrors", [], quiet({ useId: "tick", tokens: 3 })).self.tokens.after).toBe(2);
  });

  it("Flash Claw: a Fear, one attack against all within Close: 3d20 magic", () => {
    const p = plan("shapeshifting-fiend-revealed", "Flash Claw", [10, 1, 2, 3], { targets: [mira, bram] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 6, type: "magic" })]);
  });

  it("Mind Games: a successful attack from beyond Very Close: a Stress to switch places, the PC takes the damage", () => {
    expect(matchesTrigger(triggerOf("shapeshifting-fiend-revealed", "Mind Games"), { kind: "onAttacked", stage: "succeeded", attackerBand: "far" })).toBe(true);
    expect(matchesTrigger(triggerOf("shapeshifting-fiend-revealed", "Mind Games"), { kind: "onAttacked", stage: "succeeded", attackerBand: "veryClose" })).toBe(false);
    const p = plan("shapeshifting-fiend-revealed", "Mind Games", [], quiet({ picked: [bram] }));
    expect(folds(p)).toEqual([expect.objectContaining({ targetIds: ["bram"], step: expect.objectContaining({ kind: "redirectDamage", target: "picked" }) })]);
  });
});

describe("Storm Titan (HF p.87)", () => {
  it("Ball Lightning: a Fear, 1d4 spheres; moved on each spotlight; a sphere reaching a PC deals 4d6 magic", () => {
    const p = plan("storm-titan", "Ball Lightning", [3], { targets: [] });
    expect(p.fearSpent).toBe(1);
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ count: 3, range: "close" })]);
    expect(prompts(plan("storm-titan", "Ball Lightning", [], quiet({ useId: "move" })), "manual")).toHaveLength(1);
    const strike = plan("storm-titan", "Ball Lightning", [1, 2, 3, 4], quiet({ useId: "strike", targets: [mira] }));
    expect(strike.incoming).toEqual([expect.objectContaining({ amount: 10, type: "magic" })]);
  });

  it("Storm Bringer: a Stress, a Strength Reaction Roll for each PC within Close", () => {
    expect(prompts(plan("storm-titan", "Storm Bringer", [], { targets: [mira, bram] }), "pcSave")).toHaveLength(2);
  });

  it("Thunderclap: a Fear, up to three PCs mark a Stress and become Vulnerable", () => {
    const p = plan("storm-titan", "Thunderclap", [], { targets: [mira, bram] });
    expect(creature(p, "mira")).toMatchObject({ stress: 1, conditions: ["vulnerable"] });
    expect(creature(p, "bram")).toMatchObject({ stress: 1, conditions: ["vulnerable"] });
    expect(runF("storm-titan", "Thunderclap", [], { targets: [mira, bram, cora, pc("dax")] })).toMatchObject({ ok: false, reason: "targets" });
  });
});

describe("Unicorn (HF p.88)", () => {
  it("Celestial Lance: whoever damages it is marked; its standard attack deals them double damage", () => {
    expect(creature(plan("unicorn", "Celestial Lance", [], quiet({ useId: "mark", trigger: { source: mira } })), "mira")!.tags).toEqual(["Struck the Unicorn"]);
    const lance = triggerOf("unicorn", "Celestial Lance", "lance");
    expect(matchesTrigger(lance, { kind: "onHit", attack: "standard", target: { conditions: [], tags: ["Struck the Unicorn"] } })).toBe(true);
    expect(matchesTrigger(lance, { kind: "onHit", attack: "standard", target: { conditions: [], tags: [] } })).toBe(false);
    expect(folds(plan("unicorn", "Celestial Lance", [], quiet({ useId: "lance", trigger: { subject: mira } })))).toEqual([
      expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ change: { kind: "multiply", factor: 2 } }) }),
    ]);
  });

  it("Healing Touch: N Stress clear N HP of an ally in Melee", () => {
    const p = plan("unicorn", "Healing Touch", [], { targets: [ally("a1", { hp: 3 })], options: { touch: ["2"] } });
    expect(p.self.after.stress).toBe(2);
    expect(creature(p, "a1")!.hp).toBe(1);
  });

  it("Protective Aura: a Stress; attacks against it and allies within Very Close have disadvantage until it takes damage", () => {
    const aura = plan("unicorn", "Protective Aura", [], { targets: [] }).self.after;
    expect(aura.tags).toEqual(["Protective Aura"]);
    expect(activePassives(adversaryEffects("unicorn"), stateOf(aura)).map((x) => x.use.id)).toEqual(["aura"]);
    expect(summaryOf("unicorn", aura).auras).toEqual([{ kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" }, to: "allies", within: "veryClose" }]);
    expect(plan("unicorn", "Protective Aura", [], quiet({ useId: "end", self: aura })).self.after.tags).toEqual([]);
  });

  it("Teleport: a Stress, teleport with up to three allies", () => {
    const p = plan("unicorn", "Teleport", [], { targets: [], allies: [ally("a1")] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "move")).toHaveLength(2);
  });
});

describe("Vampire Bat Swarm (HF p.88)", () => {
  it("Blinding Multitude: a reminder", () => {
    expect(prompts(plan("vampire-bat-swarm", "Blinding Multitude", [], quiet()), "manual")).toHaveLength(1);
  });

  it("Bloodsuckers: after it deals damage, a Stress: the target marks a HP and the Swarm clears one", () => {
    expect(matchesTrigger(triggerOf("vampire-bat-swarm", "Bloodsuckers"), { kind: "onDealDamage", toPc: true })).toBe(true);
    const p = plan("vampire-bat-swarm", "Bloodsuckers", [], quiet({ self: selfOf("vampire-bat-swarm", { hp: 2 }), trigger: { subject: mira } }));
    expect(creature(p, "mira")!.hp).toBe(1);
    expect(p.self.after).toMatchObject({ hp: 1, stress: 1 });
  });
});

describe("Vampire Lord (HF p.88)", () => {
  const hellwing = selfOf("vampire-lord", { tags: ["Hellwing"] });

  it("Midnight Heart: defeated, a long-term countdown (6) ticking on long rests; destroying the heart kills it", () => {
    expect(stepsOf(plan("vampire-lord", "Midnight Heart", [], quiet({ useId: "defeated" })), "countdown")).toEqual([expect.objectContaining({ op: "start", start: 6 })]);
    expect(stepsOf(plan("vampire-lord", "Midnight Heart", [], quiet({ useId: "tick" })), "countdown")).toEqual([expect.objectContaining({ op: "tick" })]);
    expect(plan("vampire-lord", "Midnight Heart", [], quiet({ useId: "heart" })).self.after.defeated).toBe(true);
  });

  it("Unleash Hellfire: a Stress, 1d4 bursts; each target takes 3d6 magic (extra bursts manual)", () => {
    const p = plan("vampire-lord", "Unleash Hellfire", [3, 1, 2, 3], { targets: [mira, bram] });
    expect(stepsOf(p, "check")).toEqual([expect.objectContaining({ total: 3 })]);
    expect(p.incoming.map((h) => [h.targetId, h.amount])).toEqual([
      ["mira", 6],
      ["bram", 6],
    ]);
  });

  it("Resurgence: a PC within Very Close rolls with Hope: a Fear to clear a HP or a Stress", () => {
    expect(matchesTrigger(triggerOf("vampire-lord", "Resurgence"), { kind: "pcRolls", roll: actionRoll(), band: "veryClose" })).toBe(true);
    expect(matchesTrigger(triggerOf("vampire-lord", "Resurgence"), { kind: "pcRolls", roll: actionRoll({ withHope: false, withFear: true }), band: "veryClose" })).toBe(false);
    const p = plan("vampire-lord", "Resurgence", [], quiet({ self: selfOf("vampire-lord", { hp: 2 }), options: { resurgence: ["hp"] } }));
    expect(p).toMatchObject({ fearSpent: 1, self: { after: { hp: 1 } } });
  });

  it("Melt into Shadow: a Fear; a d6 of 5+ negates the damage and teleports it", () => {
    const p = plan("vampire-lord", "Melt into Shadow", [5], quiet());
    expect(p.fearSpent).toBe(1);
    expect(folds(p)).toEqual([expect.objectContaining({ step: expect.objectContaining({ kind: "negate", what: "damage" }) })]);
    expect(prompts(p, "move")).toHaveLength(1);
    expect(folds(plan("vampire-lord", "Melt into Shadow", [4], quiet()))).toEqual([]);
  });

  it("Hellwing: at half HP it transforms (tag; the new standard attack is manual); On Crimson Wings +1 Difficulty while flying", () => {
    expect(matchesTrigger(triggerOf("vampire-lord", "Hellwing"), { kind: "onHpMarked", before: 3, after: 4, hpMax: 7 })).toBe(true);
    const p = plan("vampire-lord", "Hellwing", [], quiet());
    expect(p.self.after.tags).toEqual(["Hellwing"]);
    expect(prompts(p, "manual")).toHaveLength(1);
    expect(summaryOf("vampire-lord", hellwing, { situations: ["The Hellwing is flying"] }).difficulty).toBe(1);
    expect(summaryOf("vampire-lord", selfOf("vampire-lord"), { situations: ["The Hellwing is flying"] }).difficulty).toBe(0);
  });

  it("Blood Bath: as the Hellwing, Major damage: 3d10 magic to all others within Very Close, then 3d6 on its later spotlights", () => {
    expect(runF("vampire-lord", "Blood Bath", [], quiet({ targets: [mira] }))).toMatchObject({ ok: false, reason: "requirement" });
    const a1 = ally("a1");
    const p = plan("vampire-lord", "Blood Bath", [1, 2, 3], quiet({ self: hellwing, targets: [mira, a1] }));
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 6, type: "magic" })]);
    expect(creature(p, "a1")!.hp).toBe(1); // 6 is under the ally's Major 8: 1 HP
    expect(p.self.after.tags).toEqual(["Hellwing", "Blood Bath"]);
    const pool = plan("vampire-lord", "Blood Bath", [1, 1, 1], quiet({ useId: "pool", self: p.self.after, targets: [mira] }));
    expect(pool.incoming).toEqual([expect.objectContaining({ amount: 3 })]);
  });
});

describe("Viscera Sucker (HF p.89)", () => {
  it("Join or Die: a reminder", () => {
    expect(prompts(plan("viscera-sucker", "Join or Die", [], quiet()), "manual")).toHaveLength(1);
  });

  it("Entangling Entrails: a Fear, Restrained until a Strength Roll (16)", () => {
    const p = plan("viscera-sucker", "Entangling Entrails", []);
    expect(p.fearSpent).toBe(1);
    expect(creature(p, "mira")!.conditions).toEqual(["restrained"]);
  });

  it("Lifesuck: a Stress; a Restrained target marks a HP and it clears one", () => {
    const self = selfOf("viscera-sucker", { hp: 2 });
    const p = plan("viscera-sucker", "Lifesuck", [], { self, targets: [pc("mira", { conditions: ["restrained"] })] });
    expect(creature(p, "mira")!.hp).toBe(1);
    expect(p.self.after.hp).toBe(1);
    expect(plan("viscera-sucker", "Lifesuck", [], { self }).self.after.hp).toBe(2);
  });
});

describe("Whisper Wraith (HF p.89)", () => {
  const shrouded = pc("mira", { tags: ["Shrouded"] });

  it("Spooky: on a hit every PC within Close marks a Stress and the GM gains a Fear", () => {
    const p = plan("whisper-wraith", "Spooky", [], quiet({ picked: [mira, bram] }));
    expect(creature(p, "mira")!.stress).toBe(1);
    expect(creature(p, "bram")!.stress).toBe(1);
    expect(p.gmFearDelta).toBe(1);
  });

  it("Nightmare Shroud: a Fear to Shroud a PC; Stress on their rolls with Fear; its damage split with them; Major damage ends it", () => {
    const p = plan("whisper-wraith", "Nightmare Shroud", []);
    expect(p.fearSpent).toBe(1);
    expect(creature(p, "mira")!.tags).toEqual(["Shrouded"]);
    expect(creature(plan("whisper-wraith", "Nightmare Shroud", [], quiet({ useId: "fear", trigger: { subject: shrouded } })), "mira")!.stress).toBe(1);
    expect(creature(plan("whisper-wraith", "Nightmare Shroud", [], quiet({ useId: "fear", trigger: { subject: mira } })), "mira")).toBeUndefined();
    const split = plan("whisper-wraith", "Nightmare Shroud", [], quiet({ useId: "split", targets: [shrouded], trigger: { amount: 10 } }));
    expect(folds(split)).toEqual([expect.objectContaining({ targetIds: ["inst1"], step: expect.objectContaining({ change: { kind: "halve" } }) })]);
    expect(split.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 5 })]);
    const alone = plan("whisper-wraith", "Nightmare Shroud", [], quiet({ useId: "split", targets: [bram], trigger: { amount: 10 } }));
    expect(folds(alone)).toEqual([]);
    expect(alone.incoming).toEqual([]);
    expect(creature(plan("whisper-wraith", "Nightmare Shroud", [], quiet({ useId: "release", targets: [shrouded] })), "mira")!.tags).toEqual([]);
  });
});

describe("Wyvern (HF p.89)", () => {
  it("Terrifying Shriek: a Fear, everyone within Far is Terrified until a Presence Roll (18) or its defeat", () => {
    const p = plan("wyvern", "Terrifying Shriek", [], { targets: [mira, bram] });
    expect(p.fearSpent).toBe(1);
    expect(creature(p, "bram")!.tags).toEqual(["Terrified"]);
    expect(creature(plan("wyvern", "Terrifying Shriek", [], quiet({ useId: "end", targets: [pc("mira", { tags: ["Terrified"] })] })), "mira")!.tags).toEqual([]);
  });

  it("Clutch: a Fear after a hit: Restrained (Clutched) until a Strength Roll (18) or Major damage", () => {
    expect(matchesTrigger(triggerOf("wyvern", "Clutch"), { kind: "onHit", attack: "feature" })).toBe(true);
    const p = plan("wyvern", "Clutch", [], quiet({ trigger: { subject: mira } }));
    expect(creature(p, "mira")).toMatchObject({ tags: ["Clutched"], conditions: ["restrained"] });
    const held = pc("mira", { tags: ["Clutched"], conditions: ["restrained"] });
    expect(creature(plan("wyvern", "Clutch", [], quiet({ useId: "release", targets: [held] })), "mira")).toMatchObject({ tags: [], conditions: [] });
  });
});

describe("Young Fire Dragon (HF p.89)", () => {
  it("Intimidating: spotlighted with Fear, PCs within Close mark a Stress or lose a Hope (no extra Fear)", () => {
    expect(runF("young-fire-dragon", "Intimidating", [], quiet({ targets: [mira] }))).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("young-fire-dragon", "Intimidating", [], quiet({ targets: [mira, bram], situations: ["You spent a Fear to spotlight the Dragon"], options: { intimidating: ["stress"] } }));
    expect(p.fearSpent).toBe(0);
    expect(creature(p, "mira")!.stress).toBe(1);
    expect(creature(p, "bram")!.stress).toBe(1);
  });

  it("Flame Breath: a Fear, an Agility Reaction Roll for all in front within Close; the Vulnerable rider is manual", () => {
    const p = plan("young-fire-dragon", "Flame Breath", [], { targets: [mira, bram] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Eruption: a Fear, an Agility Reaction Roll for each PC on the line", () => {
    const p = plan("young-fire-dragon", "Eruption", [], { targets: [mira, bram] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Blazing Scales: an attacker within Very Close marks a Stress", () => {
    expect(matchesTrigger(triggerOf("young-fire-dragon", "Blazing Scales"), { kind: "onAttacked", stage: "targeted", attackerBand: "veryClose" })).toBe(true);
    expect(matchesTrigger(triggerOf("young-fire-dragon", "Blazing Scales"), { kind: "onAttacked", stage: "targeted", attackerBand: "far" })).toBe(false);
    expect(creature(plan("young-fire-dragon", "Blazing Scales", [], quiet({ trigger: { source: mira } })), "mira")!.stress).toBe(1);
  });

  it("Slash and Burn: a standard hit gains a Fear (automatic); a Stress adds 10 magic damage to it", () => {
    expect(plan("young-fire-dragon", "Slash and Burn", [], quiet())).toMatchObject({ activation: "auto", gmFearDelta: 1 });
    const burn = plan("young-fire-dragon", "Slash and Burn", [], quiet({ useId: "burn", trigger: { subject: mira } }));
    expect(burn.self.after.stress).toBe(1);
    expect(folds(burn)).toEqual([expect.objectContaining({ targetIds: ["mira"], amount: 10 })]);
  });
});
