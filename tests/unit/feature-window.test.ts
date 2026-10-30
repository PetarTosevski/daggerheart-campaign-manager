import { describe, expect, it } from "vitest";

import {
  afterHitFeatures,
  awaiting,
  featureAnswers,
  isComplete,
  openWindow,
  preRollFits,
  resolveWindow,
  respond,
  runReactionFeature,
  targetPrompt,
  type Fold,
  type HitChoice,
  type MarkFacts,
  type RespondResult,
  type WindowHit,
  type WindowPc,
  type WindowState,
} from "@/lib/domain/adversary-actions";
import type { ActorState } from "@/lib/domain/card-effects/run";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { featureEffect } from "@/lib/srd/feature-effects/index";
import { cardEffect } from "@/lib/srd/card-effects/index";
import { defaultPicks, featureChoice, type FeatureView } from "@/components/combat-map/actions/reactions/model";

// Plan sheet-drawer, tracer SD4: features in the adversary hit's reaction window (AA1's pure machine), the before-roll
// fit (Q2) and the after-hit feature uses. The entries are the FE-* tables' own; the expected numbers come from the books
// (printed pages: CB = Core Book, HF = Hope & Fear):
// - CB p.91 thresholds: Minor 1 HP, Major 2 HP, Severe 3 HP; CB p.114 one Armor Slot steps the severity down once.
// - CB p.107 "round up unless otherwise specified" (Q6): halving 15 incoming damage leaves 8.
// - CB p.107 "the player controlling the effects … can apply the effects in any order": Thick Skin after the slot.

function entry(id: string): FeatureEffect {
  const e = featureEffect(id);
  if (!e) throw new Error(`no entry ${id}`);
  return e;
}

const THRESHOLDS = { major: 8, severe: 15 };

function actor(id: string, over: Partial<ActorState> = {}): ActorState {
  return {
    id,
    side: "pc",
    evasion: 10,
    thresholds: THRESHOLDS,
    hp: 0,
    hpMax: 6,
    stress: 0,
    stressMax: 6,
    armor: 0,
    armorMax: 3,
    defeated: false,
    conditions: [],
    hope: 3,
    hopeMax: 6,
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    spellcast: 1,
    proficiency: 1,
    level: 1,
    tier: 1,
    loadoutDomains: [],
    vaultDomains: [],
    armorWorn: true,
    activeCardEffects: [],
    cardTokens: 0,
    featureUses: [],
    weapons: {},
    facts: { conditions: [], tags: [], flying: false, featureEffects: [] },
    ...over,
  };
}

/** A PC at the table holding `features` (ids from the FE-* tables). */
function pc(id: string, features: string[], over: Partial<ActorState> = {}, band?: WindowPc["bandToTarget"], toAttacker?: WindowPc["bandToAttacker"]): WindowPc {
  const a = actor(id, over);
  return {
    id,
    thresholds: THRESHOLDS,
    hp: a.hp,
    hpMax: a.hpMax,
    stress: a.stress,
    stressMax: a.stressMax,
    armor: a.armor,
    armorMax: a.armorMax,
    hope: a.hope,
    evasion: a.evasion ?? 10,
    featureUses: a.featureUses,
    cards: [],
    actor: a,
    features: features.map(entry),
    ...(band !== undefined ? { bandToTarget: band } : {}),
    ...(toAttacker !== undefined ? { bandToAttacker: toAttacker } : {}),
  };
}

const BANDIT: Combatant = { id: "bandit", side: "adversary", difficulty: 12, thresholds: { major: 5, severe: 10 }, hp: 0, hpMax: 5, stress: 0, stressMax: 3, defeated: false, conditions: [] };

const hit = (over: Partial<WindowHit> = {}): WindowHit => ({ amount: 10, type: "physical", direct: false, attackerId: "bandit", critical: false, ...over });

function ok(r: RespondResult): WindowState {
  if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
  return r.state;
}

/** Answers with a feature the way the server does: its folds from `runReactionFeature` on the window as it is now. */
function useFeature(w: WindowState, who: string, featureId: string, dice: number[] = [], extra: { useId?: string; options?: Record<string, string[]>; choices?: Record<string, number> } = {}): WindowState {
  const pcs = w.party ?? [];
  const me = pcs.find((p) => p.id === who)!;
  const target = pcs.find((p) => p.id === w.targetId)!;
  const amount = targetPrompt(w, target).damage;
  const ran = runReactionFeature(entry(featureId), me.actor!, w, { target: target.actor!, attacker: BANDIT }, queueRng(dice), { ...extra, amount });
  if (!ran.result.ok) throw new Error(`refused ${ran.result.reason}: ${ran.result.detail}`);
  const choice: HitChoice = { kind: "feature", featureId, ...(extra.useId ? { useId: extra.useId } : {}) };
  return ok(respond(w, { characterId: who, choice, folds: ran.folds }));
}

describe("feature answers in the reaction window", () => {
  it("Iron Will (CB p.36): one additional Armor Slot against physical damage, so a Severe hit steps down twice", () => {
    const mira = pc("mira", ["subclass:stalwart:iron-will"]);
    let w = openWindow({ hit: hit({ amount: 16 }), targetId: "mira", party: [mira], attacker: BANDIT });
    expect(w.responders).toEqual([{ characterId: "mira", role: "target", cardIds: [], featureIds: ["subclass:stalwart:iron-will"] }]);
    expect(targetPrompt(w, mira).maxSlots).toBe(1);
    w = useFeature(w, "mira", "subclass:stalwart:iron-will");
    expect(targetPrompt(w, mira).maxSlots).toBe(2);
    w = ok(respond(w, { characterId: "mira", choice: { kind: "armor", slots: 2 } }));
    expect(isComplete(w)).toBe(true);
    // 16 ≥ Severe 15 → Severe; two slots: Severe → Major → Minor: 1 HP.
    expect(resolveWindow(w, [mira]).result).toMatchObject({ severityBefore: "severe", armorSlots: 2, severity: "minor", hpMarked: 1 });
  });

  it("Iron Will is not offered on magic damage (\"When you take physical damage\")", () => {
    const mira = pc("mira", ["subclass:stalwart:iron-will"]);
    const w = openWindow({ hit: hit({ type: "magic" }), targetId: "mira", party: [mira], attacker: BANDIT });
    expect(w.responders[0]?.featureIds).toBeUndefined();
  });

  it("Increased Fortitude (CB p.55): 3 Hope halves 15 incoming physical damage to 8, rounded up (Q6, CB p.107)", () => {
    const dwarf = pc("dwarf", ["ancestry:dwarf:increased-fortitude"]);
    let w = openWindow({ hit: hit({ amount: 15 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    w = useFeature(w, "dwarf", "ancestry:dwarf:increased-fortitude");
    expect(targetPrompt(w, dwarf).damage).toBe(8);
    w = ok(respond(w, { characterId: "dwarf", choice: { kind: "noArmor" } }));
    // 8 ≥ Major 8 → Major: 2 HP (15 would have been Severe, 3 HP).
    expect(resolveWindow(w, [dwarf]).result).toMatchObject({ taken: 8, severity: "major", hpMarked: 2 });
  });

  it("Increased Fortitude needs 3 Hope: with 2 it is not offered", () => {
    const dwarf = pc("dwarf", ["ancestry:dwarf:increased-fortitude"], { hope: 2 });
    const w = openWindow({ hit: hit({ amount: 15 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    expect(w.responders[0]?.featureIds).toBeUndefined();
  });

  it("Thick Skin (CB p.55) after the Armor Slot made a Major hit Minor: 2 Stress instead of the Hit Point (CB p.107 order)", () => {
    const dwarf = pc("dwarf", ["ancestry:dwarf:thick-skin"]);
    let w = openWindow({ hit: hit({ amount: 10 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    // Major now; Thick Skin is listed because the slot can bring it down to Minor.
    expect(w.responders[0]?.featureIds).toEqual(["ancestry:dwarf:thick-skin"]);
    expect(featureAnswers(w, "dwarf")).toEqual([]);
    w = ok(respond(w, { characterId: "dwarf", choice: { kind: "armor", slots: 1 } }));
    expect(featureAnswers(w, "dwarf")).toEqual([{ featureId: "ancestry:dwarf:thick-skin", useId: "main" }]);
    expect(awaiting(w)).toEqual(["dwarf"]);
    w = useFeature(w, "dwarf", "ancestry:dwarf:thick-skin");
    expect(isComplete(w)).toBe(true);
    // Major → Minor (1 HP) → Thick Skin: 1 fewer → no HP.
    expect(resolveWindow(w, [dwarf]).result).toMatchObject({ armorSlots: 1, severity: "minor", hpMarked: 0 });
  });

  it("after the armor answer the target can say Done instead of Thick Skin", () => {
    const dwarf = pc("dwarf", ["ancestry:dwarf:thick-skin"]);
    let w = openWindow({ hit: hit({ amount: 10 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    w = ok(respond(w, { characterId: "dwarf", choice: { kind: "armor", slots: 1 } }));
    expect(respond(w, { characterId: "dwarf", choice: { kind: "armor", slots: 1 } }).ok).toBe(false);
    w = ok(respond(w, { characterId: "dwarf", choice: { kind: "pass" } }));
    expect(isComplete(w)).toBe(true);
    expect(resolveWindow(w, [dwarf]).result).toMatchObject({ severity: "minor", hpMarked: 1 });
  });

  it("Scales (CB p.54): on Severe damage, a Stress marks 1 fewer Hit Point", () => {
    const drakona = pc("d", ["ancestry:drakona:scales"]);
    let w = openWindow({ hit: hit({ amount: 20 }), targetId: "d", party: [drakona], attacker: BANDIT });
    w = useFeature(w, "d", "ancestry:drakona:scales");
    w = ok(respond(w, { characterId: "d", choice: { kind: "noArmor" } }));
    expect(resolveWindow(w, [drakona]).result).toMatchObject({ severity: "severe", hpMarked: 2 });
  });

  it("Dark Aegis (HF p.14): a Favor instead of marking Hit Points; with no Favor it is not offered", () => {
    const ID = "subclass:pact-of-the-endless:dark-aegis";
    expect(openWindow({ hit: hit({ amount: 20 }), targetId: "w", party: [pc("w", [ID], { favor: 0 })], attacker: BANDIT }).responders[0]?.featureIds).toBeUndefined();
    const warlock = pc("w", [ID], { favor: 1 });
    let w = openWindow({ hit: hit({ amount: 20 }), targetId: "w", party: [warlock], attacker: BANDIT });
    w = useFeature(w, "w", ID);
    w = ok(respond(w, { characterId: "w", choice: { kind: "noArmor" } }));
    // DA8 (user 2026-10-29): the damage is zero, so it has no severity and marks no Hit Points.
    expect(resolveWindow(w, [warlock])).toMatchObject({ negated: true, hpRidersIgnored: true, result: { taken: 0, severity: "none", hpMarked: 0 } });
  });

  it("Partners-in-Arms (CB p.36): an ally within Very Close marks an Armor Slot and the target's severity drops one threshold", () => {
    const ID = "subclass:stalwart:partners-in-arms";
    const mira = pc("mira", []);
    const near = pc("bram", [ID], {}, "veryClose");
    let w = openWindow({ hit: hit({ amount: 10 }), targetId: "mira", party: [mira, near], attacker: BANDIT });
    expect(w.responders.map((r) => [r.characterId, r.featureIds])).toEqual([
      ["mira", undefined],
      ["bram", [ID]],
    ]);
    w = useFeature(w, "bram", ID);
    w = ok(respond(w, { characterId: "mira", choice: { kind: "noArmor" } }));
    expect(resolveWindow(w, [mira, near]).result).toMatchObject({ severityBefore: "major", severity: "minor", hpMarked: 1 });
    const far = pc("bram", [ID], {}, "close");
    expect(openWindow({ hit: hit(), targetId: "mira", party: [mira, far], attacker: BANDIT }).responders.map((r) => r.characterId)).toEqual(["mira"]);
  });

  it("Loyal Protector (CB p.36): only for an ally with 2 or fewer Hit Points unmarked; the Guardian takes the hit", () => {
    const ID = "subclass:stalwart:loyal-protector";
    const healthy = pc("mira", [], { hp: 0, hpMax: 6 });
    const guard = pc("bram", [ID], {}, "close");
    expect(openWindow({ hit: hit(), targetId: "mira", party: [healthy, guard], attacker: BANDIT }).responders.map((r) => r.characterId)).toEqual(["mira"]);
    const hurt = pc("mira", [], { hp: 4, hpMax: 6 });
    let w = openWindow({ hit: hit(), targetId: "mira", party: [hurt, guard], attacker: BANDIT });
    w = useFeature(w, "bram", ID);
    expect(w.targetId).toBe("bram");
    w = ok(respond(w, { characterId: "bram", choice: { kind: "noArmor" } }));
    expect(resolveWindow(w, [hurt, guard])).toMatchObject({ targetId: "bram", result: { targetId: "bram", hpMarked: 2 } });
  });

  it("Wings (CB p.57): only while flying (Q16); +2 Evasion turns a hit the roll made by 1 into a miss", () => {
    const ID = "ancestry:faerie:wings";
    expect(openWindow({ hit: hit({ attackTotal: 11 }), targetId: "f", party: [pc("f", [ID])], attacker: BANDIT }).responders[0]?.featureIds).toBeUndefined();
    const faerie = pc("f", [ID], { facts: { conditions: [], tags: [], flying: true, featureEffects: [] } });
    let w = openWindow({ hit: hit({ attackTotal: 11 }), targetId: "f", party: [faerie], attacker: BANDIT });
    w = useFeature(w, "f", ID);
    w = ok(respond(w, { characterId: "f", choice: { kind: "noArmor" } }));
    // Evasion 10 + 2 = 12 > 11.
    expect(resolveWindow(w, [faerie])).toMatchObject({ missed: true, result: null });
  });

  it("Not This Time (CB p.50, Q3): offered to a wizard within Far of the attacker; the forced reroll stands (CB p.107)", () => {
    const ID = "hope:wizard";
    const mira = pc("mira", []);
    const wizard = pc("wiz", [ID], {}, "far", "far");
    let w = openWindow({ hit: hit({ attackTotal: 14 }), targetId: "mira", party: [mira, wizard], attacker: BANDIT });
    expect(w.responders.find((r) => r.characterId === "wiz")?.featureIds).toEqual([ID]);
    w = useFeature(w, "wiz", ID, [], { options: { reroll: ["attack"] } });
    const folds = w.responses.flatMap((r) => r.folds ?? []);
    expect(folds).toEqual([{ kind: "rerollAttack" }]);
    // The server rolls the reroll (`attackRoll`): 7 against Evasion 10 misses.
    const rolled: WindowState = { ...w, responses: w.responses.map((r) => (r.characterId === "wiz" ? { ...r, folds: [{ kind: "attackRoll", total: 7, critical: false } as Fold] } : r)) };
    const done = ok(respond(rolled, { characterId: "mira", choice: { kind: "noArmor" } }));
    expect(resolveWindow(done, [mira, wizard])).toMatchObject({ missed: true });
    const tooFar = pc("wiz", [ID], {}, "far", "veryFar");
    expect(openWindow({ hit: hit(), targetId: "mira", party: [mira, tooFar], attacker: BANDIT }).responders.map((r) => r.characterId)).toEqual(["mira"]);
  });

  it("Prayer Dice (CB p.44): spent dice reduce the incoming damage by their value", () => {
    const ID = "class:seraph:prayer-dice";
    const mira = pc("mira", []);
    const seraph = pc("s", [ID], { heldDice: [{ id: "p1", kind: "prayer", sides: 4, value: 3 }, { id: "p2", kind: "prayer", sides: 4, value: 4 }] }, "close");
    let w = openWindow({ hit: hit({ amount: 9 }), targetId: "mira", party: [mira, seraph], attacker: BANDIT });
    w = useFeature(w, "s", ID, [], { useId: "damage", choices: { dice: 2 } });
    expect(targetPrompt(w, mira).damage).toBe(2);
    expect(featureAnswers(w, "s")).toEqual([]);
  });
});

describe("before the roll (Q2)", () => {
  it("Harrowing Invocation (HF p.14): you or an ally within Very Close; Keen Defenses (HF p.11): you", () => {
    const harrowing = entry("subclass:pact-of-the-endless:harrowing-invocation").uses[0]!;
    const keen = entry("subclass:martial-artist:keen-defenses").uses[0]!;
    const trig = (u: typeof harrowing) => (u.activation.kind === "reaction" ? u.activation.trigger : (null as never));
    expect(preRollFits(trig(harrowing), "w", [{ id: "w" }])).toEqual(["w"]);
    expect(preRollFits(trig(harrowing), "w", [{ id: "mira", band: "veryClose" }])).toEqual(["mira"]);
    expect(preRollFits(trig(harrowing), "w", [{ id: "mira", band: "close" }])).toEqual([]);
    expect(preRollFits(trig(harrowing), "w", [{ id: "mira" }])).toEqual(["mira"]); // no map (Q18)
    expect(preRollFits(trig(keen), "m", [{ id: "m" }])).toEqual(["m"]);
    expect(preRollFits(trig(keen), "m", [{ id: "mira", band: "melee" }])).toEqual([]);
  });

  it("an after-roll answer is not a before-roll one: Wings never fits `targeted`", () => {
    const wings = entry("ancestry:faerie:wings").uses[0]!;
    expect(preRollFits(wings.activation.kind === "reaction" ? wings.activation.trigger : (null as never), "f", [{ id: "f" }])).toEqual([]);
  });
});

describe("after the hit", () => {
  const facts = (over: Partial<MarkFacts> = {}): MarkFacts => ({ hpMarked: 3, deathMove: false, armorSlots: 0, fromAttack: true, severity: "severe", stressMarked: 0, damageType: "physical", ...over });

  it("Not Done Yet (HF p.10) is offered on Severe damage only", () => {
    const ID = "subclass:juggernaut:not-done-yet";
    const j = pc("j", [ID]);
    expect(afterHitFeatures(j, facts(), { subject: j.actor!, source: BANDIT, taken: 16 }).offers).toEqual([ID]);
    expect(afterHitFeatures(j, facts({ severity: "major", hpMarked: 2 }), { subject: j.actor!, source: BANDIT, taken: 9 }).offers).toEqual([]);
  });

  it("Eye for an Eye (HF p.10): only for an adversary within Melee range, and with a Stress to mark", () => {
    const ID = "subclass:juggernaut:eye-for-an-eye";
    expect(afterHitFeatures(pc("j", [ID], {}, undefined, "melee"), facts(), { source: BANDIT, taken: 16 }).offers).toEqual([ID]);
    expect(afterHitFeatures(pc("j", [ID], {}, undefined, "close"), facts(), { source: BANDIT, taken: 16 }).offers).toEqual([]);
    expect(afterHitFeatures(pc("j", [ID], { stress: 6 }, undefined, "melee"), facts(), { source: BANDIT, taken: 16 }).offers).toEqual([]);
  });

  it("Deadly Vengeance (HF p.15) is offered when the attack marked Hit Points and a Favor is held", () => {
    const ID = "subclass:pact-of-the-wrathful:deadly-vengeance";
    expect(afterHitFeatures(pc("w", [ID], { favor: 1 }), facts({ hpMarked: 2 }), { source: BANDIT, taken: 9 }).offers).toEqual([ID]);
    expect(afterHitFeatures(pc("w", [ID], { favor: 0 }), facts({ hpMarked: 2 }), { source: BANDIT, taken: 9 }).offers).toEqual([]);
    expect(afterHitFeatures(pc("w", [ID], { favor: 1 }), facts({ hpMarked: 0, severity: "none" }), { source: BANDIT, taken: 0 }).offers).toEqual([]);
  });

  it("Unshakable (CB p.59) runs by itself when the hit made them mark a Stress; Brave Face (HF p.32) is offered", () => {
    const firbolg = pc("f", ["ancestry:firbolg:unshakable"]);
    expect(afterHitFeatures(firbolg, facts({ stressMarked: 1 }), { taken: 16 }).auto).toEqual([{ featureId: "ancestry:firbolg:unshakable", useId: "main" }]);
    expect(afterHitFeatures(firbolg, facts({ stressMarked: 0 }), { taken: 16 }).auto).toEqual([]);
    const warborne = pc("b", ["community:warborne:brave-face"]);
    expect(afterHitFeatures(warborne, facts({ stressMarked: 1 }), { taken: 16 }).offers).toEqual(["community:warborne:brave-face"]);
  });

  it("Elemental Incarnation Fire (CB p.30) runs only while Channeling Fire", () => {
    const ID = "subclass:warden-of-the-elements:elemental-incarnation";
    const channeling = pc("d", [ID], { facts: { conditions: [], tags: [], flying: false, featureEffects: [{ featureId: ID, option: "fire" }] } }, undefined, "melee");
    expect(afterHitFeatures(channeling, facts({ hpMarked: 2 }), { source: BANDIT, taken: 9 }).auto).toEqual([{ featureId: ID, useId: "fire" }]);
    const water = pc("d", [ID], { facts: { conditions: [], tags: [], flying: false, featureEffects: [{ featureId: ID, option: "water" }] } }, undefined, "melee");
    expect(afterHitFeatures(water, facts({ hpMarked: 2 }), { source: BANDIT, taken: 9 }).auto).toEqual([]);
  });
});

// Plan drawer-answers, tracer DA8 (the user's answers of 2026-10-29 / 2026-10-30; printed pages):
// - CB p.107 "SIMULTANEOUS AND STACKING EFFECTS": "the player controlling the effects ... can apply the effects in any
//   order." After the Armor Slot answer every ready reaction that still fits the hit stays offered (dcm-bxp.99.19.50 (3)).
// - CB p.114: "Each time your character takes damage, you can only mark 1 Armor Slot."
// - Stable (HF p.12): "spend a Focus instead of an Armor Slot to reduce damage" (dcm-bxp.99.19.9).
// - Celestial Wings (HF p.19): "Once per scene while flying, you can spend a Hope instead of marking an Armor Slot."
//   (dcm-bxp.99.19.30; user 2026-10-30: Wings OR a real Armor Slot on a hit, never both).
// - Dark Aegis (HF p.14): "spend a Favor instead of marking Hit Points" (dcm-bxp.99.19.13: zero damage, no severity).
describe("DA8: every ready reaction after armor, in the player's order", () => {
  const FORTITUDE = "ancestry:dwarf:increased-fortitude";
  const IRON_WILL = "subclass:stalwart:iron-will";

  it("after the Armor Slot a dwarf still gets Increased Fortitude (not only severity-gated answers)", () => {
    const dwarf = pc("dwarf", [FORTITUDE, IRON_WILL]);
    let w = openWindow({ hit: hit({ amount: 15 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    w = ok(respond(w, { characterId: "dwarf", choice: { kind: "armor", slots: 1 } }));
    // Iron Will's extra slot is moot once the armor answer is in; Increased Fortitude still fits.
    expect(featureAnswers(w, "dwarf")).toEqual([{ featureId: FORTITUDE, useId: "main" }]);
    expect(awaiting(w)).toEqual(["dwarf"]);
    w = useFeature(w, "dwarf", FORTITUDE);
    expect(isComplete(w)).toBe(true);
    // 15 halved (rounded up) = 8 ≥ Major 8 → Major; the slot: Minor, 1 HP.
    expect(resolveWindow(w, [dwarf]).result).toMatchObject({ taken: 8, severityBefore: "major", armorSlots: 1, severity: "minor", hpMarked: 1 });
  });

  it("the same answers in the other order give the same hit; Don't mark ends the turn (every answer was offered with it)", () => {
    const dwarf = pc("dwarf", [FORTITUDE]);
    let w = openWindow({ hit: hit({ amount: 15 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    w = useFeature(w, "dwarf", FORTITUDE);
    w = ok(respond(w, { characterId: "dwarf", choice: { kind: "armor", slots: 1 } }));
    expect(resolveWindow(w, [dwarf]).result).toMatchObject({ taken: 8, armorSlots: 1, severity: "minor", hpMarked: 1 });
    let done = openWindow({ hit: hit({ amount: 15 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    expect(featureAnswers(done, "dwarf")).toEqual([{ featureId: FORTITUDE, useId: "main" }]);
    done = ok(respond(done, { characterId: "dwarf", choice: { kind: "noArmor" } }));
    expect(isComplete(done)).toBe(true);
    // Done after the slot with Increased Fortitude still offered.
    let slot = openWindow({ hit: hit({ amount: 15 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    slot = ok(respond(slot, { characterId: "dwarf", choice: { kind: "armor", slots: 1 } }));
    expect(awaiting(slot)).toEqual(["dwarf"]);
    slot = ok(respond(slot, { characterId: "dwarf", choice: { kind: "pass" } }));
    expect(isComplete(slot)).toBe(true);
    expect(resolveWindow(slot, [dwarf]).result).toMatchObject({ taken: 15, severity: "major", hpMarked: 2 });
    expect(resolveWindow(done, [dwarf]).result).toMatchObject({ taken: 15, severity: "severe", hpMarked: 3 });
  });

  it("halving answer and resistance both apply: the reaction first, then resistance, each rounding up (dcm-bxp.99.19.47 (2), Q6)", () => {
    const dwarf = { ...pc("dwarf", [FORTITUDE]), resistance: { physical: "resistant" as const, magic: "none" as const } };
    let w = openWindow({ hit: hit({ amount: 15 }), targetId: "dwarf", party: [dwarf], attacker: BANDIT });
    w = useFeature(w, "dwarf", FORTITUDE);
    w = ok(respond(w, { characterId: "dwarf", choice: { kind: "noArmor" } }));
    // 15 → 8 (Increased Fortitude, rounded up) → 4 (resistance, rounded up): Minor, 1 HP.
    expect(resolveWindow(w, [dwarf]).result).toMatchObject({ incoming: 8, resisted: "resistant", taken: 4, severity: "minor", hpMarked: 1 });
  });

  it("one answer per ally per hit, card or feature (dcm-bxp.99.19.48 (4))", () => {
    const shield = cardEffect("i-am-your-shield");
    if (!shield) throw new Error("no I Am Your Shield entry");
    const mira = pc("mira", []);
    const guard: WindowPc = { ...pc("bram", ["subclass:stalwart:partners-in-arms"], {}, "veryClose"), cards: [shield] };
    let w = openWindow({ hit: hit({ amount: 10 }), targetId: "mira", party: [mira, guard], attacker: BANDIT });
    expect(w.responders.find((r) => r.characterId === "bram")).toMatchObject({ cardIds: ["i-am-your-shield"], featureIds: ["subclass:stalwart:partners-in-arms"] });
    w = useFeature(w, "bram", "subclass:stalwart:partners-in-arms");
    expect(featureAnswers(w, "bram")).toEqual([]);
    expect(respond(w, { characterId: "bram", choice: { kind: "card", cardId: "i-am-your-shield" } })).toMatchObject({ ok: false, code: "NOT_A_RESPONDER" });
  });
});

describe("DA8: Stable and Celestial Wings stand for the hit's one Armor Slot", () => {
  const STABLE = "stance:martial-artist:stable";
  const WINGS = "ancestry:aetheris:celestial-wings";
  const stanceFacts = { conditions: [], tags: [], flying: false, featureEffects: [], activeStance: "stable" };

  it("Stable without armor: a Focus lowers Major to Minor, no Armor Slot marked, and it is the armor answer", () => {
    const monk = pc("m", [STABLE], { focus: 1, armorMax: 0, facts: stanceFacts });
    let w = openWindow({ hit: hit({ amount: 10 }), targetId: "m", party: [monk], attacker: BANDIT });
    expect(w.responders).toEqual([{ characterId: "m", role: "target", cardIds: [], featureIds: [STABLE] }]);
    w = useFeature(w, "m", STABLE);
    expect(isComplete(w)).toBe(true);
    expect(resolveWindow(w, [monk]).result).toMatchObject({ severityBefore: "major", armorSlots: 0, severity: "minor", hpMarked: 1, after: { armor: 0 } });
    expect(openWindow({ hit: hit({ amount: 10 }), targetId: "m", party: [pc("m", [STABLE], { focus: 0, armorMax: 0, facts: stanceFacts })], attacker: BANDIT }).responders).toEqual([]);
  });

  it("Stable OR the Armor Slot, never both: one step in total", () => {
    const monk = pc("m", [STABLE], { focus: 2, facts: stanceFacts });
    let slot = openWindow({ hit: hit({ amount: 20 }), targetId: "m", party: [monk], attacker: BANDIT });
    expect(featureAnswers(slot, "m")).toEqual([{ featureId: STABLE, useId: "main" }]);
    slot = ok(respond(slot, { characterId: "m", choice: { kind: "armor", slots: 1 } }));
    expect(featureAnswers(slot, "m")).toEqual([]);
    expect(isComplete(slot)).toBe(true);
    let focus = openWindow({ hit: hit({ amount: 20 }), targetId: "m", party: [monk], attacker: BANDIT });
    focus = useFeature(focus, "m", STABLE);
    // The Focus was the armor answer: nothing else fits, so the window is done and no slot can follow.
    expect(isComplete(focus)).toBe(true);
    expect(respond(focus, { characterId: "m", choice: { kind: "armor", slots: 1 } }).ok).toBe(false);
    expect(respond(focus, { characterId: "m", choice: { kind: "armor", slots: 1 } }, { replay: true })).toMatchObject({ ok: false, code: "NOT_A_RESPONDER" });
    // Severe → Major (one step), the slot stays clear.
    expect(resolveWindow(focus, [monk]).result).toMatchObject({ severity: "major", armorSlots: 0, hpMarked: 2, after: { armor: 0 } });
    // Two substitutes still make one step.
    const twice: WindowState = { ...focus, responses: [...focus.responses, { characterId: "m", choice: { kind: "feature", featureId: "x" }, folds: [{ kind: "reduceSeverity", steps: 1, targetIds: ["m"], insteadOfArmorSlot: true }] }] };
    expect(resolveWindow(twice, [monk]).result).toMatchObject({ severity: "major" });
  });

  it("Celestial Wings while flying, every slot marked: a Hope lowers Severe to Major, once; after a real slot it is not offered", () => {
    const flying = { conditions: [], tags: [], flying: true, featureEffects: [] };
    const full = pc("a", [WINGS], { armor: 3, armorMax: 3, hope: 2, facts: flying });
    let w = openWindow({ hit: hit({ amount: 20 }), targetId: "a", party: [full], attacker: BANDIT });
    expect(featureAnswers(w, "a")).toEqual([{ featureId: WINGS, useId: "main" }]);
    w = useFeature(w, "a", WINGS);
    expect(isComplete(w)).toBe(true);
    expect(resolveWindow(w, [full]).result).toMatchObject({ severity: "major", hpMarked: 2, armorSlots: 0 });
    expect(openWindow({ hit: hit({ amount: 20 }), targetId: "a", party: [pc("a", [WINGS], { armor: 3, armorMax: 3, facts: { ...flying, flying: false } })], attacker: BANDIT }).responders).toEqual([]);
    const armored = pc("a", [WINGS], { facts: flying });
    let slot = openWindow({ hit: hit({ amount: 20 }), targetId: "a", party: [armored], attacker: BANDIT });
    slot = ok(respond(slot, { characterId: "a", choice: { kind: "armor", slots: 1 } }));
    expect(featureAnswers(slot, "a")).toEqual([]);
  });

  it("a slot substitute is not offered on direct damage (CB p.99: Armor Slots can't reduce it; QUESTIONS in TASK-DA-DA8)", () => {
    const monk = pc("m", [STABLE], { focus: 1, facts: stanceFacts });
    const w = openWindow({ hit: hit({ amount: 10, direct: true }), targetId: "m", party: [monk], attacker: BANDIT });
    expect(featureAnswers(w, "m")).toEqual([]);
  });
});

describe("DA8: Dark Aegis cancels the damage to zero", () => {
  const AEGIS = "subclass:pact-of-the-endless:dark-aegis";

  it("after an Armor Slot: no slot marked, no severity, no HP; on-hit HP ignored", () => {
    const warlock = pc("w", [AEGIS], { favor: 1 });
    let w = openWindow({ hit: hit({ amount: 20 }), targetId: "w", party: [warlock], attacker: BANDIT });
    w = ok(respond(w, { characterId: "w", choice: { kind: "armor", slots: 1 } }));
    expect(featureAnswers(w, "w")).toEqual([{ featureId: AEGIS, useId: "main" }]);
    w = useFeature(w, "w", AEGIS);
    expect(isComplete(w)).toBe(true);
    expect(resolveWindow(w, [warlock])).toMatchObject({ negated: true, hpRidersIgnored: true, result: { severity: "none", armorSlots: 0, hpMarked: 0, after: { armor: 0 } } });
  });

  it("before the armor answer: nothing left for an Armor Slot to reduce", () => {
    const warlock = pc("w", [AEGIS], { favor: 1 });
    let w = openWindow({ hit: hit({ amount: 20 }), targetId: "w", party: [warlock], attacker: BANDIT });
    w = useFeature(w, "w", AEGIS);
    expect(targetPrompt(w, warlock)).toEqual({ damage: 0, severity: "none", maxSlots: 0 });
  });

  it("zero damage is no longer damage they 'would take': Damage Sink isn't offered after it (CB p.91)", () => {
    const SINK = "subclass:pact-of-the-endless:damage-sink";
    const warlock = pc("w", [AEGIS, SINK], { favor: 2 });
    let w = openWindow({ hit: hit({ amount: 20 }), targetId: "w", party: [warlock], attacker: BANDIT });
    expect(featureAnswers(w, "w").map((f) => f.featureId)).toEqual([AEGIS, SINK]);
    w = ok(respond(w, { characterId: "w", choice: { kind: "armor", slots: 1 } }));
    w = useFeature(w, "w", AEGIS);
    expect(featureAnswers(w, "w")).toEqual([]);
    expect(isComplete(w)).toBe(true);
  });
});

describe("DA8: Draining Bane's 'Clear a Stress' is ticked by default (dcm-bxp.99.19.15)", () => {
  const view: FeatureView = {
    featureId: "subclass:pact-of-the-endless:draining-bane",
    useId: "main",
    name: "Draining Bane",
    text: "",
    numbers: [],
    options: [],
    optionals: [{ id: "clear-stress", label: "Clear a Stress", defaultOn: true }],
    situations: [],
  };

  it("the prompt's default ticks it; unticking sends it off", () => {
    const picks = defaultPicks(view);
    expect(picks.optionals).toEqual({ "clear-stress": true });
    expect(featureChoice(view, picks)).toMatchObject({ choices: [{ id: "optional:clear-stress", value: true }] });
    expect(featureChoice(view, { ...picks, optionals: { "clear-stress": false } })).toMatchObject({ choices: [{ id: "optional:clear-stress", value: false }] });
    expect(defaultPicks({ ...view, optionals: [{ id: "x", label: "X" }] }).optionals).toEqual({});
  });
});

describe("DA8 pin: Elemental Dominion Fire's +1 Proficiency is for damage only (dcm-bxp.99.19.50 (2), CB p.30)", () => {
  it("a passive Proficiency +1 while Channeling Fire, nothing else (Proficiency counts damage dice)", () => {
    const fire = entry("subclass:warden-of-the-elements:elemental-dominion").uses.find((u) => u.id === "fire")!;
    expect(fire.activation).toEqual({ kind: "passive" });
    expect(fire.mods).toEqual([{ kind: "stat", stat: "proficiency", delta: { kind: "fixed", value: 1 } }]);
    expect(fire.steps).toEqual([]);
  });
});
