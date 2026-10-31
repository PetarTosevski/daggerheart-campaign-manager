/**
 * Plan lanes, tracer E6: effect endings and durations (docs/tasks/TASK-LN-E6.md). Fixture entries only: the SRD entries
 * switch to the new vocabulary in wave 5.
 *
 * Book: Slumber (CB p.332) "Asleep until they take damage or the GM spends a Fear"; Transform (CB p.334) "remain in this
 * shape until you take damage"; Spectral Mist (HF p.180) "They become corporeal again after they … make an action roll.
 * Otherwise, this effect lasts until the end of the scene."; Reliable Backup (CB p.43) "When you make a Presence Roll in
 * conversation … You can roll a d20 as your Hope Die"; Menacing Reach (HF p.15) "This effect ends when you make a
 * successful attack with that weapon"; Timejammer (CB p.334) "It resumes the next time you make an action roll that
 * targets another creature"; Eye of the Storm (HF p.23) "until you take Severe damage or you use this feature again";
 * Night's Glamour (HF p.17) "Unless you mark a Stress to maintain your Glamour, it drops when you mark a Hit Point or deal
 * damage"; Marked for Death (HF p.8) "lasts until you take a rest, the current adversary Marked for Death is defeated, or
 * the GM spends a number of Fear equal to your tier to clear it"; Unstoppable (CB p.36) "When the die's value would exceed
 * its maximum value … remove the die and drop out of Unstoppable … You can't be Restrained or Vulnerable"; HF p.12 "If you
 * are already in a stance when you shift into a different stance, you automatically drop out of the previously active
 * stance … When you drop out of a stance, you lose any ongoing benefits it provides."
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import {
  afterUnstoppable,
  effectEndsOf,
  effectSource,
  endByGmFear,
  endForCasterOnInstances,
  endForCasterOnSheets,
  endInstanceByGmFear,
  endInstanceEffects,
  endOnDefeat,
  endOnInstance,
  endOnSheet,
  instanceEffectSource,
  instanceWrites,
  refusedConditions,
  stepEnds,
  type SourceLookup,
} from "../../convex/lib/cardRows";
import { effectKeyOf } from "../../convex/lib/cardRunner";
import { readSheet, saveSheet } from "../../convex/lib/characterSheet";
import { setStance, withStance, withoutStance } from "../../convex/lib/stanceDrop";
import type { CardUse, Step } from "../../src/lib/domain/card-effects/types";
import {
  endEffects,
  endRollResult,
  endsOnOccurrence,
  occurredEvents,
  payMaintain,
  rollEndHolds,
  withoutLapsedUnstoppable,
  type EffectEnds,
  type EndOccurrence,
  type EndsOf,
} from "../../src/lib/domain/characters/expiry";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import type { InstanceEffect } from "../../convex/lib/validators/encounters";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

allowWorldEmails();

const one = { kind: "fixed", value: 1 } as const;
const effect = (id: string, text: string, until: Effect["until"] = "manual"): Effect => ({ id, source: "Test", text, until });
const hit = (severity: "none" | "minor" | "major" | "severe", hpMarked: number, lastHp = false): EndOccurrence => ({ kind: "damageTaken", severity, hpMarked, lastHp });
const roll = (r: Extract<EndOccurrence, { kind: "roll" }>["roll"]): EndOccurrence => ({ kind: "roll", roll: r });

// ---------------------------------------------------------------- fixture entries

const fixtureUse = (id: string, steps: readonly Step[]): CardUse => ({ id, name: id, activation: { kind: "action" }, steps });
const FIXTURES: Record<string, readonly CardUse[]> = {
  // Slumber: a tag on the target, nested in a save's onFail (the deep walk finds it).
  slumber: [
    fixtureUse("main", [
      {
        kind: "save",
        to: "targets",
        difficulty: { kind: "fixed", value: 13 },
        onSuccess: [],
        onFail: [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Asleep" }, duration: "manual", endsOn: ["takeDamage", "gmSpendsFear"] }],
      } as Step,
    ]),
  ],
  transform: [fixtureUse("main", [{ kind: "effect", to: "self", label: "Transformed", mods: [], duration: "manual", endsOn: ["takeDamage"] }])],
  "spectral-mist": [fixtureUse("main", [{ kind: "effect", to: "self", label: "Spectral", mods: [], duration: "scene", endsOn: ["actionRoll"] }])],
  backup: [fixtureUse("main", [{ kind: "effect", to: "self", label: "Reliable Backup", mods: [], duration: "manual", endsOnRoll: { roll: "presence" } }])],
  reach: [fixtureUse("main", [{ kind: "effect", to: "self", label: "Menacing Reach", mods: [], duration: "manual", endsOnRoll: { roll: "attack", result: "success", weapon: "primary" } }])],
  timejammer: [fixtureUse("main", [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Time-Stopped" }, duration: "manual", endsOnRoll: { roll: "action", by: "caster", targetsCreature: true } }])],
  storm: [fixtureUse("ally", [{ kind: "effect", to: "targets", label: "Eye of the Storm: +1 Evasion", mods: [], duration: "manual", endsOn: ["usedAgain"], endsOnCaster: ["takeSevere"] }])],
  glamour: [fixtureUse("main", [{ kind: "effect", to: "self", label: "Glamoured", mods: [], duration: "manual", endsOn: ["markHp", "dealDamage"], maintain: { costs: [{ kind: "stress", amount: one }] } }])],
  jumpscare: [fixtureUse("main", [{ kind: "condition", to: "targets", condition: { kind: "standard", condition: "vulnerable" }, duration: "manual", endsOn: ["markHp"] }])],
  "class:assassin:marked-for-death": [fixtureUse("main", [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Marked for Death" }, duration: "rest", endsOn: ["targetDefeated", "gmSpendsFear"] }])],
  steady: [fixtureUse("main", [{ kind: "effect", to: "self", label: "Steady", mods: [{ kind: "flag", flag: "cannotBeVulnerable" }, { kind: "flag", flag: "cannotBeRestrained" }], duration: "scene" }])],
  stanced: [fixtureUse("main", [{ kind: "effect", to: "self", label: "Braced", mods: [], duration: "manual", endsOn: ["stanceDrops"] }])],
};
const lookup: SourceLookup = (id) => FIXTURES[id];
const endsOf: EndsOf = (e) => effectEndsOf(e, lookup);

// ---------------------------------------------------------------- the pure engine (expiry.ts)

describe("occurredEvents", () => {
  it("a hit sets off takeDamage, markHp, majorDamage, takeSevere and lastHp by its severity", () => {
    expect([...occurredEvents(hit("minor", 1))].sort()).toEqual(["markHp", "takeDamage"]);
    expect([...occurredEvents(hit("severe", 3, true))].sort()).toEqual(["lastHp", "majorDamage", "markHp", "takeDamage", "takeSevere"]);
    // Damage reduced to no Hit Points (CB p.92): no damage taken; Shield Aura's reducedToNoHp.
    expect([...occurredEvents(hit("none", 0))]).toEqual(["reducedToNoHp"]);
  });

  it("a roll sets off actionRoll, bearerAttacks, rollWithFear, bearerFails, failWithFear and attackSucceeds", () => {
    expect([...occurredEvents(roll({ kind: "action", attack: "weapon", weapon: "primary", success: true, duality: "hope" }))].sort()).toEqual(["actionRoll", "attackSucceeds", "bearerAttacks"]);
    expect([...occurredEvents(roll({ kind: "action", success: false, duality: "fear" }))].sort()).toEqual(["actionRoll", "bearerFails", "failWithFear", "rollWithFear"]);
    // A reaction roll is not an action roll (CB p.95).
    expect([...occurredEvents(roll({ kind: "reaction", success: true, duality: "hope" }))]).toEqual([]);
    // A critical is a success (CB p.90).
    expect(occurredEvents(roll({ kind: "action", attack: "spell", success: false, duality: "critical" })).has("attackSucceeds")).toBe(true);
    expect([...occurredEvents({ kind: "damageDealt", severity: "severe" })].sort()).toEqual(["dealDamage", "dealSevere"]);
  });
});

describe("roll ends", () => {
  it("Reliable Backup ends on a Presence Roll, not another trait (dcm-3ea)", () => {
    const end = { roll: "presence" } as const;
    expect(rollEndHolds(end, { kind: "action", trait: "presence", success: false, duality: "fear" })).toBe(true);
    expect(rollEndHolds(end, { kind: "action", trait: "agility", success: true, duality: "hope" })).toBe(false);
  });

  it("Menacing Reach ends on a successful attack with the primary weapon only (dcm-ffk)", () => {
    const end = { roll: "attack", result: "success", weapon: "primary" } as const;
    expect(rollEndHolds(end, { kind: "action", attack: "weapon", weapon: "primary", success: true, duality: "fear" })).toBe(true);
    expect(rollEndHolds(end, { kind: "action", attack: "weapon", weapon: "primary", success: false, duality: "hope" })).toBe(false);
    expect(rollEndHolds(end, { kind: "action", attack: "weapon", weapon: "secondary", success: true, duality: "hope" })).toBe(false);
    expect(rollEndHolds(end, { kind: "action", attack: "spell", spellcast: true, success: true, duality: "hope" })).toBe(false);
  });

  it("Timejammer ends on the caster's action roll that targets a creature, not the bearer's (dcm-cwh)", () => {
    const ends: EffectEnds = { duration: "manual", endsOnRoll: { roll: "action", by: "caster", targetsCreature: true } };
    const targeted = roll({ kind: "action", spellcast: true, success: true, duality: "hope", targetsCreature: true });
    expect(endsOnOccurrence(ends, targeted, "caster")).toBe(true);
    expect(endsOnOccurrence(ends, targeted, "bearer")).toBe(false);
    expect(endsOnOccurrence(ends, roll({ kind: "action", trait: "instinct", success: true, duality: "hope" }), "caster")).toBe(false);
  });

  it("results read a critical as a success with Hope (CB p.90)", () => {
    const crit = { kind: "action", success: false, duality: "critical" } as const;
    expect(endRollResult("successWithHope", crit)).toBe(true);
    expect(endRollResult("failure", crit)).toBe(false);
    expect(endRollResult("successWithFear", { kind: "action", success: true, duality: "fear" })).toBe(true);
  });
});

describe("endEffects", () => {
  const sheet = {
    effects: [
      effect(`${effectKeyOf("transform")}:1`, "Transformed"),
      effect(`${effectKeyOf("spectral-mist")}:1`, "Spectral", "scene"),
      effect(`${effectKeyOf("backup")}:1`, "Reliable Backup"),
      effect("hand-written", "A note"),
    ],
  };

  it("Transform ends when the bearer takes damage; damage reduced to nothing leaves it (dcm-utu)", () => {
    expect(endEffects(sheet, hit("none", 0), endsOf).ended).toEqual([]);
    const out = endEffects(sheet, hit("minor", 1), endsOf);
    expect(out.ended.map((e) => e.text)).toEqual(["Transformed"]);
    expect(out.sheet.effects.map((e) => e.text)).toEqual(["Spectral", "Reliable Backup", "A note"]);
  });

  it("Spectral Mist ends on an action roll and keeps its scene duration (dcm-0ey)", () => {
    expect(endEffects(sheet, roll({ kind: "reaction", success: true, duality: "hope" }), endsOf).ended).toEqual([]);
    const out = endEffects(sheet, roll({ kind: "action", trait: "agility", success: true, duality: "hope" }), endsOf);
    expect(out.ended.map((e) => e.text)).toEqual(["Spectral"]);
    expect(out.sheet.effects.find((e) => e.text === "Reliable Backup")).toBeDefined();
  });

  it("a duration nextRoll (stored as manual) ends on the next action roll", () => {
    const ends: EffectEnds = { duration: "nextRoll" };
    expect(endsOnOccurrence(ends, roll({ kind: "action", success: true, duality: "hope" }), "bearer")).toBe(true);
    expect(endsOnOccurrence(ends, roll({ kind: "reaction", success: true, duality: "hope" }), "bearer")).toBe(false);
  });

  it("unchanged sheets come back as the same object", () => {
    const out = endEffects(sheet, { kind: "event", event: "moves" }, endsOf);
    expect(out.sheet).toBe(sheet);
  });
});

describe("maintain (dcm-4qv, Night's Glamour)", () => {
  const glamour = effect(`${effectKeyOf("glamour")}:1`, "Glamoured");
  it("the end names it maintainable; paid, it stays", () => {
    const out = endEffects({ effects: [glamour] }, hit("minor", 1), endsOf);
    expect(out.ended).toEqual([glamour]);
    expect(out.maintainable).toEqual([glamour]);
    const kept = endEffects({ effects: [glamour] }, hit("minor", 1), endsOf, { maintained: new Set([glamour.id]) });
    expect(kept.sheet.effects).toEqual([glamour]);
    expect(kept.ended).toEqual([]);
  });

  it("payMaintain marks the Stress; past a full track a Hit Point; null when it can't be paid", () => {
    const m = { costs: [{ kind: "stress", amount: one }] } as const;
    expect(payMaintain({ hope: 2, stress: 1, stressMax: 6, hp: 0, hpMax: 6 }, m)).toEqual({ hope: 2, stress: 2, stressMax: 6, hp: 0, hpMax: 6 });
    expect(payMaintain({ hope: 2, stress: 6, stressMax: 6, hp: 2, hpMax: 6 }, m)).toEqual({ hope: 2, stress: 6, stressMax: 6, hp: 3, hpMax: 6 });
    expect(payMaintain({ hope: 2, stress: 6, stressMax: 6, hp: 6, hpMax: 6 }, m)).toBeNull();
    expect(payMaintain({ hope: 0, stress: 0, stressMax: 6, hp: 0, hpMax: 6 }, { costs: [{ kind: "hope", amount: one }] })).toBeNull();
  });
});

describe("Unstoppable (dcm-v17)", () => {
  it("the effect goes once the die is gone; stays while held", () => {
    const fx = effect("feat:abc:1", "Unstoppable", "scene");
    const is = (e: Effect) => e.id === fx.id;
    const held = { effects: [fx], classState: { unstoppable: { value: 2, max: 4 } } };
    expect(withoutLapsedUnstoppable(held, is)).toBe(held);
    expect(withoutLapsedUnstoppable({ effects: [fx], classState: {} }, is).effects).toEqual([]);
  });

  it("afterUnstoppable reads the Guardian's feature effect id; refusedConditions reads the flags", () => {
    const fx = effect(`${effectKeyOf("class:guardian:unstoppable")}:1`, "Unstoppable", "scene");
    const sheet = { effects: [fx], classState: {} } as unknown as CharacterSheet;
    expect(afterUnstoppable(sheet).effects).toEqual([]);
    expect([...refusedConditions({ effects: [effect(`${effectKeyOf("steady")}:1`, "Steady", "scene")] }, lookup)].sort()).toEqual(["restrained", "vulnerable"]);
    expect([...refusedConditions({ effects: [effect("x", "Steady")] }, lookup)]).toEqual([]);
  });
});

// ---------------------------------------------------------------- the entry lookup and instances (cardRows.ts)

describe("the entry lookup", () => {
  it("finds a nested lasting step by its label; a sheet effect and an instance modifier name their entry", () => {
    expect(stepEnds("slumber", "Asleep", lookup)).toEqual({ kind: "condition", label: "Asleep", ends: { duration: "manual", endsOn: ["takeDamage", "gmSpendsFear"] }, flags: [] });
    expect(stepEnds("slumber", "Awake", lookup)).toBeUndefined();
    expect(effectSource(effect(`${effectKeyOf("transform")}:3`, "Transformed; ends when you take damage"))).toEqual({ sourceId: "transform", label: "Transformed" });
    expect(effectSource({ id: "marked-for-death", text: "Bear: +1d4 damage" })).toEqual({ sourceId: "class:assassin:marked-for-death", label: "Marked for Death" });
    expect(effectSource(effect("beastform", "Wolf"))).toBeNull();
    expect(instanceEffectSource({ id: "feat:class:assassin:x:2~tok1", label: "L" })).toEqual({ sourceId: "class:assassin:x", label: "L", caster: "tok1" });
    expect(instanceEffectSource({ id: "card:slumber:1", label: "Asleep" })).toEqual({ sourceId: "slumber", label: "Asleep" });
  });
});

const marker = (id: string, label: string): InstanceEffect => ({ id, source: "Test", label, until: "temporary" });

describe("endInstanceEffects", () => {
  const instance = { effects: [marker("card:slumber:1", "Asleep"), marker("card:jumpscare:1", "vulnerable"), marker("card:timejammer:1~tokA", "Time-Stopped")], conditions: ["vulnerable" as const], tags: ["Asleep", "Time-Stopped", "Other"] };

  it("damage ends Slumber's Asleep tag (and its marker); marking HP ends Jump Scare's Vulnerable (dcm-utu)", () => {
    // User answer 2026-10-31 (lanes-2 E6.3): "take damage" needs a marked Hit Point; a hit reduced to 0 HP ends neither.
    expect(endInstanceEffects(instance, hit("minor", 0), { lookup }).patch).toBeNull();
    const marked = endInstanceEffects(instance, hit("minor", 1), { lookup });
    expect(marked.patch).toEqual({ effects: [instance.effects[2]], conditions: [], tags: ["Time-Stopped", "Other"] });
    expect(endInstanceEffects(instance, hit("none", 0), { lookup }).patch).toBeNull();
  });

  it("caster side: only the modifiers that caster's token made (dcm-cwh)", () => {
    const targeted = roll({ kind: "action", spellcast: true, success: true, duality: "hope", targetsCreature: true });
    expect(endInstanceEffects(instance, targeted, { role: "caster", casterTokenId: "tokB", lookup }).patch).toBeNull();
    expect(endInstanceEffects(instance, targeted, { role: "caster", casterTokenId: "tokA", lookup }).patch?.tags).toEqual(["Asleep", "Other"]);
  });

  it("a GM Fear spend ends Slumber's Asleep by its id only", () => {
    expect(endInstanceByGmFear(instance, "card:slumber:1", lookup)?.tags).toEqual(["Time-Stopped", "Other"]);
    expect(endInstanceByGmFear(instance, "card:jumpscare:1", lookup)).toBeNull();
  });
});

describe("sheet ends with the lookup", () => {
  const base = { name: "Ash", effects: [] as Effect[], domainCards: { owned: [], loadout: [] } } as unknown as CharacterSheet;

  it("Marked for Death ends when the tagged adversary is defeated, or by a GM Fear spend (dcm-8bv)", () => {
    const sheet = { ...base, effects: [effect("marked-for-death", "Bear: +1d4 damage", "rest")] };
    expect(endOnDefeat(sheet, { tags: ["Other"] }, lookup).ended).toEqual([]);
    const out = endOnDefeat(sheet, { tags: ["Marked for Death"] }, lookup);
    expect(out.sheet.effects).toEqual([]);
    expect(out.lines).toEqual(["Ash: Bear: +1d4 damage ends (Test)"]);
    expect(endByGmFear(sheet, "marked-for-death", lookup)?.effects).toEqual([]);
    expect(endByGmFear({ ...base, effects: [effect(`${effectKeyOf("transform")}:1`, "Transformed")] }, `${effectKeyOf("transform")}:1`, lookup)).toBeNull();
  });

  it("Eye of the Storm on an ally ends on the caster's Severe damage; two holders leave it to the GM (dcm-wjv)", () => {
    const fx = effect(`${effectKeyOf("storm")}:1`, "Eye of the Storm: +1 Evasion");
    const caster = { ...base, name: "Sky", domainCards: { owned: ["storm"], loadout: ["storm"] } } as CharacterSheet;
    const ally = { ...base, name: "Ash", effects: [fx] };
    const party = [
      { key: "sky", sheet: caster },
      { key: "ash", sheet: ally },
    ];
    expect(endForCasterOnSheets(caster, party, hit("major", 2), lookup)).toEqual([]);
    const out = endForCasterOnSheets(caster, party, hit("severe", 3), lookup);
    expect(out.map((o) => [o.key, o.sheet.effects])).toEqual([["ash", []]]);
    // The bearer's own Severe damage doesn't end it (endsOn reads the bearer).
    expect(endOnSheet(ally, hit("severe", 3), { lookup }).ended).toEqual([]);
    const twin = { key: "twin", sheet: { ...caster, name: "Twin" } };
    expect(endForCasterOnSheets(caster, [...party, twin], hit("severe", 3), lookup)).toEqual([]);
  });
});

describe("instanceWrites (a card or feature use on enemies)", () => {
  const bear = (effects: InstanceEffect[], tags: string[]) => ({
    kind: "enemy" as const,
    tokenId: "tokE",
    minion: false,
    instance: { _id: "inst1", label: "Bear", hp: 0, stress: 0, defeated: false, stats: { hpMax: 7, stressMax: 2 }, conditions: [], tags, effects },
  });
  const creaturesOf = (c: ReturnType<typeof bear>, onMap = false) => ({ get: (id: string) => (id === "tokE" ? c : undefined), onMap, scene: { attacker: { _id: "tokA" } } }) as never;
  const plan = (cardId: string, steps: unknown[], hp = 0, tags: string[] = []) => ({ cardId, exclusive: false, steps, creatures: [{ id: "tokE", after: { hp, stress: 0, conditions: [], tags } }] }) as never;

  it("a condition that ends on an event leaves a marker; one ended by its caster names the caster's token", () => {
    const asleep = { kind: "condition", targetId: "tokE", condition: { kind: "tag", tag: "Asleep" }, duration: "manual" };
    const [w] = instanceWrites(plan("slumber", [asleep], 0, ["Asleep"]), creaturesOf(bear([], [])), "Slumber", lookup);
    expect(w!.patch.effects).toEqual([{ id: "card:slumber:1", source: "Slumber", label: "Asleep", until: "temporary" }]);
    const stopped = { kind: "condition", targetId: "tokE", condition: { kind: "tag", tag: "Time-Stopped" }, duration: "manual" };
    const [t] = instanceWrites(plan("timejammer", [stopped], 0, ["Time-Stopped"]), creaturesOf(bear([], []), true), "Book of Yarrow", lookup);
    expect(t!.patch.effects?.[0]?.id).toBe("card:timejammer:1~tokA");
    // A condition without event ends leaves none (as before lane E6).
    const plain = { kind: "condition", targetId: "tokE", condition: { kind: "tag", tag: "Dazed" }, duration: "scene" };
    expect(instanceWrites(plan("other", [plain], 0, ["Dazed"]), creaturesOf(bear([], [])), "Other", lookup)[0]!.patch.effects).toBeUndefined();
  });

  it("the use's damage ends Slumber's Asleep it already had (dcm-utu)", () => {
    const damage = { kind: "damage", result: { targetId: "tokE", severity: "major", hpMarked: 2 } };
    const [w] = instanceWrites(plan("bolt", [damage], 2, ["Asleep"]), creaturesOf(bear([marker("card:slumber:1", "Asleep")], ["Asleep"])), "Bolt", lookup);
    expect(w!.patch).toMatchObject({ hp: 2, tags: [], effects: [] });
    expect(w!.before.effects).toEqual([marker("card:slumber:1", "Asleep")]);
  });
});

// ---------------------------------------------------------------- stances (dcm-awh)

describe("stances", () => {
  it("withStance sets a known stance; withoutStance also ends the stance's own effects", () => {
    const sheet = { name: "Ash", effects: [effect(`${effectKeyOf("stanced")}:1`, "Braced")], classState: { martial: { known: ["quick", "grappling"], active: "quick", focus: 1 } } } as unknown as CharacterSheet;
    expect(withStance(sheet, "anchored")).toBeNull();
    expect(withStance(sheet, "quick")).toBeNull();
    expect(withStance(sheet, "grappling")!.classState.martial).toEqual({ known: ["quick", "grappling"], active: "grappling", focus: 1 });
    expect(withoutStance(sheet).sheet.effects).toHaveLength(1);
    const off = withoutStance(sheet, endsOf);
    expect(off.sheet.effects).toEqual([]);
    expect(off.ended.map((e) => e.text)).toEqual(["Braced"]);
  });
});

// ---------------------------------------------------------------- on the server

describe("on the server", () => {
  async function world() {
    const w = await buildWorld();
    const now = Date.now();
    const ids = await w.t.run(async (ctx) => {
      const encounterId = await ctx.db.insert("encounters", { campaignId: w.campaignId, name: "Ambush", status: "running", pcs: 2, adjustments: [], gmTurn: 1, createdAt: now, updatedAt: now, startedAt: now });
      const bear = await ctx.db.insert("encounterAdversaries", {
        campaignId: w.campaignId,
        encounterId,
        source: { kind: "srd", adversaryId: "bear" },
        label: "Bear",
        order: 0,
        summoned: false,
        stats: { difficulty: 14, major: 9, severe: 17, hpMax: 7, stressMax: 2 },
        hp: 0,
        stress: 0,
        defeated: false,
        conditions: [],
        tags: ["Asleep", "Time-Stopped"],
        effects: [marker("card:slumber:1", "Asleep"), marker("card:timejammer:1~tokA", "Time-Stopped")],
        spotlights: 0,
        spotlightTurn: 0,
        updatedAt: now,
      });
      return { encounterId, bear };
    });
    return { ...w, ...ids };
  }

  it("endOnInstance patches the instance and returns it before for the caller's undo", async () => {
    const w = await world();
    const out = await w.t.run(async (ctx) => endOnInstance(ctx, (await ctx.db.get("encounterAdversaries", w.bear))!, hit("minor", 1), lookup));
    expect(out.lines).toEqual(["Bear: Asleep ends (Test)"]);
    expect(out.before).toMatchObject({ tags: ["Asleep", "Time-Stopped"], effects: [marker("card:slumber:1", "Asleep"), marker("card:timejammer:1~tokA", "Time-Stopped")] });
    const after = await w.t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", w.bear))!);
    expect(after.tags).toEqual(["Time-Stopped"]);
  });

  it("endForCasterOnInstances finds the caster's conditions in the running encounter", async () => {
    const w = await world();
    const targeted = roll({ kind: "action", spellcast: true, success: true, duality: "hope", targetsCreature: true });
    const none = await w.t.run((ctx) => endForCasterOnInstances(ctx, w.campaignId, "tokB", targeted, lookup));
    expect(none).toEqual({ before: [], lines: [] });
    const out = await w.t.run((ctx) => endForCasterOnInstances(ctx, w.campaignId, "tokA", targeted, lookup));
    expect(out.lines).toEqual(["Bear: Time-Stopped ends (Test)"]);
    const after = await w.t.run(async (ctx) => (await ctx.db.get("encounterAdversaries", w.bear))!);
    expect(after.tags).toEqual(["Asleep"]);
  });

  it("setStance drops the previous stance first; shiftStance still works through it", async () => {
    const w = await buildWorld();
    await w.t.run((ctx) => ctx.db.patch("campaigns", w.campaignId, { options: { hopeAndFear: true } }));
    const sheet = await w.t.run(async (ctx) => {
      const s = readSheet((await ctx.db.get("characters", w.characterA))!.sheet);
      const next: CharacterSheet = { ...s, classId: "brawler", subclassId: "martial-artist", subclassRank: "foundation", classState: { ...s.classState, martial: { known: ["grappling", "quick"], active: "grappling", focus: 2 } } };
      await saveSheet(ctx, w.characterA, next);
      return next;
    });
    const set = await w.t.run((ctx) => setStance(ctx, w.campaignId, sheet, "quick"));
    expect(set!.sheet.classState.martial).toEqual({ known: ["grappling", "quick"], active: "quick", focus: 2 });
    expect(await w.t.run((ctx) => setStance(ctx, w.campaignId, sheet, "anchored"))).toBeNull();

    await w.as("player").mutation(api.combatFeatures.shiftStance, { campaignId: w.campaignId, characterId: w.characterA, stance: "quick", idempotencyKey: key() });
    const after = await w.t.run(async (ctx) => readSheet((await ctx.db.get("characters", w.characterA))!.sheet));
    expect(after.classState.martial).toMatchObject({ active: "quick", focus: 1 });
  });
});
