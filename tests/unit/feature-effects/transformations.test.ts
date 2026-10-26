import { describe, expect, it } from "vitest";

import type { PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import type { CardUse } from "@/lib/domain/card-effects/types";
import { queueRng } from "@/lib/domain/dice";
import { featureId } from "@/lib/domain/feature-effects/ids";
import { owned } from "@/lib/domain/feature-effects/owned";
import { runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { FEATURE_CLASSIFICATION } from "@/lib/srd/feature-effects/classification";
import { FEATURE_EFFECTS } from "@/lib/srd/feature-effects/index";
import { TRANSFORMATION_EFFECTS } from "@/lib/srd/feature-effects/transformations";
import { TRANSFORMATIONS } from "@/lib/srd/heritage";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-transformations (Q11 a): every transformation feature classified combat or passive runs
// through runFeature with fixed dice. Expected numbers are worked out by hand from the feature text (HF p.35-40). RNG
// order: Hope die, Fear die, then damage dice and other dice in the order the steps need them.

const entry = (id: string): FeatureEffect => {
  const found = TRANSFORMATION_EFFECTS.find((e) => e.featureId === id);
  if (!found) throw new Error(`No entry ${id}`);
  return found;
};
const use = (id: string, useId = "main"): CardUse => entry(id).uses.find((u) => u.id === useId)!;

const sheet = sheetOf("warrior", "call-of-the-brave", { stress: 1, stressMax: 6, hope: 3 });
const base = (over: Partial<FeatureRunContext> = {}, values: number[] = []): FeatureRunContext => ({
  actor: actorOf(sheet),
  gmFear: 2,
  rng: queueRng(values),
  ...over,
});

function ok(id: string, useId: string | undefined, context: FeatureRunContext): RunPlan {
  const result = runFeature(entry(id), useId, context);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.plan;
}
const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

const GIFTED = "transformation:demigod:gifted";
const WEIGHT = "transformation:demigod:weight-of-divinity";
const EPHEMERAL = "transformation:ghost:ephemeral";
const FANGS = "transformation:vampire:fangs";
const FEED = "transformation:vampire:feed";
const WOLF = "transformation:werewolf:wolf-form";
const RAMPAGE = "transformation:werewolf:howling-rampage";

describe("the transformations table (Q11)", () => {
  it("has one entry per transformation feature classified combat or passive, and none for the rest", () => {
    const expected = TRANSFORMATIONS.flatMap((t) => t.features.map((f) => featureId("transformation", t.id, f.name))).filter((id) => {
      const usage = FEATURE_CLASSIFICATION[id]?.usage;
      return usage === "combat" || usage === "passive";
    });
    expect(expected).toEqual([GIFTED, WEIGHT, EPHEMERAL, FANGS, FEED, WOLF, RAMPAGE]);
    expect(TRANSFORMATION_EFFECTS.map((e) => e.featureId)).toEqual(expected);
    for (const e of TRANSFORMATION_EFFECTS) {
      expect(e.source).toBe("transformation");
      expect(e.featureId.split(":")[1]).toBe(e.owner);
      expect(FEATURE_EFFECTS.get(e.featureId)).toBe(e);
      expect(new Set(e.uses.map((u) => u.id)).size).toBe(e.uses.length);
    }
  });

  it("a vampire sheet holds Fangs and Feed, and both run", () => {
    const vampire = sheetOf("warrior", "call-of-the-brave", { transformationId: "vampire" });
    const held = owned(vampire, { hopeAndFear: true }).map((f) => f.featureId);
    expect(held).toEqual(expect.arrayContaining([FANGS, FEED]));
    for (const id of held.filter((h) => h.startsWith("transformation:"))) expect(FEATURE_EFFECTS.get(id)).toBeDefined();
  });
});

describe("Gifted (HF p.35)", () => {
  it("+1 to action and damage rolls as a passive", () => {
    expect(use(GIFTED).activation).toEqual({ kind: "passive" });
    expect(use(GIFTED).mods).toEqual([
      { kind: "stat", stat: "actionRoll", delta: { kind: "fixed", value: 1 } },
      { kind: "stat", stat: "damage", delta: { kind: "fixed", value: 1 } },
    ]);
    const plan = ok(GIFTED, "main", base());
    expect(plan.steps).toEqual([]);
    expect(plan.limit).toBeNull();
  });

  it("+1 before each reaction roll, without a prompt", () => {
    expect(use(GIFTED, "reaction").activation).toEqual({ kind: "auto", trigger: { kind: "beforeYouRoll", roll: "reaction" } });
    const plan = ok(GIFTED, "reaction", base());
    expect(ofKind(plan, "fold").map((f) => [f.step.kind, f.amount])).toEqual([["modifyRoll", 1]]);
  });
});

describe("Weight of Divinity (HF p.35)", () => {
  it("fires on any failed roll", () => {
    expect(use(WEIGHT).activation).toEqual({ kind: "auto", trigger: { kind: "afterYouRoll", roll: "any", result: "failure" } });
  });

  it("the player marks a Stress", () => {
    const plan = ok(WEIGHT, undefined, base({ options: { weight: ["stress"] } }));
    expect(plan.actor.after.stress).toBe(2);
    expect(plan.gmFearDelta).toBe(0);
  });

  it("or the GM gains a Fear", () => {
    const plan = ok(WEIGHT, undefined, base({ options: { weight: ["fear"] } }));
    expect(plan.actor.after.stress).toBe(1);
    expect(plan.gmFearDelta).toBe(1);
    expect(ofKind(plan, "fear")).toEqual([{ kind: "fear", delta: 1 }]);
  });

  it("asks which until the player picks", () => {
    const plan = ok(WEIGHT, undefined, base());
    expect(ofKind(plan, "prompt").map((p) => [p.prompt, p.text])).toEqual([["choose", "Mark a Stress or the GM gains a Fear"]]);
    expect(plan.actor.after.stress).toBe(1);
  });

  it("a full Stress track marks a Hit Point instead (CB p.92)", () => {
    const plan = ok(WEIGHT, undefined, base({ actor: actorOf({ ...sheet, stress: 6 }), options: { weight: ["stress"] } }));
    expect(plan.actor.after.hp).toBe(sheet.hp + 1);
  });
});

describe("Ephemeral (HF p.36)", () => {
  it("resistant to physical damage, double magic damage", () => {
    expect(use(EPHEMERAL).activation).toEqual({ kind: "passive" });
    expect(use(EPHEMERAL).mods).toEqual([
      { kind: "resistance", type: "physical", level: "resistant" },
      { kind: "flag", flag: "doubleMagicDamage" },
    ]);
    expect(ok(EPHEMERAL, "main", base()).steps).toEqual([]);
  });

  it("mark 2 Stress to pass through a solid object", () => {
    const plan = ok(EPHEMERAL, "pass-through", base());
    expect(plan.actor.after.stress).toBe(3);
    expect(ofKind(plan, "prompt").map((p) => p.text)).toEqual(["You momentarily pass through a solid object."]);
  });

  it("refused without 2 free Stress slots", () => {
    const result = runFeature(entry(EPHEMERAL), "pass-through", base({ actor: actorOf({ ...sheet, stress: 5 }) }));
    expect(result).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Fangs (HF p.39)", () => {
  it("an attack with a trait of your choice on a target in Melee", () => {
    expect(use(FANGS).roll).toEqual({
      kind: "trait",
      trait: ["agility", "strength", "finesse", "instinct", "presence", "knowledge"],
      difficulty: { kind: "target" },
    });
    expect(use(FANGS).targets).toEqual({ side: "enemy", range: "melee", count: { kind: "one" } });
  });

  it("on a success, d6 physical damage using your Proficiency", () => {
    // Hope 8 + Fear 3 + Strength 1 = 12 against Difficulty 12: a hit with Hope. Proficiency 2: d6 4 + d6 5 = 9 (Minor).
    const vampire = actorOf(sheet, { proficiency: 2 });
    const plan = ok(FANGS, undefined, base({ actor: vampire, targets: [adversary("bandit")], roll: { trait: "strength" } }, [8, 3, 4, 5]));
    expect(plan.roll?.record.total).toBe(12);
    expect(plan.hits).toEqual([{ id: "bandit", hit: true }]);
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "physical", record: { total: 9 } });
    expect(ofKind(plan, "damage")[0]?.result).toMatchObject({ targetId: "bandit", incoming: 9, taken: 9, hpMarked: 1 });
  });

  it("the player's trait is used; a miss deals nothing", () => {
    // Hope 2 + Fear 5 + Knowledge -1 = 6 against 12: a miss.
    const plan = ok(FANGS, undefined, base({ targets: [adversary("bandit")], roll: { trait: "knowledge" } }, [2, 5]));
    expect(plan.roll?.record.total).toBe(6);
    expect(plan.hits).toEqual([{ id: "bandit", hit: false }]);
    expect(ofKind(plan, "damage")).toEqual([]);
  });
});

describe("Feed (HF p.39)", () => {
  const bitten = { ...adversary("bandit"), hp: 2 };
  const confirmed = ["A successful Fangs attack against a creature that can bleed"];

  it("a rider on the target marking Hit Points: mark a Stress, a token per Hit Point marked", () => {
    expect(use(FEED).activation).toEqual({ kind: "rider", trigger: { kind: "whenTargetMarksHp" } });
    const plan = ok(FEED, undefined, base({ actor: actorOf(sheet, { cardTokens: 1 }), trigger: { amount: 2, subject: bitten }, situations: confirmed }));
    expect(plan.actor.before.stress).toBe(1);
    expect(plan.actor.after).toMatchObject({ stress: 2, cardTokens: 3 });
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "add", before: 1, after: 3 }]);
  });

  it("holds up to 6 tokens", () => {
    const plan = ok(FEED, undefined, base({ actor: actorOf(sheet, { cardTokens: 4 }), trigger: { amount: 3, subject: bitten }, situations: confirmed }));
    expect(plan.actor.after.cardTokens).toBe(6);
  });

  it("only on a Fangs attack against a creature that can bleed (the player confirms, Q13)", () => {
    expect(runFeature(entry(FEED), undefined, base({ trigger: { amount: 2, subject: bitten } }))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("spend a token before an action roll: the Fear Die is a d20", () => {
    expect(use(FEED, "fear-die").activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "action" } });
    const plan = ok(FEED, "fear-die", base({ actor: actorOf(sheet, { cardTokens: 2 }) }));
    expect(plan.actor.after.cardTokens).toBe(1);
    expect(ofKind(plan, "fold").map((f) => f.step)).toEqual([{ kind: "modifyRoll", to: "self", change: { kind: "fearDie", sides: 20 } }]);
    expect(runFeature(entry(FEED), "fear-die", base())).toMatchObject({ ok: false, reason: "cost" });
  });

  it("a long rest removes a token", () => {
    expect(use(FEED, "long-rest").activation).toEqual({ kind: "auto", trigger: { kind: "timing", at: "afterLongRest" } });
    expect(ok(FEED, "long-rest", base({ actor: actorOf(sheet, { cardTokens: 3 }) })).actor.after.cardTokens).toBe(2);
    expect(ok(FEED, "long-rest", base()).actor.after.cardTokens).toBe(0);
  });

  it("with no tokens, action and reaction rolls have disadvantage", () => {
    expect(use(FEED, "hunger").activation).toEqual({ kind: "passive" });
    expect(use(FEED, "hunger").mods).toEqual([
      { kind: "flag", flag: "actionDisadvantage" },
      { kind: "flag", flag: "reactionDisadvantage" },
    ]);
    expect(ok(FEED, "hunger", base({ situations: ["There are no tokens on Feed"] })).steps).toEqual([]);
    expect(runFeature(entry(FEED), "hunger", base())).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Wolf Form (HF p.40)", () => {
  const inForm = actorOf(sheet, { facts: { featureEffects: [{ featureId: WOLF }] } });

  it("marking Hit Points: mark a Stress to enter Wolf Form until a rest", () => {
    expect(use(WOLF).activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouMarkHp" } });
    const plan = ok(WOLF, undefined, base());
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "effect")).toEqual([
      { kind: "effect", targetId: "pc", label: "Wolf Form", mods: [], duration: "rest", endsWhen: "you go into your Howling Rampage" },
    ]);
  });

  it("+1d10 to each attack roll while in Wolf Form", () => {
    expect(use(WOLF, "attack").activation).toEqual({ kind: "auto", trigger: { kind: "beforeYouRoll", roll: "attack" } });
    const plan = ok(WOLF, "attack", base({ actor: inForm }, [7]));
    expect(ofKind(plan, "fold").map((f) => [f.step.kind, f.amount])).toEqual([["modifyRoll", 7]]);
    expect(runFeature(entry(WOLF), "attack", base({}, [7]))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("+1d10 to each damage roll while in Wolf Form", () => {
    expect(use(WOLF, "damage").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } });
    // The rider runs with the attack's targets; the d10 folds into that attack's damage.
    const plan = ok(WOLF, "damage", base({ actor: inForm, targets: [adversary("bandit")] }, [10]));
    expect(ofKind(plan, "fold").map((f) => [f.step.kind, f.amount])).toEqual([["modifyDamage", 10]]);
    const fact = actorOf(sheet, { facts: { featureEffects: [] } });
    expect(runFeature(entry(WOLF), "damage", base({ actor: fact }, [10]))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("gaining a Hope in Wolf Form marks a Stress", () => {
    expect(use(WOLF, "hope").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouGainHope" } });
    expect(ok(WOLF, "hope", base({ actor: inForm })).actor.after.stress).toBe(2);
    expect(runFeature(entry(WOLF), "hope", base())).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Howling Rampage (HF p.40)", () => {
  it("marking your last Stress in Wolf Form: tier d20s of physical damage to all creatures within Very Close, then drop out", () => {
    expect(use(RAMPAGE).activation).toEqual({ kind: "auto", trigger: { kind: "whenYouMarkStress", last: true } });
    expect(use(RAMPAGE).targets).toEqual({ side: "any", range: "veryClose", count: { kind: "all" }, area: "aroundSelf", excludeSelf: true });
    // Tier 2: d20 15 + d20 9 = 24 to the bandit (under its Major threshold 30: Minor, 1 HP) and to the ally PC.
    const wolf = actorOf({ ...sheet, stress: 6 }, { tier: 2, facts: { featureEffects: [{ featureId: WOLF }] } });
    const ally = { ...adversary("ally"), side: "pc" as const };
    const plan = ok(RAMPAGE, undefined, base({ actor: wolf, targets: [adversary("bandit"), ally] }, [15, 9]));
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "physical", record: { total: 24 } });
    expect(ofKind(plan, "damage")[0]?.result).toMatchObject({ targetId: "bandit", incoming: 24, taken: 24, hpMarked: 1 });
    expect(ofKind(plan, "pcDamage")).toEqual([{ kind: "pcDamage", targetId: "ally", amount: 24, type: "physical", direct: false }]);
    expect(ofKind(plan, "prompt").map((p) => p.text)).toEqual(["Drop out of Wolf Form (end the Wolf Form effect)."]);
  });

  it("one d20 at tier 1, four at tier 4", () => {
    const at = (tier: 1 | 4, values: number[]) =>
      ok(RAMPAGE, undefined, base({ actor: actorOf(sheet, { tier, facts: { featureEffects: [{ featureId: WOLF }] } }), targets: [adversary("bandit")] }, values));
    expect(ofKind(at(1, [11]), "damageRoll")[0]?.record.total).toBe(11);
    expect(ofKind(at(4, [20, 20, 20, 20]), "damageRoll")[0]?.record.total).toBe(80);
  });

  it("only in Wolf Form", () => {
    expect(runFeature(entry(RAMPAGE), undefined, base({ targets: [adversary("bandit")] }, [11]))).toMatchObject({ ok: false, reason: "requirement" });
  });
});
