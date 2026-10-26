import { describe, expect, it } from "vitest";

import type { ActorState, PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import type { CardUse } from "@/lib/domain/card-effects/types";
import { queueRng } from "@/lib/domain/dice";
import { beastformAttackId, featureId, parseFeatureId } from "@/lib/domain/feature-effects/ids";
import { owned } from "@/lib/domain/feature-effects/owned";
import { runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { BEASTFORMS } from "@/lib/srd/beastforms";
import { FEATURE_CLASSIFICATION } from "@/lib/srd/feature-effects/classification";
import { featureEffect } from "@/lib/srd/feature-effects";
import {
  BEASTFORM_EFFECTS,
  BEASTFORM_IDS,
  BEASTFORM_STATS,
  EVOLVED_FORMS,
  FRAGILE_FORMS,
  HYBRID_EXTRA_STRESS,
  beastformEndsOn,
  evolvedBases,
} from "@/lib/srd/feature-effects/beastforms";
import type { Combatant } from "@/lib/domain/combat-actions";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-beastforms (Q10 a): every Beastform's attack and statistics and each Beastform feature
// classified combat or passive runs through runFeature with fixed dice. Expected numbers come from the book (CB p.30-35,
// printed pages). RNG order: Hope die, Fear die, then damage dice and checks in step order.

const druid = sheetOf("druid", "warden-of-the-elements", { hope: 3, stress: 1 });

/** The druid in a form: Agility 2, Strength 1, Finesse 1, Instinct 0; Proficiency 2. */
const inForm = (formId: string | null, over: Partial<ActorState> = {}): ActorState =>
  actorOf(druid, { proficiency: 2, facts: { beastformId: formId }, ...over });

const fx = (id: string): FeatureEffect => {
  const found = BEASTFORM_EFFECTS.find((e) => e.featureId === id);
  if (!found) throw new Error(`No entry ${id}`);
  return found;
};
const bf = (form: string, name: string) => fx(featureId("beastform", form, name));
const attack = (form: string) => fx(beastformAttackId(form));
const useOf = (e: FeatureEffect, id = "main"): CardUse => e.uses.find((u) => u.id === id)!;

function ok(effect: FeatureEffect, useId: string | undefined, ctx: Omit<FeatureRunContext, "gmFear"> & { gmFear?: number }): RunPlan {
  const result = runFeature(effect, useId, { gmFear: 2, ...ctx });
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  (ctx.rng as ReturnType<typeof queueRng>).done?.();
  return result.plan;
}
const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

const foe = (id: string, over: Partial<Combatant> = {}): Combatant => ({ ...adversary(id), ...over });

describe("the Beastform table: coverage", () => {
  const ids = BEASTFORM_EFFECTS.map((e) => e.featureId);
  const classified = Object.entries(FEATURE_CLASSIFICATION)
    .filter(([id, c]) => id.startsWith("beastform:") && (c.usage === "combat" || c.usage === "passive"))
    .map(([id]) => id);

  it("one attack entry per form (24) and one entry per combat or passive feature (37): no missing or extra id", () => {
    expect(BEASTFORM_IDS).toEqual(BEASTFORMS.map((b) => b.id));
    const expected = [...BEASTFORMS.map((b) => beastformAttackId(b.id)), ...classified];
    expect(classified).toHaveLength(37);
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("narrative features (Aquatic, Carrier, Massive Stride) have no entry", () => {
    const narrative = Object.entries(FEATURE_CLASSIFICATION).filter(([id, c]) => id.startsWith("beastform:") && c.usage === "narrative");
    expect(narrative).toHaveLength(8);
    for (const [id] of narrative) expect(ids).not.toContain(id);
  });

  it("every entry is a beastform feature of its owner, is in the registry and needs the Beastform", () => {
    for (const e of BEASTFORM_EFFECTS) {
      expect(parseFeatureId(e.featureId)).toMatchObject({ source: "beastform", owner: e.owner });
      expect(e.source).toBe("beastform");
      expect(featureEffect(e.featureId)).toBe(e);
      for (const u of e.uses) expect(u.requires?.[0]).toMatchObject({ kind: "situation", check: { kind: "inBeastform" } });
      expect(new Set(e.uses.map((u) => u.id)).size).toBe(e.uses.length);
    }
  });

  it("every use runs through runFeature without throwing (dice all 3s, every situation confirmed)", () => {
    const rng = (sides: number) => Math.min(3, sides);
    for (const e of BEASTFORM_EFFECTS) {
      for (const u of e.uses) {
        const situations = (u.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : []));
        const actor = inForm(e.owner, { hope: 6, stress: 0, armor: 0, facts: { beastformId: e.owner, flying: true, featureEffects: [{ featureId: e.featureId, option: "retracted" }] } });
        const spec = u.targets && u.targets.side !== "trigger" ? u.targets : undefined;
        const many = spec?.count.kind === "all" || spec?.count.kind === "any";
        const targets = spec?.side === "ally" ? [foe("ally", { side: "pc" })] : many ? [foe("bandit"), foe("thug")] : [foe("bandit")];
        const result = runFeature(e, u.id, { actor, gmFear: 2, rng, targets, situations, trigger: { amount: 10, source: foe("bandit"), subject: foe("bandit") } });
        expect(result.ok, `${e.featureId}:${u.id} ${result.ok ? "" : result.detail}`).toBe(true);
      }
    }
  });
});

describe("statistics and attacks (CB p.30, p.32-35)", () => {
  it("the table's statistics match the Beastform data", () => {
    for (const b of BEASTFORMS) {
      const st = BEASTFORM_STATS[b.id];
      if (EVOLVED_FORMS[b.id]) {
        expect(st).toBeUndefined();
        expect(b.attack).toBeNull();
        continue;
      }
      expect(st, b.id).toBeDefined();
      expect(b.traitBonus).toEqual({ trait: st!.trait, bonus: st!.traitBonus });
      expect(b.evasionBonus).toBe(st!.evasion);
      expect(b.attack).toEqual({ range: st!.range === "melee" ? "Melee" : "Very Close", trait: st!.trait, damage: `d${st!.sides}${st!.plus ? `+${st!.plus}` : ""} phy` });
      expect([...b.advantages].sort()).toEqual([...st!.advantages].sort());
      expect(st!.page).toBe(31 + b.tier);
    }
  });

  it("Agile Scout attack: Melee, Agility, d4 x Proficiency (CB p.32 'as an Agile Scout … you deal d4 physical damage using your Proficiency')", () => {
    const plan = ok(attack("agile-scout"), undefined, { actor: inForm("agile-scout"), rng: queueRng([9, 3, 3, 4]), targets: [foe("bandit")] });
    expect(plan.useId).toBe("main");
    expect(plan.roll?.record.total).toBe(9 + 3 + 2);
    expect(ofKind(plan, "damage")[0]!.result.incoming).toBe(7);
    expect(useOf(attack("agile-scout")).targets).toMatchObject({ range: "melee" });
    expect(useOf(attack("striking-serpent")).targets).toMatchObject({ range: "veryClose" });
  });

  it("Pack Predator attack: Strength, d8+2 x Proficiency; a miss deals nothing", () => {
    const hit = ok(attack("pack-predator"), undefined, { actor: inForm("pack-predator"), rng: queueRng([10, 2, 5, 6]), targets: [foe("bandit")] });
    expect(hit.roll?.record.total).toBe(10 + 2 + 1);
    expect(ofKind(hit, "damage")[0]!.result.incoming).toBe(5 + 6 + 2);
    const miss = ok(attack("pack-predator"), undefined, { actor: inForm("pack-predator"), rng: queueRng([2, 3]), targets: [foe("bandit")] });
    expect(ofKind(miss, "damage")).toHaveLength(0);
  });

  it("the statistics use: trait and Evasion bonus, no weapons or domain spells, advantage on attack rolls for an 'attack' verb", () => {
    expect(useOf(attack("pack-predator"), "form").mods).toEqual([
      { kind: "trait", trait: "strength", delta: { kind: "fixed", value: 2 } },
      { kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 1 } },
      { kind: "flag", flag: "noWeaponsOrSpells" },
      { kind: "advantage", on: "attack" },
    ]);
    expect(useOf(attack("agile-scout"), "form").mods).not.toContainEqual({ kind: "advantage", on: "attack" });
    const adv = useOf(attack("agile-scout"), "advantage");
    expect(adv.requires?.[1]).toEqual({ kind: "situation", text: "The roll is related to one of these: deceive, locate, sneak" });
    const plan = ok(attack("agile-scout"), "advantage", { actor: inForm("agile-scout"), rng: queueRng([]), situations: ["The roll is related to one of these: deceive, locate, sneak"] });
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "advantage" } });
  });

  it("not in Beastform: every use is refused", () => {
    expect(runFeature(attack("agile-scout"), undefined, { actor: inForm(null), gmFear: 0, rng: queueRng([]), targets: [foe("bandit")] })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Evolved: one attack per base form; Legendary +6 damage, Mythic +9 and the die one size up (CB p.34-35)", () => {
    expect(evolvedBases("legendary-beast")).toEqual(["agile-scout", "household-friend", "nimble-grazer", "pack-predator", "aquatic-scout", "stalking-arachnid"]);
    expect(evolvedBases("mythic-beast")).toHaveLength(12);
    expect(attack("legendary-beast").uses.map((u) => u.id)).toEqual(evolvedBases("legendary-beast"));
    // Legendary Agile Scout: d4+6 x Proficiency 2: 1 + 2 + 6 = 9.
    const legendary = ok(attack("legendary-beast"), "agile-scout", { actor: inForm("legendary-beast"), rng: queueRng([9, 3, 1, 2]), targets: [foe("bandit")] });
    expect(ofKind(legendary, "damage")[0]!.result.incoming).toBe(9);
    // Mythic Powerful Beast: d10+4 becomes d12+13 using Strength.
    const mythic = ok(attack("mythic-beast"), "powerful-beast", { actor: inForm("mythic-beast"), rng: queueRng([9, 3, 12, 11]), targets: [foe("bandit")] });
    expect(mythic.roll?.record.total).toBe(9 + 3 + 1);
    expect(ofKind(mythic, "damage")[0]!.result.incoming).toBe(12 + 11 + 13);
    expect(useOf(bf("mythic-beast", "Evolved"), "winged-beast").mods).toEqual([
      { kind: "trait", trait: "finesse", delta: { kind: "fixed", value: 2 } },
      { kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 3 } },
    ]);
    expect(useOf(bf("legendary-beast", "Evolved"), "nimble-grazer").mods?.[1]).toEqual({ kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 2 } });
  });

  it("Hybrid forms: their own attack; the extra Stress to transform (CB p.34-35)", () => {
    expect(HYBRID_EXTRA_STRESS).toEqual({ "legendary-hybrid": 1, "mythic-hybrid": 2 });
    const plan = ok(attack("mythic-hybrid"), undefined, { actor: inForm("mythic-hybrid"), rng: queueRng([9, 3, 12, 12]), targets: [foe("bandit")] });
    expect(ofKind(plan, "damage")[0]!.result.incoming).toBe(34);
    expect(useOf(attack("legendary-hybrid"), "advantage").requires?.[1]).toMatchObject({ text: "The roll is related to one of the advantages you chose for this form" });
  });

  it("drop out on the last Hit Point (CB p.30), and on Major or greater damage for Fragile forms (CB p.32)", () => {
    expect(FRAGILE_FORMS).toEqual(BEASTFORMS.filter((b) => b.features.some((f) => f.name === "Fragile")).map((b) => b.id));
    expect(beastformEndsOn("agile-scout")).toEqual(["lastHp", "majorDamage"]);
    expect(beastformEndsOn("great-predator")).toEqual(["lastHp"]);
  });
});

describe("Tier 1 features (CB p.32)", () => {
  it("Fragile: automatic on Major and on Severe damage, drops out of Beastform", () => {
    const e = bf("nimble-grazer", "Fragile");
    expect(e.uses.map((u) => u.activation)).toEqual([
      { kind: "auto", trigger: { kind: "whenYouTakeDamage", severity: "major" } },
      { kind: "auto", trigger: { kind: "whenYouTakeDamage", severity: "severe" } },
    ]);
    const plan = ok(e, "severe", { actor: inForm("nimble-grazer"), rng: queueRng([]) });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", text: expect.stringContaining("drop out of Beastform") });
  });

  it("Agile: a Hope to move up to Far without rolling", () => {
    const plan = ok(bf("agile-scout", "Agile"), undefined, { actor: inForm("agile-scout"), rng: queueRng([]) });
    expect(plan.actor.after.hope).toBe(2);
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["pc"] });
  });

  it("Companion: Help an Ally with a d8 advantage die", () => {
    expect(useOf(bf("household-friend", "Companion")).mods).toEqual([{ kind: "set", stat: "helpDie", to: { kind: "fixed", value: 8 } }]);
  });

  it("Elusive Prey: a Stress and a d4 added to Evasion against the attack", () => {
    const e = bf("nimble-grazer", "Elusive Prey");
    expect(useOf(e).activation).toEqual({ kind: "reaction", trigger: { kind: "whenAttacked", stage: "succeeded" } });
    const plan = ok(e, undefined, { actor: inForm("nimble-grazer"), rng: queueRng([3]) });
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyRoll", change: { kind: "evasion" } }, amount: 3 });
  });

  it("Hobbling Strike: a Stress on a Melee success, the target temporarily Vulnerable", () => {
    const e = bf("pack-predator", "Hobbling Strike");
    expect(useOf(e).activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weaponRange: "melee" } });
    const plan = ok(e, undefined, { actor: inForm("pack-predator"), rng: queueRng([]), targets: [foe("bandit")] });
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "bandit", condition: { condition: "vulnerable" }, duration: "temporary" });
  });

  it("Pack Hunting: +d8 damage, the player confirms the ally acted just before", () => {
    const e = bf("pack-predator", "Pack Hunting");
    const text = "An ally who acted immediately before you attacked the same target";
    expect(runFeature(e, undefined, { actor: inForm("pack-predator"), gmFear: 0, rng: queueRng([]), targets: [foe("bandit")] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = ok(e, undefined, { actor: inForm("pack-predator"), rng: queueRng([6]), targets: [foe("bandit")], situations: [text] });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyDamage", change: { kind: "add" } } });
  });

  it("Venomous Bite: automatic on a Melee success, the target temporarily Poisoned", () => {
    const plan = ok(bf("stalking-arachnid", "Venomous Bite"), undefined, { actor: inForm("stalking-arachnid"), rng: queueRng([]), targets: [foe("bandit")] });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ condition: { kind: "tag", tag: "Poisoned" }, duration: "temporary" });
    expect(ofKind(plan, "prompt")[0]!.text).toContain("1d10 direct physical damage each time they act");
  });

  it("Webslinger: a Finesse Roll against a target within Close; on a success temporarily Restrained", () => {
    const e = bf("stalking-arachnid", "Webslinger");
    expect(useOf(e).targets).toMatchObject({ range: "close" });
    const hit = ok(e, undefined, { actor: inForm("stalking-arachnid"), rng: queueRng([11, 2]), targets: [foe("bandit")] });
    expect(hit.roll?.record.total).toBe(11 + 2 + 1);
    expect(ofKind(hit, "condition")[0]).toMatchObject({ condition: { condition: "restrained" } });
    const miss = ok(e, undefined, { actor: inForm("stalking-arachnid"), rng: queueRng([2, 5]), targets: [foe("bandit")] });
    expect(ofKind(miss, "condition")).toHaveLength(0);
  });
});

describe("Tier 2 features (CB p.33)", () => {
  it("Armored Shell: physical resistance; an Armor Slot to retract; in the shell the reduction is prompted", () => {
    const e = bf("armored-sentry", "Armored Shell");
    expect(useOf(e).mods).toEqual([{ kind: "resistance", type: "physical", level: "resistant" }]);
    const retract = ok(e, "retract", { actor: inForm("armored-sentry"), rng: queueRng([]) });
    expect(retract.actor.after.armor).toBe(retract.actor.before.armor + 1);
    expect(ofKind(retract, "effect")[0]).toMatchObject({ option: "retracted", mods: [{ kind: "flag", flag: "cannotAct" }], duration: "manual" });
    const outside = inForm("armored-sentry", { facts: { beastformId: "armored-sentry", featureEffects: [] } });
    expect(runFeature(e, "shell", { actor: outside, gmFear: 0, rng: queueRng([]) })).toMatchObject({ ok: false, reason: "requirement" });
    const inside = inForm("armored-sentry", { facts: { beastformId: "armored-sentry", featureEffects: [{ featureId: e.featureId, option: "retracted" }] } });
    expect(ofKind(ok(e, "shell", { actor: inside, rng: queueRng([]) }), "prompt")[0]!.text).toContain("Armor Score");
  });

  it("Cannonball: a Stress, a Hope for the second target; the ally's throw is prompted", () => {
    const plan = ok(bf("armored-sentry", "Cannonball"), undefined, { actor: inForm("armored-sentry"), rng: queueRng([]), targets: [foe("ally", { side: "pc" })], optionals: ["second"] });
    expect(plan.actor.after).toMatchObject({ stress: 2, hope: 2 });
    expect(ofKind(plan, "prompt")).toHaveLength(2);
  });

  it("Trample: a Stress, Agility against all targets along the line, d8+1 x Proficiency and temporarily Vulnerable", () => {
    const plan = ok(bf("mighty-strider", "Trample"), undefined, { actor: inForm("mighty-strider"), rng: queueRng([10, 4, 8, 8]), targets: [foe("bandit"), foe("thug", { difficulty: 20 })] });
    expect(plan.actor.after.stress).toBe(2);
    expect(plan.roll?.record.total).toBe(10 + 4 + 2);
    expect(plan.hits.map((h) => [h.id, h.hit])).toEqual([
      ["bandit", true],
      ["thug", false],
    ]);
    expect(ofKind(plan, "damage").map((s) => [s.result.targetId, s.result.incoming])).toEqual([["bandit", 17]]);
    expect(ofKind(plan, "condition").map((c) => c.targetId)).toEqual(["bandit"]);
  });

  it("Fleet: a Hope to move up to Far", () => {
    expect(ok(bf("pouncing-predator", "Fleet"), undefined, { actor: inForm("pouncing-predator"), rng: queueRng([]) }).actor.after.hope).toBe(2);
  });

  it("Takedown: a Stress, Instinct attack; on a success +2 Proficiency (d8+6) and the target marks a Stress", () => {
    const plan = ok(bf("pouncing-predator", "Takedown"), undefined, { actor: inForm("pouncing-predator"), rng: queueRng([11, 3, 1, 2, 3, 4]), targets: [foe("bandit")] });
    expect(plan.roll?.record.total).toBe(11 + 3 + 0);
    expect(ofKind(plan, "damage")[0]!.result.incoming).toBe(1 + 2 + 3 + 4 + 6);
    expect(ofKind(plan, "mark")).toContainEqual(expect.objectContaining({ targetId: "bandit", track: "stress", amount: 1 }));
  });

  it("Rampage: a d10 on each damage 1; before the attack a Stress for +1 Proficiency", () => {
    const e = bf("powerful-beast", "Rampage");
    expect(ofKind(ok(e, "main", { actor: inForm("powerful-beast"), rng: queueRng([]), targets: [foe("bandit")] }), "fold")[0]!.step).toMatchObject({ change: { kind: "ones", add: { sides: 10 } } });
    expect(useOf(e, "proficiency").activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } });
    const prof = ok(e, "proficiency", { actor: inForm("powerful-beast"), rng: queueRng([]), targets: [foe("bandit")] });
    expect(prof.actor.after.stress).toBe(2);
    expect(ofKind(prof, "fold")[0]!.step).toMatchObject({ change: { kind: "proficiency", delta: 1 } });
  });

  it("Thick Hide +2, Hollow Bones −2 damage thresholds", () => {
    expect(useOf(bf("powerful-beast", "Thick Hide")).mods).toEqual([
      { kind: "stat", stat: "majorThreshold", delta: { kind: "fixed", value: 2 } },
      { kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 2 } },
    ]);
    expect(useOf(bf("winged-beast", "Hollow Bones")).mods?.map((m) => (m.kind === "stat" ? m.delta : null))).toEqual([
      { kind: "fixed", value: -2 },
      { kind: "fixed", value: -2 },
    ]);
  });

  it("Venomous Strike: any number of targets within Very Close; the form's d8+4 damage and Poisoned on a success", () => {
    const plan = ok(bf("striking-serpent", "Venomous Strike"), undefined, { actor: inForm("striking-serpent"), rng: queueRng([10, 3, 2, 5]), targets: [foe("bandit"), foe("thug")] });
    expect(ofKind(plan, "damage").map((s) => s.result.incoming)).toEqual([11, 11]);
    expect(ofKind(plan, "condition").map((c) => c.targetId)).toEqual(["bandit", "thug"]);
  });

  it("Warning Hiss: a Stress; targets within Melee move back to Very Close", () => {
    const plan = ok(bf("striking-serpent", "Warning Hiss"), undefined, { actor: inForm("striking-serpent"), rng: queueRng([]), targets: [foe("bandit"), foe("thug")] });
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["bandit", "thug"] });
  });

  it("Bird's-Eye View: the question once per rest, only while airborne", () => {
    const e = bf("winged-beast", "Bird’s-Eye View");
    expect(runFeature(e, "question", { actor: inForm("winged-beast", { facts: { beastformId: "winged-beast", flying: false } }), gmFear: 0, rng: queueRng([]) })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = ok(e, "question", { actor: inForm("winged-beast", { facts: { beastformId: "winged-beast", flying: true } }), rng: queueRng([]) });
    expect(plan.limit).toEqual({ key: "feat:beastform:winged-beast:birds-eye-view:question", until: "rest", consumed: true });
  });
});

describe("Tier 3 and 4 features (CB p.34-35)", () => {
  it("Vicious Maul: a Hope, Vulnerable and +1 Proficiency; Great Predator's is temporary", () => {
    const great = ok(bf("great-predator", "Vicious Maul"), undefined, { actor: inForm("great-predator"), rng: queueRng([]), targets: [foe("bandit")] });
    expect(great.actor.after.hope).toBe(2);
    expect(ofKind(great, "condition")[0]).toMatchObject({ duration: "temporary" });
    expect(ofKind(great, "fold")[0]!.step).toMatchObject({ change: { kind: "proficiency", delta: 1 } });
    const aquatic = ok(bf("aquatic-predator", "Vicious Maul"), undefined, { actor: inForm("aquatic-predator"), rng: queueRng([]), targets: [foe("bandit")] });
    expect(ofKind(aquatic, "condition")[0]).toMatchObject({ duration: "manual" });
  });

  it("Physical Defense +3, Undaunted +2 thresholds", () => {
    expect(useOf(bf("mighty-lizard", "Physical Defense")).mods?.[0]).toEqual({ kind: "stat", stat: "majorThreshold", delta: { kind: "fixed", value: 3 } });
    expect(useOf(bf("massive-behemoth", "Undaunted")).mods?.[1]).toEqual({ kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 2 } });
  });

  it("Snapping Strike: a Hope, temporarily Restrained and Vulnerable", () => {
    const plan = ok(bf("mighty-lizard", "Snapping Strike"), undefined, { actor: inForm("mighty-lizard"), rng: queueRng([]), targets: [foe("bandit")] });
    expect(plan.actor.after.hope).toBe(2);
    expect(ofKind(plan, "condition").map((c) => (c.condition.kind === "standard" ? c.condition.condition : ""))).toEqual(["restrained", "vulnerable"]);
  });

  it("Ocean Master: temporarily Restrained on a Melee success, no cost", () => {
    const plan = ok(bf("epic-aquatic-beast", "Ocean Master"), undefined, { actor: inForm("epic-aquatic-beast"), rng: queueRng([]), targets: [foe("bandit")] });
    expect(plan.actor.after.hope).toBe(plan.actor.before.hope);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ condition: { condition: "restrained" }, duration: "temporary" });
  });

  it("Unyielding: a d6 when you mark an Armor Slot; on 5+ the slot is not marked", () => {
    const e = bf("epic-aquatic-beast", "Unyielding");
    const five = ok(e, undefined, { actor: inForm("epic-aquatic-beast", { armor: 1 }), rng: queueRng([5]) });
    expect(five.actor.after.armor).toBe(0);
    const four = ok(e, undefined, { actor: inForm("epic-aquatic-beast", { armor: 1 }), rng: queueRng([4]) });
    expect(four.actor.after.armor).toBe(1);
  });

  it("Demolish: a Hope, Strength against all along a Far line, d8+10 x Proficiency, temporarily Vulnerable", () => {
    // 3 Hope - 1 for Demolish + 1 for rolling with Hope.
    const plan = ok(bf("massive-behemoth", "Demolish"), undefined, { actor: inForm("massive-behemoth"), rng: queueRng([10, 4, 1, 1]), targets: [foe("bandit")] });
    expect(plan.actor.after.hope).toBe(3);
    expect(ofKind(plan, "damage")[0]!.result.incoming).toBe(12);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ condition: { condition: "vulnerable" } });
  });

  it("Deadly Raptor: after the charge, reroll damage dice below your Proficiency", () => {
    const text = "You moved in a straight line into Melee range of this target from at least Close range in this action";
    const plan = ok(bf("mythic-aerial-hunter", "Deadly Raptor"), "reroll", { actor: inForm("mythic-aerial-hunter", { proficiency: 4 }), rng: queueRng([]), targets: [foe("bandit")], situations: [text] });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { change: { kind: "rerollChosen" } }, amount: 4 });
  });

  it("Devastating Strikes: on Severe damage in Melee, a Stress for one more Hit Point", () => {
    const e = bf("terrible-lizard", "Devastating Strikes");
    expect(useOf(e).activation).toEqual({ kind: "rider", trigger: { kind: "whenTargetMarksHp", severity: "severe" } });
    const plan = ok(e, undefined, { actor: inForm("terrible-lizard"), rng: queueRng([]), targets: [foe("bandit")], situations: ["The target is within Melee range"] });
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "mark")).toContainEqual(expect.objectContaining({ targetId: "bandit", track: "hp", amount: 1 }));
  });
});

describe("ownership (SD1 owned, Q10)", () => {
  it("a transformed druid holds the form's features; each one classified combat or passive has an entry", () => {
    for (const b of BEASTFORMS) {
      const held = owned(druid, { beastformId: b.id }).filter((f) => f.source === "beastform");
      expect(held.map((f) => f.name)).toEqual(b.features.map((f) => f.name));
      for (const f of held) expect(featureEffect(f.featureId) !== undefined).toBe(f.usage === "combat" || f.usage === "passive");
      expect(featureEffect(beastformAttackId(b.id))).toBeDefined();
    }
    expect(owned(druid, { beastformId: null }).some((f) => f.source === "beastform")).toBe(false);
  });
});
