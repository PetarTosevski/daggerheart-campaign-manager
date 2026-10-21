import { describe, expect, it } from "vitest";

import { openWindow, resolveWindow, respond, runReactionCard, type RespondResult, type WindowHit, type WindowPc, type WindowState } from "@/lib/domain/adversary-actions";
import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, Mod, Requirement } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { VALOR_EFFECTS } from "@/lib/srd/card-effects/valor";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-valor: every Valor card runs through the runner (CA1) with fixed dice. Expected numbers
// are worked out by hand from the card text (CB p.341-342). RNG order: Hope die, Fear die, advantage die, then damage
// dice, reaction rolls and checks in the order the steps need them.

const actor = (over: Partial<ActorState> = {}): ActorState => ({
  id: "pc",
  side: "pc",
  evasion: 10,
  thresholds: { major: 7, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 1,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  hope: 2,
  hopeMax: 6,
  traits: { agility: 0, strength: 2, finesse: 1, instinct: 0, presence: 1, knowledge: 0 },
  spellcast: 0,
  proficiency: 2,
  level: 9,
  tier: 4,
  loadoutDomains: ["valor", "valor", "blade"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: {
    primary: { damage: "d8+1 phy", trait: "strength", damageType: "physical", range: "melee" },
    secondary: { damage: "d6 phy", trait: "agility", damageType: "physical", range: "melee" },
  },
  ...over,
});

/** A Bandit-like adversary: Difficulty 12, thresholds 8/14, 5 HP, 3 Stress. */
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

const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 3, rng: queueRng(dice), ...over });

function entry(cardId: string): CardEffect {
  const found = VALOR_EFFECTS.find((e) => e.cardId === cardId);
  if (!found) throw new Error(`No entry for ${cardId}`);
  return found;
}

function cardUse(cardId: string, useId = "main"): CardUse {
  const found = entry(cardId).uses.find((u) => u.id === useId);
  if (!found) throw new Error(`No use ${useId} on ${cardId}`);
  return found;
}

/** The situation texts of a use, as the player would confirm them. */
const situations = (cardId: string, useId = "main"): string[] =>
  (cardUse(cardId, useId).requires ?? []).flatMap((r: Requirement) => (r.kind === "situation" ? [r.text] : []));

/** Runs a card's use and checks the dice queue was used up exactly. */
function ok(cardId: string, context: RunContext): RunPlan {
  const result = run(entry(cardId), context);
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  (context.rng as ReturnType<typeof queueRng>).done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const folds = (plan: RunPlan) => ofKind(plan, "fold").map((f) => [f.step.kind, f.targetIds, f.amount]);

/** A passive use's mods resolved through an effect step, so run() does the arithmetic. */
function resolvedMods(mods: readonly Mod[], over: Partial<ActorState> = {}) {
  const probe: CardEffect = {
    cardId: "probe",
    uses: [{ id: "main", name: "probe", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "probe", mods, duration: "permanent" }] }],
  };
  const result = run(probe, ctx([], { actor: actor(over) }));
  if (!result.ok) throw new Error("refused");
  return ofKind(result.plan, "effect")[0]!.mods;
}

describe("the Valor table", () => {
  it("has exactly one entry per Valor card classified combat or passive (all 21)", () => {
    const expected = Object.entries(CARD_CLASSIFICATION.valor)
      .filter(([, c]) => c.usage !== "outOfCombat")
      .map(([id]) => id)
      .sort();
    const ids = VALOR_EFFECTS.map((e) => e.cardId);
    expect([...ids].sort()).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(21);
  });

  it("every entry is a real Valor card and its use ids are unique", () => {
    for (const effect of VALOR_EFFECTS) {
      expect(DOMAIN_CARDS.find((c) => c.id === effect.cardId)?.domain).toBe("valor");
      const useIds = effect.uses.map((u) => u.id);
      expect(new Set(useIds).size).toBe(useIds.length);
    }
  });

  it("passive cards have no action use (the Hand shows them without a Use button)", () => {
    for (const effect of VALOR_EFFECTS) {
      if (CARD_CLASSIFICATION.valor[effect.cardId]?.usage !== "passive") continue;
      expect(effect.uses.some((u) => u.activation.kind === "action")).toBe(false);
    }
  });
});

describe("Bare Bones (CB p.341)", () => {
  it("without armor: Armor Score 3 + Strength and the tier's thresholds", () => {
    const mods = cardUse("bare-bones").mods!;
    expect(resolvedMods(mods)).toEqual([
      { kind: "set", stat: "armorScore", to: 5 },
      { kind: "set", stat: "majorThreshold", to: 15 },
      { kind: "set", stat: "severeThreshold", to: 38 },
    ]);
    expect(resolvedMods(mods, { tier: 1, traits: { ...actor().traits, strength: 0 } })).toEqual([
      { kind: "set", stat: "armorScore", to: 3 },
      { kind: "set", stat: "majorThreshold", to: 9 },
      { kind: "set", stat: "severeThreshold", to: 19 },
    ]);
    expect(resolvedMods(mods, { tier: 3 }).slice(1)).toEqual([
      { kind: "set", stat: "majorThreshold", to: 13 },
      { kind: "set", stat: "severeThreshold", to: 31 },
    ]);
  });
  it("only while you wear no armor", () => {
    expect(run(entry("bare-bones"), ctx([]))).toMatchObject({ ok: false, reason: "requirement", detail: "armor" });
    expect(ok("bare-bones", ctx([], { actor: actor({ armorWorn: false }) })).steps).toEqual([]);
  });
});

describe("Forceful Push (CB p.341)", () => {
  it("a hit with Hope: primary weapon damage + d6, knocked back to Close, a Hope for Vulnerable", () => {
    // 10 + 4 + Strength 2 = 16 vs 12; damage 2d8+1 = 5 + 3 + 1 = 9, + d6 4 = 13 (Major: 2 HP).
    const plan = ok("forceful-push", ctx([10, 4, 5, 3, 4], { targets: [adv("a")], optionals: ["vulnerable"] }));
    expect(plan.roll).toMatchObject({ withHope: true, success: true });
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 13, severity: "major", hpMarked: 2 });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["a"], text: "Knock the target back to Close range" });
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "optional", costs: [{ resource: "hope", amount: 1 }], paid: true }]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" });
    expect(plan.actor.after.hope).toBe(2); // 2 + 1 from the roll − 1
  });
  it("a hit with Fear: no d6, no Vulnerable unless chosen", () => {
    const plan = ok("forceful-push", ctx([4, 10, 5, 3], { targets: [adv("a")] }));
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 9, severity: "major", hpMarked: 2 });
    expect(ofKind(plan, "condition")).toEqual([]);
    expect(plan.gmFearDelta).toBe(1);
  });
  it("a miss: no damage, no knock-back, no Vulnerable", () => {
    const plan = ok("forceful-push", ctx([2, 3], { targets: [adv("a")], optionals: ["vulnerable"] }));
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(ofKind(plan, "prompt")).toEqual([]);
    expect(ofKind(plan, "condition")).toEqual([]);
    expect(ofKind(plan, "pay")).toEqual([]); // the optional Hope is not offered on a miss
    expect(plan.actor.after.hope).toBe(2); // a failure with Fear: no Hope gained, none spent
  });
});

describe("I Am Your Shield (CB p.341)", () => {
  it("a Stress: the hit moves to you and you may mark any number of Armor Slots", () => {
    expect(cardUse("i-am-your-shield").activation).toEqual({ kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryClose" } });
    const plan = ok("i-am-your-shield", ctx([], { trigger: { subject: ally("mira"), amount: 18 } }));
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([
      ["redirectDamage", ["mira"], undefined],
      ["extraArmorSlots", ["pc"], "any"],
    ]);
  });
});

// The reaction window of an adversary hit (Q13, AA1): Valor's reaction cards answer there.
describe("Valor cards in the adversary-hit reaction window (AA1)", () => {
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
  const asActor = (id: string): ActorState => actor({ id, stress: 0, thresholds: { major: 8, severe: 16 } });
  const answered = (r: RespondResult): WindowState => {
    if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
    return r.state;
  };

  it("I Am Your Shield is offered to an ally within Very Close; using it moves the hit to them", () => {
    const party = [windowPc("mira"), windowPc("bram", { cards: [entry("i-am-your-shield")], bandToTarget: "veryClose" })];
    let w = openWindow({ hit: hit(), targetId: "mira", party });
    expect(w.responders.find((r) => r.characterId === "bram")).toEqual({ characterId: "bram", role: "ally", cardIds: ["i-am-your-shield"] });
    const { result, folds: f } = runReactionCard(entry("i-am-your-shield"), asActor("bram"), w, { target: ally("mira") }, queueRng([]));
    expect(result.ok).toBe(true);
    w = answered(respond(w, { characterId: "bram", choice: { kind: "card", cardId: "i-am-your-shield" }, folds: f }));
    expect(w.targetId).toBe("bram");
    w = answered(respond(w, { characterId: "bram", choice: { kind: "armor", slots: 2 } }));
    // 18 is Severe against 8/16; two Armor Slots step it down twice: Minor, 1 HP.
    expect(resolveWindow(w, party).result).toMatchObject({ targetId: "bram", armorSlots: 2, severity: "minor", hpMarked: 1 });
  });

  it("an ally beyond Very Close is not offered I Am Your Shield", () => {
    const party = [windowPc("mira"), windowPc("bram", { cards: [entry("i-am-your-shield")], bandToTarget: "close" })];
    expect(openWindow({ hit: hit(), targetId: "mira", party }).responders.map((r) => r.characterId)).toEqual(["mira"]);
  });

  it("Shrug It Off: the hit PC marks a Stress and the severity drops one threshold (d6 4 keeps the card)", () => {
    const party = [windowPc("mira", { cards: [entry("shrug-it-off")] })];
    let w = openWindow({ hit: hit(), targetId: "mira", party });
    expect(w.responders).toEqual([{ characterId: "mira", role: "target", cardIds: ["shrug-it-off"] }]);
    const { result, folds: f } = runReactionCard(entry("shrug-it-off"), asActor("mira"), w, { target: ally("mira") }, queueRng([4]));
    expect(result.ok && ofKind(result.plan, "toVault")).toEqual([]);
    expect(f).toEqual([{ kind: "reduceSeverity", steps: 1, targetIds: ["mira"] }]);
    w = answered(respond(w, { characterId: "mira", choice: { kind: "card", cardId: "shrug-it-off" }, folds: f }));
    w = answered(respond(w, { characterId: "mira", choice: { kind: "noArmor" } }));
    expect(resolveWindow(w, party).result).toMatchObject({ severity: "major", hpMarked: 2 });
  });

  it("Unyielding Armor: a 6 drops the severity and the PC answers without marking a slot", () => {
    const party = [windowPc("mira", { cards: [entry("unyielding-armor")] })];
    let w = openWindow({ hit: hit(), targetId: "mira", party });
    expect(w.responders).toEqual([{ characterId: "mira", role: "target", cardIds: ["unyielding-armor"] }]);
    const { folds: f } = runReactionCard(entry("unyielding-armor"), asActor("mira"), w, { target: ally("mira") }, queueRng([2, 6]));
    expect(f).toEqual([{ kind: "reduceSeverity", steps: 1, targetIds: ["mira"] }]);
    w = answered(respond(w, { characterId: "mira", choice: { kind: "card", cardId: "unyielding-armor" }, folds: f }));
    w = answered(respond(w, { characterId: "mira", choice: { kind: "noArmor" } }));
    expect(resolveWindow(w, party).result).toMatchObject({ severity: "major", armorSlots: 0, hpMarked: 2 });
  });
});

describe("Body Basher (CB p.341)", () => {
  it("a successful Melee weapon attack adds Strength to the damage roll", () => {
    expect(cardUse("body-basher").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "success", weapon: true, weaponRange: "melee" } });
    const plan = ok("body-basher", ctx([], { targets: [adv("a")] }));
    expect(folds(plan)).toEqual([["modifyDamage", ["a"], 2]]);
  });
});

describe("Bold Presence (CB p.341)", () => {
  it("a Hope adds Strength to a Presence Roll", () => {
    expect(cardUse("bold-presence").activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "presence" } });
    const plan = ok("bold-presence", ctx([]));
    expect(plan.actor.after.hope).toBe(1);
    expect(folds(plan)).toEqual([["modifyRoll", ["pc"], 2]]);
  });
  it("once per rest, avoid gaining a condition", () => {
    const plan = ok("bold-presence", ctx([], { useId: "condition" }));
    expect(folds(plan)).toEqual([["negate", ["pc"], undefined]]);
    expect(plan.limit).toEqual({ key: "card:bold-presence:condition", until: "rest", consumed: true });
    const again = run(entry("bold-presence"), ctx([], { useId: "condition", actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toMatchObject({ ok: false, reason: "exhausted" });
    // The Presence bonus has no limit.
    expect(run(entry("bold-presence"), ctx([], { actor: actor({ featureUses: plan.actor.featureUses }) })).ok).toBe(true);
  });
});

describe("Critical Inspiration (CB p.341)", () => {
  it("once per rest on a critical attack: allies within Very Close each clear a Stress or gain a Hope", () => {
    const plan = ok("critical-inspiration", ctx([], { picked: [ally("a1", { stress: 2 })], allies: [ally("a2")] }));
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "a1", track: "stress", amount: 1 }]);
    expect(ofKind(plan, "hope")).toEqual([{ kind: "hope", targetId: "a2", delta: 1 }]);
    expect(plan.limit).toEqual({ key: "card:critical-inspiration", until: "rest", consumed: true });
    expect(run(entry("critical-inspiration"), ctx([], { actor: actor({ featureUses: plan.actor.featureUses }) }))).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Lean on Me (CB p.341)", () => {
  it("once per long rest, after an ally fails: you both clear 2 Stress", () => {
    const plan = ok("lean-on-me", ctx([], { trigger: { subject: ally("mira", { stress: 3 }) }, situations: situations("lean-on-me") }));
    expect(ofKind(plan, "clear")).toEqual([
      { kind: "clear", targetId: "pc", track: "stress", amount: 1 },
      { kind: "clear", targetId: "mira", track: "stress", amount: 2 },
    ]);
    expect(plan.limit).toEqual({ key: "card:lean-on-me", until: "longRest", consumed: true });
  });
  it("needs you to console or inspire them", () => {
    expect(run(entry("lean-on-me"), ctx([], { trigger: { subject: ally("mira") } }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Goad Them On (CB p.341)", () => {
  it("a Presence Roll against the target: on a success it marks a Stress and is Goaded", () => {
    // 9 + 4 + Presence 1 = 14 vs 12.
    const plan = ok("goad-them-on", ctx([9, 4], { targets: [adv("a")] }));
    expect(plan.roll?.record.total).toBe(14);
    expect(ofKind(plan, "mark")).toEqual([{ kind: "mark", targetId: "a", track: "stress", amount: 1, hpMarked: 0, overflow: false }]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Goaded" }, duration: "manual" });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", targetIds: ["a"] });
    expect(plan.creatures[0]!.after).toMatchObject({ stress: 1, tags: ["Goaded"] });
  });
  it("a failure does nothing to the target", () => {
    const plan = ok("goad-them-on", ctx([2, 3], { targets: [adv("a")] }));
    expect(ofKind(plan, "mark")).toEqual([]);
    expect(ofKind(plan, "condition")).toEqual([]);
    expect(ofKind(plan, "prompt")).toEqual([]);
  });
  it("a target with a full Stress track marks a Hit Point instead (CB p.92)", () => {
    const plan = ok("goad-them-on", ctx([9, 4], { targets: [adv("a", { stress: 3 })] }));
    expect(ofKind(plan, "mark")[0]).toMatchObject({ hpMarked: 1, overflow: true });
  });
});

describe("Support Tank (CB p.342)", () => {
  it("2 Hope: an ally within Close who failed rerolls their Hope or Fear Die", () => {
    expect(cardUse("support-tank").activation).toEqual({ kind: "reaction", trigger: { kind: "afterAllyRolls", range: "close", result: "failure" } });
    const plan = ok("support-tank", ctx([], { trigger: { subject: ally("mira") } }));
    expect(plan.actor.after.hope).toBe(0);
    expect(folds(plan)).toEqual([["modifyRoll", ["mira"], undefined]]);
    expect(run(entry("support-tank"), ctx([], { actor: actor({ hope: 1 }), trigger: { subject: ally("mira") } }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Armorer (CB p.342)", () => {
  it("+1 Armor Score while you wear armor", () => {
    expect(resolvedMods(cardUse("armorer").mods!)).toEqual([{ kind: "stat", stat: "armorScore", delta: 1 }]);
    expect(run(entry("armorer"), ctx([], { useId: "main", actor: actor({ armorWorn: false }) }))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("repairing your armor during a rest: your allies also clear an Armor Slot", () => {
    const plan = ok("armorer", ctx([], { useId: "repair", allies: [ally("a1", { armor: 2 }), ally("a2")], situations: situations("armorer", "repair") }));
    expect(ofKind(plan, "clear")).toEqual([
      { kind: "clear", targetId: "a1", track: "armor", amount: 1 },
      { kind: "clear", targetId: "a2", track: "armor", amount: 0 },
    ]);
  });
});

describe("Rousing Strike (CB p.342)", () => {
  it("once per rest on a critical attack: you and allies clear a Hit Point or 1d4 Stress", () => {
    // You: 1d4 Stress (3, only 1 marked); an ally clears a HP; another rolls 1d4 Stress (2).
    const plan = ok(
      "rousing-strike",
      ctx([3, 2], { options: { self: ["stress"] }, picked: [ally("a1", { hp: 2 })], allies: [ally("a2", { stress: 3 })] }),
    );
    expect(ofKind(plan, "clear")).toEqual([
      { kind: "clear", targetId: "pc", track: "stress", amount: 1 },
      { kind: "clear", targetId: "a1", track: "hp", amount: 1 },
      { kind: "clear", targetId: "a2", track: "stress", amount: 2 },
    ]);
    expect(plan.limit).toEqual({ key: "card:rousing-strike", until: "rest", consumed: true });
  });
  it("you may clear a Hit Point instead", () => {
    const plan = ok("rousing-strike", ctx([], { actor: actor({ hp: 3 }), options: { self: ["hp"] } }));
    expect(plan.actor.after.hp).toBe(2);
  });
});

describe("Inevitable (CB p.342)", () => {
  it("after a failed action roll: advantage on your next action roll", () => {
    expect(cardUse("inevitable").activation).toEqual({ kind: "auto", trigger: { kind: "afterYouRoll", roll: "action", result: "failure" } });
    const plan = ok("inevitable", ctx([]));
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", mods: [{ kind: "advantage", on: "action" }], duration: "nextRoll" });
  });
});

describe("Rise Up (CB p.342)", () => {
  it("+Proficiency to the Severe threshold", () => {
    expect(resolvedMods(cardUse("rise-up").mods!)).toEqual([{ kind: "stat", stat: "severeThreshold", delta: 2 }]);
    expect(resolvedMods(cardUse("rise-up").mods!, { proficiency: 4 })).toEqual([{ kind: "stat", stat: "severeThreshold", delta: 4 }]);
  });
  it("marking HP from an attack clears a Stress", () => {
    expect(cardUse("rise-up", "stress").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouMarkHp", fromAttack: true } });
    expect(ok("rise-up", ctx([], { useId: "stress" })).actor.after.stress).toBe(0);
  });
});

describe("Shrug It Off (CB p.342)", () => {
  it("a Stress reduces the severity one threshold; a d6 of 3 or lower vaults the card", () => {
    const plan = ok("shrug-it-off", ctx([3]));
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["reduceSeverity", ["pc"], 1]]);
    expect(ofKind(plan, "check")[0]).toEqual({ kind: "check", total: 3, dice: [3], passed: true });
    expect(ofKind(plan, "toVault")).toEqual([{ kind: "toVault", permanent: false }]);
  });
  it("a d6 of 4 or more keeps it", () => {
    expect(ofKind(ok("shrug-it-off", ctx([4])), "toVault")).toEqual([]);
  });
});

describe("Valor-Touched (CB p.342)", () => {
  const touched = actor({ loadoutDomains: ["valor", "valor", "valor", "valor", "blade"], armor: 2 });
  it("with 4+ Valor cards: +1 Armor Score", () => {
    expect(resolvedMods(cardUse("valor-touched").mods!)).toEqual([{ kind: "stat", stat: "armorScore", delta: 1 }]);
    expect(ok("valor-touched", ctx([], { actor: touched })).steps).toEqual([]);
    expect(run(entry("valor-touched"), ctx([]))).toMatchObject({ ok: false, reason: "requirement", detail: "loadoutDomainCount" });
  });
  it("marking HP without an Armor Slot clears an Armor Slot", () => {
    expect(cardUse("valor-touched", "armor").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouMarkHp", withoutArmor: true } });
    expect(ok("valor-touched", ctx([], { useId: "armor", actor: touched })).actor.after.armor).toBe(1);
    expect(run(entry("valor-touched"), ctx([], { useId: "armor" }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Full Surge (CB p.342)", () => {
  it("once per long rest, 3 Stress: +2 to all traits until your next rest", () => {
    const plan = ok("full-surge", ctx([]));
    expect(plan.actor.after.stress).toBe(4);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", mods: [{ kind: "trait", trait: "all", delta: 2 }], duration: "rest" });
    expect(plan.limit).toEqual({ key: "card:full-surge", until: "longRest", consumed: true });
    expect(run(entry("full-surge"), ctx([], { actor: actor({ featureUses: plan.actor.featureUses }) }))).toMatchObject({ ok: false, reason: "exhausted" });
  });
  it("needs 3 free Stress slots", () => {
    expect(run(entry("full-surge"), ctx([], { actor: actor({ stress: 4 }) }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Ground Pound (CB p.342)", () => {
  it("2 Hope, a Strength Roll vs all within Very Close: hit targets thrown to Far, Reaction Roll (17), 4d10+8", () => {
    // 8 + 5 + Strength 2 = 15: hits a (12), misses b (18). a's reaction roll 10 fails: 3+4+5+6+8 = 26 (Severe: 3 HP).
    const plan = ok("ground-pound", ctx([8, 5, 10, 3, 4, 5, 6], { targets: [adv("a"), adv("b", { difficulty: 18 })] }));
    expect(plan.hits).toEqual([
      { id: "a", hit: true },
      { id: "b", hit: false },
    ]);
    expect(plan.actor.after.hope).toBe(1); // 2 − 2 + 1 from the roll with Hope
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["a"], text: "Targets you succeed against are thrown back to Far range" });
    expect(ofKind(plan, "save")).toMatchObject([{ targetId: "a", difficulty: 17, success: false }]);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.severity, d.result.hpMarked])).toEqual([["a", 26, "severe", 3]]);
  });
  it("a target that succeeds takes half of the same damage roll (R9)", () => {
    // 10 + 3 + 2 = 15 hits both. a saves with 20: (1+2+3+4+8)/2 = 9 (Major). b fails with 5: the full 18 (Severe).
    const plan = ok("ground-pound", ctx([10, 3, 20, 1, 2, 3, 4, 5], { targets: [adv("a"), adv("b")] }));
    expect(ofKind(plan, "damageRoll")).toHaveLength(2);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.hpMarked])).toEqual([
      ["a", 9, 2],
      ["b", 18, 3],
    ]);
  });
  it("needs 2 Hope", () => {
    expect(run(entry("ground-pound"), ctx([], { actor: actor({ hope: 1 }), targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "cost", detail: "hope" });
  });
});

describe("Hold the Line (CB p.342)", () => {
  it("a Hope for the stance (until you move or fail a roll with Fear)", () => {
    const plan = ok("hold-the-line", ctx([]));
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", label: "Hold the Line", duration: "manual", endsWhen: "Until you move or fail a roll with Fear" });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual" });
  });
  it("while it holds, an adversary that moves within Very Close is pulled into Melee and Restrained", () => {
    const holding = actor({ activeCardEffects: ["hold-the-line"] });
    const plan = ok("hold-the-line", ctx([], { useId: "pull", actor: holding, targets: [adv("a")], situations: situations("hold-the-line", "pull") }));
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["a"], text: "Pull the adversary into Melee range" });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "standard", condition: "restrained" }, duration: "manual" });
    expect(plan.actor.after.hope).toBe(2);
    expect(run(entry("hold-the-line"), ctx([], { useId: "pull", targets: [adv("a")], situations: situations("hold-the-line", "pull") }))).toMatchObject({
      ok: false,
      reason: "requirement",
      detail: "effectActive",
    });
  });
});

describe("Lead by Example (CB p.342)", () => {
  it("after you damage an adversary, a Stress: the next PC to attack it can clear a Stress or gain a Hope", () => {
    const plan = ok("lead-by-example", ctx([], { trigger: { subject: adv("a") } }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Lead by Example" } });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", targetIds: ["a"] });
  });
});

describe("Unbreakable (CB p.342)", () => {
  it("on your last Hit Point: no death move, clear d6 Hit Points, then vault the card", () => {
    expect(cardUse("unbreakable").activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouMarkHp", last: true } });
    const plan = ok("unbreakable", ctx([4], { actor: actor({ hp: 6 }) }));
    expect(folds(plan)).toEqual([["negate", ["pc"], undefined]]);
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "pc", track: "hp", amount: 4 }]);
    expect(plan.actor.after.hp).toBe(2);
    expect(ofKind(plan, "toVault")).toEqual([{ kind: "toVault", permanent: false }]);
  });
});

describe("Unyielding Armor (CB p.342)", () => {
  it("Proficiency d6s: any 6 reduces the severity without marking an Armor Slot", () => {
    const plan = ok("unyielding-armor", ctx([6, 1]));
    expect(ofKind(plan, "check")[0]).toEqual({ kind: "check", total: 7, dice: [6, 1], passed: true });
    expect(folds(plan)).toEqual([["reduceSeverity", ["pc"], 1]]);
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual" });
  });
  it("no 6: nothing changes, the slot is marked as usual", () => {
    const plan = ok("unyielding-armor", ctx([5, 4]));
    expect(folds(plan)).toEqual([]);
    expect(ofKind(plan, "prompt")).toEqual([]);
  });
});
