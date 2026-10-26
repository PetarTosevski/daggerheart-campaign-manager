import { describe, expect, it } from "vitest";

import { activePassives, adversaryNumberEnv, matchesTrigger, passiveSummary, type AdversaryState } from "@/lib/domain/adversary-actions/features";
import { run, runStandardAttack, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext, type AdversaryRunResult } from "@/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryStep, AdversaryTrigger } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { resolveNumber } from "@/lib/domain/combat-actions/numbers";
import { queueRng } from "@/lib/domain/dice";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryEffects, adversaryGroup } from "@/lib/srd/adversary-effects";
import { T2_HF_EFFECTS } from "@/lib/srd/adversary-effects/t2-hf";
import type { AdversaryDef } from "@/lib/srd/types";

// Plan combat-actions, tracer AE-t2-hf: every feature of every tier 2 Hope & Fear adversary (HF p.70-80) run through the
// AA1 runner with fixed dice. Expected values are worked out by hand from the feature text and the stat block. RNG order:
// the d20(s), then damage dice, `check` dice and prompt numbers in step order. Every run checks that all queued dice were
// used. PCs here have Evasion 12 unless stated.

const GROUP = ADVERSARIES.filter((a) => adversaryGroup(a) === "t2-hf");

const defOf = (id: string): AdversaryDef => {
  const def = GROUP.find((a) => a.id === id);
  if (!def) throw new Error(`No tier 2 Hope & Fear adversary ${id}`);
  return def;
};

const effectOf = (adversaryId: string, feature: string): AdversaryFeatureEffect => {
  const effect = T2_HF_EFFECTS.find((e) => e.adversaryId === adversaryId && e.feature === feature);
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

/** Runs one use with queued dice (the instance's passives in force, Fear confirmed) and checks every die was used. */
function runF(adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunResult {
  const def = defOf(adversaryId);
  const self = over.self ?? selfOf(adversaryId);
  const rng = queueRng(dice);
  const result = run(effectOf(adversaryId, feature), {
    adversaryId,
    self,
    attack: { name: def.attack.name, modifier: def.attack.modifier, range: def.attack.range, damage: def.attack.damage },
    tier: 2,
    gmFear: 5,
    spotlit: true,
    fearConfirmed: true,
    targets: [mira],
    passives: passiveSummary(adversaryEffects(adversaryId), stateOf(self, over.tokens ?? 0), 2),
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

const stepsOf = <K extends AdversaryPlanStep["kind"]>(p: AdversaryPlan, kind: K) => p.steps.filter((s): s is Extract<AdversaryPlanStep, { kind: K }> => s.kind === kind);
const prompts = (p: AdversaryPlan, prompt: string) => stepsOf(p, "prompt").filter((s) => s.prompt === prompt);
const creature = (p: AdversaryPlan, id: string) => p.creatures.find((c) => c.id === id)?.after;
const triggerOf = (adversaryId: string, feature: string, useId = "main"): AdversaryTrigger => {
  const a = effectOf(adversaryId, feature).uses.find((u) => u.id === useId)!.activation;
  if (a.kind !== "reaction" && a.kind !== "auto") throw new Error(`${feature} has no trigger`);
  return a.trigger;
};
const summaryOf = (adversaryId: string, self = selfOf(adversaryId), extra: Partial<AdversaryState> = {}) =>
  passiveSummary(adversaryEffects(adversaryId), stateOf(self, 0, extra), 2);

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
  it("covers the 42 tier 2 Hope & Fear adversaries and their 138 features, nothing missing, nothing extra", () => {
    expect(GROUP).toHaveLength(42);
    const printed = GROUP.flatMap((a) => a.features.map((f) => `${a.id}/${f.name}`)).sort();
    const entries = T2_HF_EFFECTS.map((e) => `${e.adversaryId}/${e.feature}`).sort();
    expect(printed).toHaveLength(138);
    expect(entries).toEqual(printed);
    expect(new Set(entries).size).toBe(entries.length);
  });

  it("every entry is reachable through the registry and its use ids are unique", () => {
    for (const e of T2_HF_EFFECTS) {
      expect(adversaryEffects(e.adversaryId)).toContain(e);
      const ids = e.uses.map((u) => u.id);
      expect(new Set(ids).size, e.feature).toBe(ids.length);
    }
  });

  it("a printed Fear cost appears in the entry with its amount; passives and reactions never need the spotlight", () => {
    for (const a of GROUP) {
      for (const f of a.features) {
        const e = effectOf(a.id, f.name);
        const fears = e.uses.flatMap((u) => fearCosts(u.costs, u.steps));
        if (f.fearCost) expect(fears, `${a.id}/${f.name}`).toContain(f.fearCost);
        for (const u of e.uses) {
          if (u.activation.kind !== "action") expect(u.needsSpotlight, `${a.id}/${f.name}:${u.id}`).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------- shared shapes

describe("Relentless, Minion, Horde, resistance and Momentum", () => {
  it.each([
    ["entombed-cat-beast", 3],
    ["fowlbear", 2],
    ["giant-octopus", 3],
    ["gobstalker", 3],
    ["hill-titan", 3],
    ["landshark-behemoth", 3],
    ["stone-titan", 3],
  ] as const)("%s Relentless (%i): spotlighted up to X times per GM turn", (id, times) => {
    expect(summaryOf(id).relentless).toBe(times);
    expect(plan(id, `Relentless (${times})`, [], { spotlit: false, targets: [] }).modifiers).toEqual([{ kind: "relentless", times }]);
  });

  it.each([
    ["entombed-stonemason", 5],
    ["fungispunj-sporeling", 6],
    ["guahalan-spirit-beast", 5],
    ["jack-o-lantern", 4],
    ["sprite", 5],
  ] as const)("%s Minion (%i) (CB p.201)", (id, x) => {
    expect(summaryOf(id).minion).toBe(x);
    expect(plan(id, `Minion (${x})`, [], { spotlit: false, targets: [] }).modifiers).toEqual([{ kind: "minion", threshold: x }]);
  });

  it.each([
    // id, X per Minion, type, d20 that hits Evasion 12 with the ATK
    ["entombed-stonemason", 5, "physical", 13],
    ["fungispunj-sporeling", 4, "magic", 13],
    ["guahalan-spirit-beast", 5, "magic", 11],
    ["jack-o-lantern", 6, "physical", 10],
  ] as const)("%s Group Attack: a Fear, one shared roll, X damage each combined (AR9)", (id, x, type, d20) => {
    expect(runF(id, "Group Attack", [d20], { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const p = plan(id, "Group Attack", [d20], { group: [selfOf(id, { id: "m2" }), selfOf(id, { id: "m3" })] });
    expect(p).toMatchObject({ fearSpent: 1, gmFearDelta: -1, group: ["m2", "m3"] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 3 * x, type, direct: false })]);
    expect(plan(id, "Group Attack", [d20 - 1]).incoming).toEqual([]); // one below Evasion: no damage
  });

  it("Entombed Skin Beetles Horde (2d4+1): once half the HP is marked the standard attack deals 2d4+1 (CB p.199)", () => {
    const self = selfOf("entombed-skin-beetles", { hp: 3 });
    expect(summaryOf("entombed-skin-beetles", self).horde).toBe("2d4+1");
    const attack = defOf("entombed-skin-beetles").attack;
    const rng = queueRng([15, 1, 2]);
    const p = ok(runStandardAttack({ adversaryId: "entombed-skin-beetles", self, attack, tier: 2, gmFear: 0, spotlit: true, targets: [mira], passives: summaryOf("entombed-skin-beetles", self), rng }));
    rng.done();
    expect(p.incoming[0]).toMatchObject({ amount: 4, type: "physical" });
    expect(plan("entombed-skin-beetles", "Horde (2d4+1)", [], { spotlit: false, targets: [] }).modifiers).toHaveLength(1);
  });

  it("Flock of Feather Fiends Horde (1d6+1): magic damage once halved", () => {
    const self = selfOf("flock-of-feather-fiends", { hp: 3 });
    expect(summaryOf("flock-of-feather-fiends", self).horde).toBe("1d6+1");
    const rng = queueRng([15, 4]);
    const p = ok(runStandardAttack({ adversaryId: "flock-of-feather-fiends", self, attack: defOf("flock-of-feather-fiends").attack, tier: 2, gmFear: 0, spotlit: true, targets: [mira], passives: summaryOf("flock-of-feather-fiends", self), rng }));
    rng.done();
    expect(p.incoming[0]).toMatchObject({ amount: 5, type: "magic" });
    expect(plan("flock-of-feather-fiends", "Horde (1d6+1)", [], { spotlit: false, targets: [] }).modifiers).toHaveLength(1);
  });

  it.each([
    ["banshee", "physical"],
    ["entombed-empress", "physical"],
    ["guahalan-spirit-beast", "physical"],
    ["gargoyle", "magic"],
    ["scarecrow", "physical"],
  ] as const)("%s has resistance to %s damage (CB p.99)", (id, type) => {
    const r = summaryOf(id).resistance!;
    expect(r[type]).toBe("resistant");
    expect(r[type === "physical" ? "magic" : "physical"]).toBe("none");
  });

  it.each(["entombed-empress/Empty Husk", "guahalan-spirit-beast/Ethereal Form", "gargoyle/Unliving"])("%s runs as a passive", (key) => {
    const [id, feature] = key.split("/") as [string, string];
    expect(plan(id, feature, [], { spotlit: false, targets: [] }).modifiers).toHaveLength(1);
  });

  it.each(["entombed-skin-beetles", "hill-titan"])("%s Momentum: a Fear on any successful attack against a PC, automatic (Q19)", (id) => {
    expect(matchesTrigger(triggerOf(id, "Momentum"), { kind: "onHit", attack: "feature" })).toBe(true);
    const p = plan(id, "Momentum", [], { spotlit: false, targets: [] });
    expect(p).toMatchObject({ activation: "auto", gmFearDelta: 1, fearSpent: 0 });
  });
});

// ---------------------------------------------------------------- per adversary

describe("Banshee (HF p.70)", () => {
  it("Specter: physical resistance; Mark a Stress to move up to Close range through solid objects", () => {
    const p = plan("banshee", "Specter", [], { useId: "phase", targets: [] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "move")).toHaveLength(1);
    expect(plan("banshee", "Specter", [], { useId: "main", spotlit: false, targets: [] }).modifiers).toHaveLength(1);
  });

  it("Terrifying: on a hit every PC within Close range loses a Hope and the GM gains a Fear", () => {
    expect(matchesTrigger(triggerOf("banshee", "Terrifying"), { kind: "onHit", attack: "standard" })).toBe(true);
    const p = plan("banshee", "Terrifying", [], { spotlit: false, targets: [], picked: [mira, bram] });
    expect(stepsOf(p, "hope")).toEqual([
      { kind: "hope", targetId: "mira", delta: -1 },
      { kind: "hope", targetId: "bram", delta: -1 },
    ]);
    expect(p.gmFearDelta).toBe(1);
  });

  it("Scare Tactic: a Fear, teleport, the PC marks 1d4 Stress; a Hope lost only if that marks HP; three per scene", () => {
    expect(runF("banshee", "Scare Tactic", [3], { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const calm = plan("banshee", "Scare Tactic", [3]);
    expect(calm.fearSpent).toBe(1);
    expect(creature(calm, "mira")).toMatchObject({ stress: 3, hp: 0 });
    expect(stepsOf(calm, "hope")).toEqual([]);
    expect(prompts(calm, "move")).toHaveLength(1); // the teleport
    const full = plan("banshee", "Scare Tactic", [3], { targets: [pc("mira", { stress: 5 })] });
    expect(creature(full, "mira")!.hp).toBe(1); // CB p.92 overflow
    expect(stepsOf(full, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: -1 }]);
    let uses = calm.self.featureUses;
    uses = plan("banshee", "Scare Tactic", [1], { featureUses: uses }).self.featureUses;
    uses = plan("banshee", "Scare Tactic", [1], { featureUses: uses }).self.featureUses;
    expect(runF("banshee", "Scare Tactic", [1], { featureUses: uses })).toMatchObject({ ok: false, reason: "exhausted", code: "ADVERSARY_FEATURE_UNAVAILABLE" });
  });

  it("Wail of Despair: a Stress; every PC within Close range makes a Presence Reaction Roll", () => {
    const p = plan("banshee", "Wail of Despair", [], { targets: [mira, bram] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave").map((s) => s.targetIds)).toEqual([["mira"], ["bram"]]);
    expect(runF("banshee", "Wail of Despair", [], { spotlit: false })).toMatchObject({ ok: false, code: "ADVERSARY_NOT_SPOTLIT" });
  });
});

describe("Basilisk (HF p.70)", () => {
  it("Petrify: a Fear, an Instinct Reaction Roll for a PC within Far range", () => {
    const p = plan("basilisk", "Petrify", []);
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("CRONCH!: a Stress; only a Petrified PC must make a death move", () => {
    const stiff = plan("basilisk", "CRONCH!", [], { targets: [pc("mira", { tags: ["Stiff"] })] });
    expect(stiff.self.after.stress).toBe(1);
    expect(prompts(stiff, "manual")).toEqual([]);
    const petrified = plan("basilisk", "CRONCH!", [], { targets: [pc("mira", { tags: ["Petrified"] })] });
    expect(prompts(petrified, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"], text: "The target must make a death move." })]);
  });
});

describe("Berserkers (HF p.70)", () => {
  it.each(["berserker-alpha", "berserker-initiate"])("%s Pack Fury: a reminder before each of its attacks", (id) => {
    expect(matchesTrigger(triggerOf(id, "Pack Fury"), { kind: "onAttack", stage: "before", attack: "standard" })).toBe(true);
    expect(prompts(plan(id, "Pack Fury", [], { spotlit: false, targets: [] }), "manual")).toHaveLength(1);
  });

  it("Bark at the Moon: once per scene, a Fear: each ally within Close range clears a HP and a Stress", () => {
    const a1 = ally("a1", { hp: 2, stress: 1 });
    const a2 = ally("a2", { hp: 0, stress: 2 });
    const p = plan("berserker-alpha", "Bark at the Moon", [], { targets: [], allies: [a1, a2] });
    expect(p.fearSpent).toBe(1);
    expect(creature(p, "a1")).toMatchObject({ hp: 1, stress: 0 });
    expect(creature(p, "a2")).toMatchObject({ hp: 0, stress: 1 });
    expect(runF("berserker-alpha", "Bark at the Moon", [], { targets: [], featureUses: p.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it.each([
    ["berserker-alpha", 6, [15, 3, 4], 3 + 4 + 2 + 6],
    ["berserker-initiate", 4, [15, 3, 4], 3 + 4 + 4],
  ] as const)("%s Berserker Rage: the first last Stress of a scene gives +%i damage", (id, bonus, dice, amount) => {
    const trigger = triggerOf(id, "Berserker Rage");
    expect(matchesTrigger(trigger, { kind: "onMarkStress", last: true, first: { scene: true, ever: true } })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "onMarkStress", last: true, first: { scene: false, ever: false } })).toBe(false);
    const raged = plan(id, "Berserker Rage", [], { spotlit: false, targets: [] }).self.after;
    expect(raged.tags).toEqual(["Berserker Rage"]);
    const passives = summaryOf(id, raged);
    expect(passives.attackDamageAdd).toBe(bonus);
    const rng = queueRng([...dice]);
    const hit = ok(runStandardAttack({ adversaryId: id, self: raged, attack: defOf(id).attack, tier: 2, gmFear: 0, spotlit: true, targets: [mira], passives, rng }));
    rng.done();
    expect(hit.incoming[0]!.amount).toBe(amount);
  });
});

describe("Centaur Warden (HF p.70)", () => {
  it("Flanking Maneuver: +2 when an ally is in Melee range of the target (no map: holds, Q18)", () => {
    expect(summaryOf("centaur-warden").attackBonus).toBe(2);
    expect(summaryOf("centaur-warden", selfOf("centaur-warden"), { allyWithin: () => false }).attackBonus).toBe(0);
    expect(plan("centaur-warden", "Flanking Maneuver", [], { spotlit: false, targets: [] }).modifiers).toHaveLength(1);
  });

  it("Eye of the Sage: a Stress, a standard attack with advantage (two d20s, the higher kept)", () => {
    // d20s 5 and 17 keep 17; +2 ATK +2 Flanking = 21; 2d8+4 = 3 + 4 + 4.
    const p = plan("centaur-warden", "Eye of the Sage", [5, 17, 3, 4]);
    expect(p.roll!.record.total).toBe(21);
    expect(p.incoming[0]).toMatchObject({ amount: 11, type: "physical" });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "manual")).toHaveLength(1); // the 19-20 critical range
  });

  it("Trample: a Fear, gallop, an Agility Reaction Roll for every target in the path", () => {
    const p = plan("centaur-warden", "Trample", [], { targets: [mira, bram] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "move")).toHaveLength(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Quick Volley: N Stress for N more targets, one roll against all (AR7)", () => {
    expect(matchesTrigger(triggerOf("centaur-warden", "Quick Volley", "volley-2"), { kind: "onAttack", stage: "before", attack: "standard" })).toBe(true);
    // d20 10 + 2 + 2 = 14: hits Evasion 12 and 14; 2d8+4 = 2 + 3 + 4 each.
    const p = plan("centaur-warden", "Quick Volley", [10, 2, 3], { useId: "volley-2", spotlit: false, targets: [mira, bram, pc("cora")] });
    expect(p.self.after.stress).toBe(2);
    expect(p.incoming.map((h) => [h.targetId, h.amount])).toEqual([
      ["mira", 9],
      ["bram", 9],
      ["cora", 9],
    ]);
    expect(runF("centaur-warden", "Quick Volley", [10], { useId: "volley-2", targets: [mira, bram, pc("c"), pc("d")] })).toMatchObject({ ok: false, reason: "targets" });
  });
});

describe("Chicken-Foot Hut (HF p.71)", () => {
  it("Fast: a Far move prompt when spotlighted", () => {
    expect(matchesTrigger(triggerOf("chicken-foot-hut", "Fast"), { kind: "onSpotlight", tokens: 0 })).toBe(true);
    expect(prompts(plan("chicken-foot-hut", "Fast", [], { spotlit: false, targets: [] }), "move")).toEqual([expect.objectContaining({ text: "Move (far)" })]);
  });

  it("Double Strike: a Stress, two standard attacks with their own rolls", () => {
    // First: 15 + 2 hits Mira, 2d10+3 = 4 + 5 + 3; second: 3 + 2 misses Bram.
    const first = plan("chicken-foot-hut", "Double Strike", [15, 4, 5, 3], { followUp: [bram] });
    expect(first.self.after.stress).toBe(1);
    expect(first.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 12 })]);
    // First misses (3 + 2), second hits Bram (18 + 2): 6 + 6 + 3.
    const second = plan("chicken-foot-hut", "Double Strike", [3, 18, 6, 6], { followUp: [bram] });
    expect(second.incoming).toEqual([expect.objectContaining({ targetId: "bram", amount: 15 })]);
    // Both hit Mira: 12 and a fresh 2d10+3 (6 + 6 + 3) combine into one hit of 27.
    const both = plan("chicken-foot-hut", "Double Strike", [15, 4, 5, 15, 6, 6], { followUp: [mira] });
    expect(both.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 27 })]);
  });

  it("Pin: after a successful standard attack, a Stress temporarily Restrains the target", () => {
    expect(matchesTrigger(triggerOf("chicken-foot-hut", "Pin"), { kind: "onHit", attack: "standard" })).toBe(true);
    expect(matchesTrigger(triggerOf("chicken-foot-hut", "Pin"), { kind: "onHit", attack: "feature" })).toBe(false);
    const p = plan("chicken-foot-hut", "Pin", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(p.self.after.stress).toBe(1);
    expect(creature(p, "mira")!.conditions).toEqual(["restrained"]);
    expect(stepsOf(p, "condition")[0]).toMatchObject({ duration: "temporary" });
  });
});

describe("Dire Pangolati (HF p.71)", () => {
  it("Armor Eater: a reminder on the hit PC that armor costs 2 slots", () => {
    const p = plan("dire-pangolati", "Armor Eater", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Blade Spin: a Fear, an Agility Reaction Roll for each target within Very Close range", () => {
    const p = plan("dire-pangolati", "Blade Spin", [], { targets: [mira, bram] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Blade Fling: a Stress, an attack within Far range for 2d6+10 physical", () => {
    const p = plan("dire-pangolati", "Blade Fling", [10, 2, 5]);
    expect(p.incoming[0]).toMatchObject({ amount: 17, type: "physical" });
    expect(plan("dire-pangolati", "Blade Fling", [9]).incoming).toEqual([]);
  });

  it("Keratin Scales: when it would mark HP from an attack, a Stress for one HP fewer", () => {
    expect(matchesTrigger(triggerOf("dire-pangolati", "Keratin Scales"), { kind: "onMarkHp", stage: "would", amount: 2, last: false, fromAttack: true })).toBe(true);
    const p = plan("dire-pangolati", "Keratin Scales", [], { spotlit: false, targets: [] });
    expect(p.self.after.stress).toBe(1);
    expect(stepsOf(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["inst1"], amount: 1 })]);
  });
});

describe("Doppelhound (HF p.71)", () => {
  it("Blink Beast: the duplicate is placed at combat start, dispelled by a hit, conjured again for a Fear", () => {
    const placed = plan("doppelhound", "Blink Beast", [], { useId: "place", spotlit: false, targets: [] });
    expect(placed.self.after.tags).toEqual(["Duplicate"]);
    expect(runF("doppelhound", "Blink Beast", [], { useId: "attacked", spotlit: false, targets: [] })).toMatchObject({ ok: false, reason: "requirement" });
    const withDup = selfOf("doppelhound", { tags: ["Duplicate"] });
    expect(prompts(plan("doppelhound", "Blink Beast", [], { useId: "attacked", self: withDup, spotlit: false, targets: [] }), "manual")).toHaveLength(1);
    expect(plan("doppelhound", "Blink Beast", [], { useId: "dispel", self: withDup, spotlit: false, targets: [] }).self.after.tags).toEqual([]);
    expect(runF("doppelhound", "Blink Beast", [], { useId: "conjure", spotlit: false, fearConfirmed: false, targets: [] })).toMatchObject({ reason: "confirmFear" });
    const conjured = plan("doppelhound", "Blink Beast", [], { useId: "conjure", spotlit: false, targets: [] });
    expect(conjured).toMatchObject({ fearSpent: 1 });
    expect(conjured.self.after.tags).toEqual(["Duplicate"]);
  });

  it("Double Strike: a Stress, two standard attacks", () => {
    // 11 + 3 = 14 hits: 2d8+2 = 1 + 1 + 2; the second d20 1 misses.
    const p = plan("doppelhound", "Double Strike", [11, 1, 1, 1], { followUp: [mira] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 4 })]);
  });
});

describe("Dragon Knight (HF p.71)", () => {
  it("High Ground: advantage on attacks when the GM confirms the target is below it", () => {
    const self = selfOf("dragon-knight");
    expect(activePassives(adversaryEffects("dragon-knight"), stateOf(self))).toEqual([]);
    const active = activePassives(adversaryEffects("dragon-knight"), stateOf(self, 0, { situations: ["The target is below the Knight"] }));
    expect(active.map((a) => a.effect.feature)).toEqual(["High Ground"]);
    expect(runF("dragon-knight", "High Ground", [], { spotlit: false, targets: [] })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Leaping Strike: a Stress, leap, a standard attack + 1d12, and a forced Armor Slot without benefit", () => {
    // 14 + 2 = 16 hits; 2d12+3 = 6 + 6 + 3 = 15, + 1d12 (5) = 20.
    const p = plan("dragon-knight", "Leaping Strike", [14, 6, 6, 5]);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 20, forcedArmor: 1 })]);
    expect(prompts(p, "move")).toHaveLength(1);
  });

  it("Comeback: after a missed standard attack, a Fear rerolls it with advantage", () => {
    expect(matchesTrigger(triggerOf("dragon-knight", "Comeback"), { kind: "onMiss", attack: "standard" })).toBe(true);
    // d20s 4 and 16 keep 16 + 2 = 18; 2d12+3 = 2 + 2 + 3.
    const p = plan("dragon-knight", "Comeback", [4, 16, 2, 2], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(p).toMatchObject({ fearSpent: 1 });
    expect(p.incoming[0]).toMatchObject({ targetId: "mira", amount: 7 });
  });
});

describe("Elephant (HF p.72)", () => {
  it("Trample: a Stress, charge, an Agility Reaction Roll for each target in the path", () => {
    const p = plan("elephant", "Trample", [], { targets: [mira, bram] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Toss: after a successful standard attack, a Fear tosses the target and adds 1d12 to the hit", () => {
    const p = plan("elephant", "Toss", [7], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(p.fearSpent).toBe(1);
    expect(stepsOf(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], amount: 7 })]);
    expect(prompts(p, "move")).toHaveLength(1);
  });
});

describe("Entombed Cat Beast (HF p.72)", () => {
  it("Bloody Strike: a PC who marks 3+ HP from its attack marks one more", () => {
    const trigger = triggerOf("entombed-cat-beast", "Bloody Strike");
    expect(matchesTrigger(trigger, { kind: "pcMarksHp", severity: "severe", fromSelf: true })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "pcMarksHp", severity: "major", fromSelf: true })).toBe(false);
    const p = plan("entombed-cat-beast", "Bloody Strike", [], { spotlit: false, targets: [], trigger: { subject: pc("mira", { hp: 3 }) } });
    expect(creature(p, "mira")!.hp).toBe(4);
  });

  it("Screeching Caterwaul: a Stress, Presence Reaction Rolls; a hit on a Rattled PC rolls damage twice and clears it", () => {
    expect(prompts(plan("entombed-cat-beast", "Screeching Caterwaul", [], { targets: [mira, bram] }), "pcSave")).toHaveLength(2);
    const trigger = triggerOf("entombed-cat-beast", "Screeching Caterwaul", "rattled");
    expect(matchesTrigger(trigger, { kind: "onHit", attack: "standard", target: { conditions: [], tags: ["Rattled"] } })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "onHit", attack: "standard", target: { conditions: [] } })).toBe(false);
    const p = plan("entombed-cat-beast", "Screeching Caterwaul", [], { useId: "rattled", spotlit: false, targets: [], trigger: { subject: pc("mira", { tags: ["Rattled"] }) } });
    expect(creature(p, "mira")!.tags).toEqual([]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("I Alone: when it appears, defeat any number of allies and gain a Fear for each", () => {
    expect(matchesTrigger(triggerOf("entombed-cat-beast", "I Alone"), { kind: "timing", at: "appears" })).toBe(true);
    const p = plan("entombed-cat-beast", "I Alone", [], { spotlit: false, targets: [ally("a1"), ally("a2")] });
    expect(stepsOf(p, "defeat").map((s) => s.targetId)).toEqual(["a1", "a2"]);
    expect(p.gmFearDelta).toBe(2);
  });

  it("Vicious Reprisal: damaged by a PC's attack within Very Close range, a Stress for a standard attack against them", () => {
    const trigger = triggerOf("entombed-cat-beast", "Vicious Reprisal");
    expect(matchesTrigger(trigger, { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "veryClose" })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "far" })).toBe(false);
    // 12 + 2 = 14 hits; 2d12+2 = 5 + 5 + 2.
    const p = plan("entombed-cat-beast", "Vicious Reprisal", [12, 5, 5], { spotlit: false, targets: [], trigger: { source: mira } });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming[0]).toMatchObject({ targetId: "mira", amount: 12 });
  });
});

describe("Entombed Elite Guard (HF p.72)", () => {
  it("Battle Formation: a reminder when it is attacked", () => {
    expect(matchesTrigger(triggerOf("entombed-elite-guard", "Battle Formation"), { kind: "onAttacked", stage: "targeted" })).toBe(true);
    expect(prompts(plan("entombed-elite-guard", "Battle Formation", [], { spotlit: false, targets: [] }), "manual")).toHaveLength(1);
  });

  it("Javelin: an attack within Very Far range for 2d6+2 physical, no cost", () => {
    const p = plan("entombed-elite-guard", "Javelin", [10, 3, 3]);
    expect(p).toMatchObject({ fearSpent: 0 });
    expect(p.self.after.stress).toBe(0);
    expect(p.incoming[0]).toMatchObject({ amount: 8, type: "physical" });
  });
});

describe("Entombed Empress (HF p.72)", () => {
  it("Missing Organs: each destroyed container marks a HP on her", () => {
    expect(matchesTrigger(triggerOf("entombed-empress", "Missing Organs"), { kind: "situation", text: "The PCs find and destroy one of the six crystal containers" })).toBe(true);
    expect(plan("entombed-empress", "Missing Organs", [], { spotlit: false, targets: [] }).self.after.hp).toBe(1);
  });

  it("Grasping Chains: a Stress, an attack within Close range: pull, 2d8 physical, temporarily Restrained", () => {
    const p = plan("entombed-empress", "Grasping Chains", [10, 4, 4]);
    expect(p.incoming[0]).toMatchObject({ amount: 8, type: "physical" });
    expect(creature(p, "mira")!.conditions).toEqual(["restrained"]);
    expect(prompts(p, "move")).toHaveLength(1);
    const miss = plan("entombed-empress", "Grasping Chains", [9]);
    expect(miss.creatures).toEqual([]);
  });

  it("Deathless Obedience: up to three times per scene, a Fear spotlights allies within Close range", () => {
    const p = plan("entombed-empress", "Deathless Obedience", [], { targets: [] });
    expect(p.fearSpent).toBe(1);
    expect(stepsOf(p, "spotlight")).toEqual([expect.objectContaining({ who: "allies", within: "close" })]);
    expect(p.limit).toMatchObject({ consumed: true });
  });

  it("Accursed Caress: after a successful standard attack, a Fear starts a Doom Countdown (1d6+1)", () => {
    const p = plan("entombed-empress", "Accursed Caress", [3], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(p.fearSpent).toBe(1);
    expect(stepsOf(p, "countdown")).toEqual([expect.objectContaining({ op: "start", label: "Doom Countdown", start: 4, loop: false })]);
  });

  it("Final Transformation: at her last HP, the Entombed Cat Beast replaces her and is spotlighted", () => {
    expect(matchesTrigger(triggerOf("entombed-empress", "Final Transformation (Phase Change)"), { kind: "onMarkHp", stage: "did", amount: 1, last: true })).toBe(true);
    const p = plan("entombed-empress", "Final Transformation (Phase Change)", [], { spotlit: false, targets: [] });
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ count: 1, adversaryId: "entombed-cat-beast" })]);
    expect(stepsOf(p, "spotlight")).toEqual([expect.objectContaining({ who: "picked" })]);
  });
});

describe("Entombed Necropriest (HF p.73)", () => {
  it("Invigorate: a Stress; up to three allies gain advantage on their next attack roll", () => {
    const p = plan("entombed-necropriest", "Invigorate", [], { targets: [ally("a1"), ally("a2"), ally("a3")] });
    expect(stepsOf(p, "effect").map((s) => [s.targetId, s.duration])).toEqual([
      ["a1", "nextRoll"],
      ["a2", "nextRoll"],
      ["a3", "nextRoll"],
    ]);
    expect(runF("entombed-necropriest", "Invigorate", [], { targets: [ally("a1"), ally("a2"), ally("a3"), ally("a4")] })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("Last Grasp: a Fear Restrains a PC; the GM gains a Fear when that PC spends Hope", () => {
    const p = plan("entombed-necropriest", "Last Grasp", []);
    expect(creature(p, "mira")).toMatchObject({ conditions: ["restrained"], tags: ["Last Grasp"] });
    expect(matchesTrigger(triggerOf("entombed-necropriest", "Last Grasp", "hope"), { kind: "pcHope", change: "spend" })).toBe(true);
    expect(plan("entombed-necropriest", "Last Grasp", [], { useId: "hope", spotlit: false, targets: [], trigger: { subject: creature(p, "mira")! } }).gmFearDelta).toBe(1);
    expect(plan("entombed-necropriest", "Last Grasp", [], { useId: "hope", spotlit: false, targets: [], trigger: { subject: bram } }).gmFearDelta).toBe(0);
  });

  it("Chill Touch: a Stress, standard damage and 1d4 Stress; a Fear when that marks the PC's last Stress", () => {
    // 10 + 2 = 12 hits; 2d6+2 = 2 + 2 + 2; then 1d4 = 3 Stress.
    const p = plan("entombed-necropriest", "Chill Touch", [10, 2, 2, 3]);
    expect(p.incoming[0]).toMatchObject({ amount: 6, type: "magic" });
    expect(creature(p, "mira")!.stress).toBe(3);
    expect(p.gmFearDelta).toBe(0);
    const last = plan("entombed-necropriest", "Chill Touch", [10, 2, 2, 3], { targets: [pc("mira", { stress: 3 })] });
    expect(creature(last, "mira")!.stress).toBe(6);
    expect(last.gmFearDelta).toBe(1);
  });
});

describe("Entombed Skin Beetles and Stonemason (HF p.73)", () => {
  it("Omophagous: a HP, the PC marks a Stress and is Infected; an Infected PC rolling with Fear takes 6 direct physical", () => {
    const p = plan("entombed-skin-beetles", "Omophagous", []);
    expect(p.self.after.hp).toBe(1);
    expect(creature(p, "mira")).toMatchObject({ stress: 1, tags: ["Infected"] });
    expect(matchesTrigger(triggerOf("entombed-skin-beetles", "Omophagous", "infected"), { kind: "pcRolls", roll: { kind: "action", success: true, withHope: false, withFear: true } })).toBe(true);
    const fear = plan("entombed-skin-beetles", "Omophagous", [], { useId: "infected", spotlit: false, targets: [], trigger: { subject: creature(p, "mira")! } });
    expect(fear.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 6, type: "physical", direct: true })]);
    expect(plan("entombed-skin-beetles", "Omophagous", [], { useId: "infected", spotlit: false, targets: [], trigger: { subject: bram } }).incoming).toEqual([]);
  });

  it("The Work Never Ends: defeated by physical damage, a Fear clears its HP and Stress", () => {
    const trigger = triggerOf("entombed-stonemason", "The Work Never Ends");
    expect(matchesTrigger(trigger, { kind: "onDefeated", damageType: "physical" })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "onDefeated", damageType: "magic" })).toBe(false);
    const p = plan("entombed-stonemason", "The Work Never Ends", [], { self: selfOf("entombed-stonemason", { hp: 1, stress: 1 }), spotlit: false, targets: [] });
    expect(p.fearSpent).toBe(1);
    expect(p.self.after).toMatchObject({ hp: 0, stress: 0 });
  });
});

describe("Flock of Feather Fiends and Fowlbear (HF p.74)", () => {
  it("Maddening Cacophony: a Stress, Instinct Reaction Rolls within Very Close range", () => {
    const p = plan("flock-of-feather-fiends", "Maddening Cacophony", [], { targets: [mira, bram] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Double Strike (Fowlbear): two standard attacks; 2d12+2 on a hit", () => {
    // 9 + 3 = 12 hits: 1 + 2 + 2; second 1 misses.
    expect(plan("fowlbear", "Double Strike", [9, 1, 2, 1], { followUp: [bram] }).incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 5 })]);
  });

  it("Dread Honk: a Fear, Presence Reaction Rolls within Close range", () => {
    const p = plan("fowlbear", "Dread Honk", [], { targets: [mira, bram] });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });
});

describe("Fungispunj (HF p.74)", () => {
  it("Form Up: a Fear: three Sporelings leave and a Sporophore is added", () => {
    const self = selfOf("fungispunj-sporeling");
    const p = plan("fungispunj-sporeling", "Form Up", [], { self, targets: [self, selfOf("fungispunj-sporeling", { id: "s2" }), selfOf("fungispunj-sporeling", { id: "s3" })] });
    expect(stepsOf(p, "defeat").map((s) => s.targetId)).toEqual(["inst1", "s2", "s3"]);
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ count: 1, adversaryId: "fungispunj-sporophore" })]);
  });

  it("Neurotoxic Spore Cloud: a Stress, Agility Reaction Rolls within Close range", () => {
    expect(prompts(plan("fungispunj-sporophore", "Neurotoxic Spore Cloud", [], { targets: [mira, bram] }), "pcSave")).toHaveLength(2);
  });

  it("Reanimator: a Fear reanimates a corpse; spotlighting the Sporophore can spotlight its corpses", () => {
    const p = plan("fungispunj-sporophore", "Reanimator", [], { targets: [] });
    expect(p.fearSpent).toBe(1);
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ count: 1, range: "veryClose" })]);
    expect(stepsOf(plan("fungispunj-sporophore", "Reanimator", [], { useId: "command", spotlit: false, targets: [] }), "spotlight")).toHaveLength(1);
  });

  it("Colony: N Stress summons N Sporelings; an unaffordable N summons none", () => {
    const p = plan("fungispunj-sporophore", "Colony", [], { targets: [], options: { colony: ["3"] } });
    expect(p.self.after.stress).toBe(3);
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ count: 3, adversaryId: "fungispunj-sporeling", range: "close" })]);
    const tired = plan("fungispunj-sporophore", "Colony", [], { self: selfOf("fungispunj-sporophore", { stress: 3 }), targets: [], options: { colony: ["5"] } });
    expect(stepsOf(tired, "summon")).toEqual([]);
    expect(tired.self.after.stress).toBe(3);
  });

  it("Mind Meld: the Stress from an attack comes off the Sporophore for its allies to mark", () => {
    const p = plan("fungispunj-sporophore", "Mind Meld", [], { self: selfOf("fungispunj-sporophore", { stress: 2 }), spotlit: false, targets: [], trigger: { amount: 2 } });
    expect(p.self.after.stress).toBe(0);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Gargoyle (HF p.75)", () => {
  it("Swooping Strike: move to a point within Far range and a standard attack along the path", () => {
    const p = plan("gargoyle", "Swooping Strike", [10, 1, 1]);
    expect(p.incoming[0]).toMatchObject({ amount: 5 });
    expect(prompts(p, "move")).toHaveLength(1);
  });

  it("Petrifying Slash: when it deals damage, the target makes a Strength Reaction Roll", () => {
    expect(matchesTrigger(triggerOf("gargoyle", "Petrifying Slash"), { kind: "onDealDamage", toPc: true })).toBe(true);
    const p = plan("gargoyle", "Petrifying Slash", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });
});

describe("Giant Octopus (HF p.75)", () => {
  it("Armed and Dangerous: a d8 at 8 when it appears; a hit can add its value, then it drops by 1", () => {
    expect(plan("giant-octopus", "Armed and Dangerous", [], { useId: "place", spotlit: false, targets: [] }).self.tokens).toEqual({ before: 0, after: 8 });
    const add = plan("giant-octopus", "Armed and Dangerous", [], { useId: "add", tokens: 8, spotlit: false, targets: [], trigger: { subject: mira } });
    expect(stepsOf(add, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], amount: 8 })]);
    expect(add.self.tokens).toEqual({ before: 8, after: 7 });
    expect(runF("giant-octopus", "Armed and Dangerous", [], { useId: "add", spotlit: false, targets: [], trigger: { subject: mira } })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Grapple: after a successful standard attack, a Fear Grapples the target (Restrained and Vulnerable)", () => {
    const p = plan("giant-octopus", "Grapple", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(p.fearSpent).toBe(1);
    expect(creature(p, "mira")).toMatchObject({ tags: ["Grappled"], conditions: ["restrained", "vulnerable"] });
  });

  it("Crush: a Stress, 3d8 direct physical to a Grappled target only", () => {
    const p = plan("giant-octopus", "Crush", [3, 3, 3], { targets: [pc("mira", { tags: ["Grappled"] })] });
    expect(p.incoming).toEqual([expect.objectContaining({ amount: 9, direct: true, type: "physical" })]);
    expect(plan("giant-octopus", "Crush", []).incoming).toEqual([]);
  });
});

describe("Gobstalker (HF p.75)", () => {
  it("Anti-Mystica-Halitosis: a Silenced aura within Close range", () => {
    expect(summaryOf("gobstalker").auras).toHaveLength(2);
    expect(plan("gobstalker", "Anti-Mystica-Halitosis", [], { spotlit: false, targets: [] }).modifiers).toHaveLength(2);
  });

  it("Tentacle Rays: a Stress, an attack; on a success the beam the d8 showed (or one picked for a Fear)", () => {
    // 13 + 2 = 15 hits. Sear: 2d8 direct magic = 4 + 5.
    const sear = plan("gobstalker", "Tentacle Rays", [13, 4, 5], { options: { beam: ["6"] } });
    expect(sear).toMatchObject({ fearSpent: 0 });
    expect(sear.incoming[0]).toMatchObject({ amount: 9, type: "magic", direct: true });
    const picked = plan("gobstalker", "Tentacle Rays", [13], { options: { beam: ["5"] }, optionals: ["choose-beam"] });
    expect(picked.fearSpent).toBe(1);
    expect(creature(picked, "mira")!.conditions).toEqual(["vulnerable", "restrained"]);
    const corrode = plan("gobstalker", "Tentacle Rays", [13, 3, 3], { options: { beam: ["2"] } });
    expect(corrode.incoming[0]).toMatchObject({ amount: 6, type: "magic", forcedArmor: 1 });
    expect(prompts(plan("gobstalker", "Tentacle Rays", [13]), "choose")).toHaveLength(1);
    expect(plan("gobstalker", "Tentacle Rays", [9]).steps.some((s) => s.kind === "prompt")).toBe(false); // a miss: no beam
  });

  it("Leech Lick: after a standard attack marks HP, a Fear clears that much of its Stress", () => {
    expect(matchesTrigger(triggerOf("gobstalker", "Leech Lick"), { kind: "onTargetMarksHp", attack: "standard" })).toBe(true);
    const p = plan("gobstalker", "Leech Lick", [], { self: selfOf("gobstalker", { stress: 3 }), spotlit: false, targets: [], trigger: { amount: 2 } });
    expect(p.fearSpent).toBe(1);
    expect(p.self.after.stress).toBe(1);
  });
});

describe("Guahalan (HF p.76-77)", () => {
  it("The Beast Unleashed: + the GM's Fear to its damage", () => {
    const self = selfOf("guahalan-alebrujo");
    const mod = activePassives(adversaryEffects("guahalan-alebrujo"), stateOf(self))[0]!.use.modifiers![0]!;
    expect(mod).toEqual({ kind: "attackDamage", add: { kind: "gmFear" } });
    if (mod.kind !== "attackDamage") throw new Error("shape");
    expect(resolveNumber(mod.add!, adversaryNumberEnv(stateOf(self), 2, 4), () => 1)).toBe(4);
    expect(plan("guahalan-alebrujo", "The Beast Unleashed", [], { spotlit: false, targets: [] }).modifiers).toHaveLength(1);
  });

  it("Guahalan Sacrifice: a Fear, devour a Minion, then clear a HP or a Stress", () => {
    const p = plan("guahalan-alebrujo", "Guahalan Sacrifice", [], { self: selfOf("guahalan-alebrujo", { hp: 2 }), targets: [ally("m1")], options: { sacrifice: ["hp"] } });
    expect(stepsOf(p, "defeat")).toEqual([{ kind: "defeat", targetId: "m1" }]);
    expect(p.self.after.hp).toBe(1);
  });

  it("Howl of the Guahala: a Stress, Presence Reaction Rolls within Far range", () => {
    expect(prompts(plan("guahalan-alebrujo", "Howl of the Guahala", [], { targets: [mira, bram] }), "pcSave")).toHaveLength(2);
  });

  it("Rip & Tear: a Fear, an attack with advantage; a Stress for another attack on a success", () => {
    // d20s 5 and 15 keep 15 + 3 = 18 hits Mira: 2d10+4 = 2 + 2 + 4; the extra attack: 3 + 3 = 6 misses Bram.
    const p = plan("guahalan-alebrujo", "Rip & Tear", [5, 15, 2, 2, 3], { followUp: [bram], optionals: ["another"] });
    expect(p).toMatchObject({ fearSpent: 1 });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 8, type: "magic" })]);
    // Both hit: the extra attack rolls its own 2d10+4 (3 + 3 + 4) plus The Beast Unleashed's 4 Fear (5 - 1 spent).
    const both = plan("guahalan-alebrujo", "Rip & Tear", [5, 15, 2, 2, 15, 3, 3], { followUp: [bram], optionals: ["another"] });
    expect(both.incoming.map((h) => [h.targetId, h.amount])).toEqual([
      ["mira", 8],
      ["bram", 14],
    ]);
    const single = plan("guahalan-alebrujo", "Rip & Tear", [5, 15, 2, 2]);
    expect(single.self.after.stress).toBe(0);
  });

  it("Brutal Spectacle: after Severe damage, a Fear: every target within Close range marks a Stress", () => {
    const trigger = triggerOf("guahalan-alebrujo", "Brutal Spectacle");
    expect(matchesTrigger(trigger, { kind: "onDealDamage", severity: "severe", toPc: true })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "onDealDamage", severity: "major", toPc: true })).toBe(false);
    const p = plan("guahalan-alebrujo", "Brutal Spectacle", [], { spotlit: false, targets: [], picked: [mira, bram] });
    expect(creature(p, "mira")!.stress).toBe(1);
    expect(creature(p, "bram")!.stress).toBe(1);
  });

  it("Pack Alpha: a hit adds a Pool token; a token gives a Guahalan ally advantage", () => {
    expect(plan("guahalan-fang-lord", "Pack Alpha", [], { useId: "gain", spotlit: false, targets: [] }).self.tokens).toEqual({ before: 0, after: 1 });
    const spend = plan("guahalan-fang-lord", "Pack Alpha", [], { useId: "spend", tokens: 2, spotlit: false, targets: [], picked: [ally("shifter")] });
    expect(spend.self.tokens).toEqual({ before: 2, after: 1 });
    expect(stepsOf(spend, "fold")).toEqual([expect.objectContaining({ targetIds: ["shifter"] })]);
    expect(runF("guahalan-fang-lord", "Pack Alpha", [], { useId: "spend", spotlit: false, targets: [] })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it.each(["guahalan-fang-lord", "guahalan-shifter", "guahalan-spirit-singer"])("%s Unleash the Beast: a Fear; in bestial form + marked Stress to attack and damage", (id) => {
    const p = plan(id, "Unleash the Beast", [], { targets: [] });
    expect(p.fearSpent).toBe(1);
    expect(p.self.after.tags).toEqual(["Bestial Form"]);
    const beast = summaryOf(id, { ...p.self.after, stress: 3 });
    expect(beast).toMatchObject({ attackBonus: 3, attackDamageAdd: 3 });
    expect(summaryOf(id, selfOf(id, { stress: 3 }))).toMatchObject({ attackBonus: 0, attackDamageAdd: 0 });
  });

  it("Call of the Guahala: 2 Fear spotlight the Guahalan Shifters within Close range", () => {
    expect(runF("guahalan-fang-lord", "Call of the Guahala", [], { fearConfirmed: false, targets: [] })).toMatchObject({ reason: "confirmFear", detail: "2" });
    const p = plan("guahalan-fang-lord", "Call of the Guahala", [], { targets: [] });
    expect(p).toMatchObject({ fearSpent: 2, gmFearDelta: -2 });
    expect(stepsOf(p, "spotlight")).toEqual([expect.objectContaining({ who: "allies", name: "Guahalan Shifter", within: "close" })]);
  });

  it("Feral Form: at its last HP, the Guahalan Alebrujo replaces the Fang Lord and is spotlighted", () => {
    const p = plan("guahalan-fang-lord", "Feral Form (Phase Change)", [], { spotlit: false, targets: [] });
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ count: 1, adversaryId: "guahalan-alebrujo" })]);
    expect(stepsOf(p, "spotlight")).toHaveLength(1);
  });

  it("Pack Attack: a Stress, a standard attack; the Shifter bonus is a reminder", () => {
    const p = plan("guahalan-shifter", "Pack Attack", [11, 1, 1]);
    expect(p.incoming[0]).toMatchObject({ amount: 6 });
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Beast Bomb: when defeated, 5 magic damage to creatures within Melee range", () => {
    expect(matchesTrigger(triggerOf("guahalan-spirit-beast", "Beast Bomb"), { kind: "onDefeated" })).toBe(true);
    const p = plan("guahalan-spirit-beast", "Beast Bomb", [], { spotlit: false, targets: [mira, bram] });
    expect(p.incoming.map((h) => [h.targetId, h.amount, h.type])).toEqual([
      ["mira", 5, "magic"],
      ["bram", 5, "magic"],
    ]);
  });

  it("Beast-Caller: a Fear summons 2d4 Spirit Beasts and spotlights one", () => {
    const p = plan("guahalan-spirit-singer", "Beast-Caller", [2, 3], { targets: [] });
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ count: 5, adversaryId: "guahalan-spirit-beast", range: "veryClose" })]);
    expect(stepsOf(p, "spotlight")).toEqual([expect.objectContaining({ who: "picked", count: 1 })]);
  });

  it("Rage of Spirits: a Stress spotlights the Spirit Beasts within Very Close range", () => {
    const p = plan("guahalan-spirit-singer", "Rage of Spirits", [], { targets: [] });
    expect(p.self.after.stress).toBe(1);
    expect(stepsOf(p, "spotlight")).toEqual([expect.objectContaining({ who: "allies", name: "Guahalan Spirit Beast", within: "veryClose" })]);
  });

  it("Spiritual Sacrifice: near a Spirit Beast, a Fear sacrifices it and negates the damage", () => {
    expect(matchesTrigger(triggerOf("guahalan-spirit-singer", "Spiritual Sacrifice"), { kind: "onDamaged", stage: "would" })).toBe(true);
    const p = plan("guahalan-spirit-singer", "Spiritual Sacrifice", [], { spotlit: false, targets: [ally("beast")] });
    expect(stepsOf(p, "defeat")).toEqual([{ kind: "defeat", targetId: "beast" }]);
    expect(stepsOf(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["inst1"] })]);
    expect(runF("guahalan-spirit-singer", "Spiritual Sacrifice", [], { spotlit: false, targets: [ally("beast")], allyWithin: () => false })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Hill Titan, Hive Walker, Jack-o'-Lantern (HF p.77)", () => {
  it("Gullible and Bug Swarm: advantage for PCs who trick it; PCs within Very Close range are Vulnerable", () => {
    const self = selfOf("hill-titan");
    expect(summaryOf("hill-titan").auras).toEqual([{ kind: "conditionAura", condition: { kind: "standard", condition: "vulnerable" }, to: "pcs", within: "veryClose" }]);
    const tricked = activePassives(adversaryEffects("hill-titan"), stateOf(self, 0, { situations: ["A PC tries to trick or emotionally manipulate the Titan"] }));
    expect(tricked.map((a) => a.effect.feature)).toContain("Gullible");
    expect(runF("hill-titan", "Gullible", [], { spotlit: false, targets: [] })).toMatchObject({ ok: false, reason: "requirement" });
    expect(plan("hill-titan", "Bug Swarm", [], { spotlit: false, targets: [] }).modifiers).toHaveLength(1);
  });

  it("Mighty Swing: a Fear, one standard attack roll against all targets within Very Close range", () => {
    // 9 + 3 = 12 hits Mira (12), misses Bram (14); 2d10+4 = 1 + 1 + 4.
    const p = plan("hill-titan", "Mighty Swing", [9, 1, 1], { targets: [mira, bram] });
    expect(p.hits).toEqual([
      { id: "mira", hit: true },
      { id: "bram", hit: false },
    ]);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 6 })]);
  });

  it("Blood Honey: no cost, Agility Reaction Rolls along the line", () => {
    const p = plan("hive-walker", "Blood Honey", [], { targets: [mira, bram] });
    expect(p).toMatchObject({ fearSpent: 0 });
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Bee-Ruption: when it marks HP, Instinct Reaction Rolls within Very Close range; Restrained targets fail", () => {
    expect(matchesTrigger(triggerOf("hive-walker", "Bee-Ruption"), { kind: "onMarkHp", stage: "did", amount: 1, last: false })).toBe(true);
    const p = plan("hive-walker", "Bee-Ruption", [], { spotlit: false, targets: [pc("mira", { conditions: ["restrained"] }), bram] });
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });

  it("Spine-Chilling Cackle: a PC within Very Close range rolls with Fear: a Stress for one more Fear", () => {
    const trigger = triggerOf("jack-o-lantern", "Spine-Chilling Cackle");
    expect(matchesTrigger(trigger, { kind: "pcRolls", band: "veryClose", roll: { kind: "action", success: true, withHope: false, withFear: true } })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "pcRolls", band: "far", roll: { kind: "action", success: true, withHope: false, withFear: true } })).toBe(false);
    const p = plan("jack-o-lantern", "Spine-Chilling Cackle", [], { spotlit: false, targets: [] });
    expect(p.self.after.stress).toBe(1);
    expect(p.gmFearDelta).toBe(1);
  });
});

describe("Landsharks (HF p.78)", () => {
  it.each([
    ["landshark", "Burrowing", "resistant"],
    ["landshark-behemoth", "Deep Diver", "immune"],
  ] as const)("%s %s: burrow and surface; underground it is %s to all damage and can't attack", (id, feature, level) => {
    const under = plan(id, feature, [], { useId: "burrow", targets: [] }).self.after;
    expect(under.tags).toEqual(["Underground"]);
    expect(summaryOf(id, under)).toMatchObject({ resistance: { physical: level, magic: level }, flags: ["cannotAttack"] });
    expect(summaryOf(id).resistance).toBeUndefined();
    expect(plan(id, feature, [], { useId: "surface", self: under, targets: [] }).self.after.tags).toEqual([]);
  });

  it("Thick-Skinned: HP it would mark can be marked as Stress instead", () => {
    expect(stepsOf(plan("landshark", "Thick-Skinned", [], { spotlit: false, targets: [] }), "fold")).toEqual([expect.objectContaining({ step: expect.objectContaining({ kind: "convertMarks", from: "hp", into: "stress" }) })]);
  });

  it("Rending Chomp: after a hit within Melee range, a Fear forces an Armor Slot without its benefit", () => {
    const trigger = triggerOf("landshark", "Rending Chomp");
    expect(matchesTrigger(trigger, { kind: "onHit", attack: "standard", band: "melee" })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "onHit", attack: "standard", band: "close" })).toBe(false);
    const p = plan("landshark", "Rending Chomp", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(creature(p, "mira")!.armor).toBe(1);
    expect(stepsOf(p, "mark")).toEqual([expect.objectContaining({ track: "armor", noBenefit: true })]);
  });

  it("Steel-Skinned: all damage to it is one threshold lower", () => {
    expect(stepsOf(plan("landshark-behemoth", "Steel-Skinned", [], { spotlit: false, targets: [] }), "fold")).toEqual([expect.objectContaining({ targetIds: ["inst1"], amount: 1 })]);
  });

  it("Forceful Eruption: it surfaces; Agility Reaction Rolls within Very Close range", () => {
    const p = plan("landshark-behemoth", "Forceful Eruption", [], { self: selfOf("landshark-behemoth", { tags: ["Underground"] }), targets: [mira, bram] });
    expect(p.self.after.tags).toEqual([]);
    expect(prompts(p, "pcSave")).toHaveLength(2);
  });
});

describe("Ravenous Mockery and Rust Eater (HF p.78)", () => {
  it("Tongue Attack: a Stress, an attack within Close range: pull and Restrain; a Fear for Devour", () => {
    const p = plan("ravenous-mockery", "Tongue Attack", [11]);
    expect(creature(p, "mira")!.conditions).toEqual(["restrained"]);
    expect(prompts(p, "move")).toHaveLength(1);
    // Devour's own attack roll: 13 + 1 = 14 hits.
    const devoured = plan("ravenous-mockery", "Tongue Attack", [11, 13], { followUp: [mira], optionals: ["devour"] });
    expect(devoured.fearSpent).toBe(1);
    expect(creature(devoured, "mira")!.tags).toEqual(["Swallowed"]);
  });

  it("Devour: an attack in Melee range Swallows; Swallowed PCs mark a HP when it is spotlighted; Major damage disgorges them", () => {
    const p = plan("ravenous-mockery", "Devour", [11]);
    expect(creature(p, "mira")).toMatchObject({ tags: ["Swallowed"], conditions: ["restrained"] });
    const swallowed = creature(p, "mira")!;
    const digest = plan("ravenous-mockery", "Devour", [], { useId: "digest", spotlit: false, targets: [swallowed, bram] });
    expect(stepsOf(digest, "mark")).toEqual([expect.objectContaining({ targetId: "mira", track: "hp", amount: 1 })]);
    expect(matchesTrigger(triggerOf("ravenous-mockery", "Devour", "disgorge"), { kind: "onDamaged", stage: "did", severity: "minor" })).toBe(false);
    const out = plan("ravenous-mockery", "Devour", [], { useId: "disgorge", spotlit: false, targets: [swallowed] });
    expect(creature(out, "mira")).toMatchObject({ tags: [], conditions: [] });
  });

  it("Never Just One: a Fear reveals another Mockery and spotlights it", () => {
    const p = plan("ravenous-mockery", "Never Just One", [], { targets: [] });
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ adversaryId: "ravenous-mockery", count: 1 })]);
  });

  it("Stifling Pheromones: a PC's action roll within Very Close range calls for an Instinct Reaction Roll", () => {
    expect(matchesTrigger(triggerOf("rust-eater", "Stifling Pheromones"), { kind: "pcRolls", band: "melee", roll: { kind: "action", success: true, withHope: true, withFear: false } })).toBe(true);
    expect(prompts(plan("rust-eater", "Stifling Pheromones", [], { spotlit: false, targets: [], trigger: { subject: mira } }), "pcSave")).toHaveLength(1);
  });

  it("Rust Touch: a reminder on a weapon hit in Melee range; a crumbled weapon clears a HP", () => {
    const p = plan("rust-eater", "Rust Touch", [], { self: selfOf("rust-eater", { hp: 2 }), spotlit: false, targets: [], trigger: { source: mira }, optionals: ["devour-rust"] });
    expect(prompts(p, "manual")).toHaveLength(1);
    expect(p.self.after.hp).toBe(1);
  });
});

describe("Scarecrow, Sprite, Stone Titan, Triceratops (HF p.79)", () => {
  it("Made of Straw: a fire reminder when it would take damage", () => {
    expect(prompts(plan("scarecrow", "Made of Straw", [], { useId: "fire", spotlit: false, targets: [] }), "manual")).toHaveLength(1);
  });

  it("Terror Vision: a Fear, 2d8 magic and Vulnerable until they roll with Hope", () => {
    const p = plan("scarecrow", "Terror Vision", [3, 4]);
    expect(p.incoming[0]).toMatchObject({ amount: 7, type: "magic" });
    expect(creature(p, "mira")!.conditions).toEqual(["vulnerable"]);
  });

  it("Art of Invisibility: a Fear makes the Sprite Hidden", () => {
    const p = plan("sprite", "Art of Invisibility", [], { targets: [] });
    expect(p.fearSpent).toBe(1);
    expect(p.self.after.conditions).toEqual(["hidden"]);
  });

  it("Dream Petal Poison: after a successful standard attack, a Fear makes the target Sleepy", () => {
    const p = plan("sprite", "Dream Petal Poison", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(creature(p, "mira")!.tags).toEqual(["Sleepy"]);
  });

  it("Skillful Strike: before an attack, a Stress and a d6: 3+ halves the target's Evasion", () => {
    const high = plan("stone-titan", "Skillful Strike", [3], { spotlit: false, targets: [] });
    expect(high.self.after.stress).toBe(1);
    expect(prompts(high, "manual")).toHaveLength(1);
    expect(prompts(plan("stone-titan", "Skillful Strike", [2], { spotlit: false, targets: [] }), "manual")).toEqual([]);
  });

  it("Sunlight Sickness: when it appears, 1d4 Stress and that much to attack and damage", () => {
    const p = plan("stone-titan", "Sunlight Sickness", [3], { spotlit: false, targets: [] });
    expect(p.self.after.stress).toBe(3);
    expect(stepsOf(p, "effect")[0]!.mods).toEqual([
      { kind: "stat", stat: "attack", delta: 3 },
      { kind: "stat", stat: "damage", delta: 3 },
    ]);
  });

  it("Hammer Smash: when a PC marks HP from its standard attack, a Fear forces an Armor Slot without benefit", () => {
    const p = plan("stone-titan", "Hammer Smash", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(creature(p, "mira")!.armor).toBe(1);
  });

  it("Leathery Hide: HP it would mark can be Stress instead", () => {
    expect(stepsOf(plan("triceratops", "Leathery Hide", [], { spotlit: false, targets: [] }), "fold")).toHaveLength(1);
  });

  it("Tail Swipe: a Stress, up to three targets make Agility Reaction Rolls", () => {
    expect(prompts(plan("triceratops", "Tail Swipe", [], { targets: [mira, bram, pc("cora")] }), "pcSave")).toHaveLength(3);
    expect(runF("triceratops", "Tail Swipe", [], { targets: [mira, bram, pc("c"), pc("d")] })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("Bull Rush: a Stress, move into Melee, an attack for 3d10 direct physical", () => {
    const p = plan("triceratops", "Bull Rush", [12, 5, 5, 5]);
    expect(p.incoming[0]).toMatchObject({ amount: 15, direct: true });
  });
});

describe("Tyrannosaurus, Urco, Valdenhax (HF p.80)", () => {
  it("Earth-Shaking Roar: a Fear, Presence Reaction Rolls within Close range", () => {
    expect(prompts(plan("tyrannosaurus", "Earth-Shaking Roar", [], { targets: [mira, bram] }), "pcSave")).toHaveLength(2);
  });

  it("Stomp: a Stress, an attack in Melee range for 3d12 direct physical", () => {
    expect(plan("tyrannosaurus", "Stomp", [10, 4, 4, 4]).incoming[0]).toMatchObject({ amount: 12, direct: true, type: "physical" });
  });

  it("Crushing Bite: after a successful standard attack, a Fear marks an additional HP", () => {
    const p = plan("tyrannosaurus", "Crushing Bite", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(creature(p, "mira")!.hp).toBe(1);
  });

  it("Fearmonger: a PC's failure within Very Close range offers a Fear", () => {
    const trigger = triggerOf("urco", "Fearmonger");
    expect(matchesTrigger(trigger, { kind: "pcRolls", band: "veryClose", roll: { kind: "action", success: false, withHope: true, withFear: false } })).toBe(true);
    expect(matchesTrigger(trigger, { kind: "pcRolls", band: "veryClose", roll: { kind: "action", success: true, withHope: true, withFear: false } })).toBe(false);
    expect(plan("urco", "Fearmonger", [], { spotlit: false, targets: [] }).gmFearDelta).toBe(1);
  });

  it("Terror-Fueled: + the GM's Fear to attack and damage", () => {
    const mods = effectOf("urco", "Terror-Fueled").uses[0]!.modifiers!;
    expect(mods).toEqual([
      { kind: "mod", mod: { kind: "stat", stat: "attack", delta: { kind: "gmFear" } } },
      { kind: "attackDamage", add: { kind: "gmFear" } },
    ]);
    expect(plan("urco", "Terror-Fueled", [], { spotlit: false, targets: [] }).modifiers).toHaveLength(2);
  });

  it("Fear Eater: N Fear clear N Stress; with no Stress marked, N Fear clear N HP", () => {
    const stress = plan("urco", "Fear Eater", [], { self: selfOf("urco", { stress: 2 }), targets: [], options: { eat: ["stress-2"] } });
    expect(stress.self.after.stress).toBe(0);
    expect(stress.gmFearDelta).toBe(-2);
    const hp = plan("urco", "Fear Eater", [], { self: selfOf("urco", { hp: 3 }), targets: [], options: { eat: ["hp-2"] } });
    expect(hp.self.after.hp).toBe(1);
    expect(hp.gmFearDelta).toBe(-2);
    const blocked = plan("urco", "Fear Eater", [], { self: selfOf("urco", { hp: 3, stress: 1 }), targets: [], options: { eat: ["hp-2"] } });
    expect(blocked.self.after.hp).toBe(3);
    expect(blocked.gmFearDelta).toBe(0);
  });

  it("Baleful Gaze: damaged by an attack, a Fear gives the attacker −1 thresholds for the scene", () => {
    const p = plan("urco", "Baleful Gaze", [], { spotlit: false, targets: [], trigger: { source: mira } });
    expect(stepsOf(p, "effect")).toEqual([
      expect.objectContaining({
        targetId: "mira",
        duration: "scene",
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: -1 },
          { kind: "stat", stat: "severeThreshold", delta: -1 },
        ],
      }),
    ]);
  });

  it("To Me, My Pretties: once per scene, 2d4 Hordes at Far range and a Fear for each", () => {
    const p = plan("valdenhax", "To Me, My Pretties", [2, 3], { targets: [] });
    expect(p.gmFearDelta).toBe(5);
    expect(stepsOf(p, "summon")).toEqual([expect.objectContaining({ label: "Tier 2 Hordes", range: "far" })]);
    expect(runF("valdenhax", "To Me, My Pretties", [2, 3], { targets: [], featureUses: p.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Shadow Strangler: a Stress, an attack within Far range: 1d4 Stress and that many Fear", () => {
    const p = plan("valdenhax", "Shadow Strangler", [10, 3]);
    expect(creature(p, "mira")!.stress).toBe(3);
    expect(p.gmFearDelta).toBe(3);
    expect(plan("valdenhax", "Shadow Strangler", [9]).gmFearDelta).toBe(0);
  });

  it("Corpse Whisperer: a Fear; even resurrects the ally with half its HP cleared, odd clears a Stress", () => {
    const fallen = ally("fallen", { hp: 4, hpMax: 4, defeated: true });
    const even = plan("valdenhax", "Corpse Whisperer", [], { targets: [fallen], options: { d6: ["even"] } });
    expect(creature(even, "fallen")).toMatchObject({ hp: 2, defeated: false });
    const odd = plan("valdenhax", "Corpse Whisperer", [], { self: selfOf("valdenhax", { stress: 1 }), targets: [fallen], options: { d6: ["odd"] } });
    expect(odd.self.after.stress).toBe(0);
  });

  it("Vexing Word: after a PC's roll, a Stress forces a reroll", () => {
    const p = plan("valdenhax", "Vexing Word", [], { spotlit: false, targets: [], trigger: { subject: mira } });
    expect(p.self.after.stress).toBe(1);
    expect(stepsOf(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ kind: "modifyRoll" }) })]);
  });
});
