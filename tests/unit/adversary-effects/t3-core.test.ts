import { describe, expect, it } from "vitest";

import { passiveSummary, triggeredUses, type AdversaryEvent, type AdversaryState, type RollFacts } from "@/lib/domain/adversary-actions/features";
import { run, runStandardAttack, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext, type AdversaryRunResult } from "@/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryStep } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng, type Rng } from "@/lib/domain/dice";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryGroup } from "@/lib/srd/adversary-effects";
import { T3_CORE_EFFECTS } from "@/lib/srd/adversary-effects/t3-core";

// Plan combat-actions, tracer AE-t3-core: every feature of the 23 tier 3 Core Book adversaries (CB p.228-233) run
// through the adversary runner (AA1) with fixed dice. Expected values are worked out by hand from the feature text and
// the stat block (the runner adds the printed ATK to the d20). RNG order: the d20(s), then damage dice and rolled numbers
// in step order, then prompt numbers (summon counts, countdown starts, spotlight counts). Every successful run checks
// that all queued dice were used. PCs' reaction rolls are prompts (AR11): their branches run when the PC has rolled, so
// the tests check the prompt and its step.

// ---------------------------------------------------------------- fixtures

const GROUP = ADVERSARIES.filter((a) => adversaryGroup(a) === "t3-core");
const def = (id: string) => {
  const d = GROUP.find((a) => a.id === id);
  if (!d) throw new Error(`No tier 3 core adversary ${id}`);
  return d;
};
const effectOf = (adversaryId: string, feature: string): AdversaryFeatureEffect => {
  const e = T3_CORE_EFFECTS.find((x) => x.adversaryId === adversaryId && x.feature === feature);
  if (!e) throw new Error(`No entry for ${adversaryId}/${feature}`);
  return e;
};
const useOf = (adversaryId: string, feature: string, useId = "main") => effectOf(adversaryId, feature).uses.find((u) => u.id === useId)!;
const effectsOf = (adversaryId: string) => T3_CORE_EFFECTS.filter((e) => e.adversaryId === adversaryId);

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
  thresholds: { major: 10, severe: 20 },
  hp: 0,
  hpMax: 7,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 4,
  defeated: false,
  conditions: [],
  ...over,
});

const ally = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 15,
  thresholds: { major: 15, severe: 30 },
  hp: 0,
  hpMax: 5,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const mira = pc("mira");
const bram = pc("bram", { evasion: 15 });

function context(adversaryId: string, over: Partial<AdversaryRunContext> = {}): AdversaryRunContext {
  return {
    adversaryId,
    self: selfOf(adversaryId),
    attack: def(adversaryId).attack,
    tier: 3,
    gmFear: 6,
    spotlit: true,
    fearConfirmed: true,
    rng: queueRng([]),
    ...over,
  };
}

/** Runs one use with queued dice, throws on a refusal and checks every die was used. */
function runUse(adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryPlan {
  const rng = queueRng(dice);
  const result = run(effectOf(adversaryId, feature), context(adversaryId, { ...over, rng }));
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}
const attempt = (adversaryId: string, feature: string, over: Partial<AdversaryRunContext> = {}): AdversaryRunResult =>
  run(effectOf(adversaryId, feature), context(adversaryId, over));

const ofKind = <K extends AdversaryPlanStep["kind"]>(plan: AdversaryPlan, kind: K) =>
  plan.steps.filter((s): s is Extract<AdversaryPlanStep, { kind: K }> => s.kind === kind);
const prompts = (plan: AdversaryPlan, prompt: "move" | "manual" | "pcSave") => ofKind(plan, "prompt").filter((p) => p.prompt === prompt);
const after = (plan: AdversaryPlan, id: string) => plan.creatures.find((c) => c.id === id)?.after;
const saveStep = (p: { step?: unknown }) => p.step as Extract<AdversaryStep, { kind: "save" }>;
const hitOn = (targetId: string, amount: number, type: "physical" | "magic", over: Record<string, unknown> = {}) => ({
  targetId,
  amount,
  type,
  direct: false,
  forcedArmor: 0,
  critical: false,
  ...over,
});

const state = (over: Partial<AdversaryState> = {}): AdversaryState => ({ hp: 0, hpMax: 6, stress: 0, stressMax: 5, conditions: [], tokens: 0, ...over });
/** The uses an event sets off for one adversary, as `feature:useId:mode`. */
const fired = (adversaryId: string, event: AdversaryEvent, over: Partial<AdversaryState> = {}) =>
  triggeredUses(effectsOf(adversaryId), event, state(over)).map((t) => `${t.effect.feature}:${t.use.id}:${t.mode}`);
const pcRoll = (over: Partial<RollFacts>): RollFacts => ({ kind: "action", success: false, withHope: false, withFear: true, ...over });

const fixedFear = (costs: readonly AdversaryCost[] | undefined): number[] =>
  (costs ?? []).flatMap((c) => {
    if (c.kind === "fear" && c.amount.kind === "fixed") return [c.amount.value];
    if (c.kind === "either") return c.options.flatMap((o) => fixedFear(o));
    return [];
  });

// ---------------------------------------------------------------- the table

describe("the tier 3 core table", () => {
  it("has exactly one entry per printed feature of the 23 tier 3 core adversaries (87 features, Q15)", () => {
    const expected = GROUP.flatMap((a) => a.features.map((f) => `${a.id}/${f.name}`)).sort();
    const actual = T3_CORE_EFFECTS.map((e) => `${e.adversaryId}/${e.feature}`);
    expect(GROUP).toHaveLength(23);
    expect(expected).toHaveLength(87);
    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual(expected);
  });

  it("use ids are unique per feature; actions need the spotlight, passives, reactions and autos don't (CB p.194)", () => {
    for (const effect of T3_CORE_EFFECTS) {
      const ids = effect.uses.map((u) => u.id);
      expect(new Set(ids).size, effect.feature).toBe(ids.length);
      for (const u of effect.uses) {
        expect(u.needsSpotlight, `${effect.adversaryId}/${effect.feature}:${u.id}`).toBe(u.activation.kind === "action");
        if (u.activation.kind === "passive") expect(u.steps, effect.feature).toEqual([]);
        if (u.modifiers) expect(u.activation.kind).toBe("passive");
      }
    }
  });

  it("printed Fear costs are Fear costs of the entry; only Money Is Time (\"or a Fear\") and My Turn (Fear = HP marked) add one", () => {
    for (const a of GROUP) {
      for (const f of a.features) {
        const fear = effectOf(a.id, f.name).uses.flatMap((u) => fixedFear(u.costs));
        if (f.fearCost) expect(fear, `${a.id}/${f.name}`).toContain(f.fearCost);
        else if (f.name === "Money Is Time") expect(fear).toEqual([1]);
        else expect(fear, `${a.id}/${f.name}`).toEqual([]);
      }
    }
    expect(useOf("demon-of-jealousy", "My Turn").costs).toEqual([{ kind: "fear", amount: { kind: "triggerAmount" } }]);
  });

  it("every use of every entry runs through run() once its requirements and inputs are met", () => {
    const rng: Rng = (sides) => Math.ceil(sides / 2);
    for (const effect of T3_CORE_EFFECTS) {
      for (const u of effect.uses) {
        const reqs = u.requires ?? [];
        const situations = reqs.flatMap((r) => (r.kind === "situation" ? [r.text] : []));
        const tokens = reqs.reduce((n, r) => (r.kind === "tokens" ? Math.max(n, r.atLeast ?? 0) : n), 0);
        const hp = reqs.reduce((n, r) => (r.kind === "hpMarkedAtLeast" && typeof r.value === "number" ? Math.max(n, r.value) : n), 0);
        const tags = reqs.flatMap((r) => (r.kind === "hasCondition" && r.condition.kind === "tag" ? [r.condition.tag] : []));
        const result = run(effect, {
          ...context(effect.adversaryId),
          self: selfOf(effect.adversaryId, { hp, tags }),
          useId: u.id,
          gmFear: 12,
          tokens,
          situations,
          targets: u.targets && u.targets.side === "ally" ? [ally("x")] : u.targets && u.targets.side !== "trigger" ? [pc("a")] : [],
          picked: [pc("p")],
          allies: [ally("y")],
          trigger: { amount: 2, source: pc("src"), subject: pc("sub") },
          rng,
        });
        expect(result.ok, `${effect.adversaryId}/${effect.feature}:${u.id} ${result.ok ? "" : `${result.reason} ${result.detail}`}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- shared features

describe("shared features", () => {
  const minions = [
    ["elemental-spark", 9, 5],
    ["treant-sapling", 6, 8],
  ] as const;

  it.each(minions)("%s: Minion (%i) is a passive Minion modifier (CB p.201)", (id, x) => {
    const plan = runUse(id, `Minion (${x})`, [], { spotlit: false });
    expect(plan).toMatchObject({ activation: "passive", needsSpotlight: false, modifiers: [{ kind: "minion", threshold: x }], gmFearDelta: 0 });
    expect(passiveSummary(effectsOf(id), state()).minion).toBe(x);
  });

  it.each(minions)("%s: Group Attack asks for a Fear, rolls once and combines the damage per Minion (AR9)", (id, _x, damage) => {
    expect(attempt(id, "Group Attack", { targets: [mira], fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    expect(attempt(id, "Group Attack", { targets: [mira], spotlit: false })).toMatchObject({ ok: false, code: "ADVERSARY_NOT_SPOTLIT" });
    const group = [selfOf(id, { id: "m2" }), selfOf(id, { id: "m3" })];
    const plan = runUse(id, "Group Attack", [14], { targets: [mira], group });
    expect(plan).toMatchObject({ fearSpent: 1, gmFearDelta: -1, group: ["m2", "m3"] });
    expect(plan.incoming).toEqual([hitOn("mira", damage * 3, "physical", { attackTotal: 14 })]);
    expect(prompts(plan, "move")).toHaveLength(1);
    expect(runUse(id, "Group Attack", [3], { targets: [mira], group }).incoming).toEqual([]);
  });

  it.each(["demon-of-despair", "greater-earth-elemental", "vault-guardian-sentinel", "young-ice-dragon"])(
    "%s: Momentum gains a Fear automatically on a hit, without the spotlight (CB p.195)",
    (id) => {
      const plan = runUse(id, "Momentum", [], { spotlit: false });
      expect(plan).toMatchObject({ activation: "auto", needsSpotlight: false, gmFearDelta: 1, fearSpent: 0 });
      expect(fired(id, { kind: "onHit", attack: "standard" })).toContain("Momentum:main:auto");
    },
  );

  it.each([
    ["adult-flickerfly", 4],
    ["young-ice-dragon", 3],
  ] as const)("%s: Relentless (%i)", (id, x) => {
    expect(runUse(id, `Relentless (${x})`, []).modifiers).toEqual([{ kind: "relentless", times: x }]);
    expect(passiveSummary(effectsOf(id), state()).relentless).toBe(x);
  });

  it.each(["demon-of-hubris", "head-vampire"])("%s: Terrifying: every PC within Far loses a Hope and the GM gains a Fear on a hit", (id) => {
    const plan = runUse(id, "Terrifying", [], { spotlit: false, picked: [mira, bram] });
    expect(plan.activation).toBe("auto");
    expect(ofKind(plan, "hope")).toEqual([
      { kind: "hope", targetId: "mira", delta: -1 },
      { kind: "hope", targetId: "bram", delta: -1 },
    ]);
    expect(plan.gmFearDelta).toBe(1);
    expect(fired(id, { kind: "onHit", attack: "feature" })).toContain("Terrifying:main:auto");
  });

  it.each([
    ["greater-earth-elemental", "Slow"],
    ["huge-green-ooze", "Slow"],
    ["vault-guardian-turret", "Slow Firing"],
  ] as const)("%s %s: a spotlight without a token places one; with a token it clears it", (id, feature) => {
    expect(fired(id, { kind: "onSpotlight", tokens: 0 })).toEqual([`${feature}:prepare:auto`]);
    expect(fired(id, { kind: "onSpotlight", tokens: 1 }, { tokens: 1 })).toEqual([`${feature}:act:auto`]);
    const prepare = runUse(id, feature, [], { useId: "prepare", spotlit: false });
    expect(prepare.self.tokens).toEqual({ before: 0, after: 1 });
    expect(prompts(prepare, "manual")).toHaveLength(1);
    expect(runUse(id, feature, [], { useId: "act", tokens: 1 }).self.tokens).toEqual({ before: 1, after: 0 });
    expect(attempt(id, feature, { useId: "act", tokens: 0 })).toMatchObject({ ok: false, reason: "requirement" });
    expect(attempt(id, feature, { useId: "prepare", tokens: 1 })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it.each([
    ["greater-earth-elemental", "Crushing Blows"],
    ["huge-green-ooze", "Acidic Form"],
  ] as const)("%s %s: a hit target marks an Armor Slot without its benefit; no slot is a manual extra HP", (id, feature) => {
    expect(fired(id, { kind: "onHit", attack: "feature" })).toContain(`${feature}:main:auto`);
    const plan = runUse(id, feature, [], { spotlit: false, trigger: { subject: pc("mira", { armor: 1 }) } });
    expect(after(plan, "mira")).toMatchObject({ armor: 2 });
    expect(ofKind(plan, "mark")).toEqual([expect.objectContaining({ targetId: "mira", track: "armor", amount: 1, noBenefit: true })]);
    expect(prompts(plan, "manual")[0]).toMatchObject({ targetIds: ["mira"] });
  });
});

// ---------------------------------------------------------------- adversary by adversary

describe("Adult Flickerfly (CB p.228)", () => {
  it("Never Misses: before every attack, a manual halved Evasion", () => {
    expect(fired("adult-flickerfly", { kind: "onAttack", stage: "before", attack: "standard" })).toEqual(["Never Misses:main:auto"]);
    expect(prompts(runUse("adult-flickerfly", "Never Misses", [], { spotlit: false }), "manual")[0]!.text).toMatch(/Evasion is halved/);
  });

  it("Deadly Flight: only while flying (the flag)", () => {
    expect(attempt("adult-flickerfly", "Deadly Flight")).toMatchObject({ ok: false, reason: "requirement" });
    expect(runUse("adult-flickerfly", "Deadly Flight", [], { situations: ["While flying"] }).modifiers).toEqual([{ kind: "mod", mod: { kind: "flag", flag: "flying" } }]);
  });

  it("Whirlwind: a Fear, one roll against everyone within Very Close, 3d8 direct physical", () => {
    expect(attempt("adult-flickerfly", "Whirlwind", { targets: [mira], fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    // d20 10 + 3 = 13: hits Mira (12), misses Bram (15); 3d8 3 + 4 + 5 = 12.
    const plan = runUse("adult-flickerfly", "Whirlwind", [10, 3, 4, 5], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(plan.incoming).toEqual([hitOn("mira", 12, "physical", { direct: true, attackTotal: 13 })]);
  });

  it("Mind Dance: a Stress, an Instinct save for everyone within Close; each failure gains a Fear", () => {
    const plan = runUse("adult-flickerfly", "Mind Dance", [], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    const saves = prompts(plan, "pcSave");
    expect(saves.map((s) => s.targetIds)).toEqual([["mira"], ["bram"]]);
    expect(saveStep(saves[0]!)).toMatchObject({ trait: "instinct", difficulty: { kind: "actorDifficulty" } });
    expect(saveStep(saves[0]!).onFail).toEqual(expect.arrayContaining([{ kind: "fear", to: "self", change: "gain", amount: { kind: "fixed", value: 1 } }]));
  });

  it("Hallucinatory Breath: the first damage starts a looping 1d6 countdown; the breath costs 2 Hope and 3d8+3 direct magic", () => {
    expect(fired("adult-flickerfly", { kind: "onDamaged", stage: "did", first: { scene: true, ever: true } })).toContain("Hallucinatory Breath:activate:reaction");
    expect(fired("adult-flickerfly", { kind: "onDamaged", stage: "did", first: { scene: true, ever: false } })).not.toContain("Hallucinatory Breath:activate:reaction");
    const start = runUse("adult-flickerfly", "Hallucinatory Breath", [4], { useId: "activate", spotlit: false });
    expect(ofKind(start, "countdown")).toEqual([expect.objectContaining({ op: "start", label: "Hallucinatory Breath", start: 4, loop: true })]);
    const breath = runUse("adult-flickerfly", "Hallucinatory Breath", [], { useId: "breath", targets: [mira, bram] });
    const saves = prompts(breath, "pcSave");
    expect(saves).toHaveLength(2);
    expect(saveStep(saves[0]!).onFail).toEqual([
      { kind: "hope", to: "targets", change: "lose", amount: { kind: "fixed", value: 2 } },
      { kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: { kind: "fixed", value: 3 }, sides: 8, plus: { kind: "fixed", value: 3 } } }, type: "magic", direct: true },
    ]);
  });

  it("Uncanny Reflexes: a Stress halves damage from an attack within Close", () => {
    expect(fired("adult-flickerfly", { kind: "onDamaged", stage: "would", fromAttack: true, attackerBand: "close" })).toEqual(["Uncanny Reflexes:main:reaction"]);
    expect(fired("adult-flickerfly", { kind: "onDamaged", stage: "would", fromAttack: true, attackerBand: "far" })).toEqual([]);
    const plan = runUse("adult-flickerfly", "Uncanny Reflexes", [], { spotlit: false });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "fold")).toEqual([expect.objectContaining({ targetIds: ["self"], step: expect.objectContaining({ change: { kind: "halve" } }) })]);
  });
});

describe("Demon of Avarice (CB p.228)", () => {
  it("Money Talks: disadvantage against it unless the attacker paid; the hoard starts at one handful per PC", () => {
    expect(attempt("demon-of-avarice", "Money Talks", { useId: "disadvantage" })).toMatchObject({ ok: false, reason: "requirement" });
    expect(runUse("demon-of-avarice", "Money Talks", [], { useId: "disadvantage", situations: ["The attacker hasn't spent a handful of gold"] }).modifiers).toEqual([
      { kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" } },
    ]);
    expect(fired("demon-of-avarice", { kind: "timing", at: "appears" })).toEqual(["Money Talks:hoard:auto"]);
    const hoard = runUse("demon-of-avarice", "Money Talks", [], { useId: "hoard", spotlit: false, targets: [mira, bram, pc("cass")] });
    expect(hoard.self.tokens).toEqual({ before: 0, after: 3 });
  });

  it("Money Talks: handfuls the PCs spend go to the Demon; paying gold instead of HP is the PC's (manual)", () => {
    const collect = runUse("demon-of-avarice", "Money Talks", [], { useId: "collect", tokens: 1, trigger: { amount: 2 } });
    expect(collect.self.tokens).toEqual({ before: 1, after: 3 });
    expect(fired("demon-of-avarice", { kind: "onTargetMarksHp", attack: "standard" })).toEqual(["Money Talks:pay-instead:auto"]);
    expect(fired("demon-of-avarice", { kind: "onTargetMarksHp", attack: "feature" })).toEqual([]);
    expect(prompts(runUse("demon-of-avarice", "Money Talks", [], { useId: "pay-instead", trigger: { subject: mira } }), "manual")[0]).toMatchObject({ targetIds: ["mira"] });
  });

  it("Numbers Must Go Up: the handfuls add to its attack rolls", () => {
    const passives = passiveSummary(effectsOf("demon-of-avarice"), state({ tokens: 3 }));
    expect(passives.attackBonus).toBe(3);
    // d20 10 + 2 (ATK) + 3 (handfuls) = 15 hits Bram (15); 3d6+5 = 1 + 1 + 1 + 5 = 8 magic.
    const rng = queueRng([10, 1, 1, 1]);
    const result = runStandardAttack(context("demon-of-avarice", { tokens: 3, passives, targets: [bram], rng }));
    expect(result.ok && result.plan.incoming).toEqual([hitOn("bram", 8, "magic", { attackTotal: 15 })]);
    rng.done();
  });

  it("Money Is Time: 3 handfuls or a Fear spotlights 1d4+1 allies", () => {
    expect(attempt("demon-of-avarice", "Money Is Time", { useId: "gold", tokens: 2 })).toMatchObject({ ok: false, reason: "requirement" });
    const gold = runUse("demon-of-avarice", "Money Is Time", [2], { useId: "gold", tokens: 3 });
    expect(gold.self.tokens).toEqual({ before: 3, after: 0 });
    expect(gold.fearSpent).toBe(0);
    expect(ofKind(gold, "spotlight")).toEqual([{ kind: "spotlight", who: "allies", count: 3 }]);
    expect(attempt("demon-of-avarice", "Money Is Time", { useId: "fear", fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const fear = runUse("demon-of-avarice", "Money Is Time", [4], { useId: "fear" });
    expect(fear.fearSpent).toBe(1);
    expect(ofKind(fear, "spotlight")).toEqual([{ kind: "spotlight", who: "allies", count: 5 }]);
  });
});

describe("Demon of Despair (CB p.228)", () => {
  it("Depths of Despair: double damage once the GM confirms the target has 0 Hope", () => {
    expect(fired("demon-of-despair", { kind: "onAttack", stage: "beforeDamage", attack: "standard" }, { situations: ["The target has 0 Hope"] })).toContain(
      "Depths of Despair:main:auto",
    );
    expect(attempt("demon-of-despair", "Depths of Despair", { targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("demon-of-despair", "Depths of Despair", [], { targets: [mira], situations: ["The target has 0 Hope"] });
    expect(ofKind(plan, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ change: { kind: "multiply", factor: 2 } }) })]);
  });

  it("Your Struggle Is Pointless: a Fear; every PC within Far is Despairing (the d8 Hope Die is manual)", () => {
    expect(attempt("demon-of-despair", "Your Struggle Is Pointless", { targets: [mira], fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear" });
    const plan = runUse("demon-of-despair", "Your Struggle Is Pointless", [], { targets: [mira, bram] });
    expect(after(plan, "mira")!.tags).toEqual(["Despairing"]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ duration: "manual", endsWhen: "they roll a success with Hope or take their next rest" });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/d8/);
  });

  it("Your Friends Will Fail You: on a failure with Fear, a Stress makes the other PCs within Close lose a Hope", () => {
    expect(fired("demon-of-despair", { kind: "pcRolls", roll: pcRoll({}) })).toEqual(["Your Friends Will Fail You:main:reaction"]);
    expect(fired("demon-of-despair", { kind: "pcRolls", roll: pcRoll({ withFear: false, withHope: true }) })).toEqual([]);
    const plan = runUse("demon-of-despair", "Your Friends Will Fail You", [], { spotlit: false, picked: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "hope").map((h) => [h.targetId, h.delta])).toEqual([
      ["mira", -1],
      ["bram", -1],
    ]);
  });
});

describe("Demon of Hubris (CB p.229)", () => {
  it("Double or Nothing: a failure within Far offers the PC a Fear Die reroll; still failing costs 2 Stress and clears one of the Demon's", () => {
    expect(fired("demon-of-hubris", { kind: "pcRolls", roll: pcRoll({ withFear: false }), band: "far" })).toEqual(["Double or Nothing:offer:auto"]);
    expect(prompts(runUse("demon-of-hubris", "Double or Nothing", [], { useId: "offer", trigger: { subject: mira } }), "manual")[0]).toMatchObject({ targetIds: ["mira"] });
    const still = runUse("demon-of-hubris", "Double or Nothing", [], { useId: "still-failed", self: selfOf("demon-of-hubris", { stress: 2 }), trigger: { subject: mira } });
    expect(after(still, "mira")).toMatchObject({ stress: 2 });
    expect(still.self.after.stress).toBe(1);
  });

  it("Unparalleled Skill: a Stress deals its standard attack damage (3d10) to a target within Close, no roll", () => {
    const plan = runUse("demon-of-hubris", "Unparalleled Skill", [1, 2, 3], { targets: [mira] });
    expect(plan.roll).toBeNull();
    expect(plan.self.after.stress).toBe(1);
    expect(plan.incoming).toEqual([hitOn("mira", 6, "physical")]);
  });

  it("The Root of Villainy: a Fear spotlights two other Demons within Far", () => {
    expect(attempt("demon-of-hubris", "The Root of Villainy", { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    expect(ofKind(runUse("demon-of-hubris", "The Root of Villainy", []), "spotlight")).toEqual([
      { kind: "spotlight", who: "allies", count: 2, within: "far", note: "Two other Demons" },
    ]);
  });

  it("You Pale in Comparison: a PC failing within Close marks a Stress", () => {
    expect(fired("demon-of-hubris", { kind: "pcRolls", roll: pcRoll({ withFear: false }), band: "close" })).toContain("You Pale in Comparison:main:reaction");
    expect(fired("demon-of-hubris", { kind: "pcRolls", roll: pcRoll({ withFear: false }), band: "far" })).not.toContain("You Pale in Comparison:main:reaction");
    expect(after(runUse("demon-of-hubris", "You Pale in Comparison", [], { spotlit: false, trigger: { subject: mira } }), "mira")).toMatchObject({ stress: 1 });
  });
});

describe("Demon of Jealousy (CB p.229)", () => {
  it("Unprotected Mind: its standard attack deals direct damage", () => {
    const passives = passiveSummary(effectsOf("demon-of-jealousy"), state());
    expect(passives.directAttacks).toBe(true);
    // d20 12 + 4 = 16 hits; 3d8+3 = 1 + 1 + 1 + 3 = 6 direct magic.
    const rng = queueRng([12, 1, 1, 1]);
    const result = runStandardAttack(context("demon-of-jealousy", { passives, targets: [mira], rng }));
    expect(result.ok && result.plan.incoming).toEqual([hitOn("mira", 6, "magic", { direct: true, attackTotal: 16 })]);
    rng.done();
  });

  it("My Turn: Fear equal to the HP it marked makes the attacker mark as many HP", () => {
    expect(fired("demon-of-jealousy", { kind: "onMarkHp", stage: "did", amount: 2, last: false, fromAttack: true })).toEqual(["My Turn:main:reaction"]);
    const plan = runUse("demon-of-jealousy", "My Turn", [], { spotlit: false, trigger: { amount: 2, source: mira } });
    expect(plan.fearSpent).toBe(2);
    expect(plan.gmFearDelta).toBe(-2);
    expect(after(plan, "mira")).toMatchObject({ hp: 2 });
  });

  it("Rivalry: a Stress adds a d4 to another adversary's damage against a creature within Close", () => {
    expect(fired("demon-of-jealousy", { kind: "allyMarksHp", band: "close" })).toEqual(["Rivalry:main:reaction"]);
    const plan = runUse("demon-of-jealousy", "Rivalry", [3], { spotlit: false, trigger: { subject: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], amount: 3 })]);
  });

  it("What's Yours Is Mine: Severe damage within Very Close; a Fear forces a Finesse save, the theft is manual", () => {
    expect(fired("demon-of-jealousy", { kind: "pcMarksHp", band: "veryClose", severity: "severe" })).toEqual(["What's Yours Is Mine:main:reaction"]);
    expect(fired("demon-of-jealousy", { kind: "pcMarksHp", band: "veryClose", severity: "major" })).toEqual([]);
    expect(attempt("demon-of-jealousy", "What's Yours Is Mine", { trigger: { subject: mira }, fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear" });
    const plan = runUse("demon-of-jealousy", "What's Yours Is Mine", [], { trigger: { subject: mira } });
    const save = prompts(plan, "pcSave");
    expect(save[0]).toMatchObject({ targetIds: ["mira"] });
    expect(saveStep(save[0]!)).toMatchObject({ trait: "finesse" });
    expect(saveStep(save[0]!).onFail[0]).toMatchObject({ kind: "manual" });
  });
});

describe("Demon of Wrath (CB p.229)", () => {
  it("Anger Unrelenting: its attacks deal direct damage", () => {
    expect(passiveSummary(effectsOf("demon-of-wrath"), state()).directAttacks).toBe(true);
  });

  it("Battle Lust: a Fear; every PC within Far has Battle Lust for the scene (the d20 Fear Die is manual)", () => {
    const plan = runUse("demon-of-wrath", "Battle Lust", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "condition").map((c) => [c.targetId, c.duration])).toEqual([
      ["mira", "scene"],
      ["bram", "scene"],
    ]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/d20/);
  });

  it("Retaliation: damage from an attack within Close; a Stress for a standard attack against the attacker (direct)", () => {
    expect(fired("demon-of-wrath", { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "close" })).toEqual(["Retaliation:main:reaction"]);
    const passives = passiveSummary(effectsOf("demon-of-wrath"), state());
    // d20 9 + 3 = 12 hits Mira; 3d8+1 = 1 + 1 + 1 + 1 = 4 direct magic.
    const plan = runUse("demon-of-wrath", "Retaliation", [9, 1, 1, 1], { spotlit: false, passives, trigger: { source: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(plan.incoming).toEqual([hitOn("mira", 4, "magic", { direct: true, attackTotal: 12 })]);
  });

  it("Blood and Souls: a looping countdown (6) the GM starts and ticks; it summons 1d4 Minor Demons", () => {
    expect(ofKind(runUse("demon-of-wrath", "Blood and Souls", [], { useId: "activate" }), "countdown")).toEqual([
      expect.objectContaining({ op: "start", label: "Blood and Souls", start: 6, loop: true }),
    ]);
    expect(ofKind(runUse("demon-of-wrath", "Blood and Souls", [], { useId: "tick" }), "countdown")).toEqual([expect.objectContaining({ op: "tick", amount: 1 })]);
    expect(ofKind(runUse("demon-of-wrath", "Blood and Souls", [3], { useId: "summon" }), "summon")).toEqual([
      { kind: "summon", label: "Minor Demons", count: 3, adversaryId: "minor-demon", range: "close" },
    ]);
  });
});

describe("Dire Bat (CB p.230)", () => {
  it("Flying: +3 Difficulty while flying", () => {
    expect(attempt("dire-bat", "Flying")).toMatchObject({ ok: false, reason: "requirement" });
    expect(passiveSummary(effectsOf("dire-bat"), state({ situations: ["While flying"] })).difficulty).toBe(3);
  });

  it("Screech: a Stress; everyone in front within Far marks 1d4 Stress", () => {
    const plan = runUse("dire-bat", "Screech", [3], { targets: [mira] });
    expect(plan.self.after.stress).toBe(1);
    expect(after(plan, "mira")).toMatchObject({ stress: 3 });
  });

  it("Guardian: an allied Vampire marks HP; a Stress to fly in and attack the attacker with advantage, 2d6+2", () => {
    expect(fired("dire-bat", { kind: "allyMarksHp", allyName: "Vampire" })).toEqual(["Guardian:main:reaction"]);
    expect(fired("dire-bat", { kind: "allyMarksHp", allyName: "Dryad" })).toEqual([]);
    // d20s 3 and 11 keep 11, + 2 = 13 hits Mira; 2d6+2 = 2 + 4 + 2 = 8.
    const plan = runUse("dire-bat", "Guardian", [3, 11, 2, 4], { spotlit: false, trigger: { source: mira } });
    expect(plan.incoming).toEqual([hitOn("mira", 8, "physical", { attackTotal: 13 })]);
    expect(prompts(plan, "move")).toHaveLength(1);
  });
});

describe("Dryad (CB p.230)", () => {
  it("Bramble Patch: a Stress, the lasting thorn patch is manual", () => {
    const plan = runUse("dryad", "Bramble Patch", []);
    expect(plan.self.after.stress).toBe(1);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/2d6\+2/);
  });

  it("Grow Saplings: a Fear summons three Treant Saplings at Close and spotlights them", () => {
    expect(attempt("dryad", "Grow Saplings", { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const plan = runUse("dryad", "Grow Saplings", []);
    expect(ofKind(plan, "summon")).toEqual([{ kind: "summon", label: "Treant Saplings", count: 3, adversaryId: "treant-sapling", range: "close" }]);
    expect(ofKind(plan, "spotlight")).toEqual([expect.objectContaining({ who: "sameName", count: 3, name: "Treant Sapling" })]);
  });

  it("We Are All One: an ally dies within Close; a Fear clears 2 HP and 2 Stress", () => {
    expect(fired("dryad", { kind: "allyDefeated", band: "close" })).toEqual(["We Are All One:main:reaction"]);
    const plan = runUse("dryad", "We Are All One", [], { spotlit: false, self: selfOf("dryad", { hp: 3, stress: 3 }) });
    expect(plan.fearSpent).toBe(1);
    expect(plan.self.after).toMatchObject({ hp: 1, stress: 1 });
  });
});

describe("Greater Earth Elemental (CB p.230)", () => {
  it("Immovable Object: physical damage is reduced by 7; a push is a manual two ranges shorter", () => {
    expect(fired("greater-earth-elemental", { kind: "onDamaged", stage: "would", damageType: "physical" })).toEqual(["Immovable Object:reduce:auto"]);
    expect(fired("greater-earth-elemental", { kind: "onDamaged", stage: "would", damageType: "magic" })).toEqual([]);
    expect(ofKind(runUse("greater-earth-elemental", "Immovable Object", [], { useId: "reduce" }), "fold")).toEqual([expect.objectContaining({ targetIds: ["self"], amount: 7 })]);
    expect(prompts(runUse("greater-earth-elemental", "Immovable Object", [], { useId: "immovable" }), "manual")).toHaveLength(1);
  });

  it("Rockslide: a Stress; an Agility save (19) in front within Close: 2d12+5 and Vulnerable, half on a success", () => {
    const plan = runUse("greater-earth-elemental", "Rockslide", [], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    const saves = prompts(plan, "pcSave");
    expect(saves).toHaveLength(2);
    const save = saveStep(saves[0]!);
    expect(save).toMatchObject({ trait: "agility", difficulty: { kind: "fixed", value: 19 } });
    expect(save.onFail.map((s) => s.kind)).toEqual(["damage", "condition"]);
    expect(save.onSuccess).toEqual([expect.objectContaining({ kind: "damage", scale: "half" })]);
  });
});

describe("Greater Water Elemental (CB p.230)", () => {
  it("Water Jet: a hit deals 2d4+7 and Drenches (disadvantage, manual); a miss makes the target mark a Stress", () => {
    // d20 12 + 3 = 15 hits Mira; 2d4+7 = 1 + 1 + 7 = 9.
    const hitPlan = runUse("greater-water-elemental", "Water Jet", [12, 1, 1], { targets: [mira] });
    expect(hitPlan.self.after.stress).toBe(1);
    expect(hitPlan.incoming).toEqual([hitOn("mira", 9, "physical", { attackTotal: 15 })]);
    expect(after(hitPlan, "mira")).toMatchObject({ tags: ["Drenched"], stress: 0 });
    const miss = runUse("greater-water-elemental", "Water Jet", [2], { targets: [mira] });
    expect(miss.incoming).toEqual([]);
    expect(after(miss, "mira")).toMatchObject({ stress: 1 });
  });

  it("Drowning Embrace: a Fear; everyone hit within Very Close is Restrained and Vulnerable", () => {
    const plan = runUse("greater-water-elemental", "Drowning Embrace", [10], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(after(plan, "mira")!.conditions).toEqual(["restrained", "vulnerable"]);
    expect(after(plan, "bram")).toBeUndefined();
  });

  it("High Tide: after a successful standard attack, a Stress knocks the target back to Close", () => {
    expect(fired("greater-water-elemental", { kind: "onHit", attack: "standard" })).toEqual(["High Tide:main:reaction"]);
    expect(fired("greater-water-elemental", { kind: "onHit", attack: "feature" })).toEqual([]);
    const plan = runUse("greater-water-elemental", "High Tide", [], { spotlit: false, trigger: { subject: mira } });
    expect(prompts(plan, "move")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });
});

describe("Head Vampire (CB p.232)", () => {
  it("Look into My Eyes: a creature moving into Melee makes an Instinct save; a failure gains 1d4 Fear", () => {
    expect(fired("head-vampire", { kind: "pcMoves", into: "melee" })).toEqual(["Look into My Eyes:main:auto"]);
    const plan = runUse("head-vampire", "Look into My Eyes", [], { spotlit: false, trigger: { subject: mira } });
    const save = prompts(plan, "pcSave");
    expect(save[0]).toMatchObject({ targetIds: ["mira"] });
    expect(saveStep(save[0]!).onFail).toEqual([expect.objectContaining({ kind: "fear", change: "gain" })]);
  });

  it("Feed on Followers: an ally in Melee marks a HP and the Vampire clears one", () => {
    const plan = runUse("head-vampire", "Feed on Followers", [], { self: selfOf("head-vampire", { hp: 2 }), targets: [ally("thrall")] });
    expect(after(plan, "thrall")).toMatchObject({ hp: 1 });
    expect(plan.self.after.hp).toBe(1);
  });

  it("The Hunt Is On: 2 Fear summon 1d4 Vampires at Far, who take the spotlight", () => {
    expect(attempt("head-vampire", "The Hunt Is On", { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "2" });
    const plan = runUse("head-vampire", "The Hunt Is On", [2]);
    expect(plan.fearSpent).toBe(2);
    expect(ofKind(plan, "summon")).toEqual([{ kind: "summon", label: "Vampires", count: 2, adversaryId: "vampire", range: "far" }]);
    expect(ofKind(plan, "spotlight")).toEqual([expect.objectContaining({ who: "sameName", name: "Vampire" })]);
  });

  it("Lifesuck: on its spotlight a d8; 6 or higher makes everyone within Very Close mark a HP", () => {
    expect(fired("head-vampire", { kind: "onSpotlight", tokens: 0 })).toEqual(["Lifesuck:main:reaction"]);
    const six = runUse("head-vampire", "Lifesuck", [6], { spotlit: false, targets: [mira, bram] });
    expect([after(six, "mira")!.hp, after(six, "bram")!.hp]).toEqual([1, 1]);
    expect(runUse("head-vampire", "Lifesuck", [5], { spotlit: false, targets: [mira, bram] }).creatures).toEqual([]);
  });
});

describe("Huge Green Ooze (CB p.231)", () => {
  it("Envelop: a hit Envelops the target and makes them mark 2 Stress (the Stress per action roll is manual)", () => {
    // d20 9 + 3 = 12 hits Mira.
    const plan = runUse("huge-green-ooze", "Envelop", [9], { targets: [mira] });
    expect(after(plan, "mira")).toMatchObject({ stress: 2, tags: ["Enveloped"] });
    expect(prompts(plan, "manual")).toHaveLength(1);
    expect(runUse("huge-green-ooze", "Envelop", [8], { targets: [mira] }).creatures).toEqual([]);
  });

  it("Envelop: Severe damage to the Ooze frees every Enveloped target", () => {
    expect(fired("huge-green-ooze", { kind: "onDamaged", stage: "did", severity: "severe" })).toEqual(["Envelop:release:auto"]);
    expect(fired("huge-green-ooze", { kind: "onDamaged", stage: "did", severity: "major" })).toEqual([]);
    const plan = runUse("huge-green-ooze", "Envelop", [], { useId: "release", picked: [pc("mira", { tags: ["Enveloped"] })] });
    expect(ofKind(plan, "clearCondition")).toEqual([{ kind: "clearCondition", targetId: "mira", condition: { kind: "tag", tag: "Enveloped" } }]);
  });

  it("Split: at 4+ HP marked, a Fear splits it into two Green Oozes and spotlights both", () => {
    expect(fired("huge-green-ooze", { kind: "onHpMarked", before: 3, after: 4, hpMax: 7 }, { hp: 4, hpMax: 7 })).toContain("Split:main:reaction");
    expect(attempt("huge-green-ooze", "Split", { self: selfOf("huge-green-ooze", { hp: 3 }) })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("huge-green-ooze", "Split", [], { spotlit: false, self: selfOf("huge-green-ooze", { hp: 4 }) });
    expect(plan.fearSpent).toBe(1);
    expect(plan.self.after.defeated).toBe(true);
    expect(ofKind(plan, "summon")).toEqual([{ kind: "summon", label: "Green Oozes", count: 2, adversaryId: "green-ooze", range: "melee" }]);
    expect(ofKind(plan, "spotlight")).toEqual([expect.objectContaining({ who: "sameName", count: 2, name: "Green Ooze" })]);
  });
});

describe("Hydra (CB p.231)", () => {
  it("Many-Headed Menace: three heads (tokens) when it appears; Major or greater damage costs a head", () => {
    expect(fired("hydra", { kind: "timing", at: "appears" })).toEqual(["Many-Headed Menace:heads:auto"]);
    expect(runUse("hydra", "Many-Headed Menace", [], { useId: "heads" }).self.tokens).toEqual({ before: 0, after: 3 });
    expect(fired("hydra", { kind: "onDamaged", stage: "did", severity: "major", damageType: "physical" })).toEqual(["Many-Headed Menace:lose-head:auto"]);
    expect(fired("hydra", { kind: "onDamaged", stage: "did", severity: "minor", damageType: "physical" })).toEqual([]);
    expect(runUse("hydra", "Many-Headed Menace", [], { useId: "lose-head", tokens: 3 }).self.tokens).toEqual({ before: 3, after: 2 });
  });

  it("Relentless (X): up to five spotlights (the most heads); the heads limit is a manual reminder", () => {
    expect(passiveSummary(effectsOf("hydra"), state()).relentless).toBe(5);
    expect(fired("hydra", { kind: "onSpotlight", tokens: 3 }, { tokens: 3 })).toEqual(["Relentless (X):heads:auto"]);
    expect(prompts(runUse("hydra", "Relentless (X)", [], { useId: "heads" }), "manual")[0]!.text).toMatch(/heads/);
  });

  it("Regeneration: with marked HP, a Fear clears a HP and grows two heads (up to five)", () => {
    expect(attempt("hydra", "Regeneration")).toMatchObject({ ok: false, reason: "requirement" });
    expect(attempt("hydra", "Regeneration", { self: selfOf("hydra", { hp: 2 }), fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const plan = runUse("hydra", "Regeneration", [], { self: selfOf("hydra", { hp: 2 }), tokens: 2 });
    expect(plan.self.after.hp).toBe(1);
    expect(plan.self.tokens).toEqual({ before: 2, after: 4 });
    expect(runUse("hydra", "Regeneration", [], { self: selfOf("hydra", { hp: 2 }), tokens: 4 }).self.tokens.after).toBe(5);
  });

  it("Terrifying Chorus: every PC within Far loses 2 Hope", () => {
    expect(ofKind(runUse("hydra", "Terrifying Chorus", [], { targets: [mira, bram] }), "hope")).toEqual([
      { kind: "hope", targetId: "mira", delta: -2 },
      { kind: "hope", targetId: "bram", delta: -2 },
    ]);
  });

  it("Magical Weakness: magic damage Dazes it (immune to magic; Regeneration blocked is manual)", () => {
    expect(fired("hydra", { kind: "onDamaged", stage: "did", damageType: "magic" })).toContain("Magical Weakness:main:reaction");
    expect(fired("hydra", { kind: "onDamaged", stage: "did", damageType: "physical" })).not.toContain("Magical Weakness:main:reaction");
    const plan = runUse("hydra", "Magical Weakness", [], { spotlit: false });
    expect(plan.self.after.tags).toEqual(["Dazed"]);
    expect(ofKind(plan, "effect")).toEqual([expect.objectContaining({ targetId: "self", label: "Dazed", endsWhen: "the next roll with Fear" })]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Regeneration/);
  });
});

describe("Monarch (CB p.231)", () => {
  it("Execute Them!: a Fear per PC (the GM picks the party size); the group is Condemned", () => {
    expect(attempt("monarch", "Execute Them!", { targets: [mira, bram], eitherCosts: [3], fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "4" });
    const plan = runUse("monarch", "Execute Them!", [], { targets: [mira, bram], eitherCosts: [1] });
    expect(plan.fearSpent).toBe(2);
    expect([after(plan, "mira")!.tags, after(plan, "bram")!.tags]).toEqual([["Condemned"], ["Condemned"]]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/trial by combat/);
  });

  it("Crownsguard: once per scene, a Stress summons six Tier 3 Minions at Close", () => {
    const plan = runUse("monarch", "Crownsguard", []);
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "summon")).toEqual([{ kind: "summon", label: "Tier 3 Minions", count: 6, range: "close" }]);
    expect(attempt("monarch", "Crownsguard", { featureUses: plan.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Casus Belli: a Fear starts the long-term countdown (8); when it triggers, war and 1d4 Fear", () => {
    expect(attempt("monarch", "Casus Belli", { useId: "activate", fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const start = runUse("monarch", "Casus Belli", [], { useId: "activate" });
    expect(start.fearSpent).toBe(1);
    expect(ofKind(start, "countdown")).toEqual([expect.objectContaining({ op: "start", start: 8, loop: false })]);
    const war = runUse("monarch", "Casus Belli", [3], { useId: "war" });
    expect(war.gmFearDelta).toBe(3);
    expect(prompts(war, "manual")).toHaveLength(1);
  });
});

describe("Oak Treant (CB p.232)", () => {
  it("Just a Tree: tagged when it appears or would become Hidden", () => {
    expect(fired("oak-treant", { kind: "timing", at: "appears" })).toEqual(["Just a Tree:appears:auto"]);
    expect(fired("oak-treant", { kind: "wouldGainCondition", condition: { kind: "standard", condition: "hidden" } })).toEqual(["Just a Tree:hidden:auto"]);
    expect(runUse("oak-treant", "Just a Tree", [], { useId: "hidden" }).self.after.tags).toEqual(["Just a Tree"]);
  });

  it("Seed Barrage: a Stress, one roll against up to three targets within Close, 2d10+5", () => {
    expect(attempt("oak-treant", "Seed Barrage", { targets: [pc("a"), pc("b"), pc("c"), pc("d")] })).toMatchObject({ ok: false, reason: "targets" });
    // d20 10 + 2 = 12 hits Mira, misses Bram; 2d10+5 = 3 + 4 + 5 = 12.
    const plan = runUse("oak-treant", "Seed Barrage", [10, 3, 4], { targets: [mira, bram] });
    expect(plan.incoming).toEqual([hitOn("mira", 12, "physical", { attackTotal: 12 })]);
  });

  it("Take Root: a Stress Roots it (Restrained, resistant to physical); it can end it on its spotlight", () => {
    const root = runUse("oak-treant", "Take Root", [], { useId: "root" });
    expect(root.self.after).toMatchObject({ stress: 1, conditions: ["restrained"], tags: ["Rooted"] });
    expect(attempt("oak-treant", "Take Root", { useId: "rooted" })).toMatchObject({ ok: false, reason: "requirement" });
    expect(passiveSummary(effectsOf("oak-treant"), state({ tags: ["Rooted"] })).resistance).toEqual({ physical: "resistant", magic: "none" });
    const uproot = runUse("oak-treant", "Take Root", [], { useId: "uproot", self: selfOf("oak-treant", { conditions: ["restrained"], tags: ["Rooted"] }) });
    expect(uproot.self.after).toMatchObject({ conditions: [], tags: [] });
  });
});

describe("Stag Knight (CB p.231)", () => {
  it("From Above: the standard attack from above deals 3d12+3 instead", () => {
    expect(attempt("stag-knight", "From Above", { targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    // d20 9 + 3 = 12 hits; 3d12+3 = 1 + 2 + 3 + 3 = 9.
    const plan = runUse("stag-knight", "From Above", [9, 1, 2, 3], { targets: [mira], situations: ["The Knight attacks from above the target"] });
    expect(plan.incoming).toEqual([hitOn("mira", 9, "physical", { attackTotal: 12 })]);
  });

  it("Blade of the Forest: a Fear; 3d4 against everyone hit within Very Close (+ the target's Major threshold, manual)", () => {
    const plan = runUse("stag-knight", "Blade of the Forest", [9, 1, 2, 3], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(plan.incoming).toEqual([hitOn("mira", 6, "physical", { attackTotal: 12 })]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Major threshold/);
  });

  it("Thorny Armor: damaged by an attack within Melee, a Stress deals 1d10+5 to the attacker", () => {
    expect(fired("stag-knight", { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "melee" })).toEqual(["Thorny Armor:main:reaction"]);
    expect(fired("stag-knight", { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "close" })).toEqual([]);
    const plan = runUse("stag-knight", "Thorny Armor", [5], { spotlit: false, trigger: { source: mira } });
    expect(plan.incoming).toEqual([hitOn("mira", 10, "physical")]);
  });
});

describe("Vampire (CB p.232)", () => {
  it("Draining Bite: 5d4 on a hit; what follows a marked HP is manual", () => {
    const plan = runUse("vampire", "Draining Bite", [9, 1, 1, 1, 1, 1], { targets: [mira] });
    expect(plan.incoming).toEqual([hitOn("mira", 5, "physical", { attackTotal: 12 })]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/loses? a Hope/);
  });

  it("Mistform: physical damage; a Fear halves it", () => {
    expect(fired("vampire", { kind: "onDamaged", stage: "would", damageType: "physical" })).toEqual(["Mistform:main:reaction"]);
    expect(fired("vampire", { kind: "onDamaged", stage: "would", damageType: "magic" })).toEqual([]);
    expect(attempt("vampire", "Mistform", { fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const plan = runUse("vampire", "Mistform", [], { spotlit: false });
    expect(ofKind(plan, "fold")).toEqual([expect.objectContaining({ targetIds: ["self"], step: expect.objectContaining({ change: { kind: "halve" } }) })]);
  });
});

describe("Vault Guardians (CB p.232-233)", () => {
  it("Gaoler Blocking Shield: disadvantage on attacks against it from within Melee (the GM confirms)", () => {
    expect(attempt("vault-guardian-gaoler", "Blocking Shield")).toMatchObject({ ok: false, reason: "requirement" });
    const text = "The attacker is within Melee range of the Gaoler and not trapped inside it";
    expect(runUse("vault-guardian-gaoler", "Blocking Shield", [], { situations: [text] }).modifiers).toEqual([{ kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" } }]);
  });

  it("Gaoler Lock Up: a Stress; a hit Restrains the target (only attacking the Gaoler is manual)", () => {
    const plan = runUse("vault-guardian-gaoler", "Lock Up", [10], { targets: [mira] });
    expect(after(plan, "mira")!.conditions).toEqual(["restrained"]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ endsWhen: "freed with a successful Strength Roll (18)" });
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Sentinel Kinetic Slam: its standard attack's targets are knocked back to Very Close", () => {
    expect(fired("vault-guardian-sentinel", { kind: "onHit", attack: "standard" })).toContain("Kinetic Slam:main:auto");
    expect(fired("vault-guardian-sentinel", { kind: "onHit", attack: "feature" })).not.toContain("Kinetic Slam:main:auto");
    expect(prompts(runUse("vault-guardian-sentinel", "Kinetic Slam", [], { trigger: { subject: mira } }), "move")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Sentinel Box In: a Stress tags one target Boxed In (its disadvantage is manual)", () => {
    const plan = runUse("vault-guardian-sentinel", "Box In", [], { targets: [mira] });
    expect(after(plan, "mira")!.tags).toEqual(["Boxed In"]);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Sentinel Mana Bolt: a Fear; an Agility save around a point: 2d8+20 magic and knocked back, half on a success", () => {
    const plan = runUse("vault-guardian-sentinel", "Mana Bolt", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    const save = saveStep(prompts(plan, "pcSave")[0]!);
    expect(save.onFail.map((s) => s.kind)).toEqual(["damage", "move"]);
    expect(save.onSuccess).toEqual([expect.objectContaining({ kind: "damage", scale: "half" })]);
  });

  it("Turret Mark Target: a Fear Marks a target (halved Evasion is manual)", () => {
    const plan = runUse("vault-guardian-turret", "Mark Target", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(after(plan, "mira")!.tags).toEqual(["Marked"]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Evasion is halved/);
  });

  it("Turret Concentrate Fire: a Stress adds its standard attack damage (3d10+3) to another adversary's damage", () => {
    expect(fired("vault-guardian-turret", { kind: "allyDealtDamage", band: "far" })).toEqual(["Concentrate Fire:main:reaction"]);
    const plan = runUse("vault-guardian-turret", "Concentrate Fire", [1, 2, 3], { spotlit: false, trigger: { subject: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], amount: 9 })]);
  });

  it("Turret Detonation: when destroyed, an Agility save within Close: 3d20 physical, half on a success", () => {
    expect(fired("vault-guardian-turret", { kind: "onDefeated" })).toEqual(["Detonation:main:reaction"]);
    const plan = runUse("vault-guardian-turret", "Detonation", [], { spotlit: false, targets: [mira, bram] });
    expect(prompts(plan, "pcSave")).toHaveLength(2);
  });
});

describe("Young Ice Dragon (CB p.233)", () => {
  it("Rend and Crush: damage to a PC; the Stress when they didn't mark Armor is manual", () => {
    expect(fired("young-ice-dragon", { kind: "onDealDamage", toPc: true })).toContain("Rend and Crush:main:auto");
    expect(prompts(runUse("young-ice-dragon", "Rend and Crush", [], { trigger: { subject: mira } }), "manual")[0]).toMatchObject({ targetIds: ["mira"] });
  });

  it("No Hope: a PC rolling with Fear within Far loses a Hope", () => {
    expect(fired("young-ice-dragon", { kind: "pcRolls", roll: pcRoll({ success: true }), band: "far" })).toEqual(["No Hope:main:auto"]);
    expect(fired("young-ice-dragon", { kind: "pcRolls", roll: pcRoll({ withFear: false, withHope: true }), band: "far" })).toEqual([]);
    expect(ofKind(runUse("young-ice-dragon", "No Hope", [], { trigger: { subject: mira } }), "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: -1 }]);
  });

  it("Blizzard Breath: 2 Fear; an Agility save in front within Close: 4d6+5 magic and Restrained; a success picks 2 Stress or half", () => {
    expect(attempt("young-ice-dragon", "Blizzard Breath", { targets: [mira], fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "2" });
    const plan = runUse("young-ice-dragon", "Blizzard Breath", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(2);
    const save = saveStep(prompts(plan, "pcSave")[0]!);
    expect(save.onFail.map((s) => s.kind)).toEqual(["damage", "condition"]);
    expect(save.onSuccess).toEqual([expect.objectContaining({ kind: "choose", options: [expect.objectContaining({ id: "stress" }), expect.objectContaining({ id: "half" })] })]);
  });

  it("Avalanche: a Fear; an Instinct save within Far: Vulnerable and a Fear per PC who fails", () => {
    const plan = runUse("young-ice-dragon", "Avalanche", [], { targets: [mira, bram] });
    const save = saveStep(prompts(plan, "pcSave")[0]!);
    expect(save.onFail).toEqual([expect.objectContaining({ kind: "condition" }), expect.objectContaining({ kind: "fear", change: "gain" })]);
  });

  it("Frozen Scales: a successful attack from within Very Close: the attacker marks a Stress and is Chilled", () => {
    expect(fired("young-ice-dragon", { kind: "onAttacked", stage: "succeeded", attackerBand: "veryClose" })).toEqual(["Frozen Scales:main:reaction"]);
    expect(fired("young-ice-dragon", { kind: "onAttacked", stage: "succeeded", attackerBand: "close" })).toEqual([]);
    const plan = runUse("young-ice-dragon", "Frozen Scales", [], { spotlit: false, trigger: { source: mira } });
    expect(after(plan, "mira")).toMatchObject({ stress: 1, tags: ["Chilled"] });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/disadvantage/);
  });
});
