import { describe, expect, it } from "vitest";

import { passiveSummary, triggeredUses, type AdversaryEvent, type AdversaryState, type PassiveSummary } from "@/lib/domain/adversary-actions/features";
import {
  run,
  runStandardAttack,
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
import { T4_CORE_EFFECTS } from "@/lib/srd/adversary-effects/t4-core";
import type { AdversaryDef } from "@/lib/srd/types";

// Plan combat-actions, tracer AE-t4-core: every feature of the 18 tier 4 Core Book adversaries (CB p.234-239) run through
// the AA1 runner with fixed dice. Expected values are worked out by hand from the feature text and the stat block (the
// runner adds the printed ATK to the d20). RNG order: modifier dice (the Abomination's +2d4), the d20(s), damage dice in
// step order (a damage roll is rolled once per move, R9), then prompt numbers (summon counts, spotlight counts, countdown
// starts). Every successful run checks that all queued dice were used. A PC's reaction roll is a prompt (the player rolls,
// AR11); an NPC target rolls a d20 itself (CB p.161), which is how the tests reach a save's onFail / onSuccess branches.

// ---------------------------------------------------------------- fixtures

const T4_CORE = ADVERSARIES.filter((a) => adversaryGroup(a) === "t4-core");

const def = (id: string): AdversaryDef => {
  const d = ADVERSARIES.find((a) => a.id === id);
  if (!d) throw new Error(`No adversary ${id}`);
  return d;
};

const effectOf = (adversaryId: string, feature: string): AdversaryFeatureEffect => {
  const e = T4_CORE_EFFECTS.find((x) => x.adversaryId === adversaryId && x.feature === feature);
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
  thresholds: { major: 20, severe: 40 },
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
    tier: 4,
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
const hopeOf = (p: AdversaryPlan) => ofKind(p, "hope").map((h) => [h.targetId, h.delta]);

const state = (over: Partial<AdversaryState> = {}): AdversaryState => ({ hp: 0, hpMax: 8, stress: 0, stressMax: 5, conditions: [], tokens: 0, ...over });
const passivesOf = (adversaryId: string, over: Partial<AdversaryState> = {}): PassiveSummary => passiveSummary(adversaryEffects(adversaryId), state(over), 4);

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

const failAction = { kind: "action", success: false, withHope: true, withFear: false } as const;
const successAction = { kind: "action", success: true, withHope: true, withFear: false } as const;

// ---------------------------------------------------------------- the table

describe("the tier 4 core table (Q15)", () => {
  it("has exactly one entry per printed feature of the 18 tier 4 core adversaries (82), no more", () => {
    const expected = T4_CORE.flatMap((a) => a.features.map((f) => `${a.id}/${f.name}`)).sort();
    const actual = T4_CORE_EFFECTS.map((e) => `${e.adversaryId}/${e.feature}`).sort();
    expect(T4_CORE).toHaveLength(18);
    expect(expected).toHaveLength(82);
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual).toEqual(expected);
    for (const e of T4_CORE_EFFECTS) expect(adversaryGroup(def(e.adversaryId))).toBe("t4-core");
  });

  it("every use has a unique id; passives, reactions and automatic uses never need the spotlight (CB p.194)", () => {
    for (const e of T4_CORE_EFFECTS) {
      const ids = e.uses.map((u) => u.id);
      expect(new Set(ids).size, `${e.adversaryId}/${e.feature}`).toBe(ids.length);
      expect(e.uses.length).toBeGreaterThan(0);
      for (const u of e.uses) {
        if (u.activation.kind !== "action") expect(u.needsSpotlight, `${e.adversaryId}/${e.feature}:${u.id}`).toBe(false);
        if (u.modifiers) expect(u.activation.kind).toBe("passive");
      }
    }
  });

  it("only Group Attack and Cornered are actions without the spotlight (they bring it)", () => {
    const free = T4_CORE_EFFECTS.flatMap((e) => e.uses.filter((u) => u.activation.kind === "action" && !u.needsSpotlight).map(() => `${e.adversaryId}/${e.feature}`));
    expect(free.sort()).toEqual(["fallen-shock-troop/Group Attack", "hallowed-soldier/Group Attack", "outer-realms-thrall/Group Attack", "volcanic-dragon-ashen-tyrant/Cornered"]);
  });

  it("every printed Fear cost is a Fear cost of the entry: upfront, or a payment the GM picks (Q19)", () => {
    for (const a of T4_CORE) {
      for (const f of a.features.filter((x) => x.fearCost)) {
        const e = effectOf(a.id, f.name);
        const upfront = e.uses.map((u) => fearCosts(u.costs));
        const later = e.uses
          .flatMap((u) => stepsDeep(u.steps))
          .filter((s) => s.kind === "optional" || s.kind === "pay")
          .map((s) => fearCosts(s.costs));
        expect([...upfront, ...later], `${a.id}/${f.name}`).toContain(f.fearCost);
      }
    }
  });

  it("every use runs through run() once its requirements and inputs are met", () => {
    const rng: Rng = (sides) => Math.ceil(sides / 2);
    for (const e of T4_CORE_EFFECTS) {
      for (const u of e.uses) {
        const situations = (u.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : []));
        const hp = (u.requires ?? []).reduce((n, r) => (r.kind === "hpMarkedAtLeast" && typeof r.value === "number" ? Math.max(n, r.value) : n), 0);
        const result = run(e, {
          ...ctx(e.adversaryId, rng),
          self: selfOf(e.adversaryId, { hp }),
          useId: u.id,
          fearConfirmed: true,
          gmFear: 12,
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
  const MOMENTUM = T4_CORE.filter((a) => a.features.some((f) => f.name === "Momentum")).map((a) => a.id);

  it.each(MOMENTUM)("%s Momentum (CB p.195): an automatic Fear on a hit against a PC, no spotlight (Q19)", (id) => {
    expect(fired(id, { kind: "onHit", attack: "feature" })).toContain("Momentum:main:auto");
    expect(plan(id, "Momentum", [], { spotlit: false })).toMatchObject({ activation: "auto", needsSpotlight: false, gmFearDelta: 1, fearSpent: 0 });
  });

  it("Momentum appears on the 2 tier 4 core stat blocks that print it", () => {
    expect(MOMENTUM.sort()).toEqual(["fallen-warlord-undefeated-champion", "kraken"]);
  });

  it.each([
    ["fallen-warlord-realm-breaker", 2],
    ["fallen-warlord-undefeated-champion", 3],
    ["high-seraph", 3],
    ["kraken", 3],
    ["volcanic-dragon-ashen-tyrant", 4],
    ["volcanic-dragon-molten-scourge", 3],
    ["volcanic-dragon-obsidian-predator", 2],
    ["zombie-legion", 2],
  ] as const)("%s Relentless (%i): spotlighted up to X times per GM turn", (id, times) => {
    expect(passivesOf(id).relentless).toBe(times);
    expect(plan(id, `Relentless (${times})`, [], { spotlit: false }).modifiers).toEqual([{ kind: "relentless", times }]);
  });

  const MINIONS = [
    ["fallen-shock-troop", 12, 12],
    ["hallowed-soldier", 13, 10],
    ["outer-realms-thrall", 13, 11],
  ] as const;

  it.each(MINIONS)("%s Minion (%i) (CB p.201)", (id, x) => {
    expect(passivesOf(id).minion).toBe(x);
  });

  it.each(MINIONS)("%s Group Attack: 1 Fear on the GM's tap, one shared roll, 3 x %i... damage combined (AR9)", (id, _x, each) => {
    expect(attempt(id, "Group Attack", [16], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    // A d20 of 16 hits Evasion 12 with every ATK here (+2, +3).
    const p = plan(id, "Group Attack", [16], { spotlit: false, fearConfirmed: true, targets: [pc("mira")], group: [selfOf(id, { id: "m2" }), selfOf(id, { id: "m3" })] });
    expect(p).toMatchObject({ fearSpent: 1, gmFearDelta: -1, group: ["m2", "m3"] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: each * 3, type: "physical" })]);
    expect(prompts(p, "move")).toHaveLength(1);
  });

  it.each(["oracle-of-doom", "perfected-zombie"])("%s Terrifying: on a hit, every PC within Far loses a Hope and the GM gains a Fear", (id) => {
    expect(fired(id, { kind: "onHit", attack: "standard" })).toContain("Terrifying:main:auto");
    const p = plan(id, "Terrifying", [], { spotlit: false, targets: [pc("mira"), pc("bram")] });
    expect(hopeOf(p)).toEqual([
      ["mira", -1],
      ["bram", -1],
    ]);
    expect(p.gmFearDelta).toBe(1);
  });

  it.each(["fallen-warlord-realm-breaker", "fallen-warlord-undefeated-champion"])("%s Doombringer: when a target marks HP from its attack, every PC within Far of them loses a Hope", (id) => {
    expect(fired(id, { kind: "onTargetMarksHp", attack: "feature" })).toEqual(["Doombringer:main:reaction"]);
    const p = plan(id, "Doombringer", [], { spotlit: false, targets: [pc("mira"), pc("bram")] });
    expect(hopeOf(p)).toEqual([
      ["mira", -1],
      ["bram", -1],
    ]);
  });

  it.each([
    ["fallen-warlord-realm-breaker", "I Have Never Known Defeat (Phase Change)", "fallen-warlord-undefeated-champion", "Fallen Warlord: Undefeated Champion"],
    ["volcanic-dragon-obsidian-predator", "Erupting Rage (Phase Change)", "volcanic-dragon-molten-scourge", "Volcanic Dragon: Molten Scourge"],
    ["volcanic-dragon-molten-scourge", "Ashen Vengeance (Phase Change)", "volcanic-dragon-ashen-tyrant", "Volcanic Dragon: Ashen Tyrant"],
  ])("%s %s: on its last HP it is replaced by the next form, which takes the spotlight", (id, feature, nextId, nextName) => {
    expect(fired(id, { kind: "onMarkHp", stage: "did", amount: 2, last: true })).toContain(`${feature}:main:reaction`);
    expect(fired(id, { kind: "onMarkHp", stage: "did", amount: 2, last: false })).not.toContain(`${feature}:main:reaction`);
    const p = plan(id, feature, [], { spotlit: false, self: selfOf(id, { hp: def(id).hp }) });
    expect(p.self.after.defeated).toBe(true);
    expect(ofKind(p, "summon")).toEqual([{ kind: "summon", label: nextName, count: 1, adversaryId: nextId }]);
    expect(ofKind(p, "spotlight")).toEqual([expect.objectContaining({ who: "sameName", count: 1, name: nextName })]);
    expect(ADVERSARIES.find((a) => a.id === nextId)?.name).toBe(nextName);
  });

  it.each(["hallowed-soldier", "high-seraph"])("%s Divine Flight: while flying, a Fear moves it up to Far before it acts", (id) => {
    expect(attempt(id, "Divine Flight", [])).toMatchObject({ ok: false, reason: "requirement" });
    expect(attempt(id, "Divine Flight", [], { situations: ["While flying"] })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const p = plan(id, "Divine Flight", [], { situations: ["While flying"], fearConfirmed: true });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "move")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- one adversary at a time

describe("Arch-Necromancer (CB p.234)", () => {
  it("Dance of Death: mark a Stress, spotlight 1d4 allies; half damage, or full damage for a Fear the GM picks", () => {
    expect(attempt("arch-necromancer", "Dance of Death", [], { spotlit: false })).toMatchObject({ ok: false, reason: "spotlight" });
    const half = plan("arch-necromancer", "Dance of Death", [3], { allies: [npc("skel")], options: { damage: ["half"] } });
    expect(half.self.after.stress).toBe(1);
    expect(ofKind(half, "spotlight")).toEqual([expect.objectContaining({ who: "allies", count: 3 })]);
    expect(ofKind(half, "effect")).toEqual([expect.objectContaining({ targetId: "skel", mods: [{ kind: "flag", flag: "halfDamage" }] })]);
    expect(half.fearSpent).toBe(0);
    const full = plan("arch-necromancer", "Dance of Death", [2], { allies: [npc("skel")], options: { damage: ["full"] } });
    expect(full).toMatchObject({ fearSpent: 1, gmFearDelta: -1 });
    expect(ofKind(full, "effect")).toEqual([]);
    expect(prompts(plan("arch-necromancer", "Dance of Death", [1], { allies: [npc("skel")] }), "choose")).toHaveLength(1);
  });

  it("Beam of Decay: 2 Stress; Strength Reaction Rolls within Far; 2d20+12 magic and a Fear per failure, half on a success", () => {
    expect(attempt("arch-necromancer", "Beam of Decay", [], { self: selfOf("arch-necromancer", { stress: 7 }) })).toMatchObject({ ok: false, reason: "cost" });
    // The PC rolls; an NPC's d20 can't reach Difficulty 21, so "a" (5) and "b" (20) both fail: 2d20 = 10 + 10, + 12 = 32,
    // rolled once for the move (R9), and a Fear for each failure.
    const p = plan("arch-necromancer", "Beam of Decay", [5, 10, 10, 20], { targets: [pc("mira"), npc("a"), npc("b")] });
    expect(p.self.after.stress).toBe(2);
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(ofKind(p, "save").map((s) => [s.targetId, s.difficulty, s.success])).toEqual([
      ["a", 21, false],
      ["b", 21, false],
    ]);
    expect(ofKind(p, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 32],
      ["b", 32],
    ]);
    expect(p.gmFearDelta).toBe(2);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira", "a", "b"] })]);
    // The success branch halves the same roll.
    const pcSave = useOf("arch-necromancer", "Beam of Decay").steps[0]!;
    expect(pcSave).toMatchObject({ kind: "save", onSuccess: [{ kind: "damage", scale: "half" }] });
  });

  it("Open the Gates of Death: a Fear summons a Zombie Legion at Close that takes the spotlight", () => {
    expect(attempt("arch-necromancer", "Open the Gates of Death", [])).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const p = plan("arch-necromancer", "Open the Gates of Death", [], { fearConfirmed: true });
    expect(p.fearSpent).toBe(1);
    expect(ofKind(p, "summon")).toEqual([{ kind: "summon", label: "Zombie Legion", count: 1, adversaryId: "zombie-legion", range: "close" }]);
    expect(ofKind(p, "spotlight")).toEqual([expect.objectContaining({ who: "sameName", name: "Zombie Legion" })]);
  });

  it("Not Today, My Dears: at 7+ HP marked, a Fear teleports the Necromancer away; the escape is manual", () => {
    expect(fired("arch-necromancer", { kind: "onHpMarked", before: 6, after: 7, hpMax: 9 }, { hp: 7, hpMax: 9 })).toContain("Not Today, My Dears:main:reaction");
    expect(attempt("arch-necromancer", "Not Today, My Dears", [], { self: selfOf("arch-necromancer", { hp: 6 }) })).toMatchObject({ ok: false, reason: "requirement" });
    expect(attempt("arch-necromancer", "Not Today, My Dears", [], { self: selfOf("arch-necromancer", { hp: 7 }) })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("arch-necromancer", "Not Today, My Dears", [], { self: selfOf("arch-necromancer", { hp: 7 }), fearConfirmed: true, spotlit: false });
    expect(p.fearSpent).toBe(1);
    expect(prompts(p, "move")).toHaveLength(1);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Your Life Is Mine: at 6+ HP marked a Loop 2d6 countdown starts, ticks on action rolls, then 2d10+6 direct magic", () => {
    expect(fired("arch-necromancer", { kind: "onHpMarked", before: 5, after: 6, hpMax: 9 }, { hp: 6, hpMax: 9 })).toContain("Your Life Is Mine:activate:reaction");
    const start = plan("arch-necromancer", "Your Life Is Mine", [4, 5], { useId: "activate", self: selfOf("arch-necromancer", { hp: 6 }), spotlit: false });
    expect(ofKind(start, "countdown")).toEqual([expect.objectContaining({ op: "start", label: "Your Life Is Mine", start: 9, loop: true })]);
    expect(fired("arch-necromancer", { kind: "pcRolls", roll: successAction })).toContain("Your Life Is Mine:tick:auto");
    expect(fired("arch-necromancer", { kind: "situation", text: "The Your Life Is Mine countdown triggers" })).toEqual(["Your Life Is Mine:drain:reaction"]);
    const drain = plan("arch-necromancer", "Your Life Is Mine", [3, 4], { useId: "drain", spotlit: false, targets: [pc("mira")] });
    expect(drain.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 13, type: "magic", direct: true })]);
    expect(prompts(drain, "manual")).toHaveLength(1);
  });
});

describe("Fallen Shock Troop (CB p.234)", () => {
  it("Aura of Doom: a PC who marks HP from its attack loses a Hope", () => {
    expect(fired("fallen-shock-troop", { kind: "onTargetMarksHp", attack: "standard" })).toEqual(["Aura of Doom:main:auto"]);
    expect(hopeOf(plan("fallen-shock-troop", "Aura of Doom", [], { spotlit: false, trigger: { subject: pc("mira") } }))).toEqual([["mira", -1]]);
  });
});

describe("Fallen Sorcerer (CB p.234)", () => {
  it("Conflagration: a Fear; attack all within Close; 2d10+6 direct magic to the hits", () => {
    expect(attempt("fallen-sorcerer", "Conflagration", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    // d20 10 + 4 = 14: hits Evasion 12, misses 16. 2d10 = 5 + 6, + 6 = 17.
    const p = plan("fallen-sorcerer", "Conflagration", [10, 5, 6], { fearConfirmed: true, targets: [pc("mira"), pc("bram", { evasion: 16 })] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 17, type: "magic", direct: true })]);
  });

  it("Nightmare Tableau: a Stress; Restrained and Vulnerable until an Instinct Roll", () => {
    const p = plan("fallen-sorcerer", "Nightmare Tableau", [], { targets: [pc("mira")] });
    expect(p.self.after.stress).toBe(1);
    expect(after(p, "mira")!.conditions).toEqual(["restrained", "vulnerable"]);
    expect(ofKind(p, "condition").map((c) => c.endsWhen)).toEqual(["until they break free with a successful Instinct Roll", "until they break free with a successful Instinct Roll"]);
  });

  it("Slippery: on damage from an attack it can teleport within Far", () => {
    expect(fired("fallen-sorcerer", { kind: "onDamaged", stage: "did", fromAttack: true })).toEqual(["Slippery:main:reaction"]);
    expect(fired("fallen-sorcerer", { kind: "onDamaged", stage: "did", fromAttack: false })).toEqual([]);
    expect(prompts(plan("fallen-sorcerer", "Slippery", [], { spotlit: false }), "move")).toHaveLength(1);
  });

  it("Shackles of Guilt: a Loop 2d6 countdown on the first spotlight; when it triggers, Vulnerable and a Stress within Far", () => {
    expect(fired("fallen-sorcerer", { kind: "onSpotlight", first: { scene: true, ever: true }, tokens: 0 })).toEqual(["Shackles of Guilt:activate:reaction"]);
    expect(fired("fallen-sorcerer", { kind: "onSpotlight", first: { scene: false, ever: false }, tokens: 0 })).toEqual([]);
    const start = plan("fallen-sorcerer", "Shackles of Guilt", [3, 4], { useId: "activate", spotlit: false });
    expect(ofKind(start, "countdown")).toEqual([expect.objectContaining({ op: "start", start: 7, loop: true })]);
    expect(fired("fallen-sorcerer", { kind: "pcRolls", roll: failAction })).toEqual(["Shackles of Guilt:tick:auto"]);
    const p = plan("fallen-sorcerer", "Shackles of Guilt", [], { useId: "regret", spotlit: false, targets: [pc("mira"), pc("bram")] });
    expect(after(p, "mira")).toMatchObject({ stress: 1, conditions: ["vulnerable"] });
    expect(after(p, "bram")).toMatchObject({ stress: 1, conditions: ["vulnerable"] });
    expect(prompts(p, "manual")).toHaveLength(1);
  });
});

describe("Fallen Warlord: Realm-Breaker (CB p.235)", () => {
  it("Firespite Plate Armor: damage it would take is reduced by 2d10 (a fold)", () => {
    expect(fired("fallen-warlord-realm-breaker", { kind: "onDamaged", stage: "would" })).toEqual(["Firespite Plate Armor:main:auto"]);
    expect(fired("fallen-warlord-realm-breaker", { kind: "onDamaged", stage: "did" })).toEqual([]);
    const p = plan("fallen-warlord-realm-breaker", "Firespite Plate Armor", [4, 7], { spotlit: false });
    expect(ofKind(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["self"], amount: 11 })]);
  });

  it("Tormenting Lash: a Stress; a standard attack against all within Very Close; the 2-Armor-Slot rule is manual", () => {
    // d20 9 + 7 = 16 hits Evasion 12 and 15. 4d8 = 1 + 2 + 3 + 4, + 7 = 17.
    const p = plan("fallen-warlord-realm-breaker", "Tormenting Lash", [9, 1, 2, 3, 4], { targets: [pc("mira"), pc("bram", { evasion: 15 })] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming.map((h) => [h.targetId, h.amount, h.type])).toEqual([
      ["mira", 17, "physical"],
      ["bram", 17, "physical"],
    ]);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira", "bram"] })]);
  });

  it("All-Consuming Rage: a Decreasing 8 countdown; Presence Reaction Rolls for 2d6+10 direct magic; the end is a GM button", () => {
    expect(fired("fallen-warlord-realm-breaker", { kind: "onSpotlight", first: { scene: true, ever: true }, tokens: 0 })).toEqual(["All-Consuming Rage:activate:reaction"]);
    const start = plan("fallen-warlord-realm-breaker", "All-Consuming Rage", [], { useId: "activate", spotlit: false });
    expect(ofKind(start, "countdown")).toEqual([expect.objectContaining({ op: "start", start: 8, loop: true })]);
    // The PC rolls; the NPC rolls 3 against Difficulty 20 and fails: 2d6 = 2 + 3, + 10 = 15 direct magic.
    const rage = plan("fallen-warlord-realm-breaker", "All-Consuming Rage", [3, 2, 3], { useId: "rage", spotlit: false, targets: [pc("mira"), npc("a")] });
    expect(prompts(rage, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(ofKind(rage, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([["a", 15]]);
    expect(prompts(rage, "manual")).toHaveLength(1);
    expect(ofKind(rage, "countdown")).toEqual([expect.objectContaining({ op: "prompt", label: "All-Consuming Rage" })]);
    const doom = plan("fallen-warlord-realm-breaker", "All-Consuming Rage", [], { useId: "doom", spotlit: false, targets: [pc("mira")] });
    expect(doom.self.after.defeated).toBe(true);
    expect(prompts(doom, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });
});

describe("Fallen Warlord: Undefeated Champion (CB p.235)", () => {
  it("Faltering Armor: damage it would take is reduced by 1d10", () => {
    expect(fired("fallen-warlord-undefeated-champion", { kind: "onDamaged", stage: "would" })).toEqual(["Faltering Armor:main:auto"]);
    expect(ofKind(plan("fallen-warlord-undefeated-champion", "Faltering Armor", [6], { spotlit: false }), "fold")).toEqual([expect.objectContaining({ amount: 6 })]);
  });

  it("Shattering Strike: a Stress; a standard attack against all within Very Close; the Hope loss per HP is manual", () => {
    // d20 5 + 8 = 13: hits 12, misses 15. 4d12 = 1 + 1 + 1 + 1, + 13 = 17.
    const p = plan("fallen-warlord-undefeated-champion", "Shattering Strike", [5, 1, 1, 1, 1], { targets: [pc("mira"), pc("bram", { evasion: 15 })] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 17, type: "physical" })]);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
  });

  it("Endless Legions: a Fear summons Fallen Shock Troops at Far, twice the PCs (the targets)", () => {
    expect(attempt("fallen-warlord-undefeated-champion", "Endless Legions", [], { targets: [pc("a")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("fallen-warlord-undefeated-champion", "Endless Legions", [], { fearConfirmed: true, targets: [pc("a"), pc("b"), pc("c")] });
    expect(p.fearSpent).toBe(1);
    expect(ofKind(p, "summon")).toEqual([expect.objectContaining({ label: "Fallen Shock Troop", adversaryId: "fallen-shock-troop", range: "far" })]);
    const summon = useOf("fallen-warlord-undefeated-champion", "Endless Legions").steps[0]!;
    expect(summon).toMatchObject({ kind: "summon", count: { kind: "calc", of: { kind: "targetCount", which: "picked" }, times: 2 } });
  });

  it("Circle of Defilement: a 1d8 countdown; the circle makes everyone in it Vulnerable; Severe damage removes it", () => {
    const start = plan("fallen-warlord-undefeated-champion", "Circle of Defilement", [5], { useId: "activate", spotlit: false });
    expect(ofKind(start, "countdown")).toEqual([expect.objectContaining({ op: "start", start: 5, loop: false })]);
    const p = plan("fallen-warlord-undefeated-champion", "Circle of Defilement", [], { useId: "circle", spotlit: false, targets: [pc("mira"), npc("ally")] });
    expect(after(p, "mira")!.conditions).toEqual(["vulnerable"]);
    expect(after(p, "ally")!.conditions).toEqual(["vulnerable"]);
    expect(prompts(p, "manual")).toHaveLength(1);
    const severe: AdversaryEvent = { kind: "onDamaged", stage: "did", severity: "severe" };
    expect(fired("fallen-warlord-undefeated-champion", severe, { situations: ["The Circle of Defilement is active"] })).toContain("Circle of Defilement:break:auto");
    expect(fired("fallen-warlord-undefeated-champion", severe)).not.toContain("Circle of Defilement:break:auto");
  });
});

describe("Hallowed Archer (CB p.236)", () => {
  it("Punish the Guilty: double damage on a hit against a Guilty target", () => {
    expect(fired("hallowed-archer", { kind: "onHit", attack: "standard", target: { conditions: [], tags: ["Guilty"] } })).toEqual(["Punish the Guilty:main:auto"]);
    expect(fired("hallowed-archer", { kind: "onHit", attack: "standard", target: { conditions: [], tags: [] } })).toEqual([]);
    const p = plan("hallowed-archer", "Punish the Guilty", [], { spotlit: false, trigger: { subject: pc("mira", { tags: ["Guilty"] }) } });
    expect(ofKind(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ change: { kind: "multiply", factor: 2 } }) })]);
  });

  it("Divine Volley: a Stress; one standard attack roll against up to three targets", () => {
    // d20 8 + 4 = 12 hits Evasion 12. 4d8 = 1 + 2 + 3 + 4, + 8 = 18.
    const p = plan("hallowed-archer", "Divine Volley", [8, 1, 2, 3, 4], { targets: [pc("a"), pc("b"), pc("c")] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming.map((h) => [h.targetId, h.amount])).toEqual([
      ["a", 18],
      ["b", 18],
      ["c", 18],
    ]);
    expect(attempt("hallowed-archer", "Divine Volley", [], { targets: [pc("a"), pc("b"), pc("c"), pc("d")] })).toMatchObject({ ok: false, reason: "targets" });
  });
});

describe("High Seraph (CB p.236)", () => {
  it("Judgment: a Fear marks a target Guilty until the Seraph is defeated; a standard hit on them deals Severe damage", () => {
    expect(attempt("high-seraph", "Judgment", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("high-seraph", "Judgment", [], { fearConfirmed: true, targets: [pc("mira")] });
    expect(ofKind(p, "condition")).toEqual([expect.objectContaining({ targetId: "mira", condition: { kind: "tag", tag: "Guilty" }, endsWhen: "until the Seraph is defeated" })]);
    expect(prompts(p, "manual")).toHaveLength(1);
    const guilty = { conditions: [], tags: ["Guilty"] };
    expect(fired("high-seraph", { kind: "onHit", attack: "standard", target: guilty })).toEqual(["Judgment:severe:auto"]);
    expect(fired("high-seraph", { kind: "onHit", attack: "feature", target: guilty })).toEqual([]);
    const severe = plan("high-seraph", "Judgment", [], { useId: "severe", spotlit: false, trigger: { subject: pc("mira", { tags: ["Guilty"] }) } });
    expect(ofKind(severe, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], step: expect.objectContaining({ change: { kind: "minimumSeverity", severity: "severe" } }) })]);
  });

  it("God Rays: a Stress; up to twenty targets make a Presence Reaction Roll; 4d6+12 magic, half on a success", () => {
    // The PCs roll; the NPC rolls 10 against Difficulty 20 and fails: 4d6 = 1 + 2 + 3 + 4, + 12 = 22.
    const p = plan("high-seraph", "God Rays", [10, 1, 2, 3, 4], { targets: [pc("a"), pc("b"), npc("c")] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toHaveLength(2);
    expect(ofKind(p, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([["c", 22]]);
    const many = Array.from({ length: 21 }, (_, i) => pc(`p${i}`));
    expect(attempt("high-seraph", "God Rays", [], { targets: many })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("We Are One: once per scene, a Fear spotlights every other adversary within Far at half damage", () => {
    expect(attempt("high-seraph", "We Are One", [])).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("high-seraph", "We Are One", [], { fearConfirmed: true, allies: [npc("a"), npc("b")] });
    expect(ofKind(p, "spotlight")).toEqual([expect.objectContaining({ who: "allies", within: "far" })]);
    expect(ofKind(p, "effect").map((e) => e.targetId)).toEqual(["a", "b"]);
    expect(p.limit).toMatchObject({ consumed: true });
    expect(attempt("high-seraph", "We Are One", [], { fearConfirmed: true, featureUses: p.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Kraken (CB p.236)", () => {
  it("Many Tentacles: with 7 or fewer HP marked, its standard attack can hit two targets", () => {
    expect(attempt("kraken", "Many Tentacles", [], { self: selfOf("kraken", { hp: 8 }), targets: [pc("a")] })).toMatchObject({ ok: false, reason: "requirement" });
    // d20 6 + 7 = 13 hits both. 4d12 = 1 + 2 + 3 + 4, + 10 = 20.
    const p = plan("kraken", "Many Tentacles", [6, 1, 2, 3, 4], { self: selfOf("kraken", { hp: 7 }), targets: [pc("a"), pc("b")] });
    expect(p.incoming.map((h) => [h.targetId, h.amount])).toEqual([
      ["a", 20],
      ["b", 20],
    ]);
    expect(attempt("kraken", "Many Tentacles", [], { targets: [pc("a"), pc("b"), pc("c")] })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("Grapple and Drown: on a hit, a Stress to Restrain and make Vulnerable; the Stress per action roll is manual", () => {
    const p = plan("kraken", "Grapple and Drown", [10], { targets: [pc("mira")] });
    expect(p.self.after.stress).toBe(1);
    expect(after(p, "mira")!.conditions).toEqual(["restrained", "vulnerable"]);
    expect(prompts(p, "manual")).toHaveLength(1);
    expect(p.incoming).toEqual([]);
    const miss = plan("kraken", "Grapple and Drown", [1], { targets: [pc("mira")] });
    expect(miss.self.after.stress).toBe(0);
  });

  it("Boiling Blast: a Fear; any number in a line make an Agility Reaction Roll or take 4d6+9; the armor Stress is manual", () => {
    expect(attempt("kraken", "Boiling Blast", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    // The NPC rolls 2 against Difficulty 20: 4d6 = 1 + 1 + 1 + 1, + 9 = 13.
    const p = plan("kraken", "Boiling Blast", [2, 1, 1, 1, 1], { fearConfirmed: true, targets: [pc("mira"), npc("a")] });
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(ofKind(p, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([["a", 13]]);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["a"] })]);
  });
});

describe("Oracle of Doom (CB p.237)", () => {
  it("Walls Closing In: a failure within Very Far makes the roller mark a Stress", () => {
    expect(fired("oracle-of-doom", { kind: "pcRolls", band: "far", roll: failAction })).toEqual(["Walls Closing In:main:auto"]);
    expect(fired("oracle-of-doom", { kind: "pcRolls", band: "far", roll: successAction })).toEqual([]);
    expect(after(plan("oracle-of-doom", "Walls Closing In", [], { spotlit: false, trigger: { subject: pc("mira") } }), "mira")).toMatchObject({ stress: 1 });
  });

  it("Pronounce Fate: a Fear; a Knowledge Reaction Roll; failure: all Hope and 2d20+4 direct magic; success: half and a Hope", () => {
    expect(attempt("oracle-of-doom", "Pronounce Fate", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    expect(prompts(plan("oracle-of-doom", "Pronounce Fate", [], { fearConfirmed: true, targets: [pc("mira")] }), "pcSave")).toHaveLength(1);
    // NPC targets show both branches: 3 fails against 20 (2d20 = 5 + 5, + 4 = 14); 20 succeeds (7).
    const fail = plan("oracle-of-doom", "Pronounce Fate", [3, 5, 5], { fearConfirmed: true, targets: [npc("a")] });
    expect(hopeOf(fail)).toEqual([["a", -6]]);
    expect(ofKind(fail, "damage").map((d) => d.result.incoming)).toEqual([14]);
    const pass = plan("oracle-of-doom", "Pronounce Fate", [20, 5, 5], { fearConfirmed: true, targets: [npc("a")] });
    expect(ofKind(pass, "damage").map((d) => d.result.incoming)).toEqual([7]);
    expect(hopeOf(pass)).toEqual([["a", -1]]);
  });

  it("Summon Tormentors: 2 Fear, once per day (session): 2d4 Minions at Close of the PC", () => {
    expect(attempt("oracle-of-doom", "Summon Tormentors", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear", detail: "2" });
    const p = plan("oracle-of-doom", "Summon Tormentors", [2, 3], { fearConfirmed: true, targets: [pc("mira")] });
    expect(p.fearSpent).toBe(2);
    expect(ofKind(p, "summon")).toEqual([expect.objectContaining({ count: 5, range: "close" })]);
    expect(p.limit).toMatchObject({ consumed: true });
    expect(attempt("oracle-of-doom", "Summon Tormentors", [], { fearConfirmed: true, targets: [pc("mira")], featureUses: p.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Ominous Knowledge: a GM button when it sees a mortal creature; the nightmare is manual", () => {
    expect(fired("oracle-of-doom", { kind: "situation", text: "The Oracle sees a mortal creature" })).toEqual(["Ominous Knowledge:main:reaction"]);
    expect(prompts(plan("oracle-of-doom", "Ominous Knowledge", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Vengeful Fate: on HP from an attack within Very Close, a Stress knocks the attacker to Far and deals 2d10+4", () => {
    expect(fired("oracle-of-doom", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "veryClose" })).toEqual(["Vengeful Fate:main:reaction"]);
    expect(fired("oracle-of-doom", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "close" })).toEqual([]);
    const p = plan("oracle-of-doom", "Vengeful Fate", [4, 5], { spotlit: false, trigger: { source: pc("rook") } });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "rook", amount: 13, type: "physical" })]);
    expect(prompts(p, "move")).toEqual([expect.objectContaining({ targetIds: ["rook"] })]);
  });
});

describe("Outer Realms Abomination (CB p.237)", () => {
  // The runner rolls the printed "+2d4" modifier dice first on every run of this adversary, even for uses without an
  // attack roll (AA1 run.ts; noted for AA2), so each run below starts with two d4s.
  it("Chaotic Form: its attack modifier is a 2d4 rolled on each attack (the printed +2d4)", () => {
    expect(plan("outer-realms-abomination", "Chaotic Form", [1, 1], { spotlit: false }).modifiers).toEqual([]);
    // 2d4 = 1 + 2 = +3; d20 10 + 3 = 13 hits 12. 4d6 = 1 + 1 + 1 + 1, + 13 = 17 magic.
    const p = ok(runStandardAttack(ctx("outer-realms-abomination", queueRng([1, 2, 10, 1, 1, 1, 1]), { targets: [pc("mira")] })));
    expect(p.roll!.record.total).toBe(13);
    expect(p.incoming[0]).toMatchObject({ amount: 17, type: "magic" });
  });

  it("Disorienting Presence: a target it damages makes an Instinct Reaction Roll; failure: disadvantage next roll and a Fear", () => {
    expect(fired("outer-realms-abomination", { kind: "onDealDamage", toPc: true })).toEqual(["Disorienting Presence:main:auto"]);
    expect(prompts(plan("outer-realms-abomination", "Disorienting Presence", [1, 1], { spotlit: false, trigger: { subject: pc("mira") } }), "pcSave")).toHaveLength(1);
    const p = plan("outer-realms-abomination", "Disorienting Presence", [1, 1, 5], { spotlit: false, trigger: { subject: npc("a") } });
    expect(ofKind(p, "condition")).toEqual([expect.objectContaining({ targetId: "a", condition: { kind: "tag", tag: "Disoriented" }, duration: "nextRoll" })]);
    expect(prompts(p, "manual")).toHaveLength(1);
    expect(p.gmFearDelta).toBe(1);
  });

  it("Reality Quake: a Fear; Knowledge Reaction Rolls within Far or Unstuck until the scene ends; the doubling is manual", () => {
    expect(attempt("outer-realms-abomination", "Reality Quake", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("outer-realms-abomination", "Reality Quake", [1, 1, 4], { fearConfirmed: true, targets: [pc("mira"), npc("a")] });
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(ofKind(p, "condition")).toEqual([expect.objectContaining({ targetId: "a", condition: { kind: "tag", tag: "Unstuck" }, duration: "scene" })]);
    expect(prompts(p, "manual")).toEqual([expect.objectContaining({ targetIds: ["a"] })]);
  });

  it("Unreal Form: incoming damage reduced by 1d20; marking 1 HP from a successful attack gains a Fear", () => {
    expect(fired("outer-realms-abomination", { kind: "onDamaged", stage: "would" })).toEqual(["Unreal Form:reduce:reaction"]);
    expect(fired("outer-realms-abomination", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true })).toEqual(["Unreal Form:fear:auto"]);
    expect(fired("outer-realms-abomination", { kind: "onMarkHp", stage: "did", amount: 2, last: false, fromAttack: true })).toEqual([]);
    expect(ofKind(plan("outer-realms-abomination", "Unreal Form", [1, 1, 13], { useId: "reduce", spotlit: false }), "fold")).toEqual([expect.objectContaining({ amount: 13 })]);
    expect(plan("outer-realms-abomination", "Unreal Form", [1, 1], { useId: "fear", spotlit: false }).gmFearDelta).toBe(1);
  });
});

describe("Outer Realms Corruptor (CB p.237)", () => {
  it("Will-Shattering Touch: a PC it damages loses a Hope", () => {
    expect(fired("outer-realms-corruptor", { kind: "onDealDamage", toPc: true })).toEqual(["Will-Shattering Touch:main:auto"]);
    expect(hopeOf(plan("outer-realms-corruptor", "Will-Shattering Touch", [], { spotlit: false, trigger: { subject: pc("mira") } }))).toEqual([["mira", -1]]);
  });

  it("Disgorge Reality Flotsam: a Stress; Knowledge Reaction Rolls within Close or 2 Stress", () => {
    const p = plan("outer-realms-corruptor", "Disgorge Reality Flotsam", [2], { targets: [pc("mira"), npc("a")] });
    expect(p.self.after.stress).toBe(1);
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(after(p, "a")).toMatchObject({ stress: 2 });
  });
});

describe("Perfected Zombie (CB p.239)", () => {
  it("Fearsome Presence: the Hope ban on PCs' features is a reminder (manual)", () => {
    const p = plan("perfected-zombie", "Fearsome Presence", [], { spotlit: false });
    expect(p.activation).toBe("passive");
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Perfect Strike: a Stress; a standard attack against all within Very Close; hits are Vulnerable until their next rest", () => {
    // d20 9 + 4 = 13 hits 12. 4d12 = 1 + 1 + 1 + 1, + 15 = 19.
    const p = plan("perfected-zombie", "Perfect Strike", [9, 1, 1, 1, 1], { targets: [pc("mira"), pc("bram", { evasion: 14 })] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 19 })]);
    expect(ofKind(p, "condition")).toEqual([expect.objectContaining({ targetId: "mira", condition: { kind: "standard", condition: "vulnerable" }, duration: "rest" })]);
  });

  it("Skilled Opportunist: when an ally damages a target near the Zombie, a Fear adds its 4d12+15 to the damage", () => {
    const near = ["The target is within Very Close range of the Zombie"];
    expect(fired("perfected-zombie", { kind: "allyDealtDamage" }, { situations: near })).toEqual(["Skilled Opportunist:main:reaction"]);
    expect(fired("perfected-zombie", { kind: "allyDealtDamage" })).toEqual([]);
    expect(attempt("perfected-zombie", "Skilled Opportunist", [], { situations: near, spotlit: false })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("perfected-zombie", "Skilled Opportunist", [1, 2, 3, 4], { situations: near, spotlit: false, fearConfirmed: true, trigger: { subject: pc("mira") } });
    expect(p.fearSpent).toBe(1);
    expect(ofKind(p, "fold")).toEqual([expect.objectContaining({ targetIds: ["mira"], amount: 25 })]);
  });
});

describe("Volcanic Dragon: Ashen Tyrant (CB p.239)", () => {
  it("Cornered: a Stress spotlights it instead of a Fear", () => {
    const p = plan("volcanic-dragon-ashen-tyrant", "Cornered", [], { spotlit: false });
    expect(p).toMatchObject({ fearSpent: 0, needsSpotlight: false });
    expect(p.self.after.stress).toBe(1);
    expect(ofKind(p, "spotlight")).toEqual([expect.objectContaining({ who: "self" })]);
  });

  it("Injured Wings: +1 Difficulty while flying", () => {
    expect(passivesOf("volcanic-dragon-ashen-tyrant", { situations: ["While flying"] })).toMatchObject({ difficulty: 1, flags: ["flying"] });
    expect(passivesOf("volcanic-dragon-ashen-tyrant").difficulty).toBe(0);
  });

  it("Ashes to Ashes: a failure within Close loses a Hope and gains a Fear; no Hope to lose is a manual HP", () => {
    expect(fired("volcanic-dragon-ashen-tyrant", { kind: "pcRolls", band: "close", roll: failAction })).toEqual(["Ashes to Ashes:main:auto"]);
    expect(fired("volcanic-dragon-ashen-tyrant", { kind: "pcRolls", band: "far", roll: failAction })).toEqual([]);
    const p = plan("volcanic-dragon-ashen-tyrant", "Ashes to Ashes", [], { spotlit: false, trigger: { subject: pc("mira") } });
    expect(hopeOf(p)).toEqual([["mira", -1]]);
    expect(p.gmFearDelta).toBe(1);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Desperate Rampage: a Stress; attack all within Close; 2d20+2, knocked back, a Stress", () => {
    // d20 2 + 10 = 12: hits 12, misses 13. 2d20 = 10 + 10, + 2 = 22.
    const p = plan("volcanic-dragon-ashen-tyrant", "Desperate Rampage", [2, 10, 10], { targets: [pc("mira"), pc("bram", { evasion: 13 })] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 22, type: "physical" })]);
    expect(prompts(p, "move")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(after(p, "mira")).toMatchObject({ stress: 1 });
    expect(after(p, "bram")).toBeUndefined();
  });

  it("Ashen Cloud: a Fear; everyone within Far is in the ash cloud; its disadvantage and clearing are manual", () => {
    expect(attempt("volcanic-dragon-ashen-tyrant", "Ashen Cloud", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("volcanic-dragon-ashen-tyrant", "Ashen Cloud", [], { fearConfirmed: true, targets: [pc("mira"), npc("a")] });
    expect(ofKind(p, "condition").map((c) => c.targetId)).toEqual(["mira", "a"]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Apocalyptic Thrashing: a Fear starts a 1d12 countdown that ticks on Fear; Strength Reaction Rolls for 2d10+10; death throes", () => {
    expect(attempt("volcanic-dragon-ashen-tyrant", "Apocalyptic Thrashing", [])).toMatchObject({ ok: false, reason: "confirmFear" });
    const start = plan("volcanic-dragon-ashen-tyrant", "Apocalyptic Thrashing", [7], { fearConfirmed: true });
    expect(ofKind(start, "countdown")).toEqual([expect.objectContaining({ op: "start", start: 7, loop: false })]);
    expect(fired("volcanic-dragon-ashen-tyrant", { kind: "pcRolls", roll: { kind: "action", success: true, withHope: false, withFear: true } })).toEqual(["Apocalyptic Thrashing:tick:auto"]);
    expect(fired("volcanic-dragon-ashen-tyrant", { kind: "pcRolls", roll: successAction })).toEqual([]);
    // NPC "a" rolls 4 against 18 and fails (2d10 = 3 + 4, + 10 = 17, Restrained); "b" rolls 18 and takes half (9).
    const p = plan("volcanic-dragon-ashen-tyrant", "Apocalyptic Thrashing", [4, 3, 4, 18], { useId: "thrash", spotlit: false, targets: [npc("a"), npc("b")] });
    expect(ofKind(p, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 17],
      ["b", 9],
    ]);
    expect(ofKind(p, "condition")).toEqual([expect.objectContaining({ targetId: "a", condition: { kind: "standard", condition: "restrained" } })]);
    const active = ["The Apocalyptic Thrashing countdown is active"];
    expect(fired("volcanic-dragon-ashen-tyrant", { kind: "onDefeated" }, { situations: active })).toEqual(["Apocalyptic Thrashing:death-throes:auto"]);
    expect(fired("volcanic-dragon-ashen-tyrant", { kind: "onDefeated" })).toEqual([]);
    expect(ofKind(plan("volcanic-dragon-ashen-tyrant", "Apocalyptic Thrashing", [], { useId: "death-throes", spotlit: false, situations: active }), "countdown")).toEqual([
      expect.objectContaining({ op: "prompt", label: "Apocalyptic Thrashing" }),
    ]);
  });
});

describe("Volcanic Dragon: Molten Scourge (CB p.238)", () => {
  it("Cracked Scales: on damage, a d6 per marked HP; a 4 or higher gains a Fear (further ones by hand)", () => {
    expect(fired("volcanic-dragon-molten-scourge", { kind: "onDamaged", stage: "did" })).toContain("Cracked Scales:main:auto");
    const hit = plan("volcanic-dragon-molten-scourge", "Cracked Scales", [2, 5, 4], { spotlit: false, self: selfOf("volcanic-dragon-molten-scourge", { hp: 3 }) });
    expect(ofKind(hit, "check")).toEqual([expect.objectContaining({ dice: [2, 5, 4], passed: true })]);
    expect(hit.gmFearDelta).toBe(1);
    expect(prompts(hit, "manual")).toHaveLength(1);
    const none = plan("volcanic-dragon-molten-scourge", "Cracked Scales", [1, 2, 3], { spotlit: false, self: selfOf("volcanic-dragon-molten-scourge", { hp: 3 }) });
    expect(none.gmFearDelta).toBe(0);
  });

  it("Shattering Might: a Stress; on a hit 4d8+1, a Hope, knocked back, and the Scourge clears a Stress", () => {
    // d20 5 + 9 = 14 hits 12. 4d8 = 1 + 2 + 3 + 4, + 1 = 11.
    const p = plan("volcanic-dragon-molten-scourge", "Shattering Might", [5, 1, 2, 3, 4], { targets: [pc("mira")] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 11, type: "physical" })]);
    expect(hopeOf(p)).toEqual([["mira", -1]]);
    expect(prompts(p, "move")).toHaveLength(1);
    expect(p.self.after.stress).toBe(0);
    expect(plan("volcanic-dragon-molten-scourge", "Shattering Might", [1], { targets: [pc("mira")] }).self.after.stress).toBe(1);
  });

  it("Eruption: a Fear; Agility Reaction Rolls within Very Close or 4d6+6 and knocked back; the lava stays (manual)", () => {
    expect(attempt("volcanic-dragon-molten-scourge", "Eruption", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "confirmFear" });
    const p = plan("volcanic-dragon-molten-scourge", "Eruption", [3, 1, 1, 1, 1], { fearConfirmed: true, targets: [pc("mira"), npc("a")] });
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(ofKind(p, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([["a", 10]]);
    expect(prompts(p, "move")).toEqual([expect.objectContaining({ targetIds: ["a"] })]);
    expect(prompts(p, "manual")).toHaveLength(1);
  });

  it("Volcanic Breath: on Major damage (2 HP), a d10; 8+ breathes lava in front within Far", () => {
    expect(fired("volcanic-dragon-molten-scourge", { kind: "onMarkHp", stage: "did", amount: 2, last: false })).toEqual(["Volcanic Breath:main:reaction"]);
    expect(fired("volcanic-dragon-molten-scourge", { kind: "onMarkHp", stage: "did", amount: 3, last: false })).toEqual([]);
    expect(fired("volcanic-dragon-molten-scourge", { kind: "onMarkHp", stage: "did", amount: 1, last: false })).toEqual([]);
    const quiet = plan("volcanic-dragon-molten-scourge", "Volcanic Breath", [7], { spotlit: false, targets: [pc("mira")] });
    expect(prompts(quiet, "pcSave")).toEqual([]);
    // d10 8; the PC rolls; "a" rolls 2 against 20 (2d10 = 3 + 3, + 4 = 10; 1d4 = 2 Stress; Vulnerable); "b" rolls 20 (half: 5, 1 Stress).
    const p = plan("volcanic-dragon-molten-scourge", "Volcanic Breath", [8, 2, 3, 3, 2, 20], { spotlit: false, targets: [pc("mira"), npc("a"), npc("b")] });
    expect(prompts(p, "pcSave")).toEqual([expect.objectContaining({ targetIds: ["mira"] })]);
    expect(ofKind(p, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 10],
      ["b", 5],
    ]);
    expect(after(p, "a")).toMatchObject({ stress: 2, conditions: ["vulnerable"] });
    expect(after(p, "b")).toMatchObject({ stress: 1 });
  });

  it("Lava Splash: Severe damage from an attack within Very Close deals 2d10+4 direct physical to the attacker", () => {
    expect(fired("volcanic-dragon-molten-scourge", { kind: "onDamaged", stage: "did", severity: "severe", fromAttack: true, attackerBand: "veryClose" })).toContain("Lava Splash:main:reaction");
    expect(fired("volcanic-dragon-molten-scourge", { kind: "onDamaged", stage: "did", severity: "severe", fromAttack: true, attackerBand: "close" })).not.toContain("Lava Splash:main:reaction");
    expect(fired("volcanic-dragon-molten-scourge", { kind: "onDamaged", stage: "did", severity: "major", fromAttack: true, attackerBand: "melee" })).not.toContain("Lava Splash:main:reaction");
    const p = plan("volcanic-dragon-molten-scourge", "Lava Splash", [3, 4], { spotlit: false, trigger: { source: pc("rook") } });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "rook", amount: 11, type: "physical", direct: true })]);
  });
});

describe("Volcanic Dragon: Obsidian Predator (CB p.238)", () => {
  it("Flying: +3 Difficulty while flying; Obsidian Scales: resistant to physical damage", () => {
    expect(passivesOf("volcanic-dragon-obsidian-predator", { situations: ["While flying"] })).toMatchObject({ difficulty: 3, flags: ["flying"] });
    expect(passivesOf("volcanic-dragon-obsidian-predator").resistance).toEqual({ physical: "resistant", magic: "none" });
  });

  it("Avalanche Tail: a Stress; attack all within Close; 4d6+4, knocked back to Far, Vulnerable until a roll with Hope", () => {
    // d20 4 + 8 = 12 hits 12. 4d6 = 1 + 1 + 1 + 1, + 4 = 8.
    const p = plan("volcanic-dragon-obsidian-predator", "Avalanche Tail", [4, 1, 1, 1, 1], { targets: [pc("mira")] });
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 8 })]);
    expect(prompts(p, "move")).toHaveLength(1);
    expect(ofKind(p, "condition")).toEqual([expect.objectContaining({ targetId: "mira", endsWhen: "until their next roll with Hope" })]);
  });

  it("Dive-Bomb: while flying, a Stress; move to a point and attack all within Very Close; 2d10+6, a Stress, a Hope", () => {
    expect(attempt("volcanic-dragon-obsidian-predator", "Dive-Bomb", [], { targets: [pc("mira")] })).toMatchObject({ ok: false, reason: "requirement" });
    const p = plan("volcanic-dragon-obsidian-predator", "Dive-Bomb", [4, 5, 5], { situations: ["While flying"], targets: [pc("mira")] });
    expect(p.self.after.stress).toBe(1);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 16 })]);
    expect(after(p, "mira")).toMatchObject({ stress: 1 });
    expect(hopeOf(p)).toEqual([["mira", -1]]);
    expect(prompts(p, "move")).toHaveLength(1);
  });
});

describe("Zombie Legion (CB p.239)", () => {
  it("Horde (2d6+5): the standard attack deals 2d6+5 once half the HP is marked (AR10)", () => {
    expect(passivesOf("zombie-legion").horde).toBe("2d6+5");
    const passives = passivesOf("zombie-legion", { hp: 4, hpMax: 8 });
    // d20 19 + 2 = 21 hits; 2d6 = 3 + 4, + 5 = 12.
    const p = ok(runStandardAttack(ctx("zombie-legion", queueRng([19, 3, 4]), { self: selfOf("zombie-legion", { hp: 4 }), passives, targets: [pc("mira")] })));
    expect(p.incoming[0]).toMatchObject({ amount: 12, type: "physical" });
  });

  it("Unyielding: resistant to physical damage", () => {
    expect(passivesOf("zombie-legion").resistance).toEqual({ physical: "resistant", magic: "none" });
  });

  it("Overwhelm: on Minor damage (1 HP) from a Melee attack, a Stress for a standard attack with advantage on the attacker", () => {
    expect(fired("zombie-legion", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "melee" })).toEqual(["Overwhelm:main:reaction"]);
    expect(fired("zombie-legion", { kind: "onMarkHp", stage: "did", amount: 2, last: false, fromAttack: true, attackerBand: "melee" })).toEqual([]);
    expect(fired("zombie-legion", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "close" })).toEqual([]);
    // d20s 5 and 14, keep 14, + 2 = 16. 4d6 = 1 + 1 + 1 + 1, + 10 = 14.
    const p = plan("zombie-legion", "Overwhelm", [5, 14, 1, 1, 1, 1], { spotlit: false, trigger: { source: pc("rook") } });
    expect(p.self.after.stress).toBe(1);
    expect(p.roll!.record.total).toBe(16);
    expect(p.incoming).toEqual([expect.objectContaining({ targetId: "rook", amount: 14 })]);
  });
});
