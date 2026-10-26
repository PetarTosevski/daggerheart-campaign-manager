import { describe, expect, it } from "vitest";

import { matchesTrigger, passiveSummary, spotlightCost, triggeredUses, type AdversaryState } from "@/lib/domain/adversary-actions";
import { run, runStandardAttack, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext, type AdversaryRunResult } from "@/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryStep } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryGroup } from "@/lib/srd/adversary-effects";
import { T2_CORE_EFFECTS } from "@/lib/srd/adversary-effects/t2-core";

// Plan combat-actions, tracer AE-t2-core: every feature of the 36 tier 2 Core Book adversaries (CB p.220-227) run
// through the adversary runner (AA1) with fixed dice. Expected values are worked out by hand from the feature text and
// the stat block. RNG order: the d20(s), then damage dice and rolled numbers in step order, then prompt numbers (summon
// counts, countdown starts, spotlight counts). Every successful run checks that all queued dice were used. PCs' reaction
// rolls are prompts (AR11): their branches run when the PC rolls, so the tests check the prompt and its step.

const GROUP = ADVERSARIES.filter((a) => adversaryGroup(a) === "t2-core");
const def = (id: string) => {
  const d = GROUP.find((a) => a.id === id);
  if (!d) throw new Error(`No tier 2 core adversary ${id}`);
  return d;
};
const effectOf = (adversaryId: string, feature: string): AdversaryFeatureEffect => {
  const e = T2_CORE_EFFECTS.find((x) => x.adversaryId === adversaryId && x.feature === feature);
  if (!e) throw new Error(`No entry for ${adversaryId}/${feature}`);
  return e;
};
const useOf = (adversaryId: string, feature: string, useId = "main") => effectOf(adversaryId, feature).uses.find((u) => u.id === useId)!;

const selfOf = (adversaryId: string, over: Partial<Combatant> = {}): Combatant => {
  const d = def(adversaryId);
  return {
    id: "self",
    side: "adversary",
    difficulty: d.difficulty,
    thresholds: d.thresholds,
    hp: 0,
    hpMax: d.hp,
    stress: 0,
    stressMax: d.stress ?? 0,
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
  thresholds: { major: 8, severe: 15 },
  hp: 0,
  hpMax: 5,
  stress: 1,
  stressMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const mira = pc("mira");
const bram = pc("bram", { evasion: 15 });

function context(adversaryId: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunContext {
  const d = def(adversaryId);
  return {
    adversaryId,
    self: selfOf(adversaryId),
    attack: d.attack,
    tier: 2,
    gmFear: 5,
    spotlit: true,
    fearConfirmed: true,
    rng: queueRng(dice),
    ...over,
  };
}

/** Runs one use with queued dice, refuses on a refusal and checks every die was used. */
function runUse(adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryPlan {
  const rng = queueRng(dice);
  const result = run(effectOf(adversaryId, feature), context(adversaryId, [], { ...over, rng }));
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}
const attempt = (adversaryId: string, feature: string, over: Partial<AdversaryRunContext> = {}): AdversaryRunResult =>
  run(effectOf(adversaryId, feature), context(adversaryId, [], over));

const ofKind = <K extends AdversaryPlanStep["kind"]>(plan: AdversaryPlan, kind: K) =>
  plan.steps.filter((s): s is Extract<AdversaryPlanStep, { kind: K }> => s.kind === kind);
const prompts = (plan: AdversaryPlan, prompt: "move" | "manual" | "pcSave") => ofKind(plan, "prompt").filter((p) => p.prompt === prompt);
const after = (plan: AdversaryPlan, id: string) => plan.creatures.find((c) => c.id === id)?.after;
const saveStep = (p: { step?: unknown }) => p.step as Extract<AdversaryStep, { kind: "save" }>;

const state = (over: Partial<AdversaryState> = {}): AdversaryState => ({ hp: 0, hpMax: 6, stress: 0, stressMax: 4, conditions: [], tokens: 0, ...over });
const effectsOf = (adversaryId: string) => T2_CORE_EFFECTS.filter((e) => e.adversaryId === adversaryId);

const fearOf = (costs: readonly AdversaryCost[] | undefined): number =>
  (costs ?? []).reduce((n, c) => n + (c.kind === "fear" && c.amount.kind === "fixed" ? c.amount.value : 0), 0);

// ---------------------------------------------------------------- the table

describe("the tier 2 core table", () => {
  it("has exactly one entry per printed feature of the 36 tier 2 core adversaries (108 features, Q15)", () => {
    const expected = GROUP.flatMap((a) => a.features.map((f) => `${a.id}/${f.name}`)).sort();
    const actual = T2_CORE_EFFECTS.map((e) => `${e.adversaryId}/${e.feature}`);
    expect(GROUP).toHaveLength(36);
    expect(expected).toHaveLength(108);
    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual(expected);
  });

  it("use ids are unique per feature; actions need the spotlight (except Lurching Lunge), passives, reactions and autos don't (CB p.194)", () => {
    for (const effect of T2_CORE_EFFECTS) {
      const ids = effect.uses.map((u) => u.id);
      expect(new Set(ids).size, effect.feature).toBe(ids.length);
      for (const u of effect.uses) {
        const expected = u.activation.kind === "action" && effect.feature !== "Lurching Lunge";
        expect(u.needsSpotlight, `${effect.adversaryId}/${effect.feature}:${u.id}`).toBe(expected);
        if (u.activation.kind === "passive") expect(u.steps, effect.feature).toEqual([]);
      }
    }
  });

  it("Fear costs match the stat block's printed Fear (Ramp Up's Fear is its spotlight cost)", () => {
    for (const a of GROUP) {
      for (const f of a.features) {
        const effect = effectOf(a.id, f.name);
        const fear = Math.max(0, ...effect.uses.map((u) => fearOf(u.costs)));
        if (f.name === "Ramp Up") {
          expect(fear).toBe(0);
          expect(effect.uses[0]!.modifiers).toEqual([{ kind: "spotlightCostsFear" }]);
        } else expect(fear, `${a.id}/${f.name}`).toBe(f.fearCost ?? 0);
      }
    }
  });

  it("every use of every entry runs through run() (dice at half their sides, all situations confirmed)", () => {
    const situations = new Set<string>();
    const collect = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(collect);
      else if (o && typeof o === "object") {
        const r = o as Record<string, unknown>;
        if (r.kind === "situation" && typeof r.text === "string") situations.add(r.text);
        Object.values(r).forEach(collect);
      }
    };
    collect(T2_CORE_EFFECTS);
    for (const effect of T2_CORE_EFFECTS) {
      for (const u of effect.uses) {
        const result = run(effect, {
          ...context(effect.adversaryId, []),
          self: selfOf(effect.adversaryId, { conditions: ["hidden"] }),
          useId: u.id,
          targets: [pc("a", { tags: ["Entranced"] })],
          picked: [pc("p")],
          allies: [ally("x")],
          followUp: [pc("a")],
          trigger: { amount: 2, source: pc("src"), subject: pc("sub") },
          situations: [...situations],
          rng: (sides: number) => Math.ceil(sides / 2),
        });
        expect(result.ok, `${effect.adversaryId}/${effect.feature}:${u.id} ${result.ok ? "" : result.detail}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- shared features

describe("shared features", () => {
  const minions = [
    ["apprentice-assassin", 6, 4],
    ["conscript", 6, 6],
    ["cult-initiate", 6, 5],
    ["giant-recruit", 7, 5],
  ] as const;

  it.each(minions)("%s: Minion (%i) is a passive Minion modifier (CB p.201)", (id, x) => {
    const plan = runUse(id, `Minion (${x})`, [], { spotlit: false });
    expect(plan).toMatchObject({ activation: "passive", needsSpotlight: false, modifiers: [{ kind: "minion", threshold: x }], gmFearDelta: 0 });
    expect(passiveSummary(effectsOf(id), state()).minion).toBe(x);
  });

  it.each(minions)("%s: Group Attack asks for a Fear, rolls once and combines %i… per Minion (AR9)", (id, _x, damage) => {
    expect(attempt(id, "Group Attack", { targets: [mira], fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    expect(attempt(id, "Group Attack", { targets: [mira], spotlit: false })).toMatchObject({ ok: false, code: "ADVERSARY_NOT_SPOTLIT" });
    const group = [selfOf(id, { id: "m2" }), selfOf(id, { id: "m3" })];
    const plan = runUse(id, "Group Attack", [16], { targets: [mira], group });
    expect(plan).toMatchObject({ fearSpent: 1, gmFearDelta: -1, group: ["m2", "m3"] });
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: damage * 3, type: "physical", direct: false, forcedArmor: 0, critical: false, attackTotal: 16 + Number(def(id).attack.modifier) }]);
    expect(prompts(plan, "move")).toHaveLength(1);
    expect(runUse(id, "Group Attack", [2], { targets: [mira], group }).incoming).toEqual([]);
  });

  it.each(["demonic-hound-pack", "giant-brawler", "gorgon", "master-assassin", "spectral-captain", "stonewraith"])(
    "%s: Momentum gains a Fear automatically on a hit, without the spotlight (CB p.195)",
    (id) => {
      const plan = runUse(id, "Momentum", [], { spotlit: false });
      expect(plan).toMatchObject({ activation: "auto", needsSpotlight: false, gmFearDelta: 1, fearSpent: 0 });
      const offered = triggeredUses(effectsOf(id), { kind: "onHit", attack: "standard" }, state());
      expect(offered.filter((t) => t.effect.feature === "Momentum").map((t) => t.mode)).toEqual(["auto"]);
    },
  );

  it.each([
    ["battle-box", 2],
    ["gorgon", 2],
    ["juvenile-flickerfly", 3],
  ] as const)("%s: Relentless (%i)", (id, x) => {
    expect(runUse(id, `Relentless (${x})`, []).modifiers).toEqual([{ kind: "relentless", times: x }]);
    expect(passiveSummary(effectsOf(id), state()).relentless).toBe(x);
  });

  it.each([
    ["archer-squadron", "1d6+3", [15, 4], 7],
    ["demonic-hound-pack", "2d4+1", [15, 2, 3], 6],
    ["electric-eels", "2d4+1", [15, 1, 1], 3],
  ] as const)("%s: Horde (%s) once half the HP is marked (CB p.199)", (id, x, dice, amount) => {
    expect(passiveSummary(effectsOf(id), state()).horde).toBe(x);
    const half = Math.ceil(def(id).hp / 2);
    const passives = passiveSummary(effectsOf(id), state({ hp: half, hpMax: def(id).hp }));
    const rng = queueRng([...dice]);
    const result = runStandardAttack(context(id, [], { self: selfOf(id, { hp: half }), passives, targets: [pc("t", { evasion: 1 })], rng }));
    expect(result.ok && result.plan.incoming[0]!.amount).toBe(amount);
    rng.done();
  });

  it.each(["spectral-archer", "spectral-captain", "spectral-guardian"])("%s: Ghost resists physical damage and moves through solid objects for a Stress", (id) => {
    expect(passiveSummary(effectsOf(id), state()).resistance).toEqual({ physical: "resistant", magic: "none" });
    const plan = runUse(id, "Ghost", [], { useId: "phase" });
    expect(plan).toMatchObject({ needsSpotlight: true, self: { after: { stress: 1 } } });
    expect(prompts(plan, "move")).toHaveLength(1);
  });

  it.each(["mortal-hunter", "shark"])("%s: Terrifying: every PC within Far loses a Hope and the GM gains a Fear on a hit", (id) => {
    const plan = runUse(id, "Terrifying", [], { spotlit: false, picked: [mira, bram] });
    expect(plan.activation).toBe("auto");
    expect(ofKind(plan, "hope")).toEqual([
      { kind: "hope", targetId: "mira", delta: -1 },
      { kind: "hope", targetId: "bram", delta: -1 },
    ]);
    expect(plan.gmFearDelta).toBe(1);
  });
});

// ---------------------------------------------------------------- adversary by adversary

describe("Archer Squadron (CB p.220)", () => {
  it("Focused Volley: a Fear, one roll with advantage against everyone within Close of a point, 1d10+4", () => {
    // d20s 5 and 14 keep 14 (+0 ATK): hits Mira (12), misses Bram (15); 1d10 6 + 4 = 10.
    const plan = runUse("archer-squadron", "Focused Volley", [5, 14, 6], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(plan.roll!.record.total).toBe(14);
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: 10, type: "physical", direct: false, forcedArmor: 0, critical: false, attackTotal: 14 }]);
  });

  it("Suppressing Fire: a Stress, the lasting zone is a manual step", () => {
    const plan = runUse("archer-squadron", "Suppressing Fire", []);
    expect(plan.self.after.stress).toBe(1);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Agility Reaction Roll/);
  });
});

describe("Assassin Poisoner (CB p.220)", () => {
  it("Grindletooth Venom: a target who marks HP from its attacks becomes Vulnerable until they clear a HP", () => {
    const plan = runUse("assassin-poisoner", "Grindletooth Venom", [], { spotlit: false, trigger: { subject: mira } });
    expect(plan.activation).toBe("auto");
    expect(after(plan, "mira")!.conditions).toEqual(["vulnerable"]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ duration: "manual", endsWhen: "they clear a HP" });
    const u = useOf("assassin-poisoner", "Grindletooth Venom");
    expect(u.activation.kind === "auto" && matchesTrigger(u.activation.trigger, { kind: "onTargetMarksHp", attack: "feature" })).toBe(true);
  });

  it("Out of Nowhere: advantage on attacks only while Hidden", () => {
    expect(attempt("assassin-poisoner", "Out of Nowhere")).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("assassin-poisoner", "Out of Nowhere", [], { self: selfOf("assassin-poisoner", { conditions: ["hidden"] }) });
    expect(plan.modifiers).toEqual([{ kind: "mod", mod: { kind: "advantage", on: "attack" } }]);
  });

  it("Fumigation: everyone within Close is Dizzied until their next roll (the disadvantage is manual)", () => {
    const plan = runUse("assassin-poisoner", "Fumigation", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(0);
    expect(ofKind(plan, "condition").map((c) => [c.targetId, c.duration])).toEqual([
      ["mira", "nextRoll"],
      ["bram", "nextRoll"],
    ]);
    expect(after(plan, "mira")!.tags).toEqual(["Dizzied"]);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });
});

describe("Battle Box (CB p.221)", () => {
  const tactics = (dice: number[], followUp: Combatant[] = [mira]) => runUse("battle-box", "Randomized Tactics", dice, { followUp });

  it("Randomized Tactics 1, Mana Beam: d20 + 2 against one target, 2d10+2 magic", () => {
    const plan = tactics([1, 10, 3, 4]);
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "check")[0]).toMatchObject({ dice: [1], passed: true });
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: 9, type: "magic", direct: false, forcedArmor: 0, critical: false }]);
    expect(tactics([1, 9]).incoming).toEqual([]); // 9 + 2 = 11 misses Evasion 12
  });

  it("Randomized Tactics 2, Fire Jets: 2d8 physical against everyone within Close it hits", () => {
    const plan = tactics([2, 10, 3, 3], [mira, bram]);
    expect(ofKind(plan, "check").map((c) => c.passed)).toEqual([false, true]);
    expect(plan.incoming.map((h) => [h.targetId, h.amount, h.type])).toEqual([["mira", 6, "physical"]]);
  });

  it("Randomized Tactics 3, Trample: 1d6+5 physical and Vulnerable until their next roll with Hope", () => {
    const plan = tactics([3, 10, 2]);
    expect(plan.incoming[0]).toMatchObject({ targetId: "mira", amount: 7 });
    expect(after(plan, "mira")!.conditions).toEqual(["vulnerable"]);
  });

  it.each([
    [4, "finesse"],
    [5, "strength"],
    [6, "presence"],
  ] as const)("Randomized Tactics %i: the targets make a %s reaction roll against the Box's Difficulty", (d6, trait) => {
    const plan = tactics([d6], [mira, bram]);
    const saves = prompts(plan, "pcSave");
    expect(saves.map((s) => s.targetIds[0])).toEqual(["mira", "bram"]);
    expect(saveStep(saves[0]!)).toMatchObject({ trait, difficulty: { kind: "actorDifficulty" } });
  });

  it("Randomized Tactics 6: Psionic Whine's failure is 2d4+9 direct magic damage", () => {
    const step = saveStep(prompts(tactics([6]), "pcSave")[0]!);
    expect(step.onFail).toEqual([{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: { kind: "fixed", value: 2 }, sides: 4, plus: { kind: "fixed", value: 9 } } }, type: "magic", direct: true }]);
  });

  it("Overcharge: before damage, a Stress adds a d6 to the damage roll, and the GM gains a Fear", () => {
    // The server passes the attack's targets (the damage the d6 rides on).
    const plan = runUse("battle-box", "Overcharge", [4], { spotlit: false, targets: [mira] });
    expect(plan).toMatchObject({ activation: "reaction", gmFearDelta: 1, self: { after: { stress: 1 } } });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyDamage" }, amount: 4 });
  });

  it("Death Quake: when it marks its last HP, everyone within Close makes an Instinct reaction roll or takes 2d8+1 magic", () => {
    const u = useOf("battle-box", "Death Quake");
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, { kind: "onMarkHp", stage: "did", amount: 2, last: true })).toBe(true);
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, { kind: "onMarkHp", stage: "did", amount: 2, last: false })).toBe(false);
    const plan = runUse("battle-box", "Death Quake", [], { spotlit: false, targets: [mira, bram] });
    expect(prompts(plan, "pcSave").map((s) => saveStep(s).trait)).toEqual(["instinct", "instinct"]);
  });
});

describe("Chaos Skull (CB p.221)", () => {
  it("Levitation and Wards: flying, can't be Restrained, resistant to magic", () => {
    const summary = passiveSummary(effectsOf("chaos-skull"), state());
    expect(summary.flags).toEqual(["flying", "cannotBeRestrained"]);
    expect(summary.resistance).toEqual({ physical: "none", magic: "resistant" });
  });

  it("Magic Burst: a Stress, 2d6+4 magic to everyone within Close it hits", () => {
    const plan = runUse("chaos-skull", "Magic Burst", [10, 3, 4], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    expect(plan.incoming.map((h) => [h.targetId, h.amount, h.type])).toEqual([["mira", 11, "magic"]]);
  });

  it("Siphon Magic: a Fear; on a hit the target marks 1d4 Stress, the Skull clears that many and can be spotlighted again", () => {
    const plan = runUse("chaos-skull", "Siphon Magic", [15, 3], { targets: [mira], self: selfOf("chaos-skull", { stress: 3 }) });
    expect(plan.fearSpent).toBe(1);
    expect(after(plan, "mira")!.stress).toBe(3);
    expect(plan.self.after.stress).toBe(0);
    expect(ofKind(plan, "spotlight")).toEqual([{ kind: "spotlight", who: "self", note: "The Skull can immediately be spotlighted again" }]);
    const miss = runUse("chaos-skull", "Siphon Magic", [5], { targets: [mira] });
    expect(miss.creatures).toEqual([]);
    expect(ofKind(miss, "spotlight")).toEqual([]);
  });
});

describe("Courtesan (CB p.221)", () => {
  it("Searing Glance: on the PC's failed Presence Roll, a Stress makes them mark 2 Stress and Vulnerable for the scene", () => {
    const fail = useOf("courtesan", "Searing Glance", "on-failure");
    const roll = { kind: "action" as const, trait: "presence" as const, success: false, withHope: true, withFear: false };
    expect(fail.activation.kind === "reaction" && matchesTrigger(fail.activation.trigger, { kind: "pcRolls", roll })).toBe(true);
    expect(fail.activation.kind === "reaction" && matchesTrigger(fail.activation.trigger, { kind: "pcRolls", roll: { ...roll, success: true } })).toBe(false);
    const plan = runUse("courtesan", "Searing Glance", [], { useId: "on-failure", spotlit: false, trigger: { subject: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(after(plan, "mira")).toMatchObject({ stress: 2, conditions: ["vulnerable"] });
    expect(ofKind(plan, "condition")[0]!.duration).toBe("scene");
  });

  it("Searing Glance: on the PC's success they mark a Stress", () => {
    const plan = runUse("courtesan", "Searing Glance", [], { useId: "on-success", spotlit: false, trigger: { subject: mira } });
    expect(after(plan, "mira")!.stress).toBe(1);
  });
});

describe("Cult Adept (CB p.222)", () => {
  it("Enervating Blast: a Fear, its standard attack (2d4+3 magic) and a Stress on a hit", () => {
    const plan = runUse("cult-adept", "Enervating Blast", [12, 2, 3], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(plan.incoming[0]).toMatchObject({ targetId: "mira", amount: 8, type: "magic" });
    expect(after(plan, "mira")!.stress).toBe(1);
  });

  it("Shroud of the Fallen: a Stress; an ally within Close resists all damage until the Adept marks their last HP", () => {
    const plan = runUse("cult-adept", "Shroud of the Fallen", [], { targets: [ally("guard")] });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "effect")).toEqual([
      { kind: "effect", targetId: "guard", label: "Protected", mods: [{ kind: "resistance", type: "both", level: "resistant" }], duration: "manual", endsWhen: "the Cult Adept marks their last HP" },
    ]);
  });

  it("Shadow Shackles: a Fear; everyone within Close of a point is Restrained (the Hope to act is manual)", () => {
    const plan = runUse("cult-adept", "Shadow Shackles", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(after(plan, "bram")!.conditions).toEqual(["restrained"]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/spend a Hope/);
  });

  it("Fear Is Fuel: twice per scene, a PC's failure with Fear clears a Stress", () => {
    const u = useOf("cult-adept", "Fear Is Fuel");
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, { kind: "pcRolls", roll: { kind: "action", success: false, withHope: false, withFear: true } })).toBe(true);
    const self = selfOf("cult-adept", { stress: 3 });
    const first = runUse("cult-adept", "Fear Is Fuel", [], { spotlit: false, self });
    expect(first.self.after.stress).toBe(2);
    const second = runUse("cult-adept", "Fear Is Fuel", [], { spotlit: false, self, featureUses: first.self.featureUses });
    expect(attempt("cult-adept", "Fear Is Fuel", { self, featureUses: second.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Cult Fang (CB p.222)", () => {
  it("Shadow's Embrace: climbing has no modifier; a Stress moves it shadow to shadow within Far on its spotlight", () => {
    expect(runUse("cult-fang", "Shadow's Embrace", [], { useId: "climb" }).modifiers).toEqual([]);
    expect(attempt("cult-fang", "Shadow's Embrace", { useId: "shadow-step", spotlit: false })).toMatchObject({ ok: false, reason: "spotlight" });
    const plan = runUse("cult-fang", "Shadow's Embrace", [], { useId: "shadow-step" });
    expect(plan.self.after.stress).toBe(1);
    expect(prompts(plan, "move")[0]!.text).toMatch(/shadow/);
  });

  it("Pick Off the Straggler: a Stress; the target in Melee makes an Instinct reaction roll", () => {
    const plan = runUse("cult-fang", "Pick Off the Straggler", [], { targets: [mira] });
    expect(plan.self.after.stress).toBe(1);
    const step = saveStep(prompts(plan, "pcSave")[0]!);
    expect(step.trait).toBe("instinct");
    expect(step.onFail.map((s) => s.kind)).toEqual(["markStress", "move", "condition"]);
    expect(step.onSuccess).toEqual([{ kind: "markStress", to: "targets", amount: { kind: "fixed", value: 1 } }]);
  });
});

describe("Demonic Hound Pack (CB p.222)", () => {
  it("Dreadhowl: a Stress; everyone within Very Close loses a Hope (the no-Hope fallback is manual)", () => {
    const plan = runUse("demonic-hound-pack", "Dreadhowl", [], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "hope").map((h) => [h.targetId, h.delta])).toEqual([
      ["mira", -1],
      ["bram", -1],
    ]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/2 Stress/);
  });
});

describe("Electric Eels (CB p.222)", () => {
  it("Paralyzing Shock: a Stress, its standard attack against everyone within Very Close; the Fear per HP is manual", () => {
    const plan = runUse("electric-eels", "Paralyzing Shock", [13, 2, 3], { targets: [mira, pc("cass", { evasion: 14 })] });
    expect(plan.self.after.stress).toBe(1);
    expect(plan.incoming.map((h) => [h.targetId, h.amount])).toEqual([["mira", 9]]);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });
});

describe("Elite Soldier (CB p.222)", () => {
  it("Reinforce: a Stress, move to an ally, attack within Very Close for 2d10+2; the ally clears a Stress on a hit", () => {
    const plan = runUse("elite-soldier", "Reinforce", [11, 5, 5], { targets: [mira], picked: [ally("captain")] });
    expect(plan.incoming[0]).toMatchObject({ targetId: "mira", amount: 12, type: "physical" });
    expect(after(plan, "captain")!.stress).toBe(0);
    expect(prompts(plan, "move")).toHaveLength(1);
  });

  it("Vassal's Loyalty: a Stress to take the damage instead (a redirect fold)", () => {
    const plan = runUse("elite-soldier", "Vassal's Loyalty", [], { spotlit: false });
    expect(plan.activation).toBe("reaction");
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "redirectDamage", target: "self" });
  });
});

describe("Failed Experiment (CB p.223)", () => {
  it("Warped Fortitude: resistant to physical damage", () => {
    expect(passiveSummary(effectsOf("failed-experiment"), state()).resistance).toEqual({ physical: "resistant", magic: "none" });
  });

  it("Overwhelm: double damage while another adversary is within Very Close of the target", () => {
    expect(attempt("failed-experiment", "Overwhelm", { spotlit: false, allyWithin: () => false })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("failed-experiment", "Overwhelm", [], { spotlit: false, targets: [mira], allyWithin: (req) => req.of === "target" && req.range === "veryClose" });
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyDamage", change: { kind: "multiply", factor: 2 } });
  });

  it("Lurching Lunge: a Stress spotlights it without Fear (no spotlight needed)", () => {
    const plan = runUse("failed-experiment", "Lurching Lunge", [], { spotlit: false });
    expect(plan).toMatchObject({ needsSpotlight: false, fearSpent: 0, self: { after: { stress: 1 } } });
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "self" });
  });
});

describe("Giant Beastmaster (CB p.223)", () => {
  it("Two as One: when spotlighted, the GM may also spotlight one animal under its control", () => {
    const plan = runUse("giant-beastmaster", "Two as One", [], { spotlit: false });
    expect(plan.activation).toBe("reaction");
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "picked", count: 1 });
  });

  it("Pinning Strike: its standard attack; on a hit an optional Stress Restrains the target", () => {
    const plain = runUse("giant-beastmaster", "Pinning Strike", [12, 3, 4], { targets: [mira] });
    expect(plain.incoming[0]).toMatchObject({ amount: 11, type: "physical" });
    expect(plain.self.after.stress).toBe(0);
    const pinned = runUse("giant-beastmaster", "Pinning Strike", [12, 3, 4], { targets: [mira], optionals: ["pin"] });
    expect(pinned.self.after.stress).toBe(1);
    expect(after(pinned, "mira")!.conditions).toEqual(["restrained"]);
  });

  it("Deadly Companion: twice per scene, summon an animal at Close range, spotlighted at once", () => {
    const first = runUse("giant-beastmaster", "Deadly Companion", []);
    expect(ofKind(first, "summon")).toEqual([{ kind: "summon", label: "A Bear, Dire Wolf, or similar Tier 1 animal", count: 1, range: "close" }]);
    expect(ofKind(first, "spotlight")).toHaveLength(1);
    const second = runUse("giant-beastmaster", "Deadly Companion", [], { featureUses: first.self.featureUses });
    expect(attempt("giant-beastmaster", "Deadly Companion", { featureUses: second.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Giant Brawler (CB p.223)", () => {
  it("Battering Ram: a Stress; everyone within Very Close of the object makes an Agility reaction roll", () => {
    const plan = runUse("giant-brawler", "Battering Ram", [], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    expect(prompts(plan, "pcSave").map((s) => saveStep(s).trait)).toEqual(["agility", "agility"]);
  });

  it("Bloody Reprisal: after 2+ HP from an attack within Very Close, a standard attack against the attacker for 2d6+15", () => {
    const u = useOf("giant-brawler", "Bloody Reprisal");
    const event = { kind: "onMarkHp" as const, stage: "did" as const, amount: 2, last: false, fromAttack: true, attackerBand: "veryClose" as const };
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, event)).toBe(true);
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, { ...event, amount: 1 })).toBe(false);
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, { ...event, attackerBand: "far" })).toBe(false);
    const plan = runUse("giant-brawler", "Bloody Reprisal", [10, 3, 4], { spotlit: false, trigger: { source: mira } });
    expect(plan.incoming[0]).toMatchObject({ targetId: "mira", amount: 22 });
  });
});

describe("Giant Eagle (CB p.223)", () => {
  it("Flight: +3 Difficulty only while flying", () => {
    expect(passiveSummary(effectsOf("giant-eagle"), state()).difficulty).toBe(0);
    const flying = passiveSummary(effectsOf("giant-eagle"), state({ situations: ["While flying"] }));
    expect(flying).toMatchObject({ difficulty: 3, flags: ["flying"] });
  });

  it("Deadly Dive: a Stress, attack within Far for 2d10+2 and Vulnerable until they next act", () => {
    const plan = runUse("giant-eagle", "Deadly Dive", [11, 4, 6], { targets: [mira] });
    expect(plan.incoming[0]).toMatchObject({ amount: 12 });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "mira", endsWhen: "they next act" });
  });

  it("Take Off: 2d4+3 on a hit, then an Agility reaction roll against being carried off", () => {
    const plan = runUse("giant-eagle", "Take Off", [11, 2, 3], { targets: [mira] });
    expect(plan.incoming[0]).toMatchObject({ amount: 8 });
    expect(saveStep(prompts(plan, "pcSave")[0]!).trait).toBe("agility");
    expect(prompts(runUse("giant-eagle", "Take Off", [5], { targets: [mira] }), "pcSave")).toEqual([]);
  });

  it("Deadly Drop: only while flying; the held target is no longer Restrained and the fall is manual", () => {
    expect(attempt("giant-eagle", "Deadly Drop", { targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("giant-eagle", "Deadly Drop", [], { targets: [pc("held", { conditions: ["restrained"] })], situations: ["While flying"] });
    expect(after(plan, "held")!.conditions).toEqual([]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/2d20/);
  });
});

describe("Gorgon (CB p.224)", () => {
  it("Sunsear Arrows: a hit with its standard attack makes the target Glow for the scene", () => {
    const u = useOf("gorgon", "Sunsear Arrows");
    expect(u.activation.kind === "auto" && matchesTrigger(u.activation.trigger, { kind: "onHit", attack: "feature" })).toBe(false);
    const plan = runUse("gorgon", "Sunsear Arrows", [], { spotlit: false, trigger: { subject: mira } });
    expect(after(plan, "mira")!.tags).toEqual(["Glowing"]);
    expect(ofKind(plan, "condition")[0]!.duration).toBe("scene");
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Crown of Serpents: on a hit, a Stress pays for 2d10+4 and a Stress on the target; no Stress, no damage", () => {
    const plan = runUse("gorgon", "Crown of Serpents", [8, 5, 5], { targets: [mira] });
    expect(plan.self.after.stress).toBe(1);
    expect(plan.incoming[0]).toMatchObject({ amount: 14 });
    expect(after(plan, "mira")!.stress).toBe(1);
    const spent = runUse("gorgon", "Crown of Serpents", [8], { targets: [mira], self: selfOf("gorgon", { stress: 3 }) });
    expect(spent.incoming).toEqual([]);
    expect(ofKind(spent, "pay")[0]).toMatchObject({ paid: false });
  });

  it("Petrifying Gaze: a Fear makes the attacker roll Instinct; failure marks a HP and starts Petrification (4)", () => {
    const plan = runUse("gorgon", "Petrifying Gaze", [], { useId: "gaze", spotlit: false, trigger: { source: mira } });
    expect(plan.fearSpent).toBe(1);
    expect(prompts(plan, "pcSave")[0]!.targetIds).toEqual(["mira"]);
    // The entry's failure branch; inside the pcSave prompt the runner hands the countdown on as a placeholder (QUESTIONS).
    const gaze = useOf("gorgon", "Petrifying Gaze", "gaze").steps[0] as Extract<AdversaryStep, { kind: "save" }>;
    expect(gaze.onFail).toMatchObject([{ kind: "markHp" }, { kind: "countdown", op: "start", label: "Petrification", start: { kind: "fixed", value: 4 } }]);
    expect(ofKind(runUse("gorgon", "Petrifying Gaze", [], { useId: "tick", spotlit: false }), "countdown")[0]).toMatchObject({ op: "tick", label: "Petrification", amount: 1 });
    expect(ofKind(runUse("gorgon", "Petrifying Gaze", [], { useId: "end", spotlit: false }), "countdown")[0]).toMatchObject({ op: "prompt", label: "Petrification" });
  });
});

describe("Juvenile Flickerfly (CB p.224)", () => {
  it("Peerless Accuracy: before its attack a d6 of 4+ halves the target's Evasion (manual)", () => {
    expect(prompts(runUse("juvenile-flickerfly", "Peerless Accuracy", [4], { spotlit: false }), "manual")).toHaveLength(1);
    expect(prompts(runUse("juvenile-flickerfly", "Peerless Accuracy", [3], { spotlit: false }), "manual")).toEqual([]);
  });

  it("Mind Dance: a Stress; everyone within Close rolls Instinct; each failure gains a Fear", () => {
    const plan = runUse("juvenile-flickerfly", "Mind Dance", [], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    const saves = prompts(plan, "pcSave");
    expect(saves).toHaveLength(2);
    expect(saveStep(saves[0]!).onFail[0]).toEqual({ kind: "fear", to: "self", change: "gain", amount: { kind: "fixed", value: 1 } });
  });

  it("Hallucinatory Breath: first damage starts a looping 1d6 countdown; the breath makes Instinct reaction rolls", () => {
    const start = runUse("juvenile-flickerfly", "Hallucinatory Breath", [5], { useId: "activate", spotlit: false });
    expect(ofKind(start, "countdown")[0]).toMatchObject({ op: "start", start: 5, loop: true });
    const breath = runUse("juvenile-flickerfly", "Hallucinatory Breath", [], { useId: "breath", spotlit: false, targets: [mira, bram] });
    expect(saveStep(prompts(breath, "pcSave")[0]!).onFail.map((s) => s.kind)).toEqual(["markStress", "hope"]);
  });
});

describe("Knight of the Realm (CB p.224)", () => {
  const mounted = ["While the Knight is on a mount"];

  it("Chevalier: +2 Difficulty while mounted; Severe damage knocks it off (manual)", () => {
    expect(passiveSummary(effectsOf("knight-of-the-realm"), state()).difficulty).toBe(0);
    expect(passiveSummary(effectsOf("knight-of-the-realm"), state({ situations: mounted })).difficulty).toBe(2);
    const u = useOf("knight-of-the-realm", "Chevalier", "unhorsed");
    expect(u.activation.kind === "auto" && matchesTrigger(u.activation.trigger, { kind: "onDamaged", stage: "did", severity: "severe" })).toBe(true);
    expect(u.activation.kind === "auto" && matchesTrigger(u.activation.trigger, { kind: "onDamaged", stage: "did", severity: "major" })).toBe(false);
    expect(prompts(runUse("knight-of-the-realm", "Chevalier", [], { useId: "unhorsed", spotlit: false, situations: mounted }), "manual")).toHaveLength(1);
  });

  it("Heavily Armored: physical damage it would take is reduced by 3", () => {
    const u = useOf("knight-of-the-realm", "Heavily Armored");
    expect(u.activation.kind === "auto" && matchesTrigger(u.activation.trigger, { kind: "onDamaged", stage: "would", damageType: "physical" })).toBe(true);
    expect(u.activation.kind === "auto" && matchesTrigger(u.activation.trigger, { kind: "onDamaged", stage: "would", damageType: "magic" })).toBe(false);
    expect(ofKind(runUse("knight-of-the-realm", "Heavily Armored", [], { spotlit: false }), "fold")[0]).toMatchObject({ step: { kind: "reduceDamage" }, amount: 3 });
  });

  it("Cavalry Charge: mounted only; 2d8+4 and a Stress on a hit", () => {
    expect(attempt("knight-of-the-realm", "Cavalry Charge", { targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("knight-of-the-realm", "Cavalry Charge", [8, 2, 3], { targets: [mira], situations: mounted });
    expect(plan.incoming[0]).toMatchObject({ amount: 9 });
    expect(after(plan, "mira")!.stress).toBe(1);
  });

  it("For the Realm!: a Stress spotlights 1d4+1 allies, whose attacks deal half damage", () => {
    const plan = runUse("knight-of-the-realm", "For the Realm!", [2], { allies: [ally("a1"), ally("a2")] });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "allies", count: 3 });
    expect(ofKind(plan, "effect").map((e) => [e.targetId, e.mods])).toEqual([
      ["a1", [{ kind: "flag", flag: "halfDamage" }]],
      ["a2", [{ kind: "flag", flag: "halfDamage" }]],
    ]);
  });
});

describe("Masked Thief (CB p.225)", () => {
  it("Quick Hands: 1d8+2 and a stolen item (manual) on a hit", () => {
    const plan = runUse("masked-thief", "Quick Hands", [9, 4], { targets: [mira] });
    expect(plan.incoming[0]).toMatchObject({ amount: 6 });
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Escape Plan: a Stress; everyone near the trap makes an Agility Reaction Roll (13)", () => {
    const plan = runUse("masked-thief", "Escape Plan", [], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    const step = saveStep(prompts(plan, "pcSave")[0]!);
    expect(step).toMatchObject({ trait: "agility", difficulty: { kind: "fixed", value: 13 } });
    expect(step.onFail.map((s) => (s.kind === "condition" && s.condition.kind === "standard" ? s.condition.condition : s.kind))).toEqual(["restrained", "vulnerable"]);
  });
});

describe("Master Assassin (CB p.220)", () => {
  it("Won't See It Coming: its attacks deal direct damage while Hidden", () => {
    expect(passiveSummary(effectsOf("master-assassin"), state()).directAttacks).toBe(false);
    const passives = passiveSummary(effectsOf("master-assassin"), state({ conditions: ["hidden"] }));
    expect(passives.directAttacks).toBe(true);
    const rng = queueRng([10, 3, 4]);
    const result = runStandardAttack(context("master-assassin", [], { passives, targets: [mira], rng }));
    expect(result.ok && result.plan.incoming[0]).toMatchObject({ amount: 9, direct: true });
  });

  it("Strike as One: a Stress spotlights as many other Assassins as its unmarked Stress (after paying)", () => {
    const plan = runUse("master-assassin", "Strike as One", []);
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "allies", name: "Assassin", count: 4 });
    expect(ofKind(runUse("master-assassin", "Strike as One", [], { self: selfOf("master-assassin", { stress: 2 }) }), "spotlight")[0]!.count).toBe(2);
  });

  it("The Subtle Blade: a Fear turns a standard-attack hit on a Vulnerable target into Severe damage", () => {
    const u = useOf("master-assassin", "The Subtle Blade");
    const event = { kind: "onHit" as const, attack: "standard" as const, target: { conditions: ["vulnerable"] } };
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, event)).toBe(true);
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, { ...event, target: { conditions: [] } })).toBe(false);
    const plan = runUse("master-assassin", "The Subtle Blade", [], { spotlit: false, trigger: { subject: mira } });
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyDamage", change: { kind: "minimumSeverity", severity: "severe" } });
  });
});

describe("Merchant Baron (CB p.225)", () => {
  it("Everyone Has a Price: a Fear; a PC makes a Presence Reaction Roll (17) or marks 2 Stress / takes the deal", () => {
    const plan = runUse("merchant-baron", "Everyone Has a Price", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    const step = saveStep(prompts(plan, "pcSave")[0]!);
    expect(step).toMatchObject({ trait: "presence", difficulty: { kind: "fixed", value: 17 } });
    expect(step.onFail[0]).toMatchObject({ kind: "choose", id: "price" });
  });

  it("The Best Muscle Money Can Buy: once per scene, a Stress summons 1d4+1 Tier 1 adversaries at Far range", () => {
    const plan = runUse("merchant-baron", "The Best Muscle Money Can Buy", [3]);
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "summon")[0]).toMatchObject({ count: 4, range: "far" });
    expect(attempt("merchant-baron", "The Best Muscle Money Can Buy", { featureUses: plan.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Minotaur Wrecker (CB p.225)", () => {
  it("Ramp Up: every spotlight costs a Fear; while spotlit its standard attack hits everyone in range, with no Fear of its own", () => {
    expect(passiveSummary(effectsOf("minotaur-wrecker"), state()).spotlightCostsFear).toBe(true);
    expect(spotlightCost({ spotlightsThisTurn: 0, instanceSpotlights: 0, relentless: null, costsFear: true }).fear).toBe(1);
    const plan = runUse("minotaur-wrecker", "Ramp Up", [10, 3, 3], { useId: "sweep", fearConfirmed: false, targets: [mira, pc("cass")] });
    expect(plan.fearSpent).toBe(0);
    expect(plan.incoming.map((h) => [h.targetId, h.amount])).toEqual([
      ["mira", 11],
      ["cass", 11],
    ]);
  });

  it("Charging Bull: a Stress, 2d6+8 to everyone in its path it hits, knocked back; +1d6 combined for a collision", () => {
    const plan = runUse("minotaur-wrecker", "Charging Bull", [10, 3, 3, 4], { targets: [mira, pc("cass")], optionals: ["collision"], picked: [mira] });
    expect(plan.incoming.map((h) => [h.targetId, h.amount])).toEqual([
      ["mira", 18],
      ["cass", 14],
    ]);
    expect(prompts(plan, "move")[0]).toMatchObject({ targetIds: ["mira", "cass"] });
  });

  it("Gore: 2d8 direct physical on a hit", () => {
    const plan = runUse("minotaur-wrecker", "Gore", [10, 3, 4], { targets: [mira] });
    expect(plan.incoming[0]).toMatchObject({ amount: 7, direct: true, type: "physical" });
  });
});

describe("Mortal Hunter (CB p.225)", () => {
  it("Deathlock: a Fear curses a target for the scene (its direct damage is manual)", () => {
    const plan = runUse("mortal-hunter", "Deathlock", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(after(plan, "mira")!.tags).toEqual(["Deathlocked"]);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Inevitable Death: a Stress spotlights 1d4 allies at half damage", () => {
    const plan = runUse("mortal-hunter", "Inevitable Death", [3], { allies: [ally("a1")] });
    expect(ofKind(plan, "spotlight")[0]!.count).toBe(3);
    expect(ofKind(plan, "effect")).toHaveLength(1);
  });

  it("Rampage: first spotlight starts a looping 1d6 countdown; when it triggers, attack everyone in its path for 2d8+2", () => {
    const u = useOf("mortal-hunter", "Rampage", "activate");
    expect(u.activation.kind === "reaction" && matchesTrigger(u.activation.trigger, { kind: "onSpotlight", first: { scene: true, ever: true }, tokens: 0 })).toBe(true);
    expect(ofKind(runUse("mortal-hunter", "Rampage", [2], { useId: "activate", spotlit: false }), "countdown")[0]).toMatchObject({ start: 2, loop: true });
    const plan = runUse("mortal-hunter", "Rampage", [7, 3, 3], { useId: "rampage", spotlit: false, targets: [mira] });
    expect(plan.incoming[0]).toMatchObject({ amount: 8 });
  });
});

describe("Royal Advisor (CB p.225)", () => {
  it("Devastating Retort: a PC's action roll below 17 against it marks a Stress", () => {
    const u = useOf("royal-advisor", "Devastating Retort");
    const roll = { kind: "action" as const, success: true, withHope: true, withFear: false, total: 16 };
    expect(u.activation.kind === "auto" && matchesTrigger(u.activation.trigger, { kind: "pcRolls", roll, againstSelf: true })).toBe(true);
    expect(u.activation.kind === "auto" && matchesTrigger(u.activation.trigger, { kind: "pcRolls", roll: { ...roll, total: 17 }, againstSelf: true })).toBe(false);
    expect(after(runUse("royal-advisor", "Devastating Retort", [], { spotlit: false, trigger: { subject: mira } }), "mira")!.stress).toBe(1);
  });

  it("Bend Ears (a Stress) and Scapegoat (a Fear) are social, manual steps", () => {
    const bend = runUse("royal-advisor", "Bend Ears", []);
    expect(bend.self.after.stress).toBe(1);
    expect(prompts(bend, "manual")).toHaveLength(1);
    const scapegoat = runUse("royal-advisor", "Scapegoat", []);
    expect(scapegoat.fearSpent).toBe(1);
    expect(prompts(scapegoat, "manual")[0]!.text).toMatch(/Presence Roll \(17\)/);
  });
});

describe("Secret-Keeper (CB p.226)", () => {
  it("Seize Your Moment: asks for 2 Fear, then spotlights 1d4 allies at half damage", () => {
    expect(attempt("secret-keeper", "Seize Your Moment", { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "2" });
    const plan = runUse("secret-keeper", "Seize Your Moment", [4], { allies: [ally("a1")] });
    expect(plan).toMatchObject({ fearSpent: 2, gmFearDelta: -2 });
    expect(ofKind(plan, "spotlight")[0]!.count).toBe(4);
  });

  it("Our Master's Will: spotlighting an ally within Far, a Stress gains a Fear", () => {
    const plan = runUse("secret-keeper", "Our Master's Will", [], { spotlit: false });
    expect(plan).toMatchObject({ gmFearDelta: 1, self: { after: { stress: 1 } } });
  });

  it("Summoning Ritual: first spotlight starts Countdown (6); its HP ticks it; when it triggers a Minor Demon appears", () => {
    expect(ofKind(runUse("secret-keeper", "Summoning Ritual", [], { useId: "activate", spotlit: false }), "countdown")[0]).toMatchObject({ op: "start", start: 6, loop: false });
    const tick = runUse("secret-keeper", "Summoning Ritual", [], { useId: "tick", spotlit: false, trigger: { amount: 2 } });
    expect(ofKind(tick, "countdown")[0]).toMatchObject({ op: "tick", label: "Summoning Ritual" });
    expect(useOf("secret-keeper", "Summoning Ritual", "tick").steps[0]).toMatchObject({ amount: { kind: "triggerAmount" } });
    expect(ofKind(runUse("secret-keeper", "Summoning Ritual", [], { useId: "summon", spotlit: false }), "summon")[0]).toMatchObject({ adversaryId: "minor-demon", count: 1, range: "close" });
  });

  it("Fallen Hounds: once per scene after 2+ HP, a Stress summons a Demonic Hound Pack, spotlighted at once", () => {
    const plan = runUse("secret-keeper", "Fallen Hounds", [], { spotlit: false });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "summon")[0]).toMatchObject({ adversaryId: "demonic-hound-pack", count: 1 });
    expect(attempt("secret-keeper", "Fallen Hounds", { featureUses: plan.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Shark (CB p.226)", () => {
  it("Rending Bite: a hit forces an Armor Slot without its benefit (no free slot: manual extra HP)", () => {
    const plan = runUse("shark", "Rending Bite", [], { spotlit: false, trigger: { subject: mira } });
    expect(ofKind(plan, "mark")[0]).toMatchObject({ targetId: "mira", track: "armor", amount: 1, noBenefit: true });
    expect(after(plan, "mira")!.armor).toBe(1);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Blood in the Water: a Stress spotlights it and makes a standard attack against the creature who marked HP", () => {
    const plan = runUse("shark", "Blood in the Water", [10, 5, 6], { spotlit: false, trigger: { subject: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "self" });
    expect(plan.incoming[0]).toMatchObject({ targetId: "mira", amount: 12 });
  });
});

describe("Siren (CB p.226)", () => {
  it("Captive Audience: against an Entranced target the attack deals 2d10+1; against anyone else, nothing", () => {
    const plan = runUse("siren", "Captive Audience", [10, 4, 5], { targets: [pc("dazed", { tags: ["Entranced"] })] });
    expect(plan.incoming[0]).toMatchObject({ targetId: "dazed", amount: 10 });
    expect(runUse("siren", "Captive Audience", [10], { targets: [mira] }).incoming).toEqual([]);
  });

  it("Enchanting Song: a Fear; everyone within Close rolls Instinct or is Entranced (Vulnerable, can't act)", () => {
    const plan = runUse("siren", "Enchanting Song", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(prompts(plan, "manual")).toHaveLength(1);
    const step = saveStep(prompts(plan, "pcSave")[0]!);
    expect(step.onFail[0]).toMatchObject({ kind: "condition", condition: { kind: "tag", tag: "Entranced", implies: ["vulnerable"] }, endsWhen: "they mark 2 Stress" });
  });
});

describe("Spectral Archer, Captain and Guardian (CB p.226)", () => {
  it("Pick Your Target: a Fear, 2d8+12 on a hit", () => {
    const plan = runUse("spectral-archer", "Pick Your Target", [9, 4, 4], { targets: [mira] });
    expect(plan).toMatchObject({ fearSpent: 1 });
    expect(plan.incoming[0]).toMatchObject({ amount: 20 });
  });

  it("Unending Battle: 2 Fear return up to 1d4+1 defeated Spectral allies", () => {
    const plan = runUse("spectral-captain", "Unending Battle", [2]);
    expect(plan.fearSpent).toBe(2);
    expect(ofKind(plan, "summon")[0]!.count).toBe(3);
  });

  it("Hold Fast: a Stress gives its Spectral allies +2 to their reaction roll", () => {
    const plan = runUse("spectral-captain", "Hold Fast", [], { spotlit: false, allies: [ally("s1")] });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "fold")[0]).toMatchObject({ targetIds: ["s1"], amount: 2, step: { kind: "modifyRoll" } });
  });

  it("Grave Blade: a Fear, 2d10+6 and a Stress on a hit", () => {
    const plan = runUse("spectral-guardian", "Grave Blade", [11, 5, 5], { targets: [mira] });
    expect(plan.incoming[0]).toMatchObject({ amount: 16 });
    expect(after(plan, "mira")!.stress).toBe(1);
  });
});

describe("Spy (CB p.227)", () => {
  it("Gathering Secrets: a Fear for a narrated secret (manual)", () => {
    const plan = runUse("spy", "Gathering Secrets", []);
    expect(plan.fearSpent).toBe(1);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Fly on the Wall: a Stress reveals the Spy; escaping to report gains 1d4 Fear", () => {
    expect(runUse("spy", "Fly on the Wall", [], { useId: "reveal", spotlit: false }).self.after.stress).toBe(1);
    expect(runUse("spy", "Fly on the Wall", [3], { useId: "report", spotlit: false }).gmFearDelta).toBe(3);
  });
});

describe("Stonewraith (CB p.227)", () => {
  it("Stonestrider: immune to all damage while within stone; moving into stone makes it Hidden", () => {
    expect(passiveSummary(effectsOf("stonewraith"), state()).resistance).toBeUndefined();
    expect(passiveSummary(effectsOf("stonewraith"), state({ situations: ["While within stone or earth"] })).resistance).toEqual({ physical: "immune", magic: "immune" });
    expect(runUse("stonewraith", "Stonestrider", [], { useId: "enter-stone" }).self.after.conditions).toEqual(["hidden"]);
  });

  it("Rocky Ambush: only while Hidden; a Stress, then an Agility or Instinct Reaction Roll (15)", () => {
    expect(attempt("stonewraith", "Rocky Ambush", { targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("stonewraith", "Rocky Ambush", [], { targets: [mira], self: selfOf("stonewraith", { conditions: ["hidden"] }) });
    expect(plan.self.after.stress).toBe(1);
    expect(saveStep(prompts(plan, "pcSave")[0]!)).toMatchObject({ trait: ["agility", "instinct"], difficulty: { kind: "fixed", value: 15 } });
  });

  it("Avalanche Roar: in a cave, a Fear; Agility Reaction Roll (14) and the rubble's Progress Countdown (8)", () => {
    expect(attempt("stonewraith", "Avalanche Roar", { targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("stonewraith", "Avalanche Roar", [], { targets: [mira], situations: ["While within a cave"] });
    expect(plan.fearSpent).toBe(1);
    expect(saveStep(prompts(plan, "pcSave")[0]!).difficulty).toEqual({ kind: "fixed", value: 14 });
    expect(ofKind(plan, "countdown")[0]).toMatchObject({ op: "start", start: 8 });
  });
});

describe("War Wizard (CB p.227)", () => {
  it("Battle Teleport: a Stress to teleport within Far before or after its standard attack", () => {
    for (const id of ["before", "after"]) {
      const plan = runUse("war-wizard", "Battle Teleport", [], { useId: id, spotlit: false });
      expect(plan.self.after.stress).toBe(1);
      expect(prompts(plan, "move")[0]!.text).toBe("Teleport (far)");
    }
  });

  it("Warding Sphere: damage from an attack within Close deals 2d6 magic to the attacker, then waits for Refresh Warding Sphere", () => {
    const plan = runUse("war-wizard", "Warding Sphere", [3, 4], { spotlit: false, trigger: { source: mira } });
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: 7, type: "magic", direct: false, forcedArmor: 0, critical: false }]);
    expect(attempt("war-wizard", "Warding Sphere", { trigger: { source: mira }, featureUses: plan.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
    const refresh = runUse("war-wizard", "Refresh Warding Sphere", []);
    expect(refresh.self.after.stress).toBe(1);
    expect(ofKind(refresh, "fold")[0]!.step).toMatchObject({ kind: "refreshFeature" });
  });

  it("Eruption: a Fear; Agility Reaction Roll (14): 2d10 and thrown out on a failure, half on a success", () => {
    const plan = runUse("war-wizard", "Eruption", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(saveStep(prompts(plan, "pcSave")[0]!).difficulty).toEqual({ kind: "fixed", value: 14 });
    // A creature that rolls its own d20 (an NPC caught in the area) shows both branches: 2d10 = 9, half = 5.
    const npcs = runUse("war-wizard", "Eruption", [5, 4, 5, 18], { targets: [ally("n1", { thresholds: { major: 50, severe: 60 } }), ally("n2", { thresholds: { major: 50, severe: 60 } })] });
    expect(ofKind(npcs, "save").map((s) => s.success)).toEqual([false, true]);
    expect(ofKind(npcs, "damageRoll").map((d) => d.record.total)).toEqual([9, 9]);
    expect(prompts(npcs, "move")).toHaveLength(1);
  });

  it("Arcane Artillery: a Fear; everyone in the scene rolls Agility: 2d12 magic, half on a success", () => {
    const plan = runUse("war-wizard", "Arcane Artillery", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    const step = saveStep(prompts(plan, "pcSave")[0]!);
    expect(step.difficulty).toEqual({ kind: "actorDifficulty" });
    expect(step.onSuccess[0]).toMatchObject({ kind: "damage", scale: "half", type: "magic" });
  });
});
