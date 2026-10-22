import { describe, expect, it } from "vitest";

import { passiveSummary, triggeredUses, type AdversaryEvent, type AdversaryState, type PassiveSummary } from "@/lib/domain/adversary-actions/features";
import {
  run,
  runStandardAttack,
  upfrontFear,
  type AdversaryPlan,
  type AdversaryPlanStep,
  type AdversaryRunContext,
  type AdversaryRunResult,
} from "@/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryFeatureUse, AdversaryStep } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng, type Rng } from "@/lib/domain/dice";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryEffects, adversaryGroup } from "@/lib/srd/adversary-effects";
import { T1_CORE_EFFECTS } from "@/lib/srd/adversary-effects/t1-core";
import type { AdversaryDef } from "@/lib/srd/types";

// Plan combat-actions, tracer AE-t1-core: every feature of the 52 tier 1 Core Book adversaries (CB p.210-219) run through
// the AA1 runner with fixed dice. Expected values are worked out by hand from the feature text and the stat block (the
// runner adds the printed ATK to the d20). RNG order: modifier dice, the d20(s), damage dice in step order, then prompt
// numbers (summon counts, spotlight counts). Every successful run checks that all queued dice were used. A PC's reaction
// roll is a prompt (the player rolls, AR11); an NPC target rolls a d20 itself (CB p.161), which is how the tests reach a
// save's onFail / onSuccess branches.

// ---------------------------------------------------------------- fixtures

const T1_CORE = ADVERSARIES.filter((a) => adversaryGroup(a) === "t1-core");

const def = (id: string): AdversaryDef => {
  const d = ADVERSARIES.find((a) => a.id === id);
  if (!d) throw new Error(`No adversary ${id}`);
  return d;
};

const effectOf = (adversaryId: string, feature: string): AdversaryFeatureEffect => {
  const e = T1_CORE_EFFECTS.find((x) => x.adversaryId === adversaryId && x.feature === feature);
  if (!e) throw new Error(`No entry for ${adversaryId}/${feature}`);
  return e;
};
const useOf = (adversaryId: string, feature: string, useId = "main"): AdversaryFeatureUse => effectOf(adversaryId, feature).uses.find((u) => u.id === useId)!;

/** The adversary instance from its stat block, nothing marked. */
const selfOf = (adversaryId: string, over: Partial<Combatant> = {}): Combatant => {
  const d = def(adversaryId);
  const minion = d.features.find((f) => /^Minion \((\d+)\)$/.test(f.name));
  return {
    id: "self",
    side: "adversary",
    difficulty: d.difficulty,
    thresholds: { major: d.thresholds.major, severe: d.thresholds.severe },
    hp: 0,
    hpMax: d.hp,
    stress: 0,
    stressMax: d.stress ?? 0,
    defeated: false,
    conditions: [],
    ...(minion ? { minionX: Number(/\((\d+)\)/.exec(minion.name)![1]) } : {}),
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

/** A non-PC creature in an area (rolls its own reaction roll, CB p.161). */
const npc = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  defeated: false,
  conditions: [],
  ...over,
});

const ctx = (adversaryId: string, rng: Rng, over: Partial<AdversaryRunContext> = {}): AdversaryRunContext => {
  const d = def(adversaryId);
  return {
    adversaryId,
    self: selfOf(adversaryId),
    attack: d.attack,
    tier: 1,
    gmFear: 3,
    spotlit: true,
    targets: [],
    rng,
    ...over,
  };
};

/** Runs a feature (its first action use, or `useId`) with queued dice; checks every die was used. */
function attempt(adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunResult {
  const rng = queueRng(dice);
  const result = run(effectOf(adversaryId, feature), ctx(adversaryId, rng, over));
  if (result.ok) rng.done();
  return result;
}

function ok(result: AdversaryRunResult): AdversaryPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const plan = (adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}) => ok(attempt(adversaryId, feature, dice, over));

const ofKind = <K extends AdversaryPlanStep["kind"]>(p: AdversaryPlan, kind: K) => p.steps.filter((s): s is Extract<AdversaryPlanStep, { kind: K }> => s.kind === kind);
const prompts = (p: AdversaryPlan, prompt: string) => ofKind(p, "prompt").filter((s) => s.prompt === prompt);
const after = (p: AdversaryPlan, id: string) => p.creatures.find((c) => c.id === id)?.after;

const state = (over: Partial<AdversaryState> = {}): AdversaryState => ({ hp: 0, hpMax: 6, stress: 0, stressMax: 3, conditions: [], tokens: 0, ...over });
const passivesOf = (adversaryId: string, over: Partial<AdversaryState> = {}): PassiveSummary => passiveSummary(adversaryEffects(adversaryId), state(over));

/** The uses an event sets off for one adversary, as `feature:useId:mode`. */
const fired = (adversaryId: string, event: AdversaryEvent, over: Partial<AdversaryState> = {}) =>
  triggeredUses(adversaryEffects(adversaryId), event, state(over)).map((t) => `${t.effect.feature}:${t.use.id}:${t.mode}`);

const fearCosts = (costs: readonly AdversaryCost[] | undefined): number =>
  (costs ?? []).reduce((n, c) => n + (c.kind === "fear" && c.amount.kind === "fixed" ? c.amount.value : 0), 0);
const stepsDeep = (steps: readonly AdversaryStep[]): AdversaryStep[] =>
  steps.flatMap((s) => {
    if (s.kind === "optional" || s.kind === "followUp") return [s, ...stepsDeep(s.steps)];
    if (s.kind === "choose") return [s, ...s.options.flatMap((o) => stepsDeep(o.steps))];
    if (s.kind === "save") return [s, ...stepsDeep(s.onFail), ...stepsDeep(s.onSuccess)];
    if (s.kind === "check") return [s, ...stepsDeep(s.then), ...stepsDeep(s.otherwise)];
    return [s];
  });

// ---------------------------------------------------------------- the table

describe("the tier 1 core table (Q15)", () => {
  it("has exactly one entry per printed feature of the 52 tier 1 core adversaries (140), no more", () => {
    const expected = T1_CORE.flatMap((a) => a.features.map((f) => `${a.id}/${f.name}`)).sort();
    const actual = T1_CORE_EFFECTS.map((e) => `${e.adversaryId}/${e.feature}`).sort();
    expect(T1_CORE).toHaveLength(52);
    expect(expected).toHaveLength(140);
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual).toEqual(expected);
    for (const e of T1_CORE_EFFECTS) expect(adversaryGroup(def(e.adversaryId))).toBe("t1-core");
  });

  it("every use has a unique id; passives, reactions and automatic uses never need the spotlight (CB p.194)", () => {
    for (const e of T1_CORE_EFFECTS) {
      const ids = e.uses.map((u) => u.id);
      expect(new Set(ids).size, `${e.adversaryId}/${e.feature}`).toBe(ids.length);
      expect(e.uses.length).toBeGreaterThan(0);
      for (const u of e.uses) {
        if (u.activation.kind !== "action") expect(u.needsSpotlight, `${e.adversaryId}/${e.feature}:${u.id}`).toBe(false);
        if (u.modifiers) expect(u.activation.kind).toBe("passive");
      }
    }
  });

  it("every printed Fear cost is a Fear cost of the entry: upfront, a tapped optional step, or the spotlight's (Q19)", () => {
    for (const a of T1_CORE) {
      for (const f of a.features.filter((x) => x.fearCost)) {
        const e = effectOf(a.id, f.name);
        const upfront = e.uses.map((u) => fearCosts(u.costs));
        const optional = e.uses.flatMap((u) => stepsDeep(u.steps)).filter((s) => s.kind === "optional").map((s) => fearCosts(s.costs));
        const spotlight = e.uses.some((u) => u.modifiers?.some((m) => m.kind === "spotlightCostsFear")) ? [1] : [];
        expect([...upfront, ...optional, ...spotlight], `${a.id}/${f.name}`).toContain(f.fearCost);
      }
    }
  });

  it("every use runs through run() once its requirements and inputs are met", () => {
    const rng: Rng = (sides) => Math.ceil(sides / 2);
    for (const e of T1_CORE_EFFECTS) {
      for (const u of e.uses) {
        const situations = (u.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : []));
        const tokens = (u.requires ?? []).some((r) => r.kind === "tokens" && (r.atLeast ?? 0) > 0) ? 1 : 0;
        const hp = (u.requires ?? []).reduce((n, r) => (r.kind === "hpMarkedAtLeast" && typeof r.value === "number" ? Math.max(n, r.value) : n), 0);
        const conditions = (u.requires ?? []).flatMap((r) => (r.kind === "hasCondition" && r.condition.kind === "standard" ? [r.condition.condition] : []));
        const result = run(e, {
          ...ctx(e.adversaryId, rng),
          self: selfOf(e.adversaryId, { hp, conditions }),
          useId: u.id,
          fearConfirmed: true,
          gmFear: 12,
          tokens,
          situations,
          targets: u.targets && u.targets.side !== "trigger" ? [pc("a")] : [],
          trigger: { amount: 4, source: pc("src"), subject: pc("sub") },
          allies: [npc("ally")],
        });
        expect(result.ok, `${e.adversaryId}/${e.feature}:${u.id} ${result.ok ? "" : `${result.reason} ${result.detail}`}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- shared features

describe("shared features", () => {
  const MOMENTUM = T1_CORE.filter((a) => a.features.some((f) => f.name === "Momentum")).map((a) => a.id);

  it.each(MOMENTUM)("%s Momentum (CB p.195): an automatic Fear on a hit against a PC, no spotlight (Q19)", (id) => {
    expect(useOf(id, "Momentum").activation).toEqual({ kind: "auto", trigger: { kind: "onHit", attack: "any" } });
    expect(fired(id, { kind: "onHit", attack: "feature" })).toContain("Momentum:main:auto");
    const p = plan(id, "Momentum", [], { spotlit: false });
    expect(p).toMatchObject({ activation: "auto", needsSpotlight: false, gmFearDelta: 1, fearSpent: 0 });
  });

  it("Momentum appears on the 11 tier 1 core stat blocks that print it", () => {
    expect(MOMENTUM).toHaveLength(11);
  });

  it.each([
    ["acid-burrower", 3],
    ["construct", 2],
    ["minor-demon", 2],
    ["minor-fire-elemental", 2],
  ] as const)("%s Relentless (%i): spotlighted up to X times per GM turn", (id, times) => {
    expect(passivesOf(id).relentless).toBe(times);
    expect(plan(id, `Relentless (${times})`, [], { spotlit: false }).modifiers).toEqual([{ kind: "relentless", times }]);
  });

  const MINIONS = [
    ["giant-rat", 3, 1],
    ["jagged-knife-lackey", 3, 2],
    ["minor-treant", 5, 4],
    ["rotted-zombie", 3, 2],
    ["sellsword", 4, 3],
    ["skeleton-dredge", 4, 1],
    ["tangle-bramble", 4, 2],
  ] as const;

  it.each(MINIONS)("%s Minion (%i) (CB p.201)", (id, x) => {
    expect(passivesOf(id).minion).toBe(x);
  });

  it.each(MINIONS)("%s Group Attack: 1 Fear on the GM's tap, one shared roll, %i x %i damage combined (AR9)", (id, _x, each) => {
    expect(attempt(id, "Group Attack", [16], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    // The Fear spotlights the group: no spotlight of its own. A d20 of 16 hits Evasion 12 with every ATK here (-4 to +3).
    const p = plan(id, "Group Attack", [16], { spotlit: false, fearConfirmed: true, targets: [pc("mira")], group: [selfOf(id, { id: "m2" }), selfOf(id, { id: "m3" })] });
    expect(p).toMatchObject({ fearSpent: 1, gmFearDelta: -1, group: ["m2", "m3"] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: each * 3, type: "physical" })]);
    expect(prompts(p, "move")).toHaveLength(1);
  });

  const HORDES = [
    ["giant-mosquitoes", "1d4+1", 1],
    ["pirate-raiders", "1d4+1", 1],
    ["swarm-of-rats", "1d4+1", 1],
    ["tangle-bramble-swarm", "1d4+2", 2],
    ["zombie-pack", "1d4+2", 2],
  ] as const;

  it.each(HORDES)("%s Horde (%s): the standard attack deals X once half the HP is marked (AR10)", (id, x, plus) => {
    const d = def(id);
    expect(passivesOf(id).horde).toBe(x);
    const half = Math.ceil(d.hp / 2);
    const passives = passivesOf(id, { hp: half, hpMax: d.hp });
    // d20 19 hits Evasion 12 with every ATK here (-3 to +1); the Horde die rolls 3.
    const p = ok(runStandardAttack(ctx(id, queueRng([19, 3]), { self: selfOf(id, { hp: half }), passives, targets: [pc("mira")] })));
    expect(p.incoming[0]).toMatchObject({ amount: 3 + plus, type: "physical" });
  });

  it.each(["pirate-captain", "pirate-raiders", "pirate-tough"])("%s Swashbuckler: 2 or fewer HP from a Melee attack makes the attacker mark a Stress", (id) => {
    expect(fired(id, { kind: "onMarkHp", stage: "did", amount: 2, last: false, fromAttack: true, attackerBand: "melee" })).toContain("Swashbuckler:main:auto");
    expect(fired(id, { kind: "onMarkHp", stage: "did", amount: 3, last: false, fromAttack: true, attackerBand: "melee" })).not.toContain("Swashbuckler:main:auto");
    expect(fired(id, { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "close" })).not.toContain("Swashbuckler:main:auto");
    const p = plan(id, "Swashbuckler", [], { spotlit: false, trigger: { source: pc("rook") } });
    expect(after(p, "rook")).toMatchObject({ stress: 1 });
  });

  it.each(["brawny-zombie", "green-ooze"])("%s Slow: a spotlight without a token places one; with a token it clears it and they act", (id) => {
    expect(fired(id, { kind: "onSpotlight", tokens: 0 })).toEqual(["Slow:prepare:auto"]);
    expect(fired(id, { kind: "onSpotlight", tokens: 1 }, { tokens: 1 })).toEqual(["Slow:act:auto"]);
    const prepare = plan(id, "Slow", [], { useId: "prepare", spotlit: false });
    expect(prepare.self.tokens).toEqual({ before: 0, after: 1 });
    expect(prompts(prepare, "manual")).toHaveLength(1);
    expect(plan(id, "Slow", [], { useId: "act", tokens: 1 }).self.tokens).toEqual({ before: 1, after: 0 });
    expect(attempt(id, "Slow", [], { useId: "act", tokens: 0 })).toMatchObject({ ok: false, reason: "requirement" });
    expect(attempt(id, "Slow", [], { useId: "prepare", tokens: 1 })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it.each(["green-ooze", "tiny-green-ooze"])("%s Acidic Form: a hit target marks an Armor Slot without its benefit; no slot is a manual extra HP", (id) => {
    expect(fired(id, { kind: "onHit", attack: "standard" })).toContain("Acidic Form:main:auto");
    const p = plan(id, "Acidic Form", [], { spotlit: false, trigger: { subject: pc("mira", { armor: 1 }) } });
    expect(after(p, "mira")).toMatchObject({ armor: 2 });
    expect(ofKind(p, "mark")).toEqual([expect.objectContaining({ targetId: "mira", track: "armor", amount: 1, noBenefit: true })]);
    expect(prompts(p, "manual")[0]).toMatchObject({ targetIds: ["mira"] });
  });

  it.each([
    ["green-ooze", "tiny-green-ooze", "Tiny Green Ooze"],
    ["red-ooze", "tiny-red-ooze", "Tiny Red Ooze"],
  ])("%s Split: at 3+ HP marked, a Fear splits it into two %s and spotlights both", (id, tinyId, tinyName) => {
    expect(fired(id, { kind: "onHpMarked", before: 2, after: 3, hpMax: 5 }, { hp: 3, hpMax: 5 })).toContain("Split:main:reaction");
    expect(attempt(id, "Split", [], { self: selfOf(id, { hp: 2 }) })).toMatchObject({ ok: false, reason: "requirement" });
    expect(attempt(id, "Split", [], { self: selfOf(id, { hp: 3 }) })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const p = plan(id, "Split", [], { self: selfOf(id, { hp: 3 }), fearConfirmed: true, spotlit: false });
    expect(p.fearSpent).toBe(1);
    expect(p.self.after.defeated).toBe(true);
    expect(ofKind(p, "summon")).toEqual([{ kind: "summon", label: tinyName, count: 2, adversaryId: tinyId, range: "melee" }]);
    expect(ofKind(p, "spotlight")).toEqual([expect.objectContaining({ who: "sameName", count: 2, name: tinyName })]);
  });
});

// ---------------------------------------------------------------- one adversary at a time

describe("Acid Burrower (CB p.210)", () => {
  it("Earth Eruption: mark a Stress; every creature within Very Close makes an Agility Reaction Roll or is Vulnerable until they next act", () => {
    expect(attempt("acid-burrower", "Earth Eruption", [], { spotlit: false })).toMatchObject({ ok: false, reason: "spotlight", code: "ADVERSARY_NOT_SPOTLIT" });
    expect(attempt("acid-burrower", "Earth Eruption", [], { self: selfOf("acid-burrower", { stress: 3 }) })).toMatchObject({ ok: false, reason: "cost" });
    // A PC rolls; the NPC rolls a d20 against the Burrower's Difficulty 14: 9 fails, 15 succeeds.
    const p = plan("acid-burrower", "Earth Eruption", [9, 15], { targets: [pc("mira"), npc("goblin"), npc("orc")] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(ofKind(p, "save").map((s) => [s.targetId, s.difficulty, s.success])).toEqual([
      ["goblin", 14, false],
      ["orc", 14, true],
    ]);
    expect(ofKind(p, "condition")).toEqual([expect.objectContaining({ targetId: "goblin", condition: { kind: "standard", condition: "vulnerable" }, endsWhen: "until they next act" })]);
  });

  it("Spit Acid: one roll against all in front within Close; hits take 2d6 and a forced Armor Slot, with the no-slot rider manual", () => {
    // d20 12 + 3 = 15: hits Evasion 12, misses 16. 2d6 = 3 + 4.
    const p = plan("acid-burrower", "Spit Acid", [12, 3, 4], { targets: [pc("mira"), pc("bram", { evasion: 16 })] });
    expect(p.hits).toEqual([
      { id: "mira", hit: true },
      { id: "bram", hit: false },
    ]);
    expect(p.incoming).toEqual([{ targetId: "mira", amount: 7, type: "physical", direct: false, forcedArmor: 1, critical: false, attackTotal: 15 }]);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(p.fearSpent).toBe(0);
  });

  it("Acid Bath: a reaction to Severe damage, 1d10 physical to everyone within Close; the blood pool is manual", () => {
    expect(fired("acid-burrower", { kind: "onDamaged", stage: "did", severity: "severe" })).toEqual(["Acid Bath:main:reaction"]);
    expect(fired("acid-burrower", { kind: "onDamaged", stage: "did", severity: "major" })).toEqual([]);
    const p = plan("acid-burrower", "Acid Bath", [6], { spotlit: false, targets: [pc("mira"), pc("bram")] });
    expect(p.incoming.map((h) => [h.targetId, h.amount, h.type])).toEqual([
      ["mira", 6, "physical"],
      ["bram", 6, "physical"],
    ]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Archer Guard (CB p.212)", () => {
  it("Hobbling Shot: on a hit, mark a Stress to deal 1d12+3; the Agility disadvantage if HP is marked is manual", () => {
    // d20 13 + 1 = 14 hits; 1d12 = 8, + 3 = 11.
    const p = plan("archer-guard", "Hobbling Shot", [13, 8], { targets: [pc("mira")] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming[0]).toMatchObject({ targetId: "mira", amount: 11, type: "physical" });
    expect(prompts(p, "manual")).toHaveLength(1);
    const miss = plan("archer-guard", "Hobbling Shot", [5], { targets: [pc("mira")] });
    expect(miss.self.after.stress).toBe(0);
    expect(miss.incoming).toEqual([]);
    const full = plan("archer-guard", "Hobbling Shot", [13], { self: selfOf("archer-guard", { stress: 2 }), targets: [pc("mira")] });
    expect(full.incoming).toEqual([]); // the Stress can't be marked, so no damage (CB p.90)
  });
});

describe("Bear (CB p.210)", () => {
  it("Overwhelming Force: targets who mark HP from the standard attack are knocked back to Very Close", () => {
    expect(fired("bear", { kind: "onTargetMarksHp", attack: "standard" })).toEqual(["Overwhelming Force:main:auto"]);
    expect(fired("bear", { kind: "onTargetMarksHp", attack: "feature" })).toEqual([]);
    const p = plan("bear", "Overwhelming Force", [], { spotlit: false, trigger: { subject: pc("mira") } });
    expect(prompts(p, "move")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Bite: mark a Stress, attack in Melee, 3d4+10 and Restrained until a Strength Roll", () => {
    const p = plan("bear", "Bite", [15, 1, 2, 3], { targets: [pc("mira")] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming[0]).toMatchObject({ amount: 16, type: "physical" });
    expect(after(p, "mira")!.conditions).toEqual(["restrained"]);
  });
});

describe("Bladed Guard (CB p.212)", () => {
  it("Shield Wall: moving within Very Close takes an Agility Roll against the Guard; the line bonus is manual", () => {
    expect(fired("bladed-guard", { kind: "pcMoves", into: "veryClose" })).toEqual(["Shield Wall:main:auto"]);
    const p = plan("bladed-guard", "Shield Wall", [], { spotlit: false, trigger: { subject: pc("mira") } });
    expect(prompts(p, "manual")).toHaveLength(1);
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Detain: on a hit, mark a Stress to Restrain the target", () => {
    const p = plan("bladed-guard", "Detain", [11], { targets: [pc("mira")] });
    expect(p.self.after.stress).toBe(1);
    expect(ofKind(p, "condition")[0]).toMatchObject({ targetId: "mira", condition: { kind: "standard", condition: "restrained" }, duration: "manual" });
    expect(p.incoming).toEqual([]);
  });
});

describe("Brawny Zombie (CB p.219)", () => {
  it("Rend Asunder: a standard attack with advantage against a Restrained target deals direct damage", () => {
    // d20s 5 and 14, keep 14, + 2 = 16. 1d12 = 7, + 3 = 10.
    const p = plan("brawny-zombie", "Rend Asunder", [5, 14, 7], { targets: [pc("mira", { conditions: ["restrained"] })] });
    expect(p.roll!.record.total).toBe(16);
    expect(p.incoming[0]).toMatchObject({ amount: 10, direct: true });
    expect(plan("brawny-zombie", "Rend Asunder", [5, 14], { targets: [pc("mira")] }).incoming).toEqual([]);
  });

  it("Rip and Tear: after a standard hit, mark a Stress to Restrain temporarily and force 2 Stress", () => {
    expect(fired("brawny-zombie", { kind: "onHit", attack: "standard" })).toEqual(["Rip and Tear:main:reaction"]);
    expect(fired("brawny-zombie", { kind: "onHit", attack: "feature" })).toEqual([]);
    const p = plan("brawny-zombie", "Rip and Tear", [], { spotlit: false, trigger: { subject: pc("mira") } });
    expect(p.self.after.stress).toBe(1);
    expect(after(p, "mira")).toMatchObject({ stress: 2, conditions: ["restrained"] });
    expect(ofKind(p, "condition")[0]!.duration).toBe("temporary");
  });
});

describe("Cave Ogre (CB p.210)", () => {
  it("Ramp Up: spotlighting costs a Fear; while spotlighted the standard attack can hit all within range", () => {
    expect(passivesOf("cave-ogre").spotlightCostsFear).toBe(true);
    const passives = passivesOf("cave-ogre");
    // d20 12 + 1 = 13 hits both; 1d10 = 5, + 2 = 7, direct from Bone Breaker.
    const p = plan("cave-ogre", "Ramp Up", [12, 5], { useId: "attack", passives, targets: [pc("mira"), pc("bram")] });
    expect(p.incoming.map((h) => [h.targetId, h.amount, h.direct])).toEqual([
      ["mira", 7, true],
      ["bram", 7, true],
    ]);
    expect(attempt("cave-ogre", "Ramp Up", [12, 5], { useId: "attack", spotlit: false, targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "spotlight" });
  });

  it("Bone Breaker: its attacks deal direct damage", () => {
    expect(passivesOf("cave-ogre").directAttacks).toBe(true);
    const p = ok(runStandardAttack(ctx("cave-ogre", queueRng([15, 4]), { passives: passivesOf("cave-ogre"), targets: [pc("mira")] })));
    expect(p.incoming[0]).toMatchObject({ amount: 6, direct: true });
  });

  it("Hail of Boulders: mark a Stress; all in front within Far; 1d10+2; a Fear only when more than one target is hit", () => {
    const two = plan("cave-ogre", "Hail of Boulders", [11, 4], { targets: [pc("a"), pc("b"), pc("c", { evasion: 16 })] });
    expect(two.self.after.stress).toBe(1);
    expect(two.incoming.map((h) => [h.targetId, h.amount])).toEqual([
      ["a", 6],
      ["b", 6],
    ]);
    expect(two.gmFearDelta).toBe(1);
    const single = plan("cave-ogre", "Hail of Boulders", [11, 4], { targets: [pc("a"), pc("c", { evasion: 16 })] });
    expect(single.gmFearDelta).toBe(0);
  });

  it("Rampaging Fury: on marking 2+ HP, move within Close and deal 2d6+3 direct to everyone in the path", () => {
    expect(fired("cave-ogre", { kind: "onMarkHp", stage: "did", amount: 2, last: false })).toEqual(["Rampaging Fury:main:reaction"]);
    expect(fired("cave-ogre", { kind: "onMarkHp", stage: "did", amount: 1, last: false })).toEqual([]);
    const p = plan("cave-ogre", "Rampaging Fury", [2, 5], { spotlit: false, targets: [pc("mira"), pc("bram")] });
    expect(p.incoming.map((h) => [h.amount, h.direct])).toEqual([
      [10, true],
      [10, true],
    ]);
    expect(prompts(p, "move")).toHaveLength(1);
  });
});

describe("Construct (CB p.210)", () => {
  it("Weak Structure: marking HP from physical damage marks one more", () => {
    expect(fired("construct", { kind: "onMarkHp", stage: "did", amount: 1, last: false, damageType: "physical" })).toContain("Weak Structure:main:auto");
    expect(fired("construct", { kind: "onMarkHp", stage: "did", amount: 1, last: false, damageType: "magic" })).not.toContain("Weak Structure:main:auto");
    expect(plan("construct", "Weak Structure", [], { spotlit: false, self: selfOf("construct", { hp: 2 }) }).self.after.hp).toBe(3);
  });

  it("Trample: mark a Stress; attack everyone in its path; 1d8 to the hits", () => {
    // d20 10 + 4 = 14: hits Evasion 12, misses 15.
    const p = plan("construct", "Trample", [10, 6], { targets: [pc("a"), pc("b", { evasion: 15 })] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "a", amount: 6 })]);
  });

  it("Overload: before damage, mark a Stress for +10 to the damage roll; it can take the spotlight again", () => {
    expect(fired("construct", { kind: "onAttack", stage: "beforeDamage", attack: "standard" })).toEqual(["Overload:main:reaction"]);
    const p = plan("construct", "Overload", [], { spotlit: false, trigger: { subject: pc("mira") } });
    expect(p.self.after.stress).toBe(1);
    expect(ofKind(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], amount: 10 })]);
    expect(ofKind(p, "spotlight")).toEqual([expect.objectContaining({ who: "self" })]);
  });

  it("Death Quake: on its last HP, an attack with advantage against all within Very Close for 1d12+2 magic", () => {
    expect(fired("construct", { kind: "onMarkHp", stage: "did", amount: 2, last: true })).toContain("Death Quake:main:reaction");
    expect(fired("construct", { kind: "onMarkHp", stage: "did", amount: 2, last: false })).not.toContain("Death Quake:main:reaction");
    const p = plan("construct", "Death Quake", [3, 8, 9], { spotlit: false, targets: [pc("a"), pc("b")] });
    expect(p.roll!.record.total).toBe(12); // keep 8, + 4
    expect(p.incoming.map((h) => [h.amount, h.type])).toEqual([
      [11, "magic"],
      [11, "magic"],
    ]);
  });
});

describe("Courtier (CB p.211)", () => {
  it("Mockery: mark a Stress; a Presence Reaction Roll (14) or 2 Stress and Vulnerable until the scene ends", () => {
    const p = plan("courtier", "Mockery", [], { targets: [pc("mira")] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    const failed = plan("courtier", "Mockery", [13], { targets: [npc("rival")] });
    expect(ofKind(failed, "save")[0]).toMatchObject({ difficulty: 14, success: false });
    expect(after(failed, "rival")).toMatchObject({ stress: 2, conditions: ["vulnerable"] });
    expect(ofKind(failed, "condition")[0]!.duration).toBe("scene");
  });

  it("Scapegoat: spend a Fear on the GM's tap; the story effect is manual", () => {
    expect(attempt("courtier", "Scapegoat", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    expect(attempt("courtier", "Scapegoat", [], { targets: [pc("mira")], fearConfirmed: true, gmFear: 0 })).toMatchObject({ ok: false, reason: "cost", code: "NOT_ENOUGH_FEAR" });
    const p = plan("courtier", "Scapegoat", [], { targets: [pc("mira")], fearConfirmed: true });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });
});

describe("Deeproot Defender (CB p.211)", () => {
  it("Ground Slam: knock all within Very Close back to Far; each marks a Stress", () => {
    const p = plan("deeproot-defender", "Ground Slam", [], { targets: [pc("a"), pc("b")] });
    expect(prompts(p, "move")).toEqual([expect.objectContaining({ targetIds: ["a", "b"] })]);
    expect([after(p, "a")!.stress, after(p, "b")!.stress]).toEqual([1, 1]);
  });

  it("Grab and Drag: on a hit, a tapped Fear pulls the target in, deals 1d6+2 and Restrains them", () => {
    expect(upfrontFear(useOf("deeproot-defender", "Grab and Drag").costs, ctx("deeproot-defender", queueRng([])))).toBe(0);
    const declined = plan("deeproot-defender", "Grab and Drag", [12], { targets: [pc("mira")] });
    expect(declined).toMatchObject({ fearSpent: 0, incoming: [] });
    const taken = plan("deeproot-defender", "Grab and Drag", [12, 4], { targets: [pc("mira")], optionals: ["drag"] });
    expect(taken.fearSpent).toBe(1);
    expect(taken.incoming[0]).toMatchObject({ amount: 6 });
    expect(prompts(taken, "move")).toHaveLength(1);
    expect(ofKind(taken, "condition")[0]).toMatchObject({ endsWhen: "until the Defender takes Severe damage" });
  });
});

describe("Dire Wolf (CB p.211)", () => {
  it("Pack Tactics: with another Dire Wolf in Melee of the target, the attack deals 1d6+5 and gains a Fear", () => {
    expect(attempt("dire-wolf", "Pack Tactics", [], { useId: "attack", targets: [pc("mira")], allyWithin: () => false })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("dire-wolf", "Pack Tactics", [10, 3], { useId: "attack", targets: [pc("mira")], allyWithin: (r) => r.name === "Dire Wolf" && r.of === "target" });
    expect(p.incoming[0]).toMatchObject({ amount: 8 });
    expect(p.gmFearDelta).toBe(1);
  });

  it("Hobbling Strike: mark a Stress; 3d4+10 direct and Vulnerable until they clear an HP", () => {
    const p = plan("dire-wolf", "Hobbling Strike", [15, 2, 2, 2], { targets: [pc("mira")] });
    expect(p.incoming[0]).toMatchObject({ amount: 16, direct: true });
    expect(after(p, "mira")!.conditions).toEqual(["vulnerable"]);
  });
});

describe("Giant Mosquitoes (CB p.211)", () => {
  it("Flying: +2 Difficulty while flying", () => {
    expect(passivesOf("giant-mosquitoes").difficulty).toBe(0);
    const flying = passivesOf("giant-mosquitoes", { situations: ["While flying"] });
    expect(flying.difficulty).toBe(2);
    expect(flying.flags).toContain("flying");
  });

  it("Bloodsucker: when its attack makes a target mark HP, mark a Stress to force one more HP", () => {
    expect(fired("giant-mosquitoes", { kind: "onTargetMarksHp", attack: "standard" })).toEqual(["Bloodsucker:main:reaction"]);
    const p = plan("giant-mosquitoes", "Bloodsucker", [], { spotlit: false, trigger: { subject: pc("mira", { hp: 1 }) } });
    expect(p.self.after.stress).toBe(1);
    expect(after(p, "mira")!.hp).toBe(2);
  });
});

describe("Giant Scorpion (CB p.211)", () => {
  it("Double Strike: mark a Stress; one standard attack roll against two targets in Melee", () => {
    expect(attempt("giant-scorpion", "Double Strike", [14], { targets: [pc("a"), pc("b"), pc("c")] })).toMatchObject({ ok: false, reason: "targets" });
    const p = plan("giant-scorpion", "Double Strike", [14, 9], { targets: [pc("a"), pc("b")] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming.map((h) => h.amount)).toEqual([11, 11]); // 1d12+2 rolled once (R9)
  });

  it("Venomous Stinger: on a hit, a tapped Fear deals 1d4+4 and Poisons until a rest; the d6 rider is manual", () => {
    const p = plan("giant-scorpion", "Venomous Stinger", [12, 2], { targets: [pc("mira")], optionals: ["poison"] });
    expect(p.fearSpent).toBe(1);
    expect(p.incoming[0]).toMatchObject({ amount: 6 });
    expect(ofKind(p, "condition")[0]).toMatchObject({ condition: { kind: "tag", tag: "Poisoned" }, duration: "rest" });
    expect(prompts(p, "manual")).toHaveLength(1);
    expect(plan("giant-scorpion", "Venomous Stinger", [12], { targets: [pc("mira")] }).incoming).toEqual([]);
  });
});

describe("Glass Snake (CB p.212)", () => {
  it("Armor-Shredding Shards: a successful Melee attack against it makes the attacker mark an Armor Slot", () => {
    expect(fired("glass-snake", { kind: "onAttacked", stage: "succeeded", attackerBand: "melee" })).toEqual(["Armor-Shredding Shards:main:auto"]);
    expect(fired("glass-snake", { kind: "onAttacked", stage: "succeeded", attackerBand: "close" })).toEqual([]);
    const p = plan("glass-snake", "Armor-Shredding Shards", [], { spotlit: false, trigger: { source: pc("rook") } });
    expect(after(p, "rook")!.armor).toBe(1);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["rook"] })]);
  });

  it("Spinning Serpent: mark a Stress; attack all within Very Close for 1d6+1", () => {
    const p = plan("glass-snake", "Spinning Serpent", [10, 5], { targets: [pc("a"), pc("b", { evasion: 13 })] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "a", amount: 6 })]);
  });

  it("Spitter: a Fear introduces the die and a second spotlight; on its spotlight a 5+ forces Agility Reaction Rolls", () => {
    expect(attempt("glass-snake", "Spitter", [])).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const intro = plan("glass-snake", "Spitter", [], { fearConfirmed: true });
    expect(intro.self.tokens).toEqual({ before: 0, after: 1 });
    expect(ofKind(intro, "spotlight")).toEqual([expect.objectContaining({ who: "self" })]);
    expect(fired("glass-snake", { kind: "onSpotlight", tokens: 1 }, { tokens: 1 })).toEqual(["Spitter:spit:auto"]);
    expect(attempt("glass-snake", "Spitter", [], { useId: "spit", tokens: 0 })).toMatchObject({ ok: false, reason: "requirement" });
    const spit = plan("glass-snake", "Spitter", [5], { useId: "spit", tokens: 1, targets: [pc("a"), pc("b")] });
    expect(ofKind(spit, "check")[0]).toMatchObject({ total: 5, passed: true });
    expect(prompts(spit, "pcSave").map((s) => s.targetIds[0])).toEqual(["a", "b"]);
    expect(prompts(plan("glass-snake", "Spitter", [4], { useId: "spit", tokens: 1, targets: [pc("a")] }), "pcSave")).toEqual([]);
  });
});

describe("Green Ooze (CB p.215)", () => {
  it("Envelop: a standard attack; on a hit 2 Stress and Enveloped until Severe damage; the per-roll Stress is manual", () => {
    // d20 12 + 1 = 13; 1d6 = 4, + 1 = 5 magic.
    const p = plan("green-ooze", "Envelop", [12, 4], { targets: [pc("mira")] });
    expect(p.incoming[0]).toMatchObject({ amount: 5, type: "magic" });
    expect(after(p, "mira")).toMatchObject({ stress: 2, tags: ["Enveloped"] });
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Harrier (CB p.212)", () => {
  it("Maintain Distance: after a standard attack it can move anywhere within Far", () => {
    expect(fired("harrier", { kind: "onAttack", stage: "after", attack: "standard" })).toEqual(["Maintain Distance:main:reaction"]);
    expect(prompts(plan("harrier", "Maintain Distance", [], { spotlit: false }), "move")).toHaveLength(1);
  });

  it("Fall Back: mark a Stress before an incoming Melee attack, move, and attack that creature for 1d10+2", () => {
    expect(fired("harrier", { kind: "onAttacked", stage: "targeted", attackerBand: "melee" })).toEqual(["Fall Back:main:reaction"]);
    const p = plan("harrier", "Fall Back", [11, 7], { spotlit: false, trigger: { source: pc("rook") } });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming[0]).toMatchObject({ targetId: "rook", amount: 9 });
  });
});

describe("Head Guard (CB p.212)", () => {
  it("Rally Guards: 2 Fear spotlights the Head Guard and up to 2d4 allies within Far", () => {
    expect(attempt("head-guard", "Rally Guards", [])).toMatchObject({ ok: false, reason: "confirmFear", detail: "2" });
    const p = plan("head-guard", "Rally Guards", [3, 2], { fearConfirmed: true, spotlit: false });
    expect(p.fearSpent).toBe(2);
    expect(ofKind(p, "spotlight")).toEqual([
      { kind: "spotlight", who: "self" },
      { kind: "spotlight", who: "allies", count: 5, within: "far", note: "Up to 2d4 allies" },
    ]);
  });

  it("On My Signal: its first spotlight starts Countdown (5), PC attack rolls tick it, the volley spotlights the Archer Guards", () => {
    expect(fired("head-guard", { kind: "onSpotlight", first: { scene: true, ever: true }, tokens: 0 })).toEqual(["On My Signal:main:reaction"]);
    expect(fired("head-guard", { kind: "onSpotlight", first: { scene: false, ever: false }, tokens: 0 })).toEqual([]);
    const start = plan("head-guard", "On My Signal", [], { useId: "main" });
    expect(ofKind(start, "countdown")[0]).toMatchObject({ op: "start", label: "On My Signal", start: 5, loop: false });
    expect(fired("head-guard", { kind: "pcRolls", roll: { kind: "action", attack: true, success: true, withHope: true, withFear: false } })).toEqual(["On My Signal:tick:auto"]);
    expect(ofKind(plan("head-guard", "On My Signal", [], { useId: "tick" }), "countdown")[0]).toMatchObject({ op: "tick", amount: 1 });
    const signal = plan("head-guard", "On My Signal", [], { useId: "signal", spotlit: false });
    expect(ofKind(signal, "spotlight")).toEqual([{ kind: "spotlight", who: "sameName", name: "Archer Guard", within: "far" }]);
    expect(prompts(signal, "manual")).toHaveLength(1);
  });
});

describe("Jagged Knife Bandit (CB p.213)", () => {
  it("Climber is a reminder with no rule to apply", () => {
    expect(prompts(plan("jagged-knife-bandit", "Climber", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("From Above: attacking from above deals 1d10+1 instead", () => {
    expect(attempt("jagged-knife-bandit", "From Above", [11], { useId: "attack", targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("jagged-knife-bandit", "From Above", [11, 6], { useId: "attack", targets: [pc("mira")], situations: ["The Bandit attacks from above the target"] });
    expect(p.incoming[0]).toMatchObject({ amount: 7 });
  });
});

describe("Jagged Knife Hexer (CB p.213)", () => {
  it("Curse: temporarily Curse a target; a Cursed PC's roll with Hope can be made with Fear for a Stress", () => {
    const curse = plan("jagged-knife-hexer", "Curse", [], { targets: [pc("mira")] });
    expect(ofKind(curse, "condition")[0]).toMatchObject({ condition: { kind: "tag", tag: "Cursed" }, duration: "temporary" });
    expect(fired("jagged-knife-hexer", { kind: "pcRolls", roll: { kind: "action", success: true, withHope: true, withFear: false } })).toEqual(["Curse:hex:reaction"]);
    const hex = plan("jagged-knife-hexer", "Curse", [], { useId: "hex", spotlit: false, trigger: { subject: pc("mira", { tags: ["Cursed"] }) } });
    expect(hex.self.after.stress).toBe(1);
    expect(ofKind(hex, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ change: { kind: "swapDuality" } }) })]);
    expect(ofKind(plan("jagged-knife-hexer", "Curse", [], { useId: "hex", trigger: { subject: pc("bram") } }), "fold")).toEqual([]);
  });

  it("Chaotic Flux: up to three targets within Very Close; mark a Stress for 2d6+3 magic to the hits", () => {
    expect(attempt("jagged-knife-hexer", "Chaotic Flux", [10], { targets: [pc("a"), pc("b"), pc("c"), pc("d")] })).toMatchObject({ ok: false, reason: "targets" });
    const p = plan("jagged-knife-hexer", "Chaotic Flux", [10, 4, 5], { targets: [pc("a"), pc("b"), pc("c", { evasion: 14 })] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming.map((h) => [h.targetId, h.amount, h.type])).toEqual([
      ["a", 12, "magic"],
      ["b", 12, "magic"],
    ]);
  });
});

describe("Jagged Knife Kneebreaker (CB p.213)", () => {
  it("I've Got 'Em: the double damage from other adversaries is manual", () => {
    expect(prompts(plan("jagged-knife-kneebreaker", "I've Got 'Em", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Hold Them Down: a hit deals no damage but Restrains and makes Vulnerable", () => {
    const p = plan("jagged-knife-kneebreaker", "Hold Them Down", [15], { targets: [pc("mira")] }); // 15 - 3 = 12
    expect(p.incoming).toEqual([]);
    expect(after(p, "mira")!.conditions).toEqual(["restrained", "vulnerable"]);
  });
});

describe("Jagged Knife Lieutenant (CB p.213)", () => {
  it("Tactician: mark a Stress to also spotlight two allies within Close", () => {
    const p = plan("jagged-knife-lieutenant", "Tactician", []);
    expect(p.self.after.stress).toBe(1);
    expect(ofKind(p, "spotlight")).toEqual([{ kind: "spotlight", who: "allies", count: 2, within: "close" }]);
  });

  it("More Where That Came From: summon three Jagged Knife Lackeys at Far range", () => {
    expect(ofKind(plan("jagged-knife-lieutenant", "More Where That Came From", []), "summon")).toEqual([
      { kind: "summon", label: "Jagged Knife Lackey", count: 3, adversaryId: "jagged-knife-lackey", range: "far" },
    ]);
  });

  it("Coup de Grace: a Fear; against a Vulnerable target 2d6+12 and a Stress", () => {
    expect(attempt("jagged-knife-lieutenant", "Coup de Grace", [10], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("jagged-knife-lieutenant", "Coup de Grace", [10, 3, 3], { fearConfirmed: true, targets: [pc("mira", { conditions: ["vulnerable"] })] });
    expect(p.incoming[0]).toMatchObject({ amount: 18 });
    expect(after(p, "mira")!.stress).toBe(1);
    expect(plan("jagged-knife-lieutenant", "Coup de Grace", [10], { fearConfirmed: true, targets: [pc("mira")] }).incoming).toEqual([]);
  });
});

describe("Jagged Knife Shadow (CB p.214)", () => {
  it("Backstab: a standard attack with advantage deals 1d6+6 instead", () => {
    const p = plan("jagged-knife-shadow", "Backstab", [4, 11, 2], { useId: "attack", targets: [pc("mira")], situations: ["The attack has advantage"] });
    expect(p.roll!.record.total).toBe(12);
    expect(p.incoming[0]).toMatchObject({ amount: 8 });
  });

  it("Cloaked: Hidden until after its next attack, attacking with advantage meanwhile", () => {
    const p = plan("jagged-knife-shadow", "Cloaked", []);
    expect(p.self.after.conditions).toEqual(["hidden"]);
    expect(ofKind(p, "effect")[0]).toMatchObject({ targetId: "self", mods: [{ kind: "advantage", on: "attack" }] });
  });
});

describe("Jagged Knife Sniper (CB p.214)", () => {
  it("Unseen Strike: while Hidden, a successful standard attack deals 1d10+4 instead", () => {
    expect(attempt("jagged-knife-sniper", "Unseen Strike", [13], { useId: "attack", targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("jagged-knife-sniper", "Unseen Strike", [13, 5], { useId: "attack", self: selfOf("jagged-knife-sniper", { conditions: ["hidden"] }), targets: [pc("mira")] });
    expect(p.incoming[0]).toMatchObject({ amount: 9 });
  });
});

describe("Merchant (CB p.214)", () => {
  const presence = (success: boolean, total?: number): AdversaryEvent => ({
    kind: "pcRolls",
    againstSelf: true,
    roll: { kind: "action", trait: "presence", success, withHope: true, withFear: false, ...(total !== undefined ? { total } : {}) },
  });

  it("Preferential Treatment: a Presence success earns a discount; a failure costs more and earns disadvantage (manual)", () => {
    expect(fired("merchant", presence(true, 16))).toEqual(["Preferential Treatment:discount:auto"]);
    expect(fired("merchant", presence(false, 15))).toEqual(["Preferential Treatment:markup:auto"]);
    expect(prompts(plan("merchant", "Preferential Treatment", [], { useId: "discount", trigger: { subject: pc("mira") } }), "manual")).toHaveLength(1);
    const markup = plan("merchant", "Preferential Treatment", [], { useId: "markup", trigger: { subject: pc("mira") } });
    expect(after(markup, "mira")!.tags).toEqual(["Out of Favor"]);
    expect(prompts(markup, "manual")).toHaveLength(1);
  });

  it("The Runaround: a Presence Roll of 14 or lower against it costs a Stress", () => {
    expect(fired("merchant", presence(true, 14))).toContain("The Runaround:main:auto");
    expect(fired("merchant", presence(true, 15))).not.toContain("The Runaround:main:auto");
    expect(after(plan("merchant", "The Runaround", [], { trigger: { subject: pc("mira") } }), "mira")!.stress).toBe(1);
  });
});

describe("Minor Chaos Elemental (CB p.214)", () => {
  it("Arcane Form: resistant to magic damage", () => {
    expect(passivesOf("minor-chaos-elemental").resistance).toEqual({ physical: "none", magic: "resistant" });
  });

  it("Sickening Flux: mark a HP; everyone within Close marks a Stress and is Vulnerable until a rest", () => {
    const p = plan("minor-chaos-elemental", "Sickening Flux", [], { targets: [pc("a"), pc("b")] });
    expect(p.self.after.hp).toBe(1);
    expect(after(p, "a")).toMatchObject({ stress: 1, conditions: ["vulnerable"] });
    expect(ofKind(p, "condition")[0]).toMatchObject({ duration: "rest", endsWhen: "or until they clear a HP" });
  });

  it("Remake Reality: a Fear; 2d6+3 direct magic to all within Very Close", () => {
    expect(attempt("minor-chaos-elemental", "Remake Reality", [], { targets: [pc("a")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("minor-chaos-elemental", "Remake Reality", [1, 6], { fearConfirmed: true, targets: [pc("a"), pc("b")] });
    expect(p.incoming.map((h) => [h.amount, h.type, h.direct])).toEqual([
      [10, "magic", true],
      [10, "magic", true],
    ]);
  });

  it("Magical Reflection: damage from an attack within Close deals half of it back to the attacker", () => {
    expect(fired("minor-chaos-elemental", { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "close" })).toEqual(["Magical Reflection:main:reaction"]);
    expect(fired("minor-chaos-elemental", { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "far" })).toEqual([]);
    const p = plan("minor-chaos-elemental", "Magical Reflection", [], { spotlit: false, trigger: { amount: 7, source: pc("rook") } });
    expect(p.incoming[0]).toMatchObject({ targetId: "rook", amount: 4 }); // 7 / 2 rounded up (CB p.107)
  });
});

describe("Minor Demon (CB p.215)", () => {
  it("All Must Fall: a PC within Close who fails with Fear loses a Hope", () => {
    const fearFail: AdversaryEvent = { kind: "pcRolls", band: "close", roll: { kind: "action", success: false, withHope: false, withFear: true } };
    expect(fired("minor-demon", fearFail)).toEqual(["All Must Fall:main:auto"]);
    expect(fired("minor-demon", { ...fearFail, roll: { kind: "action", success: true, withHope: false, withFear: true } })).toEqual([]);
    expect(ofKind(plan("minor-demon", "All Must Fall", [], { trigger: { subject: pc("mira") } }), "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: -1 }]);
  });

  it("Hellfire: a Fear; Agility Reaction Rolls within Far, 1d20+3 magic on a failure, half on a success", () => {
    expect(attempt("minor-demon", "Hellfire", [], { targets: [pc("a")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    const pcs = plan("minor-demon", "Hellfire", [], { fearConfirmed: true, targets: [pc("a"), pc("b")] });
    expect(prompts(pcs, "pcSave")).toHaveLength(2);
    // NPCs against Difficulty 14: 5 fails (1d20 10 + 3 = 13), 16 succeeds (half of the same roll, 7).
    const npcs = plan("minor-demon", "Hellfire", [5, 10, 16], { fearConfirmed: true, targets: [npc("x"), npc("y")] });
    expect(ofKind(npcs, "damage").map((s) => [s.result.targetId, s.result.incoming])).toEqual([
      ["x", 13],
      ["y", 7],
    ]);
  });

  it("Reaper: before damage, mark a Stress to add its marked HP to the damage roll", () => {
    expect(fired("minor-demon", { kind: "onAttack", stage: "beforeDamage", attack: "feature" })).toEqual(["Reaper:main:reaction"]);
    const p = plan("minor-demon", "Reaper", [], { spotlit: false, self: selfOf("minor-demon", { hp: 3 }), trigger: { subject: pc("mira") } });
    expect(ofKind(p, "fold")).toEqual([expect.objectContaining({ amount: 3, targetIds: ["mira"] })]);
    expect(p.self.after.stress).toBe(1);
  });
});

describe("Minor Fire Elemental (CB p.214)", () => {
  it("Scorched Earth: mark a Stress; Agility Reaction Rolls around a point within Far; 2d8 magic or half", () => {
    const p = plan("minor-fire-elemental", "Scorched Earth", [], { targets: [pc("a"), pc("b")] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
    const npcs = plan("minor-fire-elemental", "Scorched Earth", [12, 3, 5, 13], { targets: [npc("x"), npc("y")] }); // Difficulty 13
    expect(ofKind(npcs, "damage").map((s) => s.result.incoming)).toEqual([8, 4]);
  });

  it("Explosion: a Fear; attack all within Close, 1d8 magic and knocked back to Far", () => {
    const p = plan("minor-fire-elemental", "Explosion", [12, 5], { fearConfirmed: true, targets: [pc("a"), pc("b", { evasion: 16 })] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "a", amount: 5, type: "magic" })]);
    expect(prompts(p, "move")).toEqual([expect.objectContaining({ targetIds: ["a"] })]);
  });

  it("Consume Kindling: three times per scene, clear a HP or a Stress", () => {
    const self = selfOf("minor-fire-elemental", { hp: 2, stress: 2 });
    const first = plan("minor-fire-elemental", "Consume Kindling", [], { self, options: { consume: ["hp"] } });
    expect([first.self.after.hp, first.self.after.stress]).toEqual([1, 2]);
    const second = plan("minor-fire-elemental", "Consume Kindling", [], { self, options: { consume: ["stress"] }, featureUses: first.self.featureUses });
    expect(second.self.after.stress).toBe(1);
    const third = plan("minor-fire-elemental", "Consume Kindling", [], { self, options: { consume: ["hp"] }, featureUses: second.self.featureUses });
    expect(attempt("minor-fire-elemental", "Consume Kindling", [], { self, options: { consume: ["hp"] }, featureUses: third.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Patchwork Zombie Hulk (CB p.219)", () => {
  it("Destructible: Major or greater damage marks an additional HP", () => {
    expect(fired("patchwork-zombie-hulk", { kind: "onDamaged", stage: "did", severity: "major" })).toEqual(["Destructible:main:auto"]);
    expect(fired("patchwork-zombie-hulk", { kind: "onDamaged", stage: "did", severity: "minor" })).toEqual([]);
    expect(plan("patchwork-zombie-hulk", "Destructible", [], { self: selfOf("patchwork-zombie-hulk", { hp: 4 }) }).self.after.hp).toBe(5);
  });

  it("Flailing Limbs: its standard attack can hit all within Very Close", () => {
    const p = plan("patchwork-zombie-hulk", "Flailing Limbs", [8, 11], { useId: "attack", targets: [pc("a"), pc("b")] });
    expect(p.incoming.map((h) => h.amount)).toEqual([11, 11]);
  });

  it("Another for the Pile: next to a corpse, clear a HP and a Stress", () => {
    expect(attempt("patchwork-zombie-hulk", "Another for the Pile", [])).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("patchwork-zombie-hulk", "Another for the Pile", [], { self: selfOf("patchwork-zombie-hulk", { hp: 2, stress: 1 }), situations: ["The Zombie is within Very Close range of a corpse"] });
    expect([p.self.after.hp, p.self.after.stress]).toEqual([1, 0]);
  });

  it("Tormented Screams: mark a Stress; Presence Reaction Rolls (13): failures lose a Hope and give a Fear each, successes mark a Stress", () => {
    const p = plan("patchwork-zombie-hulk", "Tormented Screams", [], { targets: [pc("a"), pc("b")] });
    expect(prompts(p, "pcSave")).toHaveLength(2);
    const npcs = plan("patchwork-zombie-hulk", "Tormented Screams", [12, 13], { targets: [npc("x"), npc("y")] });
    expect(npcs.gmFearDelta).toBe(1);
    expect(ofKind(npcs, "hope")).toEqual([{ kind: "hope", targetId: "x", delta: -1 }]);
    expect(after(npcs, "y")!.stress).toBe(1);
  });
});

describe("Petty Noble (CB p.216)", () => {
  it("My Land, My Rules: on their land, social actions against the Noble have disadvantage", () => {
    expect(attempt("petty-noble", "My Land, My Rules", [])).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("petty-noble", "My Land, My Rules", [], { situations: ["The Noble is on their land"] });
    expect(p.modifiers).toEqual([{ kind: "mod", mod: { kind: "disadvantageAgainst", on: "presence" } }]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Guards, Seize Them!: once per scene, mark a Stress to summon 1d4 Bladed Guards at Far", () => {
    const p = plan("petty-noble", "Guards, Seize Them!", [3]);
    expect(p.self.after.stress).toBe(1);
    expect(ofKind(p, "summon")).toEqual([{ kind: "summon", label: "Bladed Guard", count: 3, adversaryId: "bladed-guard", range: "far" }]);
    expect(attempt("petty-noble", "Guards, Seize Them!", [2], { featureUses: p.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Exile: a Fear marks the target Exiled; the social disadvantage is manual", () => {
    const p = plan("petty-noble", "Exile", [], { fearConfirmed: true, targets: [pc("mira")] });
    expect(p.fearSpent).toBe(1);
    expect(after(p, "mira")!.tags).toEqual(["Exiled"]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Pirate Captain (CB p.216)", () => {
  it("Reinforcements: once per scene, mark a Stress to summon a Pirate Raiders Horde at Far", () => {
    const p = plan("pirate-captain", "Reinforcements", []);
    expect(ofKind(p, "summon")).toEqual([{ kind: "summon", label: "Pirate Raiders", count: 1, adversaryId: "pirate-raiders", range: "far" }]);
    expect(attempt("pirate-captain", "Reinforcements", [], { featureUses: p.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("No Quarter: a Fear against a target with three Pirates near; 1d4+1 Stress on a failed Presence Reaction Roll, else 1", () => {
    const situations = ["The target has three or more Pirates within Melee range"];
    expect(attempt("pirate-captain", "No Quarter", [], { fearConfirmed: true, targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("pirate-captain", "No Quarter", [], { fearConfirmed: true, situations, targets: [pc("mira")] });
    expect(prompts(p, "pcSave")).toHaveLength(1);
    const failed = plan("pirate-captain", "No Quarter", [3, 2], { fearConfirmed: true, situations, targets: [npc("x")] }); // Difficulty 14
    expect(after(failed, "x")!.stress).toBe(3);
    const passed = plan("pirate-captain", "No Quarter", [17], { fearConfirmed: true, situations, targets: [npc("x")] });
    expect(after(passed, "x")!.stress).toBe(1);
  });
});

describe("Pirate Tough (CB p.216)", () => {
  it("Clear the Decks: on a hit, mark a Stress to close in, deal 3d4 and knock the target back to Close", () => {
    const p = plan("pirate-tough", "Clear the Decks", [12, 1, 2, 3], { targets: [pc("mira")] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming[0]).toMatchObject({ amount: 6 });
    expect(prompts(p, "move")).toHaveLength(2);
  });
});

describe("Red Ooze (CB p.216)", () => {
  it("Creeping Fire is a manual movement limit", () => {
    expect(prompts(plan("red-ooze", "Creeping Fire", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Ignite: 1d8 magic and Ignited until a Finesse Roll (14); the per-roll damage is manual", () => {
    const p = plan("red-ooze", "Ignite", [11, 7], { targets: [pc("mira")] });
    expect(p.incoming[0]).toMatchObject({ amount: 7, type: "magic" });
    expect(after(p, "mira")!.tags).toEqual(["Ignited"]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Shambling Zombie (CB p.219)", () => {
  it("Too Many to Handle: with another Zombie near, creatures in its Melee range are Vulnerable (attacks against them have advantage)", () => {
    expect(passivesOf("shambling-zombie").auras).toEqual([]);
    expect(passivesOf("shambling-zombie", { situations: ["At least one other Zombie is within Close range"] }).auras).toEqual([
      { kind: "conditionAura", condition: { kind: "standard", condition: "vulnerable" }, to: "all", within: "melee" },
    ]);
  });

  it("Horrifying: targets who mark HP from its attacks also mark a Stress", () => {
    expect(fired("shambling-zombie", { kind: "onTargetMarksHp", attack: "standard" })).toEqual(["Horrifying:main:auto"]);
    expect(after(plan("shambling-zombie", "Horrifying", [], { trigger: { subject: pc("mira") } }), "mira")!.stress).toBe(1);
  });
});

describe("Skeleton Archer (CB p.217)", () => {
  it("Opportunist: with two adversaries near the target, its damage is doubled", () => {
    expect(attempt("skeleton-archer", "Opportunist", [], { trigger: { subject: pc("mira") } })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("skeleton-archer", "Opportunist", [], { situations: ["Two or more adversaries are within Very Close range of the target"], trigger: { subject: pc("mira") } });
    expect(ofKind(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ change: { kind: "multiply", factor: 2 } }) })]);
  });

  it("Deadly Shot: against a Vulnerable target, a hit and a Stress deal 3d4+8", () => {
    const p = plan("skeleton-archer", "Deadly Shot", [10, 4, 4, 4], { targets: [pc("mira", { conditions: ["vulnerable"] })] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming[0]).toMatchObject({ amount: 20 });
    const plain = plan("skeleton-archer", "Deadly Shot", [10], { targets: [pc("mira")] });
    expect([plain.self.after.stress, plain.incoming]).toEqual([0, []]);
  });
});

describe("Skeleton Knight (CB p.217)", () => {
  it("Terrifying: on a hit, every PC within Close loses a Hope and the GM gains a Fear", () => {
    expect(fired("skeleton-knight", { kind: "onHit", attack: "standard" })).toEqual(["Terrifying:main:auto"]);
    const p = plan("skeleton-knight", "Terrifying", [], { spotlit: false, targets: [pc("a"), pc("b")] });
    expect(ofKind(p, "hope").map((s) => [s.targetId, s.delta])).toEqual([
      ["a", -1],
      ["b", -1],
    ]);
    expect(p.gmFearDelta).toBe(1);
  });

  it("Cut to the Bone: mark a Stress; all within Very Close; 1d8+2 and a Stress to the hits", () => {
    const p = plan("skeleton-knight", "Cut to the Bone", [10, 6], { targets: [pc("a"), pc("b", { evasion: 14 })] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "a", amount: 8 })]);
    expect(after(p, "a")!.stress).toBe(1);
    expect(after(p, "b")).toBeUndefined();
  });

  it("Dig Two Graves: when defeated, an attack for 1d4+8 and 1d4 Hope lost", () => {
    expect(fired("skeleton-knight", { kind: "onDefeated" })).toEqual(["Dig Two Graves:main:reaction"]);
    const p = plan("skeleton-knight", "Dig Two Graves", [10, 3, 2], { spotlit: false, targets: [pc("rook")] });
    expect(p.incoming[0]).toMatchObject({ amount: 11 });
    expect(ofKind(p, "hope")).toEqual([{ kind: "hope", targetId: "rook", delta: -2 }]);
  });
});

describe("Skeleton Warrior (CB p.217)", () => {
  it("Only Bones: resistant to physical damage", () => {
    expect(passivesOf("skeleton-warrior").resistance).toEqual({ physical: "resistant", magic: "none" });
  });

  it("Won't Stay Dead: when defeated, spotlight it and roll a d6; a 6 re-forms it with no marked HP", () => {
    const situations = ["There are other adversaries on the battlefield"];
    const dead = selfOf("skeleton-warrior", { hp: 3, defeated: true });
    expect(attempt("skeleton-warrior", "Won't Stay Dead", [6], { self: dead })).toMatchObject({ ok: false, reason: "requirement" });
    const six = plan("skeleton-warrior", "Won't Stay Dead", [6], { self: dead, situations, spotlit: false });
    expect(ofKind(six, "spotlight")).toEqual([{ kind: "spotlight", who: "self" }]);
    expect(six.self.after.hp).toBe(0);
    expect(prompts(six, "manual")).toHaveLength(1);
    const five = plan("skeleton-warrior", "Won't Stay Dead", [5], { self: dead, situations });
    expect([five.self.after.hp, prompts(five, "manual")]).toEqual([3, []]);
  });
});

describe("Spellblade (CB p.217)", () => {
  it("Arcane Steel: its standard attack's damage is both physical and magic (printed phy/mag)", () => {
    expect(useOf("spellblade", "Arcane Steel").activation.kind).toBe("passive");
    const p = ok(runStandardAttack(ctx("spellblade", queueRng([12, 3]), { targets: [pc("mira")] })));
    expect(p.incoming[0]).toMatchObject({ amount: 7, type: "both" });
  });

  it("Suppressing Blast: mark a Stress; a group within Far makes Agility Reaction Rolls or takes 1d8+2 magic; the Fear per HP is manual", () => {
    const p = plan("spellblade", "Suppressing Blast", [], { targets: [pc("a"), pc("b")] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Move as a Unit: 2 Fear to spotlight up to five allies within Far", () => {
    expect(attempt("spellblade", "Move as a Unit", [])).toMatchObject({ ok: false, reason: "confirmFear", detail: "2" });
    const p = plan("spellblade", "Move as a Unit", [], { fearConfirmed: true });
    expect(ofKind(p, "spotlight")).toEqual([expect.objectContaining({ who: "allies", count: 5, within: "far" })]);
  });
});

describe("Swarm of Rats (CB p.218)", () => {
  it("In Your Face: PCs in its Melee range are tagged; their disadvantage against others is manual", () => {
    expect(passivesOf("swarm-of-rats").auras).toEqual([{ kind: "conditionAura", condition: { kind: "tag", tag: "In Your Face" }, to: "pcs", within: "melee" }]);
    expect(prompts(plan("swarm-of-rats", "In Your Face", [], { spotlit: false }), "manual")).toHaveLength(1);
  });
});

describe("Sylvan Soldier (CB p.218)", () => {
  it("Pack Tactics: with another Sylvan Soldier in Melee of the target, the attack deals 1d8+5", () => {
    const p = plan("sylvan-soldier", "Pack Tactics", [12, 4], { useId: "attack", targets: [pc("mira")] });
    expect(p.incoming[0]).toMatchObject({ amount: 9 });
  });

  it("Forest Control: a Fear drops a tree; an Agility Reaction Roll (15) or 1d10 physical", () => {
    const p = plan("sylvan-soldier", "Forest Control", [], { fearConfirmed: true, targets: [pc("mira")] });
    expect(prompts(p, "pcSave")).toHaveLength(1);
    const npcHit = plan("sylvan-soldier", "Forest Control", [14, 6], { fearConfirmed: true, targets: [npc("x")] });
    expect(ofKind(npcHit, "save")[0]).toMatchObject({ difficulty: 15, success: false });
    expect(ofKind(npcHit, "damage")[0]!.result.incoming).toBe(6);
  });

  it("Blend In: after a hit, mark a Stress to become Hidden", () => {
    expect(fired("sylvan-soldier", { kind: "onHit", attack: "standard" })).toEqual(["Blend In:main:reaction"]);
    const p = plan("sylvan-soldier", "Blend In", [], { spotlit: false });
    expect([p.self.after.stress, p.self.after.conditions]).toEqual([1, ["hidden"]]);
  });
});

describe("Tangle Bramble (CB p.218)", () => {
  it("Drain and Multiply: with three Minions near, a hit that marks HP lets them combine into a Swarm", () => {
    expect(fired("tangle-bramble", { kind: "onTargetMarksHp", attack: "standard" })).toEqual([]);
    expect(fired("tangle-bramble", { kind: "onTargetMarksHp", attack: "standard" }, { situations: ["Three or more Tangle Bramble Minions are within Close range"] })).toEqual([
      "Drain and Multiply:main:reaction",
    ]);
    const p = plan("tangle-bramble", "Drain and Multiply", [], { situations: ["Three or more Tangle Bramble Minions are within Close range"] });
    expect(ofKind(p, "summon")).toEqual([{ kind: "summon", label: "Tangle Bramble Swarm", count: 1, adversaryId: "tangle-bramble-swarm", range: "close" }]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Tangle Bramble Swarm (CB p.218)", () => {
  it("Crush: mark a Stress; 2d6+8 direct to a target with 3 or more bramble tokens", () => {
    expect(attempt("tangle-bramble-swarm", "Crush", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("tangle-bramble-swarm", "Crush", [2, 3], { situations: ["The target has 3 or more bramble tokens"], targets: [pc("mira")] });
    expect(p.incoming[0]).toMatchObject({ amount: 13, direct: true });
  });

  it("Encumber: a hit gives a bramble token and Restrains; tokens and the rest are manual", () => {
    expect(fired("tangle-bramble-swarm", { kind: "onHit", attack: "standard" })).toEqual(["Encumber:main:reaction"]);
    const p = plan("tangle-bramble-swarm", "Encumber", [], { trigger: { subject: pc("mira") } });
    expect(after(p, "mira")).toMatchObject({ conditions: ["restrained"], tags: ["Bramble tokens"] });
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Tiny Red Ooze (CB p.216)", () => {
  it("Burning: a creature in Melee that damages it takes 1d6 direct magic", () => {
    expect(fired("tiny-red-ooze", { kind: "onDamaged", stage: "did", attackerBand: "melee" })).toEqual(["Burning:main:reaction"]);
    expect(fired("tiny-red-ooze", { kind: "onDamaged", stage: "did", attackerBand: "close" })).toEqual([]);
    const p = plan("tiny-red-ooze", "Burning", [4], { spotlit: false, trigger: { source: pc("rook") } });
    expect(p.incoming[0]).toMatchObject({ targetId: "rook", amount: 4, type: "magic", direct: true });
  });
});

describe("Weaponmaster (CB p.218)", () => {
  it("Goading Strike: a standard attack; on a hit a Stress Taunts the target; the disadvantage is manual", () => {
    const p = plan("weaponmaster", "Goading Strike", [12, 6], { targets: [pc("mira")] });
    expect(p.incoming[0]).toMatchObject({ amount: 8 });
    expect(p.self.after.stress).toBe(1);
    expect(after(p, "mira")!.tags).toEqual(["Taunted"]);
    const tired = plan("weaponmaster", "Goading Strike", [12, 6], { self: selfOf("weaponmaster", { stress: 3 }), targets: [pc("mira")] });
    expect(tired.incoming[0]!.amount).toBe(8);
    expect(after(tired, "mira")).toBeUndefined();
  });

  it("Adrenaline Burst: once per scene, a Fear clears 2 HP and 2 Stress", () => {
    const self = selfOf("weaponmaster", { hp: 3, stress: 3 });
    expect(attempt("weaponmaster", "Adrenaline Burst", [], { self })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("weaponmaster", "Adrenaline Burst", [], { self, fearConfirmed: true });
    expect([p.self.after.hp, p.self.after.stress, p.fearSpent]).toEqual([1, 1, 1]);
    expect(attempt("weaponmaster", "Adrenaline Burst", [], { self, fearConfirmed: true, featureUses: p.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Young Dryad (CB p.218)", () => {
  it("Voice of the Forest: mark a Stress to spotlight 1d4 allies; their next successful attack deals half damage (as printed)", () => {
    const p = plan("young-dryad", "Voice of the Forest", [2], { allies: [npc("soldier")] });
    expect(p.self.after.stress).toBe(1);
    expect(ofKind(p, "spotlight")[0]).toMatchObject({ who: "allies", count: 2 });
    expect(ofKind(p, "effect")[0]).toMatchObject({ targetId: "soldier", mods: [{ kind: "flag", flag: "halfDamage" }], duration: "hit" });
  });

  it("Thorny Cage: a Fear Restrains a target within Very Close; the Stress for acting against the cage is manual", () => {
    const p = plan("young-dryad", "Thorny Cage", [], { fearConfirmed: true, targets: [pc("mira")] });
    expect(after(p, "mira")!.conditions).toEqual(["restrained"]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Zombie Pack (CB p.219)", () => {
  it("Overwhelm: when it marks HP from a Melee attack, a Stress buys a standard attack against the attacker (Horde X when halved)", () => {
    expect(fired("zombie-pack", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "melee" })).toEqual(["Overwhelm:main:reaction"]);
    const p = plan("zombie-pack", "Overwhelm", [14, 5], { spotlit: false, trigger: { source: pc("rook") } });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming[0]).toMatchObject({ targetId: "rook", amount: 7 }); // 14 - 1 = 13; 1d10 5 + 2
    const halved = plan("zombie-pack", "Overwhelm", [14, 2], { self: selfOf("zombie-pack", { hp: 3 }), passives: passivesOf("zombie-pack", { hp: 3 }), trigger: { source: pc("rook") } });
    expect(halved.incoming[0]!.amount).toBe(4); // Horde 1d4+2
  });
});
