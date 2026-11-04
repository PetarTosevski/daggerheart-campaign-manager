import { describe, expect, it } from "vitest";

import { rollMatches, rollTargetCount, run, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, RollSpec } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { foldsFromPlan } from "@/lib/domain/adversary-actions/window";
import { queueRng } from "@/lib/domain/dice";
import { actorExtras, runFeature } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { actorOf, fixed, sheetOf } from "./fixtures";

// Plan drawer-answers, tracer DA0: the vocabulary and the pure runner carry the user's answers of 2026-10-29 / 30.
// Book pages are printed pages (CB = Core Book, HF = Hope & Fear). Every expected number is worked out by hand; the RNG
// order is Hope die, Fear die, then damage dice and checks in step order.

const sheet = sheetOf("druid", "warden-of-the-elements", { hope: 4, stress: 1, proficiency: 2 });
const actor = actorOf(sheet, { proficiency: 2 });

const adv = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 6,
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
  hp: 3,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
});

const card = (use: Partial<CardUse>): CardEffect => ({ cardId: "test:card", uses: [{ id: "main", name: "Test", activation: { kind: "action" }, steps: [], ...use }] });

function ok(effect: CardEffect, context: Partial<RunContext> & { dice?: number[] } = {}): RunPlan {
  const { dice = [], ...rest } = context;
  const rng = queueRng(dice);
  const result = run(effect, { actor, gmFear: 2, rng, ...rest });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  rng.done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

describe("EndEvent stanceDrops (dcm-bxp.99.19.10, HF p.12)", () => {
  it("a stance's condition carries endsOn stanceDrops into the plan", () => {
    // Grappling (HF p.12): "temporarily Restrain the target"; "When you drop out of a stance, you lose any ongoing benefits it provides."
    const plan = ok(card({ targets: { side: "enemy", range: "melee", count: { kind: "one" } }, steps: [{ kind: "condition", to: "targets", condition: { kind: "standard", condition: "restrained" }, duration: "temporary", endsOn: ["stanceDrops"] }] }), { targets: [adv("bandit")] });
    expect(ofKind(plan, "condition")).toEqual([{ kind: "condition", targetId: "bandit", condition: { kind: "standard", condition: "restrained" }, duration: "temporary", endsOn: ["stanceDrops"] }]);
  });
});

describe("insteadOfArmorSlot (dcm-bxp.99.19.9 Stable, HF p.12; CB p.114 one Armor Slot per hit)", () => {
  it("reduceSeverity and convertMarks keep the flag on their fold, for the reaction window", () => {
    const stable = card({ activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } }, costs: [{ kind: "tokens", amount: fixed(1), pool: "focus" }], steps: [{ kind: "reduceSeverity", to: "self", steps: 1, insteadOfArmorSlot: true }] });
    const plan = ok(stable, { actor: { ...actor, focus: 2 } });
    expect(plan.actor.after.focus).toBe(1);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "reduceSeverity", insteadOfArmorSlot: true }, targetIds: ["pc"], amount: 1 }]);
    const wings = ok(card({ steps: [{ kind: "convertMarks", to: "self", from: "armor", into: "hope", insteadOfArmorSlot: true }] }));
    expect(ofKind(wings, "fold")).toMatchObject([{ step: { kind: "convertMarks", insteadOfArmorSlot: true } }]);
  });
});

describe("damage cancelled to zero (dcm-bxp.99.19.13 Dark Aegis, HF p.14)", () => {
  it("negate damage with ignoreOnHitHp folds as a negated hit and keeps the flag", () => {
    // "when you would take damage, you can spend a Favor instead of marking Hit Points"
    const aegis = card({ activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } }, costs: [{ kind: "tokens", amount: fixed(1), pool: "favor" }], steps: [{ kind: "negate", to: "self", what: "damage", ignoreOnHitHp: true }] });
    const plan = ok(aegis, { actor: { ...actor, favor: 3 } });
    expect(plan.actor.after.favor).toBe(2);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "negate", what: "damage", ignoreOnHitHp: true } }]);
    expect(foldsFromPlan(plan, "pc")).toEqual([{ kind: "negateDamage" }]);
  });
});

describe("defaultOn optional steps (dcm-bxp.99.19.15 Draining Bane, HF p.14: 'you can clear a Stress')", () => {
  const bane = card({ steps: [{ kind: "optional", id: "clear-stress", label: "Clear a Stress", defaultOn: true, steps: [{ kind: "clear", to: "self", track: "stress", amount: fixed(1) }] }] });

  it("runs when the choices omit it, and when they name it", () => {
    expect(ok(bane).actor.after.stress).toBe(0);
    expect(ok(bane, { optionals: ["clear-stress"] }).actor.after.stress).toBe(0);
  });

  it("is skipped only on an explicit off", () => {
    expect(ok(bane, { optionalsOff: ["clear-stress"] }).actor.after.stress).toBe(1);
    expect(ofKind(ok(bane, { optionalsOff: ["clear-stress"] }), "clear")).toEqual([]);
  });

  it("an optional without defaultOn still needs to be named", () => {
    const plain = card({ steps: [{ kind: "optional", id: "x", label: "X", steps: [{ kind: "clear", to: "self", track: "stress", amount: fixed(1) }] }] });
    expect(ok(plain).actor.after.stress).toBe(1);
    expect(ok(plain, { optionals: ["x"] }).actor.after.stress).toBe(0);
  });
});

describe("a Stress cancelled (dcm-bxp.99.19.50 (1) Unshakable, CB p.59)", () => {
  it("negate stress is a fold for the Stress about to be marked", () => {
    const plan = ok(card({ activation: { kind: "auto", trigger: { kind: "wouldMarkStress" } }, steps: [{ kind: "negate", to: "self", what: "stress" }] }));
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "negate", what: "stress" }, targetIds: ["pc"] }]);
  });
});

describe("a target count rolled before the pick (dcm-d95, Warden's Protection, CB p.31)", () => {
  // "spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close range"
  const wardens = card({
    costs: [{ kind: "hope", amount: fixed(2) }],
    targets: { side: "ally", range: "close", count: { kind: "upTo", n: { kind: "dice", dice: { count: fixed(1), sides: 4 } }, rolledFirst: true } },
    steps: [{ kind: "clear", to: "targets", track: "hp", amount: fixed(2) }],
  });
  const use = wardens.uses[0]!;

  it("rollTargetCount rolls the 1d4 for the server; other uses have none", () => {
    expect(rollTargetCount(use, actor, queueRng([3]))).toBe(3);
    expect(rollTargetCount({ ...use, targets: { side: "ally", range: "close", count: { kind: "upTo", n: fixed(2) } } }, actor, queueRng([]))).toBeNull();
    expect(rollTargetCount({ ...use, targets: { side: "trigger", who: "source" } }, actor, queueRng([]))).toBeNull();
  });

  it("run takes the server's count and rolls nothing for it (an empty dice queue)", () => {
    const plan = ok(wardens, { rolledTargetCount: 2, targets: [ally("a"), ally("b")] });
    expect(ofKind(plan, "clear")).toEqual([
      { kind: "clear", targetId: "a", track: "hp", amount: 2 },
      { kind: "clear", targetId: "b", track: "hp", amount: 2 },
    ]);
    expect(plan.actor.after.hope).toBe(2);
  });

  it("refuses more targets than the rolled count, and a rolledFirst use with no count", () => {
    expect(run(wardens, { actor, gmFear: 0, rng: queueRng([]), rolledTargetCount: 1, targets: [ally("a"), ally("b")] })).toMatchObject({ ok: false, reason: "targets" });
    expect(run(wardens, { actor, gmFear: 0, rng: queueRng([]), targets: [ally("a")] })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("an upTo count without rolledFirst still rolls when no count is given (unchanged)", () => {
    const old = card({ ...use, targets: { side: "ally", range: "close", count: { kind: "upTo", n: { kind: "dice", dice: { count: fixed(1), sides: 4 } } } } });
    expect(ofKind(ok(old, { dice: [1], targets: [ally("a")] }), "clear")).toHaveLength(1);
  });
});

describe("a trait roll that is an attack (dcm-bxp.99.19.6 (5), Rampage, CB p.33)", () => {
  it("rollMatches('attack') holds for a trait roll with attack: true, not without", () => {
    const formAttack: RollSpec = { kind: "trait", trait: "strength", difficulty: { kind: "target" }, attack: true };
    expect(rollMatches("attack", formAttack)).toBe(true);
    expect(rollMatches("strength", formAttack)).toBe(true);
    expect(rollMatches("action", formAttack)).toBe(true);
    expect(rollMatches("weaponAttack", formAttack)).toBe(false);
    expect(rollMatches("attack", { kind: "trait", trait: "strength", difficulty: { kind: "target" } })).toBe(false);
  });
});

describe("a move the server makes (dcm-bxp.99.19.16 Charge, CB p.59)", () => {
  // "When you succeed on an Agility Roll to move from Far or Very Far range into Melee range with one or more targets"
  const charge = card({
    roll: { kind: "trait", trait: "agility", difficulty: { kind: "gm" } },
    targets: { side: "enemy", range: "far", count: { kind: "one" } },
    steps: [{ kind: "move", to: "self", mode: "intoMelee", relativeTo: "target", when: ["success"] }],
  });

  it("on a success the plan carries a server move into Melee of the target", () => {
    // Agility 2: Hope 9 + Fear 3 + 2 = 14 against the GM's 12: a success with Hope.
    const plan = ok(charge, { dice: [9, 3], roll: { difficulty: 12 }, targets: [adv("ogre")] });
    expect(plan.success).toBe(true);
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "move", server: true, anchorId: "ogre", targetIds: ["pc"], text: "Move into Melee range" }]);
  });

  it("on a failure the token stays: no move", () => {
    // 2 + 3 + 2 = 7 < 12.
    const plan = ok(charge, { dice: [2, 3], roll: { difficulty: 12 }, targets: [adv("ogre")] });
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "prompt")).toEqual([]);
  });

  it("other move modes stay player prompts", () => {
    const plan = ok(card({ steps: [{ kind: "move", to: "self", mode: "move", range: "far" }] }));
    expect(ofKind(plan, "prompt")[0]).not.toHaveProperty("server");
  });
});

describe("a use rolled by an ally (dcm-bxp.99.19.21 Cannonball, CB p.33)", () => {
  // "Mark a Stress to allow an ally to throw or launch you at an adversary. To do so, the ally makes an attack roll using
  // Agility or Strength (their choice) against a target within Close range. On a success, the adversary takes d12+2
  // physical damage using the thrower's Proficiency."
  const cannonball = card({
    costs: [{ kind: "stress", amount: fixed(1) }],
    limit: { per: "scene" },
    targets: { side: "ally", range: "unlimited", count: { kind: "one" }, excludeSelf: true },
    roll: { kind: "trait", trait: ["agility", "strength"], difficulty: { kind: "target" }, attack: true },
    rolledBy: { who: "ally", proficiency: "actor", targets: { side: "enemy", range: "close", count: { kind: "one" } } },
    steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 12, plus: fixed(2) } }, type: "physical" }],
  });
  const roller = { id: "ally", traits: { agility: 0, strength: 3, finesse: 0, instinct: 0, presence: 0, knowledge: 0 }, proficiency: 1 };

  it("the actor's run pays the Stress and the limit and sends the ally the roll, with the actor's Proficiency", () => {
    const plan = ok(cannonball, { targets: [ally("ally")] });
    expect(plan.actor.after.stress).toBe(2);
    expect(plan.roll).toBeNull();
    expect(ofKind(plan, "prompt")).toEqual([{ kind: "prompt", prompt: "allyRoll", text: "Test: make the roll", targetIds: ["ally"], amount: 2 }]);
    expect(ofKind(plan, "damageRoll")).toEqual([]);
    expect(plan.limit).toMatchObject({ consumed: true });
  });

  it("the roller's run rolls with the roller's trait, uses the actor's Proficiency, gives the roller the Hope, and pays nothing again", () => {
    // Strength 3: Hope 10 + Fear 4 + 3 = 17 against Difficulty 12: hit with Hope. Damage 2d12+2 (the actor's Proficiency 2): 5 + 6 + 2 = 13, Major.
    const plan = ok(cannonball, { roller, roll: { trait: "strength" }, targets: [adv("bandit")], dice: [10, 4, 5, 6] });
    expect(plan.roll?.record.total).toBe(17);
    expect(plan.hits).toEqual([{ id: "bandit", hit: true }]);
    expect(ofKind(plan, "hope")).toEqual([{ kind: "hope", targetId: "ally", delta: 1 }]);
    expect(plan.actor.after).toEqual(plan.actor.before);
    expect(plan.limit).toBeNull();
    expect(ofKind(plan, "pay")).toEqual([]);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ targetId: "bandit", incoming: 13, severity: "major", hpMarked: 2 });
  });

  it("with proficiency 'roller' the damage uses the roller's Proficiency", () => {
    const own = card({ ...cannonball.uses[0]!, rolledBy: { ...cannonball.uses[0]!.rolledBy!, proficiency: "roller" } });
    expect(ofKind(ok(own, { targets: [ally("ally")] }), "prompt")[0]).not.toHaveProperty("amount");
    // 1d12+2 with the roller's Proficiency 1: 5 + 2 = 7, Minor.
    const plan = ok(own, { roller, roll: { trait: "strength" }, targets: [adv("bandit")], dice: [10, 4, 5] });
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 7, severity: "minor", hpMarked: 1 });
  });

  it("the roller's targets follow rolledBy.targets (one target)", () => {
    expect(run(cannonball, { actor, gmFear: 0, rng: queueRng([]), roller, targets: [adv("a"), adv("b")] })).toMatchObject({ ok: false, reason: "targets" });
  });
});

describe("Favor read as 3 when unset (SD4 follow-up, HF p.14: 'You start with 3 Favor.')", () => {
  const favorFeature: FeatureEffect = {
    featureId: "class:warlock:test",
    source: "class",
    owner: "warlock",
    uses: [{ id: "main", name: "Spend a Favor", activation: { kind: "action" }, costs: [{ kind: "tokens", amount: fixed(1), pool: "favor" }], steps: [] }],
  };

  it("a warlock who never had a session start pays a Favor (3 -> 2)", () => {
    const warlock = sheetOf("warlock", "pact-of-the-endless");
    expect(warlock.classState.favor).toBeUndefined();
    expect(actorExtras(warlock).favor).toBe(3);
    const result = runFeature(favorFeature, undefined, { actor: actorOf(warlock, actorExtras(warlock)), gmFear: 0, rng: queueRng([]) });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.actor.before.favor).toBe(3);
    expect(result.plan.actor.after.favor).toBe(2);
  });

  it("a stored Favor wins; a multiclass warlock reads 3 too; other classes have no Favor", () => {
    expect(actorExtras(sheetOf("warlock", "pact-of-the-endless", { classState: { favor: 0 } })).favor).toBe(0);
    const multi = sheetOf("guardian", "stalwart", { multiclass: { classId: "warlock", domainId: "dread", subclassId: "pact-of-the-endless" } });
    expect(actorExtras(multi).favor).toBe(3);
    expect(actorExtras(sheetOf("guardian", "stalwart"))).not.toHaveProperty("favor");
  });
});
