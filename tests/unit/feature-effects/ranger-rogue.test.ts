import { describe, expect, it } from "vitest";

import type { ActorState, PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { applyUpgrades, featureAvailability, holdingsFor, owned, parseFeatureId, runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects";
import { FEATURE_CLASSIFICATION, featureEffect } from "@/lib/srd/feature-effects";
import { FOCUS_TAG, RANGER_ROGUE_EFFECTS, RANGER_ROGUE_IDS as ID, RANGER_ROGUE_SITUATIONS as S } from "@/lib/srd/feature-effects/ranger-rogue";
import type { CharacterSheet } from "@/lib/validation/characters";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-ranger-rogue: every Ranger and Rogue feature's effect entry, run through runFeature with
// fixed dice. Expected values come from the book by hand (CB p.38-43, printed pages). RNG order: Hope die, Fear die, then
// damage dice. The fixtures' actor has Agility 2, Spellcast 1, Proficiency 1, a d8 Melee weapon (Agility) and 3 Hope; the
// fixtures' adversary has Difficulty 12 and thresholds 30 / 60.

const OWNERS = new Set(["ranger", "rogue", "beastbound", "wayfinder", "nightwalker", "syndicate"]);

const entry = (id: string) => {
  const e = RANGER_ROGUE_EFFECTS.find((x) => x.featureId === id);
  if (!e) throw new Error(`no entry for ${id}`);
  return e;
};

const ranger = (patch: Partial<CharacterSheet> = {}) => sheetOf("ranger", "beastbound", { hope: 3, ...patch });
const rogue = (patch: Partial<CharacterSheet> = {}) => sheetOf("rogue", "nightwalker", { hope: 3, ...patch });

/** Runs one use with fixed dice; every die must be used. */
function plan(id: string, useId: string | undefined, dice: number[], over: Partial<FeatureRunContext> = {}, sheet: CharacterSheet = ranger()): RunPlan {
  const rng = queueRng(dice);
  const result = runFeature(entry(id), useId, { actor: actorOf(sheet), gmFear: 2, rng, ...over });
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}
const refusal = (id: string, useId: string | undefined, over: Partial<FeatureRunContext> = {}, sheet: CharacterSheet = ranger()) =>
  runFeature(entry(id), useId, { actor: actorOf(sheet), gmFear: 2, rng: queueRng([]), ...over });

const ofKind = <K extends PlanStep["kind"]>(p: RunPlan, kind: K) => p.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const folds = (p: RunPlan) => ofKind(p, "fold").map((f) => ({ kind: f.step.kind, targetIds: f.targetIds, amount: f.amount }));
const tagged = (id: string, tags: string[] = [FOCUS_TAG]): Combatant => ({ ...adversary(id), tags });
const actorWith = (sheet: CharacterSheet, over: Partial<ActorState>) => actorOf(sheet, over);

describe("the Ranger and Rogue table", () => {
  const usable = Object.entries(FEATURE_CLASSIFICATION)
    .filter(([id, c]) => OWNERS.has(parseFeatureId(id)?.owner ?? "") && (c.usage === "combat" || c.usage === "passive"))
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per combat or passive Ranger / Rogue feature (no missing, extra or duplicate id)", () => {
    const ids = RANGER_ROGUE_EFFECTS.map((e) => e.featureId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(usable);
    expect(usable).toHaveLength(20);
    expect(ids).not.toContain("subclass:wayfinder:path-forward");
    expect(ids).not.toContain("subclass:syndicate:well-connected");
    expect(Object.values(ID).sort()).toEqual(usable);
    for (const id of ids) expect(featureEffect(id)).toBe(entry(id));
  });

  it("each entry's source, owner and card are the ones owned() gives a sheet at mastery", () => {
    for (const [classId, subclassId] of [["ranger", "beastbound"], ["ranger", "wayfinder"], ["rogue", "nightwalker"], ["rogue", "syndicate"]] as const) {
      const held = owned(sheetOf(classId, subclassId, { subclassRank: "mastery" })).filter((f) => f.owner === classId || f.owner === subclassId);
      const usableHeld = held.filter((f) => f.usage === "combat" || f.usage === "passive");
      for (const f of usableHeld) {
        const e = entry(f.featureId);
        expect([e.source, e.owner, e.card]).toEqual([f.source, f.owner, f.card]);
      }
      expect(held.filter((f) => !usableHeld.includes(f)).map((f) => f.featureId)).toEqual(
        subclassId === "wayfinder" ? ["subclass:wayfinder:path-forward"] : subclassId === "syndicate" ? ["subclass:syndicate:well-connected"] : [],
      );
    }
  });

  it("every use runs through runFeature without throwing, with unique use ids; passive uses carry only mods", () => {
    for (const effect of RANGER_ROGUE_EFFECTS) {
      expect(new Set(effect.uses.map((u) => u.id)).size).toBe(effect.uses.length);
      for (const use of effect.uses) {
        if (use.activation.kind === "passive") expect(use.steps).toEqual([]);
        if (use.id === "main" && effect.featureId === ID.roguesDodge) continue; // delegated: below, with a sheet
        const result = runFeature(effect, use.id, {
          actor: actorOf(ranger({ hope: 6 })),
          gmFear: 2,
          targets: use.targets && use.targets.side === "point" ? [] : [tagged("a")],
          trigger: { source: adversary("a"), subject: tagged("b"), amount: 9 },
          companion: { ...adversary("wolf"), side: "pc" },
          situations: (use.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : [])),
          options: { who: ["you"], benefit: ["supply"] },
          rng: () => 1,
        });
        expect(result.ok, `${effect.featureId}/${use.id}`).toBe(true);
      }
    }
  });
});

describe("Ranger (CB p.38)", () => {
  it("Hold Them Off: a rider on a successful weapon attack, 3 Hope, the same roll against two more adversaries", () => {
    const use = entry(ID.holdThemOff).uses[0]!;
    expect(use.activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } });
    const p = plan(ID.holdThemOff, undefined, []);
    expect(p.actor.after.hope).toBe(0);
    expect(folds(p)).toEqual([{ kind: "addTargets", targetIds: ["pc"], amount: 2 }]);
    const step = ofKind(p, "fold")[0]!.step;
    expect(step).toMatchObject({ kind: "addTargets", damage: "same", targets: { side: "enemy", range: "weapon", count: { kind: "upTo", n: { kind: "fixed", value: 2 } } } });
    expect(refusal(ID.holdThemOff, undefined, {}, ranger({ hope: 2 }))).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Ranger's Focus: a Hope and an attack; on a success normal damage and the target becomes the temporary Focus", () => {
    // Hope 8 + Fear 5 + Agility 2 = 15 against Difficulty 12: a hit with Hope (+1 Hope). d8 × Proficiency 1 = 6: Minor, 1 HP.
    const p = plan(ID.rangersFocus, undefined, [8, 5, 6], { targets: [adversary("bandit")] });
    expect(p.hits).toEqual([{ id: "bandit", hit: true }]);
    expect(p.actor.after.hope).toBe(3); // 3 - 1 + 1
    expect(ofKind(p, "damageRoll")[0]!.record.total).toBe(6);
    expect(ofKind(p, "condition")).toEqual([
      { kind: "condition", targetId: "bandit", condition: { kind: "tag", tag: FOCUS_TAG }, duration: "temporary", endsWhen: "Ranger's Focus ends or you make a different creature your Focus" },
    ]);
    expect(p.creatures.find((c) => c.id === "bandit")?.after.tags).toEqual([FOCUS_TAG]);
    expect(p.exclusive).toBe(true);
    // Hope 2 + Fear 3 + 2 = 7: a miss with Fear, no damage, no Focus; the Hope is still spent.
    const miss = plan(ID.rangersFocus, undefined, [2, 3], { targets: [adversary("bandit")] });
    expect(ofKind(miss, "condition")).toEqual([]);
    expect(ofKind(miss, "damage")).toEqual([]);
    expect(miss.actor.after.hope).toBe(2);
    expect(miss.gmFearDelta).toBe(1);
  });

  it("Ranger's Focus: when you deal damage to your Focus, they must mark a Stress (and nobody else does)", () => {
    const p = plan(ID.rangersFocus, "stress", [], { trigger: { subject: tagged("bandit"), amount: 6 } });
    expect(ofKind(p, "mark")).toEqual([{ kind: "mark", targetId: "bandit", track: "stress", amount: 1, hpMarked: 0, overflow: false }]);
    expect(entry(ID.rangersFocus).uses[1]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenYouDealDamage", toEnemy: true } });
    const other = plan(ID.rangersFocus, "stress", [], { trigger: { subject: adversary("ogre"), amount: 6 } });
    expect(ofKind(other, "mark")).toEqual([]);
  });

  it("Ranger's Focus: after a failed attack against your Focus, end it to reroll the Duality Dice (Q1 after-roll)", () => {
    const facts = { target: { conditions: [], tags: [FOCUS_TAG], hp: 0, hpMax: 5 } };
    const p = plan(ID.rangersFocus, "reroll", [], { actor: actorWith(ranger(), { facts }), targets: [tagged("bandit")] });
    expect(folds(p)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: undefined }]);
    expect(ofKind(p, "fold")[0]!.step).toMatchObject({ change: { kind: "reroll", dice: "all" } });
    expect(ofKind(p, "clearCondition")).toEqual([{ kind: "clearCondition", targetId: "bandit", condition: { kind: "tag", tag: FOCUS_TAG } }]);
    expect(p.creatures.find((c) => c.id === "bandit")?.after.tags).toEqual([]);
    // Not the Focus: the engine knows it and refuses; unknown: the player's box decides (Q13).
    const notFocus = { target: { conditions: [], tags: [], hp: 0, hpMax: 5 } };
    expect(refusal(ID.rangersFocus, "reroll", { actor: actorWith(ranger(), { facts: notFocus }), targets: [adversary("ogre")], situations: [S.focusTarget] })).toMatchObject({ ok: false, reason: "requirement" });
    expect(refusal(ID.rangersFocus, "reroll", { targets: [tagged("bandit")] })).toMatchObject({ ok: false, reason: "requirement" });
    expect(refusal(ID.rangersFocus, "reroll", { targets: [tagged("bandit")], situations: [S.focusTarget] }).ok).toBe(true);
  });
});

describe("Beastbound (CB p.38, companion CB p.40)", () => {
  const wolf: Combatant = { ...adversary("wolf"), side: "pc", evasion: 10 };

  it("Companion: Command an attack from the companion's token, a Spellcast Roll, your Proficiency and their d6 (Q4)", () => {
    // Experience +2 for a Hope. Hope 7 + Fear 3 + Spellcast 1 + 2 = 13 against 12: a hit with Hope (+1 Hope). d6: 4.
    const p = plan(ID.companion, "attack", [7, 3, 4], { targets: [adversary("bandit")], choices: { experience: 2 } });
    expect(p.actorKind).toBe("companion");
    expect(p.roll?.record.total).toBe(13);
    expect(p.actor.after.hope).toBe(3); // 3 - 1 + 1
    expect(ofKind(p, "damage")[0]!.result).toMatchObject({ targetId: "bandit", incoming: 4, hpMarked: 1 });
    expect(ofKind(p, "prompt").map((s) => s.text)).toEqual(["On a success with Hope, if your next action builds on their success, you gain advantage on the roll."]);
    // No Experience: no Hope. Hope 3 + Fear 9 + 1 = 13: a hit with Fear, no advantage reminder.
    const plain = plan(ID.companion, "attack", [3, 9, 2], { targets: [adversary("bandit")] });
    expect(plain.actor.after.hope).toBe(3);
    expect(ofKind(plain, "prompt")).toEqual([]);
    expect(ofKind(plain, "damage")[0]!.result.incoming).toBe(2);
  });

  it("Companion: Command an action (the GM's Difficulty); on a success the companion acts", () => {
    const p = plan(ID.companion, "command", [9, 4], { roll: { difficulty: 10 } });
    expect(p.success).toBe(true);
    expect(ofKind(p, "prompt").map((s) => s.text)).toEqual([
      "Your companion takes the action you commanded.",
      "On a success with Hope, if your next action builds on their success, you gain advantage on the roll.",
    ]);
    expect(plan(ID.companion, "command", [2, 4], { roll: { difficulty: 10 } }).steps.some((s) => s.kind === "prompt")).toBe(false);
  });

  it("Battle-Bonded: +2 Evasion against an adversary inside your companion's Melee range; the Trainings have no modifier", () => {
    expect(entry(ID.battleBonded).uses[0]!.mods).toEqual([
      { kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 2 }, versus: { creature: { kind: "inCompanionReach" }, on: "attacksByThem" } },
    ]);
    expect(entry(ID.expertTraining).uses[0]!.mods).toEqual([]);
    expect(entry(ID.advancedTraining).uses[0]!.mods).toEqual([]);
  });

  it("Loyal Friend: once per long rest, you or your companion takes the other's damage", () => {
    const you = plan(ID.loyalFriend, undefined, [], { trigger: { subject: wolf, amount: 5 }, situations: [S.loyalFriend], options: { who: ["you"] } });
    expect(ofKind(you, "fold").map((f) => [f.step, f.targetIds])).toEqual([[expect.objectContaining({ kind: "redirectDamage", target: "self" }), ["wolf"]]]);
    expect(you.limit).toEqual({ key: "feat:subclass:beastbound:loyal-friend", until: "longRest", consumed: true });

    const me = { ...adversary("pc"), side: "pc" as const };
    const it2 = plan(ID.loyalFriend, undefined, [], { trigger: { subject: me, amount: 5 }, companion: wolf, situations: [S.loyalFriend], options: { who: ["companion"] } });
    expect(ofKind(it2, "fold")[0]!.step).toMatchObject({ kind: "redirectDamage", target: "picked", pick: { side: "ally", companion: true, range: "close" } });

    const used = ranger({ subclassRank: "mastery", featureUses: you.actor.featureUses });
    expect(featureAvailability(used, entry(ID.loyalFriend))).toEqual({ state: "exhausted", until: "longRest", label: expect.any(String) });
    expect(refusal(ID.loyalFriend, undefined, { actor: actorOf(used), trigger: { subject: wolf }, situations: [S.loyalFriend] })).toMatchObject({ ok: false, reason: "exhausted" });
    expect(refusal(ID.loyalFriend, undefined, { trigger: { subject: wolf } })).toMatchObject({ ok: false, reason: "requirement" });
    // No pick yet: the window asks who.
    expect(ofKind(plan(ID.loyalFriend, undefined, [], { trigger: { subject: wolf }, situations: [S.loyalFriend] }), "prompt")[0]).toMatchObject({ prompt: "choose" });
  });
});

describe("Wayfinder (CB p.39)", () => {
  const wayfinder = () => sheetOf("ranger", "wayfinder", { hope: 3 });

  it("Ruthless Predator: mark a Stress for +1 Proficiency on a damage roll", () => {
    const p = plan(ID.ruthlessPredator, "main", [], { targets: [adversary("bandit")] }, wayfinder());
    expect(p.actor.after.stress).toBe(2);
    expect(folds(p)).toEqual([{ kind: "modifyDamage", targetIds: ["bandit"], amount: 1 }]);
    expect(entry(ID.ruthlessPredator).uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "damage" } });
  });

  it("Ruthless Predator: your Severe damage makes the adversary mark a Stress", () => {
    expect(entry(ID.ruthlessPredator).uses[1]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenEnemyTakesDamage", severity: "severe", byYou: true } });
    const p = plan(ID.ruthlessPredator, "severe", [], { trigger: { subject: adversary("bandit"), amount: 61 } }, wayfinder());
    expect(ofKind(p, "mark")).toEqual([{ kind: "mark", targetId: "bandit", track: "stress", amount: 1, hpMarked: 0, overflow: false }]);
  });

  it("Elusive Predator: +2 Evasion against attacks by your Focus", () => {
    expect(entry(ID.elusivePredator).uses[0]!.mods).toEqual([
      { kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 2 }, versus: { creature: { kind: "tagged", tag: FOCUS_TAG }, on: "attacksByThem" } },
    ]);
  });

  it("Apex Predator: a Hope before attacking your Focus; on a success the GM loses a Fear", () => {
    const facts = { target: { conditions: [], tags: [FOCUS_TAG], hp: 0, hpMax: 5 } };
    const p = plan(ID.apexPredator, undefined, [], { actor: actorWith(wayfinder(), { facts }), targets: [tagged("bandit")] }, wayfinder());
    expect(p.actor.after.hope).toBe(2);
    expect(p.gmFearDelta).toBe(-1);
    expect(plan(ID.apexPredator, undefined, [], { actor: actorWith(wayfinder(), { facts }), gmFear: 0 }).gmFearDelta).toBe(0);
    const notFocus = { target: { conditions: [], tags: [], hp: 0, hpMax: 5 } };
    expect(refusal(ID.apexPredator, undefined, { actor: actorWith(wayfinder(), { facts: notFocus }), situations: [S.apexTarget] })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Rogue (CB p.42)", () => {
  it("Rogue's Dodge: 3 Hope, D5 writes +2 Evasion until hit or the next rest", () => {
    const sheet = rogue();
    const result = runFeature(entry(ID.roguesDodge), undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.actor.after.hope).toBe(0);
    expect(ofKind(result.plan, "delegate")[0]).toMatchObject({ feature: "roguesDodge", done: true });
    expect(result.sheet?.effects.find((e) => e.id === "rogues-dodge")).toMatchObject({ until: "hit", mods: { evasion: 2 } });
    const poor = rogue({ hope: 2 });
    expect(runFeature(entry(ID.roguesDodge), undefined, { actor: actorOf(poor), gmFear: 0, rng: queueRng([]), sheet: poor })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Cloaked: passive, the map turns Hidden into Cloaked (Q9)", () => {
    expect(entry(ID.cloaked).uses).toEqual([{ id: "main", name: "Cloaked", activation: { kind: "passive" }, mods: [], steps: [] }]);
  });

  it("Sneak Attack: automatic on a successful attack, + tier d6s (tier 1: 1d6, tier 3: 3d6)", () => {
    expect(entry(ID.sneakAttack).uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "success" } });
    expect(folds(plan(ID.sneakAttack, undefined, [5], { targets: [adversary("bandit")], situations: [S.sneakAttack] }, rogue()))).toEqual([{ kind: "modifyDamage", targetIds: ["bandit"], amount: 5 }]);
    const tier3 = actorWith(rogue({ level: 5 }), { tier: 3 });
    expect(folds(plan(ID.sneakAttack, undefined, [2, 3, 4], { actor: tier3, targets: [adversary("bandit")], situations: [S.sneakAttack] }, rogue()))[0]!.amount).toBe(9);
    expect(refusal(ID.sneakAttack, undefined, {}, rogue())).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Nightwalker (CB p.42)", () => {
  it("Shadow Stepper: in darkness, a Stress to reappear in a shadow within Far, Cloaked", () => {
    const p = plan(ID.shadowStepper, undefined, [], { situations: [S.shadowStepper] }, rogue());
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["pc"] });
    expect(ofKind(p, "condition")[0]).toMatchObject({ targetId: "pc", condition: { kind: "standard", condition: "cloaked" }, duration: "manual" });
    expect(entry(ID.shadowStepper).uses[0]!.targets).toMatchObject({ side: "point", range: "far" });
    expect(refusal(ID.shadowStepper, undefined, {}, rogue())).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Fleeting Shadow: +1 Evasion, and Shadow Stepper reaches Very Far (NV3)", () => {
    expect(entry(ID.fleetingShadow).uses[0]!.mods).toEqual([{ kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 1 } }]);
    for (const [rank, range] of [["specialization", "far"], ["mastery", "veryFar"]] as const) {
      const sheet = rogue({ subclassRank: rank });
      const upgraded = applyUpgrades(entry(ID.shadowStepper), holdingsFor(sheet, owned(sheet), "nightwalker"));
      expect(upgraded.uses[0]!.targets).toMatchObject({ range });
    }
  });

  it("Dark Cloud: Spellcast Roll (15); on a success a temporary cloud around you that blocks sight (Q14)", () => {
    // Hope 10 + Fear 6 + Spellcast 1 = 17.
    const p = plan(ID.darkCloud, undefined, [10, 6], {}, rogue());
    expect(ofKind(p, "area")).toEqual([
      { kind: "area", area: { label: "Dark Cloud", centre: "self", radius: "close", side: "all", blocksSight: true, duration: "temporary", mods: [] }, centreId: "pc", targetIds: ["pc"] },
    ]);
    expect(ofKind(plan(ID.darkCloud, undefined, [3, 4], {}, rogue()), "area")).toEqual([]); // 8 < 15
  });

  it("Adrenaline: while Vulnerable, + level to damage rolls", () => {
    expect(entry(ID.adrenaline).uses[0]!.mods).toEqual([{ kind: "stat", stat: "damage", delta: { kind: "level" } }]);
    expect(plan(ID.adrenaline, undefined, [], { actor: actorWith(rogue(), { facts: { conditions: ["vulnerable"] } }) }, rogue()).steps).toEqual([]);
    expect(refusal(ID.adrenaline, undefined, { actor: actorWith(rogue(), { facts: { conditions: [] } }), situations: [S.vulnerable] }, rogue())).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Vanishing Act: a Stress to be Cloaked until a roll with Fear or the next rest; clears Restrained", () => {
    const p = plan(ID.vanishingAct, undefined, [], { actor: actorWith(rogue(), { conditions: ["restrained"] }) }, rogue());
    expect(p.actor.after.stress).toBe(2);
    expect(ofKind(p, "condition")).toEqual([{ kind: "condition", targetId: "pc", condition: { kind: "standard", condition: "cloaked" }, duration: "rest", endsOn: ["rollWithFear"] }]);
    expect(ofKind(p, "clearCondition")).toEqual([{ kind: "clearCondition", targetId: "pc", condition: { kind: "standard", condition: "restrained" } }]);
  });
});

describe("Syndicate (CB p.43)", () => {
  const syndicate = (patch: Partial<CharacterSheet> = {}) => sheetOf("rogue", "syndicate", { hope: 3, subclassRank: "specialization", ...patch });
  const contact = (sheet: CharacterSheet, option: string) => {
    const r = runFeature(entry(ID.contactsEverywhere), "main", { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), options: { benefit: [option] }, holdings: holdingsFor(sheet, owned(sheet), "syndicate") });
    if (!r.ok) throw new Error(r.detail);
    return r.plan;
  };

  it("Contacts Everywhere: once per session, one of three benefits", () => {
    const supply = contact(syndicate(), "supply");
    expect(ofKind(supply, "prompt")[0]?.text).toBe("They provide 1 handful of gold, a unique tool, or a mundane object that the situation requires.");
    expect(supply.limit).toEqual({ key: "feat:subclass:syndicate:contacts-everywhere", until: "session", consumed: true });
    expect(ofKind(contact(syndicate(), "die"), "effect")[0]).toMatchObject({ option: "die", duration: "nextRoll", mods: [] });
    expect(ofKind(contact(syndicate(), "snipe"), "effect")[0]).toMatchObject({ option: "snipe", duration: "manual", endsOn: ["dealDamage"] });
    // Without Reliable Backup the extra options don't exist.
    expect(ofKind(contact(syndicate(), "shield"), "effect")).toEqual([]);
    const used = syndicate({ featureUses: supply.actor.featureUses });
    expect(() => contact(used, "supply")).toThrow();
  });

  it("Reliable Backup: three times per session and two more benefits (NV3)", () => {
    let sheet = syndicate({ subclassRank: "mastery" });
    for (let i = 0; i < 3; i++) sheet = { ...sheet, featureUses: contact(sheet, "supply").actor.featureUses };
    expect(sheet.featureUses).toHaveLength(3);
    expect(() => contact(sheet, "supply")).toThrow();
    const fresh = syndicate({ subclassRank: "mastery" });
    expect(ofKind(contact(fresh, "shield"), "effect")[0]).toMatchObject({ option: "shield", endsOn: ["markHp"] });
    expect(ofKind(contact(fresh, "backup"), "effect")[0]).toMatchObject({ option: "backup", duration: "manual", endsWhen: "you make a Presence Roll in conversation" });
    expect(entry(ID.reliableBackup).uses[0]!.mods).toEqual([]);
  });

  it("the waiting benefits: +3 to the Hope or Fear Die, +2d8 damage, 1 fewer HP, a d20 Hope Die", () => {
    const waiting = (option: string) => actorWith(syndicate(), { facts: { featureEffects: [{ featureId: ID.contactsEverywhere, option }] } });
    expect(folds(plan(ID.contactsEverywhere, "die", [], { actor: waiting("die") }, syndicate()))).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: 3 }]);
    expect(folds(plan(ID.contactsEverywhere, "snipe", [5, 6], { actor: waiting("snipe"), targets: [adversary("bandit")] }, syndicate()))).toEqual([{ kind: "modifyDamage", targetIds: ["bandit"], amount: 11 }]);
    expect(folds(plan(ID.contactsEverywhere, "shield", [], { actor: waiting("shield") }, syndicate()))).toEqual([{ kind: "adjustHpMarked", targetIds: ["pc"], amount: 1 }]);
    const backup = plan(ID.contactsEverywhere, "backup", [], { actor: waiting("backup"), situations: [S.conversation] }, syndicate());
    expect(ofKind(backup, "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "hopeDie", sides: 20 } });
    // Another benefit waiting (the engine knows): refused.
    expect(refusal(ID.contactsEverywhere, "snipe", { actor: waiting("die") }, syndicate())).toMatchObject({ ok: false, reason: "requirement" });
  });
});
