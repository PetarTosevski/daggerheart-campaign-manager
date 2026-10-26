import { describe, expect, it } from "vitest";

import type { PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { featureKey, featureSlug, parseFeatureId } from "@/lib/domain/feature-effects/ids";
import { featureAvailability, runFeature, type FeatureRunContext } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { applyUpgrades, type Holdings } from "@/lib/domain/feature-effects/upgrades";
import { FEATURE_CLASSIFICATION } from "@/lib/srd/feature-effects/classification";
import { DRUID_SORCERER_EFFECTS } from "@/lib/srd/feature-effects/druid-sorcerer";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import { actorOf, adversary, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-druid-sorcerer: every Druid and Sorcerer feature classified combat or passive, run through
// runFeature (SD1) with fixed dice. Expected values come from the book by hand (printed pages): CB p.30 (Evolution,
// Beastform, Warden of the Elements), p.31 (Warden of Renewal), p.46 (Volatile Magic, Channel Raw Power, Elemental
// Origin), p.47 (Primal Origin). The default actor (fixtures) has Proficiency 1, 3 Hope, 1 of 6 Stress marked.

const OWNERS = new Set(["druid", "sorcerer", "warden-of-the-elements", "warden-of-renewal", "elemental-origin", "primal-origin"]);
const INCARNATION = "subclass:warden-of-the-elements:elemental-incarnation";
const AURA = "subclass:warden-of-the-elements:elemental-aura";

const entry = (featureId: string): FeatureEffect => {
  const found = DRUID_SORCERER_EFFECTS.find((e) => e.featureId === featureId);
  if (!found) throw new Error(`No entry for ${featureId}`);
  return found;
};

const druid = sheetOf("druid", "warden-of-the-elements", { proficiency: 2 });
const sorcerer = sheetOf("sorcerer", "primal-origin");

const ally = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "pc",
  evasion: 11,
  thresholds: { major: 6, severe: 12 },
  hp: 4,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

/** Runs a use, checks every queued die was used, and returns the plan. */
function ok(featureId: string, useId: string | undefined, context: Omit<FeatureRunContext, "rng" | "gmFear"> & { dice?: number[] }): RunPlan {
  const { dice = [], ...rest } = context;
  const rng = queueRng(dice);
  const result = runFeature(entry(featureId), useId, { gmFear: 2, rng, ...rest });
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}

function refused(featureId: string, useId: string | undefined, context: Omit<FeatureRunContext, "rng" | "gmFear">) {
  return runFeature(entry(featureId), useId, { gmFear: 2, rng: queueRng([]), ...context });
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const folds = (plan: RunPlan) => ofKind(plan, "fold").map((f) => ({ kind: f.step.kind, targetIds: f.targetIds, amount: f.amount, change: "change" in f.step ? f.step.change : undefined }));

const channelingFacts = (option: string, extra: { areas?: { featureId: string; own: boolean }[]; beastformId?: string | null } = {}) => ({
  featureEffects: [{ featureId: INCARNATION, option }],
  ...extra,
});

describe("the Druid and Sorcerer table", () => {
  const expected = Object.entries(FEATURE_CLASSIFICATION)
    .filter(([id, row]) => OWNERS.has(parseFeatureId(id)?.owner ?? "") && (row.usage === "combat" || row.usage === "passive"))
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per feature classified combat or passive (17), and none for the narrative and rest ones", () => {
    const ids = DRUID_SORCERER_EFFECTS.map((e) => e.featureId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(expected);
    expect(ids).toHaveLength(17);
    for (const id of ["class:druid:wildtouch", "class:sorcerer:arcane-sense", "class:sorcerer:minor-illusion", "subclass:warden-of-renewal:clarity-of-nature"]) {
      expect(ids).not.toContain(id);
    }
  });

  it("each entry's source, owner and subclass card match its id and the printed card; every key fits the sheet", () => {
    for (const e of DRUID_SORCERER_EFFECTS) {
      const parsed = parseFeatureId(e.featureId)!;
      expect(e.source).toBe(parsed.source);
      expect(e.owner).toBe(parsed.owner);
      expect(() => featureKey(e.featureId)).not.toThrow();
      for (const u of e.uses) expect(() => featureKey(e.featureId, u.id)).not.toThrow();
      if (e.source !== "subclass") {
        expect(e.card).toBeUndefined();
        continue;
      }
      const sub = SUBCLASSES.find((s) => s.id === e.owner)!;
      const card = (["foundation", "specialization", "mastery"] as const).find((c) => sub[c].some((f) => featureSlug(f.name) === parsed.slug));
      expect(e.card).toBe(card);
    }
  });
});

describe("Druid (CB p.30)", () => {
  it("Evolution: 3 Hope, a Beastform without marking a Stress, +1 to the chosen trait (D5's records)", () => {
    const sheet = { ...druid, hope: 4 };
    const result = runFeature(entry("hope:druid"), undefined, {
      actor: actorOf(sheet),
      gmFear: 0,
      rng: queueRng([]),
      sheet,
      options: { form: ["agile-scout"], trait: ["instinct"] },
    });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.actor.after).toMatchObject({ hope: 1, stress: 1 });
    expect(result.sheet!.effects.find((e) => e.id === "beastform")?.text).toMatch(/^Agile Scout/);
    expect(result.sheet!.effects.find((e) => e.id === "evolution")?.mods).toEqual({ trait: { id: "instinct", delta: 1 } });
    // Short of 3 Hope: refused.
    expect(refused("hope:druid", undefined, { actor: actorOf({ ...druid, hope: 2 }), sheet: { ...druid, hope: 2 }, options: { form: ["agile-scout"], trait: ["instinct"] } })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Beastform: mark a Stress, D5 records the form", () => {
    const result = runFeature(entry("class:druid:beastform"), undefined, { actor: actorOf(druid), gmFear: 0, rng: queueRng([]), sheet: druid, options: { form: ["agile-scout"] } });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.actor.after).toMatchObject({ hope: 3, stress: 2 });
    expect(result.sheet!.effects.some((e) => e.id === "beastform")).toBe(true);
  });
});

describe("Warden of the Elements (CB p.30)", () => {
  it("Elemental Incarnation: mark a Stress to Channel one element until Severe damage or your next rest", () => {
    for (const element of ["fire", "earth", "water", "air"]) {
      const plan = ok(INCARNATION, "main", { actor: actorOf(druid), options: { element: [element] } });
      expect(plan.actor.after.stress).toBe(2);
      expect(plan.exclusive).toBe(true);
      const effects = ofKind(plan, "effect");
      expect(effects).toHaveLength(1);
      expect(effects[0]).toMatchObject({ targetId: "pc", option: element, duration: "rest", endsOn: ["takeSevere"] });
    }
    // Earth: thresholds + Proficiency (2); Air: advantage on Agility Rolls.
    expect(ofKind(ok(INCARNATION, "main", { actor: actorOf(druid), options: { element: ["earth"] } }), "effect")[0]!.mods).toEqual([
      { kind: "stat", stat: "majorThreshold", delta: 2 },
      { kind: "stat", stat: "severeThreshold", delta: 2 },
    ]);
    expect(ofKind(ok(INCARNATION, "main", { actor: actorOf(druid), options: { element: ["air"] } }), "effect")[0]!.mods).toEqual([{ kind: "advantage", on: "agility" }]);
  });

  it("Fire: an adversary within Melee that damages you takes 1d10 magic damage; only while Channeling Fire", () => {
    const attacker = adversary("ogre");
    const plan = ok(INCARNATION, "fire", { actor: actorOf(druid, { facts: channelingFacts("fire") }), trigger: { source: attacker }, dice: [7] });
    expect(ofKind(plan, "damageRoll").map((s) => s.type)).toEqual(["magic"]);
    expect(ofKind(plan, "damage").map((s) => ({ id: s.result.targetId, incoming: s.result.incoming }))).toEqual([{ id: "ogre", incoming: 7 }]);
    expect(refused(INCARNATION, "fire", { actor: actorOf(druid, { facts: channelingFacts("earth") }), trigger: { source: attacker } })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Water: the Stress on the other adversaries is a manual step (vocabulary gap)", () => {
    const plan = ok(INCARNATION, "water", { actor: actorOf(druid, { facts: channelingFacts("water") }) });
    expect(ofKind(plan, "prompt").map((p) => p.prompt)).toEqual(["manual"]);
  });

  it("Elemental Aura: once per rest while Channeling, a Close aura matching the element", () => {
    const actor = actorOf(druid, { facts: channelingFacts("earth") });
    const plan = ok(AURA, "main", { actor, options: { element: ["earth"] } });
    const [area] = ofKind(plan, "area");
    expect(area).toMatchObject({ centreId: "pc", area: { radius: "close", side: "allies", duration: "rest", endsOn: ["takeSevere"], mods: [{ kind: "trait", trait: "strength", delta: 1 }] } });
    expect(plan.limit).toEqual({ key: `feat:${AURA}`, until: "rest", consumed: true });
    // An element you are not Channeling draws nothing; not Channeling at all is refused; used once this rest is exhausted.
    expect(ofKind(ok(AURA, "main", { actor, options: { element: ["fire"] } }), "area")).toEqual([]);
    expect(refused(AURA, "main", { actor: actorOf(druid, { facts: { featureEffects: [] } }), options: { element: ["earth"] } })).toMatchObject({ ok: false, reason: "requirement" });
    expect(refused(AURA, "main", { actor: { ...actor, featureUses: [{ key: `feat:${AURA}`, until: "rest" }] }, options: { element: ["earth"] } })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Aura Fire: an adversary in the aura that marks HP also marks a Stress; Water moves the attacker for a Stress; Air reduces by 1d8", () => {
    const inAura = (option: string) => actorOf(druid, { facts: channelingFacts(option, { areas: [{ featureId: AURA, own: true }] }) });
    const ogre = adversary("ogre");
    const fire = ok(AURA, "fire", { actor: inAura("fire"), trigger: { subject: ogre } });
    expect(ofKind(fire, "mark")).toMatchObject([{ targetId: "ogre", track: "stress", amount: 1 }]);
    expect(refused(AURA, "fire", { actor: actorOf(druid, { facts: channelingFacts("fire", { areas: [] }) }), trigger: { subject: ogre } })).toMatchObject({ ok: false, reason: "requirement" });

    const water = ok(AURA, "water", { actor: inAura("water"), trigger: { source: ogre }, situations: ["The adversary that damaged you is within Close range"] });
    expect(water.actor.after.stress).toBe(2);
    expect(ofKind(water, "prompt")).toMatchObject([{ prompt: "move", targetIds: ["ogre"] }]);

    expect(folds(ok(AURA, "air-self", { actor: inAura("air"), dice: [5] }))).toEqual([{ kind: "reduceDamage", targetIds: ["pc"], amount: 5, change: undefined }]);
    const mira = ally("mira");
    expect(folds(ok(AURA, "air-ally", { actor: inAura("air"), trigger: { subject: mira }, situations: ["The damage is from an attack beyond Melee range"], dice: [3] }))).toEqual([
      { kind: "reduceDamage", targetIds: ["mira"], amount: 3, change: undefined },
    ]);
  });

  it("Elemental Dominion: Earth rolls a d6 per Hit Point marked, one fewer per 6; Water makes the attacker Vulnerable; Fire and Air are passive mods", () => {
    const earth = ok("subclass:warden-of-the-elements:elemental-dominion", "earth", { actor: actorOf(druid, { facts: channelingFacts("earth") }), trigger: { amount: 3 }, dice: [6, 2, 6] });
    expect(folds(earth)).toEqual([{ kind: "adjustHpMarked", targetIds: ["pc"], amount: 2, change: "fewer" }]);

    const ogre = adversary("ogre");
    const water = ok("subclass:warden-of-the-elements:elemental-dominion", "water", { actor: actorOf(druid, { facts: channelingFacts("water") }), trigger: { source: ogre } });
    expect(water.actor.after.stress).toBe(2);
    expect(ofKind(water, "condition")).toMatchObject([{ targetId: "ogre", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }]);

    const dominion = entry("subclass:warden-of-the-elements:elemental-dominion");
    expect(dominion.uses.find((u) => u.id === "fire")).toMatchObject({ activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "proficiency", delta: { kind: "fixed", value: 1 } }] });
    expect(dominion.uses.find((u) => u.id === "air")).toMatchObject({ activation: { kind: "passive" }, mods: [{ kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 1 } }] });
    expect(refused("subclass:warden-of-the-elements:elemental-dominion", "air", { actor: actorOf(druid, { facts: channelingFacts("fire") }) })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Warden of Renewal (CB p.31)", () => {
  const renewal = sheetOf("druid", "warden-of-renewal");
  const holdings = (featureIds: string[]): Holdings => ({ rank: "specialization", featureIds: new Set(featureIds), level: 5 });

  it("Regeneration: 3 Hope, the touched creature clears 1d4 HP; Very Close with Regenerative Reach", () => {
    const mira = ally("mira", { hp: 4 });
    const plan = ok("subclass:warden-of-renewal:regeneration", undefined, { actor: actorOf(renewal), targets: [mira], dice: [3] });
    expect(plan.actor.after.hope).toBe(0);
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "mira", track: "hp", amount: 3 }]);

    const regen = entry("subclass:warden-of-renewal:regeneration");
    expect(regen.uses[0]!.targets).toMatchObject({ range: "melee" });
    expect(applyUpgrades(regen, holdings(["subclass:warden-of-renewal:regenerative-reach"])).uses[0]!.targets).toMatchObject({ range: "veryClose" });
    expect(applyUpgrades(regen, holdings([])).uses[0]!.targets).toMatchObject({ range: "melee" });
    // Regenerative Reach itself is the upgrade: a passive entry with nothing of its own.
    expect(entry("subclass:warden-of-renewal:regenerative-reach").uses).toMatchObject([{ activation: { kind: "passive" }, mods: [], steps: [] }]);
  });

  it("Regeneration can be activated again for another 3 Hope (no roll, no limit; CB p.107)", () => {
    const mira = ally("mira", { hp: 5 });
    const plan = ok("subclass:warden-of-renewal:regeneration", undefined, { actor: actorOf({ ...renewal, hope: 6 }), targets: [mira], times: 2, dice: [2, 1] });
    expect(plan.actor.after.hope).toBe(0);
    expect(ofKind(plan, "clear").map((c) => c.amount)).toEqual([2, 1]);
  });

  it("Warden's Protection: once per long rest, 2 Hope, up to 1d4 allies within Close clear 2 HP", () => {
    const allies = [ally("a"), ally("b")];
    const plan = ok("subclass:warden-of-renewal:wardens-protection", undefined, { actor: actorOf(renewal), targets: allies, dice: [3] });
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "clear").map((c) => [c.targetId, c.amount])).toEqual([
      ["a", 2],
      ["b", 2],
    ]);
    expect(plan.limit).toMatchObject({ key: "feat:subclass:warden-of-renewal:wardens-protection", until: "longRest" });
    // More allies than the 1d4 shows: refused.
    expect(runFeature(entry("subclass:warden-of-renewal:wardens-protection"), undefined, { actor: actorOf(renewal), gmFear: 0, rng: queueRng([1]), targets: allies })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("Defender: in Beastform, an ally within Close who marks 2+ HP marks 1 fewer for your Stress", () => {
    const mira = ally("mira");
    const plan = ok("subclass:warden-of-renewal:defender", undefined, {
      actor: actorOf(renewal, { facts: { beastformId: "agile-scout" } }),
      trigger: { subject: mira },
      situations: ["The ally marks 2 or more Hit Points"],
    });
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([{ kind: "adjustHpMarked", targetIds: ["mira"], amount: 1, change: "fewer" }]);
    expect(refused("subclass:warden-of-renewal:defender", undefined, { actor: actorOf(renewal, { facts: { beastformId: null } }), trigger: { subject: mira }, situations: ["The ally marks 2 or more Hit Points"] })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Sorcerer (CB p.46)", () => {
  it("Volatile Magic: 3 Hope after the damage roll of a magic attack, reroll the picked dice (Q1)", () => {
    const ogre = adversary("ogre");
    const plan = ok("hope:sorcerer", undefined, { actor: actorOf(sorcerer), targets: [ogre], situations: ["The attack deals magic damage"], damageDice: { reroll: [0, 2] } });
    expect(plan.activation).toBe("reaction");
    expect(plan.actor.after.hope).toBe(0);
    expect(folds(plan)).toEqual([{ kind: "modifyDamage", targetIds: ["ogre"], amount: undefined, change: { kind: "rerollChosen" } }]);
    expect(entry("hope:sorcerer").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "damage" } });
    expect(refused("hope:sorcerer", undefined, { actor: actorOf(sorcerer), targets: [ogre] })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Channel Raw Power: vault a loadout card for Hope equal to its level, through D5's once-per-long-rest key", () => {
    const sheet = { ...sorcerer, domainCards: { owned: ["rune-ward"], loadout: ["rune-ward"] } };
    const result = runFeature(entry("class:sorcerer:channel-raw-power"), undefined, { actor: actorOf(sheet), gmFear: 0, rng: queueRng([]), sheet, options: { card: ["hope:rune-ward"] } });
    if (!result.ok) throw new Error(result.detail);
    expect(result.plan.actor.after.hope).toBe(4);
    expect(result.plan.actor.featureUses).toEqual([{ key: "channelRawPower", until: "longRest" }]);
    expect(result.sheet!.domainCards.loadout).toEqual([]);
    const used = { ...sheet, featureUses: [{ key: "channelRawPower", until: "longRest" as const }] };
    expect(featureAvailability(used, entry("class:sorcerer:channel-raw-power"))).toMatchObject({ state: "exhausted", label: "Back after a long rest" });
  });
});

describe("Elemental Origin (CB p.46)", () => {
  const elemental = sheetOf("sorcerer", "elemental-origin");

  it("Elementalist: a Hope before the roll for +2 to it or +3 to its damage", () => {
    const roll = ok("subclass:elemental-origin:elementalist", undefined, { actor: actorOf(elemental), options: { bonus: ["roll"] } });
    expect(roll.actor.after.hope).toBe(2);
    expect(folds(roll)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: 2, change: { kind: "add", amount: { kind: "fixed", value: 2 } } }]);
    const ogre = adversary("ogre");
    const damage = ok("subclass:elemental-origin:elementalist", undefined, { actor: actorOf(elemental), targets: [ogre], options: { bonus: ["damage"] } });
    expect(folds(damage)).toEqual([{ kind: "modifyDamage", targetIds: ["ogre"], amount: 3, change: { kind: "add", amount: { kind: "fixed", value: 3 } } }]);
  });

  it("Natural Evasion: an attack against you succeeds, mark a Stress, +d6 to your Evasion against it", () => {
    const plan = ok("subclass:elemental-origin:natural-evasion", undefined, { actor: actorOf(elemental), trigger: { source: adversary("ogre") }, dice: [4] });
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toMatchObject([{ kind: "modifyRoll", targetIds: ["pc"], amount: 4, change: { kind: "evasion" } }]);
  });

  it("Transcendence: once per long rest, two distinct benefits until your next rest; the trait is your pick", () => {
    const plan = ok("subclass:elemental-origin:transcendence", undefined, { actor: actorOf(elemental), options: { benefits: ["trait", "trait", "evasion", "severe"], trait: ["knowledge"] } });
    const effects = ofKind(plan, "effect");
    expect(effects.map((e) => e.mods)).toEqual([[{ kind: "trait", trait: "knowledge", delta: 1 }], [{ kind: "stat", stat: "evasion", delta: 2 }]]);
    expect(effects.every((e) => e.duration === "rest")).toBe(true);
    expect(plan.limit).toEqual({ key: "feat:subclass:elemental-origin:transcendence", until: "longRest", consumed: true });
    const severe = ok("subclass:elemental-origin:transcendence", undefined, { actor: actorOf(elemental), options: { benefits: ["severe", "proficiency"] } });
    expect(ofKind(severe, "effect").map((e) => e.mods)).toEqual([[{ kind: "stat", stat: "severeThreshold", delta: 4 }], [{ kind: "stat", stat: "proficiency", delta: 1 }]]);
    expect(refused("subclass:elemental-origin:transcendence", undefined, { actor: actorOf({ ...elemental, featureUses: [{ key: "feat:subclass:elemental-origin:transcendence", until: "longRest" }] }), options: { benefits: ["severe", "proficiency"] } })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Primal Origin (CB p.47)", () => {
  const situation = ["You cast a spell, or attacked with a weapon that deals magic damage"];
  const ogre = adversary("ogre");

  it("Manipulate Magic: a Stress after a magic spell or attack for one of four options", () => {
    const run = (option: string) => ok("subclass:primal-origin:manipulate-magic", undefined, { actor: actorOf(sorcerer), targets: [ogre], situations: situation, options: { option: [option] } });
    const roll = run("roll");
    expect(roll.actor.after.stress).toBe(2);
    expect(folds(roll)).toMatchObject([{ kind: "modifyRoll", amount: 2 }]);
    expect(folds(run("double"))).toMatchObject([{ kind: "modifyDamage", targetIds: ["ogre"], change: { kind: "doubleDice", which: "chosen", count: 1 } }]);
    expect(folds(run("target"))).toMatchObject([{ kind: "addTargets", amount: 1 }]);
    expect(ofKind(run("reach"), "prompt")).toMatchObject([{ prompt: "manual" }]);
    expect(refused("subclass:primal-origin:manipulate-magic", undefined, { actor: actorOf(sorcerer), options: { option: ["roll"] } })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Enchanted Aid: a d8 advantage die when you Help with a Spellcast Roll; once per long rest swap their Duality Dice", () => {
    const mira = ally("mira");
    const help = ok("subclass:primal-origin:enchanted-aid", "main", { actor: actorOf(sorcerer), trigger: { subject: mira } });
    expect(ofKind(help, "help")).toEqual([{ kind: "help", targetId: "mira", die: 8, free: false }]);
    expect(entry("subclass:primal-origin:enchanted-aid").uses[0]!.activation).toEqual({ kind: "rider", trigger: { kind: "whenHelping", roll: "spellcast" } });

    const swap = ok("subclass:primal-origin:enchanted-aid", "swap", { actor: actorOf(sorcerer), trigger: { subject: mira }, situations: ["The ally made a Spellcast Roll with your help"] });
    expect(folds(swap)).toMatchObject([{ kind: "modifyRoll", targetIds: ["mira"], change: { kind: "swapDuality" } }]);
    expect(swap.limit).toEqual({ key: "feat:subclass:primal-origin:enchanted-aid:swap", until: "longRest", consumed: true });
  });

  it("Arcane Charge: Charged by magic damage or 2 Hope; a successful magic attack clears it for +10 damage or +3 Difficulty", () => {
    const charge = ok("subclass:primal-origin:arcane-charge", "main", { actor: actorOf(sorcerer) });
    expect(charge.actor.after.hope).toBe(1);
    expect(ofKind(charge, "condition")).toMatchObject([{ targetId: "pc", condition: { kind: "tag", tag: "Charged" }, duration: "longRest" }]);
    expect(ofKind(ok("subclass:primal-origin:arcane-charge", "charged", { actor: actorOf(sorcerer) }), "condition")).toMatchObject([{ condition: { tag: "Charged" }, duration: "longRest" }]);

    const charged = actorOf(sorcerer, { facts: { conditions: [], tags: ["Charged"] } });
    const damage = ok("subclass:primal-origin:arcane-charge", "release", { actor: charged, targets: [ogre], situations: ["The attack deals magic damage"], options: { bonus: ["damage"] } });
    expect(folds(damage)).toMatchObject([{ kind: "modifyDamage", targetIds: ["ogre"], amount: 10 }]);
    expect(ofKind(damage, "clearCondition")).toMatchObject([{ targetId: "pc", condition: { kind: "tag", tag: "Charged" } }]);
    const difficulty = ok("subclass:primal-origin:arcane-charge", "release", { actor: charged, targets: [ogre], situations: ["The attack deals magic damage"], options: { bonus: ["difficulty"] } });
    expect(ofKind(difficulty, "effect")).toMatchObject([{ targetId: "ogre", mods: [{ kind: "stat", stat: "reactionDifficulty", delta: 3 }], duration: "nextRoll" }]);
    // Not Charged: refused.
    expect(refused("subclass:primal-origin:arcane-charge", "release", { actor: actorOf(sorcerer, { facts: { conditions: [], tags: [] } }), targets: [ogre], situations: ["The attack deals magic damage"] })).toMatchObject({ ok: false, reason: "requirement" });
  });
});
