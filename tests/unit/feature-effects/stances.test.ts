import { describe, expect, it } from "vitest";

import type { ActorState, PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import { queueRng } from "@/lib/domain/dice";
import { runFeature, type FeatureRunContext, type FeatureRunResult } from "@/lib/domain/feature-effects/run";
import { featureAvailability } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { featureClass, MARTIAL_STANCE_SLUGS } from "@/lib/srd/feature-effects/classification";
import {
  dropsActiveStance,
  dropStance,
  REFOCUS_EFFECT,
  SHIFT_STANCE_EFFECT,
  shiftRefusal,
  STANCE_DROP_EVENTS,
  STANCE_DURATION,
  STANCE_EFFECTS,
  STANCE_ENDS_ON,
} from "@/lib/srd/feature-effects/stances";
import { STANCE_DROP_TRIGGERS, STANCES } from "@/lib/srd/stances";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-stances (Q5 (a): stances fully automated). Every expected value comes from the stance
// texts of HF p.12 (the Martial Stances sheet, HF p.13, says the same) and the dice the test feeds the runner.
// RNG order: the runner's dice in the order the steps need them.

const sheet = sheetOf("brawler", "martial-artist", {
  traits: { agility: 1, strength: 2, finesse: 0, instinct: 3, presence: 0, knowledge: -1 },
  classState: { martial: { known: ["quick", "reliable"], focus: 2 } },
});

/** The Martial Artist with `active` as the active stance and `focus` Focus. */
const actor = (active: string | null, over: Partial<ActorState> = {}): ActorState => actorOf(sheet, { focus: 2, facts: { activeStance: active }, ...over });

const entry = (slug: string): FeatureEffect => {
  const found = STANCE_EFFECTS.find((e) => e.featureId === `stance:martial-artist:${slug}`);
  if (!found) throw new Error(`No entry for ${slug}`);
  return found;
};

const use = (slug: string, useId: string | undefined, context: Partial<FeatureRunContext> & { actor: ActorState }, dice: number[] = []): FeatureRunResult =>
  runFeature(entry(slug), useId, { gmFear: 2, rng: queueRng(dice), ...context });

function ok(result: FeatureRunResult): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const creature = (plan: RunPlan, id: string) => plan.creatures.find((c) => c.id === id)!.after;

describe("the table (Q5)", () => {
  it("has the 16 stances of HF p.12, as classified, all from the martial artist", () => {
    expect(STANCE_EFFECTS).toHaveLength(16);
    expect(STANCE_EFFECTS.map((e) => e.featureId)).toEqual(MARTIAL_STANCE_SLUGS.flat().map((s) => `stance:martial-artist:${s}`));
    expect(STANCE_EFFECTS.map((e) => e.featureId.split(":")[2])).toEqual(STANCES.map((s) => s.id));
    for (const e of STANCE_EFFECTS) {
      expect(e).toMatchObject({ source: "stance", owner: "martial-artist" });
      expect(featureClass(e.featureId)).toBeDefined();
    }
  });

  it("every use holds only while its stance is the active stance (HF p.12: 'while active')", () => {
    for (const e of STANCE_EFFECTS) {
      const slug = e.featureId.split(":")[2]!;
      for (const u of e.uses) {
        expect(u.requires?.[0]).toEqual({ kind: "situation", text: expect.stringContaining("stance") as string, check: { kind: "activeStance", stance: slug } });
        // No active stance ("Until you shift into a stance, you are not considered to be in a stance") and another stance.
        for (const active of [null, slug === "quick" ? "reliable" : "quick"]) {
          const result = runFeature(e, u.id, { actor: actor(active, { focus: 6, hope: 6 }), gmFear: 2, rng: queueRng([]), situations: ["The attack was within Melee range"] });
          expect(result).toMatchObject({ ok: false, reason: "requirement" });
        }
      }
    }
  });
});

describe("Tier 1 (HF p.12)", () => {
  it("Favored: + the picked trait to the damage roll (Strength 2); no pick asks for one", () => {
    const plan = ok(use("favored", undefined, { actor: actor("favored"), options: { trait: ["strength"] }, targets: [adversary("a")] }));
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "add" } }, amount: 2 }]);
    expect(ofKind(plan, "fold")[0]!.amount).toBe(2);
    const instinct = ok(use("favored", undefined, { actor: actor("favored"), options: { trait: ["instinct"] }, targets: [adversary("a")] }));
    expect(ofKind(instinct, "fold")[0]!.amount).toBe(3);
    expect(ofKind(ok(use("favored", undefined, { actor: actor("favored") })), "prompt")[0]).toMatchObject({ prompt: "choose" });
  });

  it("Invigorating: on a successful attack a d4; a 4 gains a Focus, a 3 does not; Focus caps at 6", () => {
    const four = ok(use("invigorating", undefined, { actor: actor("invigorating") }, [4]));
    expect(ofKind(four, "check")[0]).toMatchObject({ dice: [4], passed: true });
    expect(four.actor.after.focus).toBe(3);
    const three = ok(use("invigorating", undefined, { actor: actor("invigorating") }, [3]));
    expect(three.actor.after.focus).toBe(2);
    expect(ofKind(three, "resource")).toHaveLength(0);
    expect(ok(use("invigorating", undefined, { actor: actor("invigorating", { focus: 6 }) }, [4])).actor.after.focus).toBe(6);
    expect(entry("invigorating").uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } });
  });

  it("Quick: a Focus or a Stress for one more target of the same attack", () => {
    const focus = ok(use("quick", undefined, { actor: actor("quick") }));
    expect(focus.actor.after).toMatchObject({ focus: 1, stress: sheet.stress });
    expect(ofKind(focus, "fold")).toMatchObject([{ step: { kind: "addTargets" }, amount: 1 }]);
    const stress = ok(use("quick", undefined, { actor: actor("quick"), eitherCosts: [1] }));
    expect(stress.actor.after).toMatchObject({ focus: 2, stress: sheet.stress + 1 });
    expect(ofKind(stress, "fold")[0]!.amount).toBe(1);
    expect(use("quick", undefined, { actor: actor("quick", { focus: 0 }) })).toMatchObject({ ok: false, reason: "cost" });
    expect(entry("quick").uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } });
  });

  it("Reliable: +1 to attack rolls while active", () => {
    const u = entry("reliable").uses[0]!;
    expect(u.activation.kind).toBe("passive");
    expect(u.mods).toEqual([{ kind: "stat", stat: "attack", delta: { kind: "fixed", value: 1 } }]);
    expect(use("reliable", undefined, { actor: actor("reliable") }).ok).toBe(true);
  });
});

describe("Tier 2 (HF p.12)", () => {
  it("Aggressive: −1 Evasion while active; on a successful attack one more damage die, the lowest dropped", () => {
    const [passive, extra] = entry("aggressive").uses;
    expect(passive!.mods).toEqual([{ kind: "stat", stat: "evasion", delta: { kind: "fixed", value: -1 } }]);
    expect(extra!.activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } });
    const plan = ok(use("aggressive", "extra-die", { actor: actor("aggressive"), targets: [adversary("a")] }));
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "extraDie", drop: "lowest" } } }]);
  });

  it("Anchored: +2 to both damage thresholds and can't be moved against your will", () => {
    expect(entry("anchored").uses[0]!.mods).toEqual([
      { kind: "stat", stat: "majorThreshold", delta: { kind: "fixed", value: 2 } },
      { kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 2 } },
      { kind: "flag", flag: "cannotBeMoved" },
    ]);
    expect(use("anchored", undefined, { actor: actor("anchored") }).ok).toBe(true);
  });

  it("Defensive: a Melee attack on you gets the disadvantage-unless-a-Stress prompt (manual)", () => {
    expect(entry("defensive").uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenAttacked", stage: "targeted", from: "melee" } });
    const plan = ok(use("defensive", undefined, { actor: actor("defensive"), trigger: { source: adversary("bandit") } }));
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "manual", targetIds: ["bandit"], text: expect.stringContaining("marks a Stress") as string }]);
  });

  it("Otherworldly: on a successful attack, physical or magic damage", () => {
    const plan = ok(use("otherworldly", undefined, { actor: actor("otherworldly"), options: { type: ["magic"] }, targets: [adversary("a")] }));
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "type", type: "magic" } } }]);
    const physical = ok(use("otherworldly", undefined, { actor: actor("otherworldly"), options: { type: ["physical"] }, targets: [adversary("a")] }));
    expect(ofKind(physical, "fold")[0]!.step).toMatchObject({ change: { type: "physical" } });
  });
});

describe("Tier 3 (HF p.12)", () => {
  const melee = ["The attack was within Melee range"];

  it("Grappling: within Melee, a Focus or a Stress to temporarily Restrain or throw up to Close", () => {
    const restrain = ok(use("grappling", undefined, { actor: actor("grappling"), situations: melee, targets: [adversary("a")], options: { grapple: ["restrain"] } }));
    expect(restrain.actor.after.focus).toBe(1);
    expect(ofKind(restrain, "condition")).toMatchObject([{ targetId: "a", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" }]);
    expect(creature(restrain, "a").conditions).toContain("restrained");
    const thrown = ok(use("grappling", undefined, { actor: actor("grappling"), situations: melee, targets: [adversary("a")], options: { grapple: ["throw"] }, eitherCosts: [1] }));
    expect(thrown.actor.after).toMatchObject({ focus: 2, stress: sheet.stress + 1 });
    expect(ofKind(thrown, "prompt")).toMatchObject([{ prompt: "move", targetIds: ["a"] }]);
    expect(use("grappling", undefined, { actor: actor("grappling"), targets: [adversary("a")] })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Scary: on a successful attack the target marks a Stress", () => {
    const plan = ok(use("scary", undefined, { actor: actor("scary"), targets: [adversary("a")] }));
    expect(creature(plan, "a").stress).toBe(1);
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "a", track: "stress", amount: 1 }]);
  });

  it("Stable: a Focus instead of an Armor Slot reduces the damage one threshold", () => {
    const u = entry("stable").uses[0]!;
    expect(u.activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } });
    const plan = ok(use("stable", undefined, { actor: actor("stable"), trigger: { amount: 9 } }));
    expect(plan.actor.after).toMatchObject({ focus: 1, armor: plan.actor.before.armor });
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "reduceSeverity", steps: 1 }, amount: 1 }]);
    expect(use("stable", undefined, { actor: actor("stable", { focus: 0 }) })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Vigilant: targeted by an attack, a Stress for a d6 bonus to Evasion against it", () => {
    expect(entry("vigilant").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "whenAttacked", stage: "targeted" } });
    const plan = ok(use("vigilant", undefined, { actor: actor("vigilant") }, [5]));
    expect(plan.actor.after.stress).toBe(sheet.stress + 1);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyRoll", change: { kind: "evasion" } }, amount: 5 }]);
  });
});

describe("Tier 4 (HF p.12)", () => {
  it("Crushing: on Severe damage, a Hope makes the target mark one more Hit Point", () => {
    expect(entry("crushing").uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "whenTargetMarksHp", severity: "severe" } });
    const plan = ok(use("crushing", undefined, { actor: actor("crushing"), targets: [{ ...adversary("a"), hp: 3 }] }));
    expect(plan.actor.after.hope).toBe(sheet.hope - 1);
    expect(creature(plan, "a").hp).toBe(4);
    expect(use("crushing", undefined, { actor: actor("crushing", { hope: 0 }), targets: [adversary("a")] })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Exacting: a 1 on a damage die counts as its highest value", () => {
    const plan = ok(use("exacting", undefined, { actor: actor("exacting"), targets: [adversary("a")] }));
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "ones", asMax: true } } }]);
  });

  it("Honed: a Focus before the attack roll for +1 Proficiency on that attack", () => {
    expect(entry("honed").uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } });
    const plan = ok(use("honed", undefined, { actor: actor("honed", { focus: 1 }), targets: [adversary("a")] }));
    expect(plan.actor.after.focus).toBe(0);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "proficiency", delta: 1 } }, amount: 1 }]);
    expect(use("honed", undefined, { actor: actor("honed", { focus: 0 }) })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Isolating: advantage on attacks only with no other creature within Very Close (3 squares) of you or your target", () => {
    expect(entry("isolating").uses[0]!.mods).toEqual([{ kind: "advantage", on: "attack" }]);
    const facts = (isolation: { self?: number; target?: number }) => actor("isolating", { facts: { activeStance: "isolating", isolation } });
    expect(use("isolating", undefined, { actor: facts({ self: 5, target: 4 }) }).ok).toBe(true);
    expect(use("isolating", undefined, { actor: facts({ self: 5, target: 2 }) })).toMatchObject({ ok: false, reason: "requirement" });
    expect(use("isolating", undefined, { actor: facts({ self: 1, target: 6 }) })).toMatchObject({ ok: false, reason: "requirement" });
    // Not known to the engine: the player's check box decides (Q13).
    expect(use("isolating", undefined, { actor: facts({}) })).toMatchObject({ ok: false, reason: "requirement" });
    expect(use("isolating", undefined, { actor: facts({}), situations: ["No other creatures within Very Close range of you or your target"] }).ok).toBe(true);
  });
});

describe("dropping out (HF p.12, Q7)", () => {
  it("Severe damage, the last Hit Point, shifting and the end of the scene drop the active stance; nothing else does", () => {
    expect(STANCE_DURATION).toBe("scene");
    expect(STANCE_ENDS_ON).toEqual(["takeSevere", "lastHp"]);
    for (const trigger of STANCE_DROP_TRIGGERS) expect(dropsActiveStance(STANCE_DROP_EVENTS[trigger])).toBe(true);
    for (const other of ["markHp", "majorDamage", "dealSevere", "rollWithFear", "bearerMarksStress"] as const) expect(dropsActiveStance(other)).toBe(false);
  });

  it("dropping out ends the stance's benefits: its uses refuse once no stance is active", () => {
    const martial = { known: ["reliable", "quick"], active: "reliable", focus: 3 };
    const dropped = dropStance(martial);
    expect(dropped).toEqual({ known: ["reliable", "quick"], focus: 3 });
    expect(use("reliable", undefined, { actor: actor(dropped.active ?? null) })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Shift stance (HF p.12)", () => {
  it("costs a Focus; Flow State's use marks a Stress instead (HF p.11)", () => {
    const shift = runFeature(SHIFT_STANCE_EFFECT, undefined, { actor: actor(null), gmFear: 0, rng: queueRng([]) });
    expect(shift.ok && shift.plan.actor.after.focus).toBe(1);
    expect(shift.ok && shift.plan.limit).toBeNull();
    expect(runFeature(SHIFT_STANCE_EFFECT, undefined, { actor: actor(null, { focus: 0 }), gmFear: 0, rng: queueRng([]) })).toMatchObject({ ok: false, reason: "cost" });
    const flow = runFeature(SHIFT_STANCE_EFFECT, "flow-state", { actor: actor("quick", { focus: 0 }), gmFear: 0, rng: queueRng([]) });
    expect(flow.ok && flow.plan.actor.after).toMatchObject({ focus: 0, stress: sheet.stress + 1 });
  });

  it("only into a known stance that is not already active", () => {
    const martial = { known: ["quick", "reliable"], active: "quick", focus: 2 };
    expect(shiftRefusal(martial, "reliable")).toBeNull();
    expect(shiftRefusal(martial, "quick")).toBe("active");
    expect(shiftRefusal(martial, "honed")).toBe("unknown");
    expect(shiftRefusal({ known: ["nope"], focus: 1 }, "nope")).toBe("unknown");
    expect(shiftRefusal(undefined, "quick")).toBe("unknown");
    expect(shiftRefusal({ known: ["quick"], focus: 0 }, "quick")).toBeNull();
  });
});

describe("Refocus (HF p.12)", () => {
  const calm = ["During a moment of calm"];

  it("clears the track, rolls Instinct d6s (3) and gains the highest; once per rest", () => {
    const plan = ok(runFeature(REFOCUS_EFFECT, undefined, { actor: actor(null, { focus: 4 }), gmFear: 0, rng: queueRng([2, 5, 1]), situations: calm }));
    expect(ofKind(plan, "resource")).toEqual([
      { kind: "resource", targetId: "pc", resource: "focus", before: 4, after: 0 },
      { kind: "resource", targetId: "pc", resource: "focus", before: 0, after: 5 },
    ]);
    expect(plan.limit).toEqual({ key: "feat:stance:martial-artist:refocus", until: "rest", consumed: true });
    const used = { ...sheet, featureUses: plan.actor.featureUses };
    expect(featureAvailability(used, REFOCUS_EFFECT).state).toBe("exhausted");
    expect(runFeature(REFOCUS_EFFECT, undefined, { actor: actorOf(used, { focus: 5 }), gmFear: 0, rng: queueRng([6, 6, 6]), situations: calm })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("an Instinct of 0 or less rolls no dice and gains 0 Focus (user answer 2026-10-23)", () => {
    for (const instinct of [0, -1]) {
      const a = actor(null, { focus: 3, traits: { ...sheet.traits, instinct } });
      // An empty dice queue: rolling any die would throw.
      const plan = ok(runFeature(REFOCUS_EFFECT, undefined, { actor: a, gmFear: 0, rng: queueRng([]), situations: calm }));
      expect(plan.actor.after.focus).toBe(0);
    }
  });

  it("needs a moment of calm (the player confirms it)", () => {
    expect(runFeature(REFOCUS_EFFECT, undefined, { actor: actor(null), gmFear: 0, rng: queueRng([3, 3, 3]) })).toMatchObject({ ok: false, reason: "requirement" });
  });
});
