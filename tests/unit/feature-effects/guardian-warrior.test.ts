import { describe, expect, it } from "vitest";

import { openWindow, resolveWindow, respond, runReactionCard, type RespondResult, type WindowHit, type WindowPc, type WindowState } from "@/lib/domain/adversary-actions";
import type { ActorState, PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import { run } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, Mod } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { featureSlug, parseFeatureId } from "@/lib/domain/feature-effects/ids";
import { applyUpgrades, asCardEffect, featureAvailability, runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { FEATURE_CLASSIFICATION } from "@/lib/srd/feature-effects/classification";
import { GUARDIAN_WARRIOR_EFFECTS } from "@/lib/srd/feature-effects/guardian-warrior";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import { actorOf, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-guardian-warrior: every Guardian and Warrior feature classified combat or passive runs
// through runFeature with fixed dice. Expected numbers are worked out by hand from the book (Guardian CB p.36, Warrior
// CB p.48, CB p.107). RNG order: Hope die, Fear die, then damage dice, in the order the steps need them.

const OWNERS = new Set(["guardian", "warrior", "stalwart", "vengeance", "call-of-the-brave", "call-of-the-slayer"]);

function entry(featureId: string): FeatureEffect {
  const found = GUARDIAN_WARRIOR_EFFECTS.find((e) => e.featureId === featureId);
  if (!found) throw new Error(`No entry for ${featureId}`);
  return found;
}

function featureUse(featureId: string, useId = "main"): CardUse {
  const found = entry(featureId).uses.find((u) => u.id === useId);
  if (!found) throw new Error(`No use ${useId} on ${featureId}`);
  return found;
}

const guardian = sheetOf("guardian", "stalwart", { hope: 6 });
const warrior = sheetOf("warrior", "call-of-the-brave", { hope: 2 });

const ctx = (sheetActor: ActorState, dice: number[], over: Partial<FeatureRunContext> = {}): FeatureRunContext => ({ actor: sheetActor, gmFear: 2, rng: queueRng(dice), ...over });

/** Runs a feature's use and checks the dice queue was used up exactly. */
function ok(featureId: string, useId: string | undefined, context: FeatureRunContext): RunPlan {
  const result = runFeature(entry(featureId), useId, context);
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  (context.rng as ReturnType<typeof queueRng>).done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const folds = (plan: RunPlan) => ofKind(plan, "fold").map((f) => [f.step.kind, f.targetIds, f.amount]);

/** A passive use's mods resolved through an effect step, so run() does the arithmetic. */
function resolvedMods(mods: readonly Mod[]) {
  const probe: CardEffect = { cardId: "probe", uses: [{ id: "main", name: "probe", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "probe", mods, duration: "permanent" }] }] };
  const result = run(probe, { actor: actorOf(guardian), gmFear: 0, rng: queueRng([]) });
  if (!result.ok) throw new Error("refused");
  return ofKind(result.plan, "effect")[0]!.mods;
}

const adv = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
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

const ally = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "pc",
  evasion: 12,
  thresholds: { major: 6, severe: 12 },
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

describe("the Guardian and Warrior table", () => {
  const groupIds = Object.keys(FEATURE_CLASSIFICATION).filter((id) => OWNERS.has(parseFeatureId(id)?.owner ?? ""));

  it("has exactly one entry per Guardian and Warrior feature classified combat or passive (21 of 22)", () => {
    expect(groupIds).toHaveLength(22);
    const expected = groupIds.filter((id) => ["combat", "passive"].includes(FEATURE_CLASSIFICATION[id]!.usage)).sort();
    const ids = GUARDIAN_WARRIOR_EFFECTS.map((e) => e.featureId);
    expect([...ids].sort()).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(21);
    expect(ids).not.toContain("subclass:call-of-the-slayer:martial-preparation");
  });

  it("source, owner and subclass card match the id and the subclass data; use ids are unique", () => {
    for (const e of GUARDIAN_WARRIOR_EFFECTS) {
      const parsed = parseFeatureId(e.featureId);
      expect(parsed).toMatchObject({ source: e.source, owner: e.owner });
      if (e.source === "subclass") {
        const sub = SUBCLASSES.find((s) => s.id === e.owner)!;
        const card = (["foundation", "specialization", "mastery"] as const).find((c) => sub[c].some((f) => featureSlug(f.name) === parsed!.slug));
        expect(e.card).toBe(card);
      } else expect(e.card).toBeUndefined();
      const useIds = e.uses.map((u) => u.id);
      expect(new Set(useIds).size).toBe(useIds.length);
    }
  });

  it("passive features have no action use (the drawer shows them without a Use button)", () => {
    for (const e of GUARDIAN_WARRIOR_EFFECTS) {
      if (FEATURE_CLASSIFICATION[e.featureId]!.usage !== "passive") continue;
      expect(e.uses.some((u) => u.activation.kind === "action")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- Guardian (CB p.36)

describe("Frontline Tank (CB p.36, CB p.107)", () => {
  it("3 Hope clear 2 Armor Slots; twice for 6 Hope clears 4", () => {
    const once = ok("hope:guardian", undefined, ctx(actorOf(guardian, { armor: 3, armorMax: 4 }), []));
    expect(once.actor.after).toMatchObject({ hope: 3, armor: 1 });
    const twice = ok("hope:guardian", undefined, ctx(actorOf(guardian, { armor: 4, armorMax: 4 }), [], { times: 2 }));
    expect(twice.actor.after).toMatchObject({ hope: 0, armor: 0 });
    expect(twice.limit).toBeNull();
  });

  it("refuses with less than 3 Hope", () => {
    expect(runFeature(entry("hope:guardian"), undefined, ctx(actorOf(guardian, { hope: 2, armor: 2 }), []))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Unstoppable (CB p.36)", () => {
  const id = "class:guardian:unstoppable";

  it("D5 gives the d4 die at 1 and keeps its once-per-long-rest key; the scene effect forbids Restrained", () => {
    const sheet = sheetOf("guardian", "vengeance", { conditions: ["vulnerable"] });
    const result = runFeature(entry(id), undefined, ctx(actorOf(sheet), [], { sheet }));
    if (!result.ok) throw new Error(result.detail);
    expect(result.sheet!.classState.unstoppable).toEqual({ value: 1, max: 4 });
    expect(result.sheet!.conditions).toEqual([]);
    expect(result.plan.actor.featureUses).toEqual([{ key: "unstoppable", until: "longRest" }]);
    expect(ofKind(result.plan, "effect")).toMatchObject([{ label: "Unstoppable", duration: "scene", mods: [{ kind: "flag", flag: "cannotBeRestrained" }] }]);
    expect(ofKind(result.plan, "prompt").map((p) => p.text)).toEqual(["While Unstoppable you can't be Vulnerable."]);
    const used = { ...sheet, featureUses: result.plan.actor.featureUses };
    expect(featureAvailability(used, entry(id))).toMatchObject({ state: "exhausted", label: "Back after a long rest" });
  });

  it("level 5: a d6", () => {
    const sheet = sheetOf("guardian", "stalwart", { level: 5 });
    const result = runFeature(entry(id), undefined, ctx(actorOf(sheet), [], { sheet }));
    expect(result.ok && result.sheet!.classState.unstoppable).toEqual({ value: 1, max: 6 });
  });

  it("while Unstoppable, physical damage is one threshold lower; not otherwise", () => {
    expect(featureUse(id, "severity").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouWouldTakeDamage", damageType: "physical" } });
    const on = actorOf(guardian, { facts: { featureEffects: [{ featureId: id }] } });
    expect(folds(ok(id, "severity", ctx(on, [])))).toEqual([["reduceSeverity", ["pc"], 1]]);
    const off = actorOf(guardian, { facts: { featureEffects: [] } });
    expect(runFeature(entry(id), "severity", ctx(off, []))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("dealing Hit Points raises the die through D5; past its maximum the die is removed", () => {
    const facts = { featureEffects: [{ featureId: id }] };
    const sheet = sheetOf("guardian", "stalwart", { classState: { unstoppable: { value: 3, max: 4 } } });
    const up = runFeature(entry(id), "grow", ctx(actorOf(sheet, { facts }), [], { sheet }));
    expect(up.ok && up.sheet!.classState.unstoppable).toEqual({ value: 4, max: 4 });
    const atMax = sheetOf("guardian", "stalwart", { classState: { unstoppable: { value: 4, max: 4 } } });
    const out = runFeature(entry(id), "grow", ctx(actorOf(atMax, { facts }), [], { sheet: atMax }));
    expect(out.ok && out.sheet!.classState.unstoppable).toBeUndefined();
  });
});

describe("Stalwart thresholds (CB p.36)", () => {
  it("Unwavering +1, Unrelenting +2, Undaunted +3 to both damage thresholds, as passive mods", () => {
    for (const [slug, n] of [["unwavering", 1], ["unrelenting", 2], ["undaunted", 3]] as const) {
      const use = featureUse(`subclass:stalwart:${slug}`);
      expect(use.activation.kind).toBe("passive");
      expect(resolvedMods(use.mods!)).toEqual([
        { kind: "stat", stat: "majorThreshold", delta: n },
        { kind: "stat", stat: "severeThreshold", delta: n },
      ]);
    }
  });
});

describe("Stalwart and Vengeance reactions (CB p.36)", () => {
  it("Iron Will: one extra Armor Slot against physical damage", () => {
    expect(featureUse("subclass:stalwart:iron-will").activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", damageType: "physical" } });
    expect(folds(ok("subclass:stalwart:iron-will", undefined, ctx(actorOf(guardian), [])))).toEqual([["extraArmorSlots", ["pc"], 1]]);
  });

  it("Partners-in-Arms: you mark an Armor Slot, the ally's severity drops one threshold", () => {
    const plan = ok("subclass:stalwart:partners-in-arms", undefined, ctx(actorOf(guardian, { armor: 0, armorMax: 3 }), [], { trigger: { subject: ally("mira") } }));
    expect(plan.actor.after.armor).toBe(1);
    expect(folds(plan)).toEqual([["reduceSeverity", ["mira"], 1]]);
    expect(runFeature(entry("subclass:stalwart:partners-in-arms"), undefined, ctx(actorOf(guardian, { armor: 3, armorMax: 3 }), [], { trigger: { subject: ally("mira") } }))).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Loyal Protector: an ally with 2 or fewer HP unmarked; a Stress, a sprint prompt and the damage moves to you", () => {
    const use = featureUse("subclass:stalwart:loyal-protector");
    expect(use.activation).toEqual({ kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "close" } });
    const low = ally("mira", { hp: 4 });
    const plan = ok("subclass:stalwart:loyal-protector", undefined, ctx(actorOf(guardian, { facts: { subject: { hp: 4, hpMax: 6, conditions: [] } } }), [], { trigger: { subject: low } }));
    expect(plan.actor.after.stress).toBe(guardian.stress + 1);
    expect(ofKind(plan, "prompt").map((p) => [p.prompt, p.text])).toEqual([["move", "Sprint to the ally's side"]]);
    expect(folds(plan)).toEqual([["redirectDamage", ["mira"], undefined]]);
    // 3 unmarked: refused.
    const healthy = actorOf(guardian, { facts: { subject: { hp: 3, hpMax: 6, conditions: [] } } });
    expect(runFeature(entry("subclass:stalwart:loyal-protector"), undefined, ctx(healthy, [], { trigger: { subject: ally("mira", { hp: 3 }) } }))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("At Ease is passive with no mods (the sheet's Stress slots add it)", () => {
    expect(featureUse("subclass:vengeance:at-ease")).toMatchObject({ activation: { kind: "passive" }, mods: [], steps: [] });
  });

  it("Revenge: an adversary in Melee succeeds on you; 2 Stress and it marks a Hit Point", () => {
    expect(featureUse("subclass:vengeance:revenge").activation).toEqual({ kind: "reaction", trigger: { kind: "whenAttacked", stage: "succeeded", from: "melee" } });
    const plan = ok("subclass:vengeance:revenge", undefined, ctx(actorOf(guardian), [], { trigger: { source: adv("bandit") } }));
    expect(plan.actor.after.stress).toBe(guardian.stress + 2);
    expect(plan.creatures.find((c) => c.id === "bandit")?.after.hp).toBe(1);
  });

  it("Act of Reprisal (Q8): an adversary damages an ally in your Melee; +1 Proficiency on your next success against it", () => {
    expect(featureUse("subclass:vengeance:act-of-reprisal").activation).toEqual({ kind: "auto", trigger: { kind: "whenAllyTakesDamage", range: "melee" } });
    const plan = ok("subclass:vengeance:act-of-reprisal", undefined, ctx(actorOf(guardian), [], { trigger: { source: adv("bandit"), subject: ally("mira") } }));
    expect(ofKind(plan, "effect")).toEqual([
      {
        kind: "effect",
        targetId: "pc",
        label: "Act of Reprisal",
        mods: [{ kind: "stat", stat: "proficiency", delta: 1, versus: { creature: { kind: "damagedAlly", range: "melee" }, on: "attacksAgainstThem" } }],
        duration: "manual",
        endsWhen: "Your next successful attack against that adversary",
        endsOn: ["attackSucceeds"],
      },
    ]);
  });

  it("Nemesis: 2 Hope Prioritize one adversary until your next rest (one at a time); swap Hope and Fear against it", () => {
    const plan = ok("subclass:vengeance:nemesis", undefined, ctx(actorOf(guardian), [], { targets: [adv("bandit")] }));
    expect(plan.actor.after.hope).toBe(4);
    expect(plan.exclusive).toBe(true);
    expect(ofKind(plan, "condition")).toMatchObject([{ targetId: "bandit", condition: { kind: "tag", tag: "Prioritized" }, duration: "rest" }]);

    const prioritized = actorOf(guardian, { facts: { target: { hp: 0, hpMax: 5, conditions: [], tags: ["Prioritized"] } } });
    expect(folds(ok("subclass:vengeance:nemesis", "swap", ctx(prioritized, [])))).toEqual([["modifyRoll", ["pc"], undefined]]);
    const other = actorOf(guardian, { facts: { target: { hp: 0, hpMax: 5, conditions: [], tags: [] } } });
    expect(runFeature(entry("subclass:vengeance:nemesis"), "swap", ctx(other, []))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

// ---------------------------------------------------------------- Warrior (CB p.48)

describe("No Mercy (CB p.48)", () => {
  it("3 Hope: +1 to attack rolls until your next rest", () => {
    const plan = ok("hope:warrior", undefined, ctx(actorOf(warrior, { hope: 3 }), []));
    expect(plan.actor.after.hope).toBe(0);
    expect(ofKind(plan, "effect")).toMatchObject([{ label: "No Mercy", duration: "rest", mods: [{ kind: "stat", stat: "attack", delta: 1 }] }]);
  });
});

describe("Attack of Opportunity (CB p.48)", () => {
  const id = "class:warrior:attack-of-opportunity";
  const actor = actorOf(warrior, { traits: { ...warrior.traits, strength: 2 } });

  it("one reaction use per trait (a trait of your choice), on an enemy leaving your Melee range", () => {
    expect(entry(id).uses.map((u) => u.id)).toEqual(["agility", "strength", "finesse", "instinct", "presence", "knowledge"]);
    for (const u of entry(id).uses) {
      expect(u.activation).toEqual({ kind: "reaction", trigger: { kind: "whenEnemyLeavesRange", range: "melee" } });
      expect(u.roll).toMatchObject({ kind: "reaction", trait: u.id });
    }
  });

  it("a success: one effect (the primary weapon's damage); no Hope or Fear from a reaction roll", () => {
    // Strength reaction roll 9 + 3 + 2 = 14 against Difficulty 12; d8 damage rolls 6.
    const plan = ok(id, "strength", ctx(actor, [9, 3, 6], { trigger: { source: adv("bandit") }, options: { effect: ["damage"] } }));
    expect(plan.success).toBe(true);
    expect(plan.actor.after.hope).toBe(actor.hope);
    expect(plan.gmFearDelta).toBe(0);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ taken: 6 });
  });

  it("a critical: two effects (damage and you move with them); the damage is not doubled by the reaction critical", () => {
    const plan = ok(id, "strength", ctx(actor, [5, 5, 6], { trigger: { source: adv("bandit") }, options: { effect: ["damage"], critical: ["follow"] } }));
    expect(plan.roll?.critical).toBe(true);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ taken: 6 });
    expect(ofKind(plan, "prompt").map((p) => [p.prompt, p.text])).toEqual([["move", "You move with them"]]);
  });

  it("a failure: nothing", () => {
    const plan = ok(id, "strength", ctx(actor, [2, 3], { trigger: { source: adv("bandit") }, options: { effect: ["damage"] } }));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "damage")).toEqual([]);
  });
});

describe("Combat Training (CB p.48)", () => {
  it("on physical damage, + your level to the damage roll", () => {
    expect(featureUse("class:warrior:combat-training").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouDealDamage", damageType: "physical" } });
    const plan = ok("class:warrior:combat-training", undefined, ctx(actorOf({ ...warrior, level: 4 }), [], { targets: [adv("bandit")] }));
    expect(folds(plan)).toEqual([["modifyDamage", ["bandit"], 4]]);
  });
});

describe("Call of the Brave (CB p.48)", () => {
  it("Courage: a failed roll with Fear gains a Hope (the situation the server confirms)", () => {
    expect(featureUse("subclass:call-of-the-brave:courage").activation).toEqual({ kind: "auto", trigger: { kind: "afterYouRoll", roll: "action", result: "failure" } });
    const plan = ok("subclass:call-of-the-brave:courage", undefined, ctx(actorOf(warrior), [], { situations: ["The roll was with Fear"] }));
    expect(plan.actor.after.hope).toBe(3);
    expect(runFeature(entry("subclass:call-of-the-brave:courage"), undefined, ctx(actorOf(warrior), []))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Battle Ritual: once per long rest, confirmed: clear 2 Stress and gain 2 Hope", () => {
    const text = featureUse("subclass:call-of-the-brave:battle-ritual").requires!.flatMap((r) => (r.kind === "situation" ? [r.text] : []));
    const plan = ok("subclass:call-of-the-brave:battle-ritual", undefined, ctx(actorOf(warrior, { stress: 3 }), [], { situations: text }));
    expect(plan.actor.after).toMatchObject({ stress: 1, hope: 4 });
    expect(plan.limit).toEqual({ key: "feat:subclass:call-of-the-brave:battle-ritual", until: "longRest", consumed: true });
    expect(runFeature(entry("subclass:call-of-the-brave:battle-ritual"), undefined, ctx(actorOf(warrior), []))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Rise to the Challenge: 2 or fewer HP unmarked, a d20 Hope Die on your roll", () => {
    // hpMax 6: 4 marked leaves 2 unmarked.
    expect(folds(ok("subclass:call-of-the-brave:rise-to-the-challenge", undefined, ctx(actorOf(warrior, { hp: 4 }), [])))).toEqual([["modifyRoll", ["pc"], undefined]]);
    expect(featureUse("subclass:call-of-the-brave:rise-to-the-challenge").steps[0]).toMatchObject({ change: { kind: "hopeDie", sides: 20 } });
    expect(runFeature(entry("subclass:call-of-the-brave:rise-to-the-challenge"), undefined, ctx(actorOf(warrior, { hp: 3 }), []))).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Camaraderie: one more Tag Team per session; allies pay 2 Hope to Tag Team with you", () => {
    expect(resolvedMods(featureUse("subclass:call-of-the-brave:camaraderie").mods!)).toEqual([
      { kind: "stat", stat: "tagTeamUses", delta: 1 },
      { kind: "set", stat: "tagTeamAllyCost", to: 2 },
    ]);
  });
});

describe("Call of the Slayer (CB p.48)", () => {
  const slayer = "subclass:call-of-the-slayer:slayer";
  const heldDice = [
    { id: "slayer-1", kind: "slayer" as const, sides: 6 },
    { id: "slayer-2", kind: "slayer" as const, sides: 6 },
    { id: "slayer-3", kind: "slayer" as const, sides: 6 },
  ];
  const sheet = sheetOf("warrior", "call-of-the-slayer", { sessionFeatures: { slayerDice: 3 } });

  it("spend 2 of 3 Slayer Dice on an attack roll: roll them (4 + 5) and add 9", () => {
    const plan = ok(slayer, "attack", ctx(actorOf(sheet, { heldDice }), [4, 5], { choices: { dice: 2 } }));
    expect(ofKind(plan, "pay")[0]!.costs).toEqual([{ resource: "tokens", amount: 2, pool: "slayer", values: [4, 5] }]);
    expect(folds(plan)).toEqual([["modifyRoll", ["pc"], 9]]);
    expect(plan.actor.after.heldDice).toEqual([heldDice[2]]);
  });

  it("on a damage roll they add to the damage; more dice than held is refused", () => {
    const plan = ok(slayer, "damage", ctx(actorOf(sheet, { heldDice }), [6], { choices: { dice: 1 }, targets: [adv("bandit")] }));
    expect(folds(plan)).toEqual([["modifyDamage", ["bandit"], 6]]);
    expect(runFeature(entry(slayer), "damage", ctx(actorOf(sheet, { heldDice }), [], { choices: { dice: 4 } }))).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Weapon Specialist: on a success, a Hope adds a secondary weapon damage die", () => {
    const ws = "subclass:call-of-the-slayer:weapon-specialist";
    expect(featureUse(ws).activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } });
    const plan = ok(ws, "main", ctx(actorOf(warrior), [], { targets: [adv("bandit")] }));
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "fold").map((f) => f.step)).toMatchObject([{ kind: "modifyDamage", change: { kind: "addWeaponDie", weapon: "secondary" } }]);
  });

  it("Weapon Specialist: once per long rest, reroll the Slayer Dice's 1s (a manual step)", () => {
    const ws = "subclass:call-of-the-slayer:weapon-specialist";
    const plan = ok(ws, "slayer-ones", ctx(actorOf(warrior), []));
    expect(ofKind(plan, "prompt").map((p) => p.prompt)).toEqual(["manual"]);
    expect(plan.limit).toEqual({ key: "feat:subclass:call-of-the-slayer:weapon-specialist:slayer-ones", until: "longRest", consumed: true });
  });
});

// The reaction window of an adversary hit (combat-actions Q13 / Q17, AA1): Iron Will and Partners-in-Arms answer there.
describe("Stalwart reactions in the adversary-hit reaction window (CB p.36)", () => {
  const windowPc = (id: string, over: Partial<WindowPc> = {}): WindowPc => ({
    id,
    thresholds: { major: 8, severe: 16 },
    hp: 0,
    hpMax: 6,
    stress: 0,
    stressMax: 6,
    armor: 0,
    armorMax: 3,
    hope: 2,
    evasion: 12,
    cards: [],
    ...over,
  });
  const hit = (over: Partial<WindowHit> = {}): WindowHit => ({ attackerId: "bandit", amount: 18, type: "physical", direct: false, critical: false, ...over });
  const answered = (r: RespondResult): WindowState => {
    if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
    return r.state;
  };
  const asActor = (id: string, over: Partial<ActorState> = {}): ActorState => actorOf(guardian, { id, stress: 0, thresholds: { major: 8, severe: 16 }, ...over });
  const asCard = (featureId: string) => asCardEffect(entry(featureId));
  const IRON_WILL = "subclass:stalwart:iron-will";
  const PARTNERS = "subclass:stalwart:partners-in-arms";

  it("Iron Will: the hit Guardian marks two Armor Slots against a Severe 18: Minor, 1 HP", () => {
    const party = [windowPc("bram", { cards: [asCard(IRON_WILL)] })];
    let w = openWindow({ hit: hit(), targetId: "bram", party });
    expect(w.responders).toEqual([{ characterId: "bram", role: "target", cardIds: [IRON_WILL] }]);
    const { result, folds: f } = runReactionCard(asCard(IRON_WILL), asActor("bram"), w, { target: ally("bram") }, queueRng([]));
    expect(result.ok).toBe(true);
    w = answered(respond(w, { characterId: "bram", choice: { kind: "card", cardId: IRON_WILL }, folds: f }));
    w = answered(respond(w, { characterId: "bram", choice: { kind: "armor", slots: 2 } }));
    expect(resolveWindow(w, party).result).toMatchObject({ targetId: "bram", armorSlots: 2, severity: "minor", hpMarked: 1 });
  });

  it("Iron Will is not offered against magic damage", () => {
    const party = [windowPc("bram", { cards: [asCard(IRON_WILL)] })];
    expect(openWindow({ hit: hit({ type: "magic" }), targetId: "bram", party }).responders).toEqual([{ characterId: "bram", role: "target", cardIds: [] }]);
  });

  it("Partners-in-Arms: an ally within Very Close is hit; the Guardian's Armor Slot drops it from Severe to Major", () => {
    const party = [windowPc("mira"), windowPc("bram", { cards: [asCard(PARTNERS)], bandToTarget: "veryClose" })];
    let w = openWindow({ hit: hit(), targetId: "mira", party });
    expect(w.responders.find((r) => r.characterId === "bram")).toEqual({ characterId: "bram", role: "ally", cardIds: [PARTNERS] });
    const { result, folds: f } = runReactionCard(asCard(PARTNERS), asActor("bram"), w, { target: ally("mira") }, queueRng([]));
    expect(result.ok && result.plan.actor.after.armor).toBe(1);
    expect(f).toEqual([{ kind: "reduceSeverity", steps: 1, targetIds: ["mira"] }]);
    w = answered(respond(w, { characterId: "bram", choice: { kind: "card", cardId: PARTNERS }, folds: f }));
    w = answered(respond(w, { characterId: "mira", choice: { kind: "noArmor" } }));
    expect(resolveWindow(w, party).result).toMatchObject({ targetId: "mira", severity: "major", hpMarked: 2 });
  });

  it("Partners-in-Arms is not offered to a Guardian at Close range", () => {
    const party = [windowPc("mira"), windowPc("bram", { cards: [asCard(PARTNERS)], bandToTarget: "close" })];
    expect(openWindow({ hit: hit(), targetId: "mira", party }).responders.map((r) => r.characterId)).toEqual(["mira"]);
  });
});

describe("upgrades", () => {
  it("no Guardian or Warrior entry carries upgrades (Unstoppable's d6 at level 5 is D5's die)", () => {
    for (const e of GUARDIAN_WARRIOR_EFFECTS) {
      expect(e.upgrades).toBeUndefined();
      expect(applyUpgrades(e, { rank: "mastery", featureIds: new Set(), level: 10 })).toBe(e);
    }
  });
});
