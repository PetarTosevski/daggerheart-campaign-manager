import { describe, expect, it } from "vitest";

import {
  adversaryFeatureUseKey,
  run,
  runStandardAttack,
  standardAttackEffect,
  upfrontFear,
  type AdversaryPlan,
  type AdversaryRunContext,
  type AdversaryRunResult,
} from "@/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect, AdversaryFeatureUse } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

// Plan combat-actions, tracer AA1: the adversary-feature runner. Expected values come from the book's examples (CB
// p.148: 2d8+2 critical with 5 and 7 = 30; CB p.195 Momentum, p.196 Explosion, p.201 Group Attack, p.199 Horde) and from
// the rule text by hand. RNG order: modifier dice ("+2d4"), the d20(s), then damage dice and prompt numbers in step order.

const fixed = (value: number) => ({ kind: "fixed" as const, value });

const self = (over: Partial<Combatant> = {}): Combatant => ({
  id: "inst1",
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

const pcTarget = (id: string, over: Partial<Combatant> = {}): Combatant => ({
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

const ctx = (dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunContext => ({
  adversaryId: "bandit",
  self: self(),
  attack: { name: "Claws", modifier: 2, range: "Melee", damage: "2d8+2 phy" },
  tier: 1,
  gmFear: 3,
  spotlit: true,
  targets: [pcTarget("mira")],
  rng: queueRng(dice),
  ...over,
});

const feature = (use: Partial<AdversaryFeatureUse>, name = "Test Feature"): AdversaryFeatureEffect => ({
  adversaryId: "bandit",
  feature: name,
  uses: [{ id: "main", activation: { kind: "action" }, needsSpotlight: true, steps: [], ...use }],
});

function ok(result: AdversaryRunResult): AdversaryPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

describe("the standard attack (AR1, AR2, AR7)", () => {
  it("CB p.148: a natural 20 hits and deals 2d8+2 critical damage = 30, as one incoming hit for the window", () => {
    const plan = ok(runStandardAttack(ctx([20, 5, 7])));
    expect(plan.roll).toMatchObject({ critical: true, record: { total: 22 } });
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: 30, type: "physical", direct: false, forcedArmor: 0, critical: true, attackTotal: 22 }]);
    expect(plan.needsSpotlight).toBe(true);
    expect(plan.creatures).toEqual([]); // nothing marked on the PC before the window
  });

  it("d20 + ATK below Evasion misses: no damage roll, no hit", () => {
    const plan = ok(runStandardAttack(ctx([9])));
    expect(plan.hits).toEqual([{ id: "mira", hit: false }]);
    expect(plan.incoming).toEqual([]);
  });

  it("hits one target in its printed range (CB p.161: one target by default)", () => {
    const effect = standardAttackEffect("bandit", { name: "Bow", range: "Far" });
    expect(effect.uses[0]!.targets).toEqual({ side: "enemy", range: "far", count: { kind: "one" } });
    expect(runStandardAttack(ctx([15], { targets: [pcTarget("a"), pcTarget("b")] }))).toMatchObject({ ok: false, reason: "targets", code: null });
  });

  it("needs the spotlight (CB p.194)", () => {
    expect(runStandardAttack(ctx([15], { spotlit: false }))).toMatchObject({ ok: false, reason: "spotlight", code: "ADVERSARY_NOT_SPOTLIT" });
  });

  it("adds passive and instance attack bonuses, an Experience for a Fear, and +2d4 modifier dice", () => {
    // 8 + 2 ATK + 1 passive + 1 instance = 12: hits Evasion 12.
    const plan = ok(runStandardAttack(ctx([8, 3, 4], { passives: passives({ attackBonus: 1 }), instance: { attack: 1 } })));
    expect(plan.hits[0]!.hit).toBe(true);
    // An Experience asks for the GM's tap first (Q19), then costs 1 Fear.
    expect(runStandardAttack(ctx([5, 3, 4], { experience: { name: "Ambusher", value: 3 } }))).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    const exp = ok(runStandardAttack(ctx([7, 3, 4], { experience: { name: "Ambusher", value: 3 }, fearConfirmed: true })));
    expect(exp).toMatchObject({ fearSpent: 1, gmFearDelta: -1 });
    expect(exp.hits[0]!.hit).toBe(true); // 7 + 2 + 3 = 12
    const dice = ok(runStandardAttack(ctx([2, 3, 6, 4, 5], { attack: { name: "Spines", modifier: "+2d4", range: "Close", damage: "1d6 phy" } })));
    expect(dice.roll!.record.total).toBe(11); // 6 + (2 + 3)
  });

  it("instance disadvantage (Goad Them On) rolls two d20s and keeps the lower", () => {
    const plan = ok(runStandardAttack(ctx([18, 4], { instance: { disadvantage: true } })));
    expect(plan.roll!.record.total).toBe(6);
  });

  it("Horde (X): once half the HP is marked the attack deals X (CB p.199)", () => {
    const plan = ok(runStandardAttack(ctx([15, 3, 1], { self: self({ hp: 3, hpMax: 5 }), hordeX: "1d4+1", attack: { name: "Bites", modifier: 2, range: "Melee", damage: "1d10+2 phy" } })));
    expect(plan.incoming[0]).toMatchObject({ amount: 4, type: "physical" });
  });

  it("direct damage in the text and a direct-attacks passive reach the hit (CB p.99)", () => {
    const text = ok(runStandardAttack(ctx([15], { attack: { name: "Smash", modifier: 2, range: "Melee", damage: "40 direct phy" } })));
    expect(text.incoming[0]).toMatchObject({ amount: 40, direct: true });
    const passive = ok(runStandardAttack(ctx([15, 1, 1], { passives: passives({ directAttacks: true }) })));
    expect(passive.incoming[0]!.direct).toBe(true);
  });

  it("instance damage bonus then half damage (Blighting Strike) ride on its hit", () => {
    const plan = ok(runStandardAttack(ctx([15, 3, 3], { instance: { damage: 2, halfDamage: true } })));
    expect(plan.incoming[0]!.amount).toBe(5); // (3 + 3 + 2 + 2) / 2
  });
});

describe("Fear, Stress and spotlight (AR6, Q19)", () => {
  // CB p.196, Explosion: "Spend a Fear to erupt in a fiery explosion. Make an attack against all targets within Close
  // range. Targets the adversary succeeds against take 1d8 magic damage and are knocked back to Far range."
  const explosion = feature({
    costs: [{ kind: "fear", amount: fixed(1) }],
    roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" } },
    targets: { side: "enemy", range: "close", count: { kind: "all" } },
    steps: [
      { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: fixed(1), sides: 8 } }, type: "magic" },
      { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "far" },
    ],
  }, "Explosion");
  const two = [pcTarget("mira"), pcTarget("bram", { evasion: 16 })];

  it("asks before spending Fear (Q19), refuses without enough Fear, then spends exactly what it costs", () => {
    expect(run(explosion, ctx([12, 5], { targets: two }))).toMatchObject({ ok: false, reason: "confirmFear", code: null, detail: "1" });
    expect(run(explosion, ctx([12, 5], { targets: two, fearConfirmed: true, gmFear: 0 }))).toMatchObject({ ok: false, reason: "cost", code: "NOT_ENOUGH_FEAR" });
    expect(upfrontFear(explosion.uses[0]!.costs, ctx([]))).toBe(1);
    const plan = ok(run(explosion, ctx([12, 5], { targets: two, fearConfirmed: true })));
    expect(plan).toMatchObject({ fearSpent: 1, gmFearDelta: -1, success: true });
    expect(plan.hits).toEqual([
      { id: "mira", hit: true },
      { id: "bram", hit: false },
    ]);
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: 5, type: "magic", direct: false, forcedArmor: 0, critical: false, attackTotal: 14 }]);
    expect(plan.steps.find((s) => s.kind === "prompt")).toMatchObject({ prompt: "move", targetIds: ["mira"] });
  });

  it("Momentum (CB p.195): an automatic Fear gain on a hit needs no spotlight", () => {
    const momentum = feature({ activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } }, needsSpotlight: false, steps: [{ kind: "fear", to: "self", change: "gain", amount: fixed(1) }] }, "Momentum");
    const plan = ok(run(momentum, ctx([], { spotlit: false, targets: [] })));
    expect(plan).toMatchObject({ activation: "auto", gmFearDelta: 1, fearSpent: 0 });
  });

  it("marking the adversary's own Stress pays a cost; a full track can't (CB p.194)", () => {
    const rally = feature({ costs: [{ kind: "stress", amount: fixed(1) }], steps: [{ kind: "spotlight", who: "allies", count: { kind: "dice", dice: { count: fixed(1), sides: 4 } } }] }, "Rally");
    const plan = ok(run(rally, ctx([3], { targets: [] })));
    expect(plan.self.after.stress).toBe(1);
    expect(plan.steps).toContainEqual({ kind: "spotlight", who: "allies", count: 3 });
    expect(run(rally, ctx([], { self: self({ stress: 3 }), targets: [] }))).toMatchObject({ ok: false, reason: "cost", code: "ADVERSARY_FEATURE_UNAVAILABLE" });
  });

  it("an optional Fear step (Heavy Hitter) runs only when the GM took it", () => {
    const heavy = feature({
      activation: { kind: "reaction", trigger: { kind: "onAttack", stage: "beforeDamage", attack: "standard" } },
      needsSpotlight: false,
      roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" } },
      targets: { side: "enemy", range: "melee", count: { kind: "one" } },
      steps: [
        { kind: "optional", id: "hit-harder", label: "Spend a Fear for +2", costs: [{ kind: "fear", amount: fixed(1) }], steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: fixed(2) } }] },
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "physical" },
        { kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: fixed(0) } },
      ],
    }, "Heavy Hitter");
    const declined = ok(run(heavy, ctx([15, 1, 1])));
    expect(declined.fearSpent).toBe(0);
    const taken = ok(run(heavy, ctx([15, 1, 1], { optionals: ["hit-harder"] })));
    expect(taken.fearSpent).toBe(1);
  });
});

describe("Minions, PCs marked directly, prompts (AR9, AR5)", () => {
  it("Group Attack: one shared roll, X per Minion combined (CB p.201)", () => {
    const group = feature({
      costs: [{ kind: "fear", amount: fixed(1) }],
      roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" } },
      targets: { side: "enemy", range: "unlimited", count: { kind: "one" } },
      groupAttack: { within: "close" },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "flat", amount: fixed(2) }, type: "physical" }],
    }, "Group Attack");
    const others = [self({ id: "m2" }), self({ id: "m3" }), self({ id: "m4" })];
    const plan = ok(run(group, ctx([12], { group: others, fearConfirmed: true })));
    expect(plan.incoming[0]!.amount).toBe(8);
    expect(plan.group).toEqual(["m2", "m3", "m4"]);
  });

  it("a forced Armor Slot moves into the hit (CB p.195); Stress overflow and a forced last HP are marked directly", () => {
    const shred = feature({
      roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" } },
      targets: { side: "enemy", range: "melee", count: { kind: "one" } },
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon" },
        { kind: "markArmor", to: "targets", when: ["hit"], amount: fixed(1), noBenefit: true },
        { kind: "markStress", to: "targets", when: ["hit"], amount: fixed(2) },
      ],
    }, "Shredding Strike");
    const plan = ok(run(shred, ctx([15, 2, 2], { targets: [pcTarget("mira", { stress: 5, armor: 1 })] })));
    expect(plan.incoming[0]).toMatchObject({ amount: 6, forcedArmor: 1 });
    const mira = plan.creatures.find((c) => c.id === "mira")!;
    expect(mira.after).toMatchObject({ armor: 1, stress: 6, hp: 1 }); // forced slot left for the window; overflow 1 HP

    const reap = feature({ targets: { side: "enemy", range: "melee", count: { kind: "one" } }, steps: [{ kind: "markHp", to: "targets", amount: fixed(2) }] }, "Reap");
    expect(ok(run(reap, ctx([], { targets: [pcTarget("mira", { hp: 4 })] }))).deathMoves).toEqual(["mira"]);
  });

  it("summon and countdown prompts resolve their numbers after the steps", () => {
    const call = feature({
      needsSpotlight: true,
      steps: [
        { kind: "summon", label: "Call lackeys", count: { kind: "dice", dice: { count: fixed(1), sides: 4 } }, adversaryId: "jagged-knife-lackey", range: "close" },
        { kind: "countdown", op: "start", label: "Reinforcements", start: fixed(5), loop: true, onTrigger: "More arrive." },
        { kind: "countdown", op: "tick", label: "Reinforcements" },
      ],
    }, "Call for Help");
    const plan = ok(run(call, ctx([2], { targets: [] })));
    expect(plan.steps).toEqual([
      { kind: "summon", label: "Call lackeys", count: 2, adversaryId: "jagged-knife-lackey", range: "close" },
      { kind: "countdown", op: "start", label: "Reinforcements", start: 5, loop: true, onTrigger: "More arrive." },
      { kind: "countdown", op: "tick", label: "Reinforcements", amount: 1, loop: false },
    ]);
  });
});

describe("limits, requirements, passives", () => {
  it("a once-per-scene feature is recorded per instance and refused when used up", () => {
    const once = feature({ limit: { per: "scene" }, steps: [{ kind: "manual", to: "self", text: "Something dramatic." }] }, "Big Move");
    const plan = ok(run(once, ctx([], { targets: [] })));
    const key = adversaryFeatureUseKey("bandit", "Big Move");
    expect(plan.limit).toEqual({ key, until: "session", consumed: true });
    expect(plan.self.featureUses).toEqual([{ key, until: "session" }]);
    expect(run(once, ctx([], { targets: [], featureUses: plan.self.featureUses }))).toMatchObject({ ok: false, reason: "exhausted", code: "ADVERSARY_FEATURE_UNAVAILABLE" });
  });

  it("requirements: HP marked, stat-block tokens, conditions, confirmed situations", () => {
    const enraged = feature({ requires: [{ kind: "hpMarkedAtLeast", value: "half" }], steps: [] }, "Enraged");
    expect(run(enraged, ctx([], { targets: [] }))).toMatchObject({ ok: false, reason: "requirement", code: "ADVERSARY_FEATURE_UNAVAILABLE" });
    expect(run(enraged, ctx([], { targets: [], self: self({ hp: 3 }) })).ok).toBe(true);
    const pool = feature({ requires: [{ kind: "tokens", atLeast: 1 }], steps: [{ kind: "tokens", to: "self", op: "spend", amount: fixed(1) }] }, "Fireball");
    expect(run(pool, ctx([], { targets: [] })).ok).toBe(false);
    expect(ok(run(pool, ctx([], { targets: [], tokens: 5 }))).self.tokens).toEqual({ before: 5, after: 4 });
    const hidden = feature({ requires: [{ kind: "hasCondition", condition: { kind: "standard", condition: "hidden" } }, { kind: "situation", text: "While flying" }], steps: [] });
    expect(run(hidden, ctx([], { targets: [], self: self({ conditions: ["hidden"] }) })).ok).toBe(false);
    expect(run(hidden, ctx([], { targets: [], self: self({ conditions: ["hidden"] }), situations: ["While flying"] })).ok).toBe(true);
  });

  it("conditions on itself update its `after`; a passive use returns its modifiers", () => {
    const vanish = feature({ steps: [{ kind: "condition", to: "self", condition: { kind: "standard", condition: "hidden" }, duration: "temporary" }] }, "Vanish");
    expect(ok(run(vanish, ctx([], { targets: [] }))).self.after.conditions).toEqual(["hidden"]);
    const horde = feature({ activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "horde", damage: { kind: "dice", dice: { count: fixed(1), sides: 4, plus: fixed(1) } } }] }, "Horde (1d4+1)");
    expect(ok(run(horde, ctx([], { spotlit: false, targets: [] }))).modifiers).toHaveLength(1);
  });

  it("unknown use ids are refused", () => {
    expect(run(feature({}), ctx([], { useId: "nope" }))).toMatchObject({ ok: false, reason: "noUse", code: "ADVERSARY_FEATURE_UNAVAILABLE" });
  });
});

function passives(over: Partial<NonNullable<AdversaryRunContext["passives"]>>): NonNullable<AdversaryRunContext["passives"]> {
  return {
    attackBonus: 0,
    difficulty: 0,
    horde: null,
    minion: null,
    relentless: null,
    spotlightCostsFear: false,
    directAttacks: false,
    attackDamageAdd: 0,
    flags: [],
    auras: [],
    ...over,
  };
}
