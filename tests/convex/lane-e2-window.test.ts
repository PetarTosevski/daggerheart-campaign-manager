/**
 * Plan lanes, tracer E2 (docs/tasks/TASK-LN-E2.md): the reaction window's pure pieces with fixture entries (the SRD
 * entries switch to the new vocabulary in wave 5). Printed pages: CB = Core Book, HF = Hope & Fear.
 *
 * - dcm-s77: dearer Armor Slots (Armor Eater, HF p.71: "that PC must mark an additional Armor Slot to reduce the severity
 *   of the damage"; Boiling Blast, CB p.236: "If a target marks an Armor Slot to reduce the damage, they must also mark a
 *   Stress").
 * - dcm-98d: "when you would mark an Armor Slot" (Unyielding Armor, CB p.342: "roll a number of d6s equal to your
 *   Proficiency. If any roll a 6, reduce the severity by one threshold without marking an Armor Slot").
 * - dcm-sim: Shield Aura (CB p.341): "If this spell causes a creature who would be damaged to instead mark no Hit
 *   Points, the effect ends."
 * - dcm-nt4: resistance by the attacker's position (CB p.99 halving).
 *
 * Thresholds 8 / 15 (CB p.91: Minor 1 HP, Major 2 HP, Severe 3 HP; CB p.114: one Armor Slot steps it down once).
 */
import { describe, expect, it } from "vitest";

import { hitArmorCost, resistanceHolds } from "../../convex/lib/adversaryHits";
import { attackSucceeded, endedOnNoHp } from "../../convex/lib/incomingHits";
import {
  applyHitToPc,
  armorOptions,
  armorPreview,
  armorSlotAutos,
  cardAnswers,
  openWindow,
  resolveWindow,
  respond,
  runReactionCard,
  targetArmorPreview,
  targetPrompt,
  type RespondResult,
  type WindowHit,
  type WindowPc,
  type WindowState,
} from "../../src/lib/domain/adversary-actions/index";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import type { ActorState } from "../../src/lib/domain/card-effects/run";
import type { CardEffect } from "../../src/lib/domain/card-effects/types";
import { queueRng } from "../../src/lib/domain/dice/index";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { armorCounts, armorQuestion, promptMode, type HitView } from "../../src/components/combat-map/actions/reactions/model";

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
    proficiency: 2,
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

function pc(id: string, cards: CardEffect[], over: Partial<ActorState> = {}): WindowPc {
  const a = actor(id, over);
  return { id, thresholds: THRESHOLDS, hp: a.hp, hpMax: a.hpMax, stress: a.stress, stressMax: a.stressMax, armor: a.armor, armorMax: a.armorMax, hope: a.hope, evasion: 10, featureUses: [], cards, actor: a, features: [] };
}

const hit = (amount: number, over: Partial<WindowHit> = {}): WindowHit => ({ amount, type: "physical", direct: false, attackerId: "bandit", critical: false, ...over });

function ok(r: RespondResult): WindowState {
  if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
  return r.state;
}

const defense = (over: Partial<WindowPc> = {}) => ({ id: "mira", thresholds: THRESHOLDS, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, armorMax: 3, hope: 3, ...over });

// ---------------------------------------------------------------- dcm-s77

describe("E2 dcm-s77: dearer Armor Slots", () => {
  const eater = { slotsPerStep: 2 };

  it("Armor Eater: one step costs 2 slots; one slot buys nothing and isn't marked", () => {
    const pcNow = defense();
    expect(armorOptions(pcNow, { ...hit(10), armorCost: eater })).toMatchObject({ canUseArmor: true, maxSlots: 2 });
    expect(armorPreview(pcNow, { ...hit(10), armorCost: eater })).toEqual([
      { slots: 0, severity: "major", hp: 2 },
      { slots: 2, severity: "minor", hp: 1 },
    ]);
    const two = applyHitToPc(pcNow, { ...hit(10), armorCost: eater }, { armorSlots: 2 });
    expect(two).toMatchObject({ severity: "minor", hpMarked: 1, armorSlots: 2 });
    expect(two.after.armor).toBe(2);
    const one = applyHitToPc(pcNow, { ...hit(10), armorCost: eater }, { armorSlots: 1 });
    expect(one).toMatchObject({ severity: "major", hpMarked: 2, armorSlots: 0 });
    expect(one.after.armor).toBe(0);
  });

  it("with one free slot the dearer step can't be bought; without a cost one slot is one step (CB p.114)", () => {
    expect(armorOptions(defense({ armor: 2 }), { ...hit(10), armorCost: eater })).toMatchObject({ canUseArmor: false, maxSlots: 0 });
    expect(armorOptions(defense({ armor: 2 }), hit(10))).toMatchObject({ canUseArmor: true, maxSlots: 1 });
  });

  it("an extra slot allowance (Iron Will, I Am Your Shield) is counted in whole dearer steps", () => {
    expect(armorOptions(defense({ armorMax: 5 }), { ...hit(20), armorCost: eater }, 1)).toMatchObject({ maxSlots: 4 });
    expect(armorOptions(defense({ armorMax: 5 }), { ...hit(20), armorCost: eater }, "any")).toMatchObject({ maxSlots: 4 });
  });

  it("Boiling Blast: a Stress for each slot used, past a full track 1 HP (CB p.92)", () => {
    const blast = { ...hit(10), armorCost: { alsoMark: { track: "stress" as const, amount: 1 } } };
    expect(applyHitToPc(defense(), blast, { armorSlots: 1 })).toMatchObject({ severity: "minor", hpMarked: 1, stressMarked: 1 });
    expect(applyHitToPc(defense(), blast, { armorSlots: 0 })).toMatchObject({ severity: "major", hpMarked: 2, stressMarked: 0 });
    const full = applyHitToPc(defense({ stress: 6 }), blast, { armorSlots: 1 });
    expect(full).toMatchObject({ hpMarked: 2, stressMarked: 0, overflow: true });
  });

  it("the window: the preview lists whole steps, the prompt asks for 2, a single slot answer buys nothing", () => {
    const party = [pc("mira", [])];
    let w = openWindow({ hit: { ...hit(10), armorCost: eater }, targetId: "mira", party });
    expect(targetPrompt(w, party[0]!)).toMatchObject({ maxSlots: 2, severity: "major" });
    const preview = targetArmorPreview(w, party[0]!);
    expect(preview).toEqual([
      { slots: 0, severity: "major", hp: 2 },
      { slots: 2, severity: "minor", hp: 1 },
    ]);
    const view = { awaiting: true, role: "target", maxSlots: 2, armorPreview: preview, damage: 10, severity: "major" } as unknown as HitView;
    expect(promptMode(view)).toBe("armorMany");
    expect(armorCounts(view)).toEqual([2]);
    expect(armorQuestion(view)).toBe("Mark 2 Armor Slots to make it Minor?");
    w = ok(respond(w, { characterId: "mira", choice: { kind: "armor", slots: 2 } }));
    expect(resolveWindow(w, party).result).toMatchObject({ severity: "minor", hpMarked: 1, armorSlots: 2 });
  });

  it("hitArmorCost reads the attacking feature's step and 'successful attack' autos (fixture entries)", () => {
    const entries: AdversaryFeatureEffect[] = [
      {
        adversaryId: "pangolati",
        feature: "Armor Eater",
        uses: [{ id: "main", activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } }, needsSpotlight: false, steps: [{ kind: "armorCost", to: "targets", slotsPerStep: 2 }] }],
      },
      {
        adversaryId: "pangolati",
        feature: "Boiling Blast",
        uses: [{ id: "main", activation: { kind: "action" }, needsSpotlight: true, steps: [{ kind: "armorCost", to: "targets", alsoMark: { track: "stress", amount: 1 } }] }],
      },
      {
        adversaryId: "pangolati",
        feature: "Picky",
        uses: [{ id: "main", activation: { kind: "auto", trigger: { kind: "onHit", targetHas: { kind: "standard", condition: "vulnerable" } } }, needsSpotlight: false, steps: [{ kind: "armorCost", to: "targets", slotsPerStep: 3 }] }],
      },
    ];
    expect(hitArmorCost(entries, undefined)).toEqual({ slotsPerStep: 2 });
    expect(hitArmorCost(entries, "Boiling Blast")).toEqual({ slotsPerStep: 2, alsoMark: { track: "stress", amount: 1 } });
    expect(hitArmorCost(entries.slice(1), undefined)).toBeUndefined();
    const standardOnly: AdversaryFeatureEffect[] = [{ ...entries[0]!, uses: [{ ...entries[0]!.uses[0]!, activation: { kind: "auto", trigger: { kind: "onHit", attack: "standard" } } }] }];
    expect(hitArmorCost(standardOnly, undefined)).toEqual({ slotsPerStep: 2 });
    expect(hitArmorCost(standardOnly, "Boiling Blast")).toBeUndefined();
  });
});

// ---------------------------------------------------------------- dcm-98d

/** Unyielding Armor as wave 5 would write it: "would mark an Armor Slot", Proficiency d6s, a 6 is the slot's step. */
const UNYIELDING: CardEffect = {
  cardId: "fixture-unyielding",
  uses: [
    {
      id: "main",
      name: "Unyielding Armor",
      activation: { kind: "reaction", trigger: { kind: "whenArmorSlotMarked", who: "self", stage: "would" } },
      steps: [
        {
          kind: "check",
          dice: { count: { kind: "proficiency" }, sides: 6 },
          test: { kind: "anyAtLeast", value: 6 },
          then: [{ kind: "reduceSeverity", to: "self", steps: 1, insteadOfArmorSlot: true }],
          otherwise: [],
        },
      ],
    },
  ],
};

describe("E2 dcm-98d: 'when you would mark an Armor Slot' (Unyielding Armor)", () => {
  const party = () => [pc("mira", [UNYIELDING])];
  const target = () => ({ target: actor("mira") });

  it("is offered before the armor answer and not after it", () => {
    const w = openWindow({ hit: hit(10), targetId: "mira", party: party() });
    expect(cardAnswers(w, "mira")).toEqual(["fixture-unyielding"]);
    const marked = ok(respond(w, { characterId: "mira", choice: { kind: "armor" } }));
    expect(cardAnswers(marked, "mira")).toEqual([]);
  });

  it("a 6 among the Proficiency d6s lowers the severity without an Armor Slot; the armor answer is in", () => {
    const w = openWindow({ hit: hit(10), targetId: "mira", party: party() });
    const run = runReactionCard(UNYIELDING, actor("mira"), w, target(), queueRng([3, 6]));
    expect(run.folds).toEqual([{ kind: "reduceSeverity", steps: 1, targetIds: ["mira"], insteadOfArmorSlot: true }]);
    const after = ok(respond(w, { characterId: "mira", choice: { kind: "card", cardId: "fixture-unyielding" }, folds: run.folds }));
    const res = resolveWindow(after, party());
    expect(res.result).toMatchObject({ severity: "minor", hpMarked: 1, armorSlots: 0 });
    expect(res.result?.after.armor).toBe(0);
    expect(respond(after, { characterId: "mira", choice: { kind: "armor" } }).ok).toBe(false);
  });

  it("no 6: nothing changes and the slot is still asked for", () => {
    const w = openWindow({ hit: hit(10), targetId: "mira", party: party() });
    const run = runReactionCard(UNYIELDING, actor("mira"), w, target(), queueRng([3, 5]));
    expect(run.folds).toEqual([]);
    let after = ok(respond(w, { characterId: "mira", choice: { kind: "card", cardId: "fixture-unyielding" }, folds: run.folds }));
    after = ok(respond(after, { characterId: "mira", choice: { kind: "armor" } }));
    expect(resolveWindow(after, party()).result).toMatchObject({ severity: "minor", hpMarked: 1, armorSlots: 1 });
  });
});

// ---------------------------------------------------------------- dcm-sim

const AURA_TAG = { kind: "tag", tag: "Shield Aura" } as const;

/** Shield Aura as wave 5 would write it: the tag ends on `reducedToNoHp`; the holder's auto use on an ally's slot. */
const SHIELD_AURA: CardEffect = {
  cardId: "fixture-shield-aura",
  uses: [
    {
      id: "main",
      name: "Shield Aura",
      activation: { kind: "action" },
      targets: { side: "selfOrAlly", range: "veryClose", count: { kind: "one" } },
      steps: [{ kind: "condition", to: "targets", condition: AURA_TAG, duration: "manual", endsOn: ["reducedToNoHp"] }],
    },
    {
      id: "aura-ally",
      name: "Shield Aura: an ally marks an Armor Slot",
      activation: { kind: "auto", trigger: { kind: "whenArmorSlotMarked", who: "ally" } },
      targets: { side: "trigger", who: "subject" },
      steps: [{ kind: "reduceSeverity", to: "triggerSubject", when: [{ kind: "targetHas", condition: AURA_TAG }], steps: 1 }],
    },
  ],
};

describe("E2 dcm-sim: Shield Aura's extra step and its end at no Hit Points", () => {
  const party = (tags: string[] = ["Shield Aura"]) => [pc("mira", [], { tags }), pc("bram", [SHIELD_AURA])];

  it("a marked slot sets off the holder's aura: Major → Minor (slot) → none (aura); the aura made it 0 HP and ends", () => {
    const p = party();
    let w = openWindow({ hit: hit(10), targetId: "mira", party: p });
    expect(targetArmorPreview(w, p[0]!)).toEqual([
      { slots: 0, severity: "major", hp: 2 },
      { slots: 1, severity: "none", hp: 0 },
    ]);
    w = ok(respond(w, { characterId: "mira", choice: { kind: "armor" } }));
    expect(armorSlotAutos(w).map((a) => [a.characterId, a.cardId])).toEqual([["bram", "fixture-shield-aura"]]);
    const res = resolveWindow(w, p);
    expect(res.result).toMatchObject({ severity: "none", hpMarked: 0, armorSlots: 1 });
    expect(res.endedOnNoHp).toEqual([{ bearerId: "mira", ownerId: "bram", cardId: "fixture-shield-aura", ends: AURA_TAG }]);
  });

  it("Severe: the aura's step still leaves 1 HP, so it stays; a Minor hit the slot alone stops doesn't end it", () => {
    const p = party();
    const severe = ok(respond(openWindow({ hit: hit(16), targetId: "mira", party: p }), { characterId: "mira", choice: { kind: "armor" } }));
    expect(resolveWindow(severe, p)).toMatchObject({ result: { severity: "minor", hpMarked: 1 }, endedOnNoHp: [] });
    const minor = ok(respond(openWindow({ hit: hit(4), targetId: "mira", party: p }), { characterId: "mira", choice: { kind: "armor" } }));
    expect(resolveWindow(minor, p)).toMatchObject({ result: { severity: "none", hpMarked: 0 }, endedOnNoHp: [] });
  });

  it("no aura tag on the target, or no slot marked: nothing extra", () => {
    const bare = party([]);
    const w = ok(respond(openWindow({ hit: hit(10), targetId: "mira", party: bare }), { characterId: "mira", choice: { kind: "armor" } }));
    expect(resolveWindow(w, bare)).toMatchObject({ result: { severity: "minor", hpMarked: 1 }, endedOnNoHp: [] });
    const p = party();
    const none = ok(respond(openWindow({ hit: hit(10), targetId: "mira", party: p }), { characterId: "mira", choice: { kind: "noArmor" } }));
    expect(armorSlotAutos(none)).toEqual([]);
  });

  it("endedOnNoHp takes the card's tag effect off the bearer's sheet", () => {
    const sheet = { conditions: ["vulnerable"], effects: [{ id: "card:fixture-shield-aura:1", source: "Shield Aura", text: "Shield Aura; ends when …", until: "manual" }, { id: "card:other:1", source: "Other", text: "Shield Aura", until: "manual" }] } as unknown as CharacterSheet;
    const out = endedOnNoHp(sheet, [{ bearerId: "mira", ownerId: "bram", cardId: "fixture-shield-aura", ends: AURA_TAG }]);
    expect(out.names).toEqual(["Shield Aura"]);
    expect(out.sheet.effects.map((e) => e.id)).toEqual(["card:other:1"]);
    expect(endedOnNoHp(sheet, [{ bearerId: "mira", ownerId: "bram", cardId: "x", ends: { kind: "standard", condition: "vulnerable" } }]).sheet.conditions).toEqual([]);
  });
});

// ---------------------------------------------------------------- dcm-nt4, dcm-fyb (pure parts)

describe("E2 dcm-nt4: resistance by where the attack comes from", () => {
  it("from melee / beyond melee reads the attacker's band; unknown is any (Q18); outside the area holds; a keyword needs one", () => {
    const melee = { kind: "resistance", type: "physical", level: "resistant", from: "melee" } as const;
    const beyond = { kind: "resistance", type: "physical", level: "resistant", from: "beyondMelee" } as const;
    expect(resistanceHolds(melee, "melee")).toBe(true);
    expect(resistanceHolds(melee, "close")).toBe(false);
    expect(resistanceHolds(melee, undefined)).toBe(true);
    expect(resistanceHolds(beyond, "far")).toBe(true);
    expect(resistanceHolds(beyond, "melee")).toBe(false);
    expect(resistanceHolds({ kind: "resistance", type: "physical", level: "resistant", from: "outsideArea" }, "melee")).toBe(true);
    expect(resistanceHolds({ kind: "resistance", type: "magic", level: "immune", keyword: "fire" }, undefined)).toBe(false);
  });
});

describe("E2 dcm-fyb: which hits are a successful attack", () => {
  const payload = (attacker: unknown) => ({ attacker }) as never;
  it("an adversary's attack with an attack total; not a feature's damage without one, not a PC's card", () => {
    expect(attackSucceeded(payload({ instanceId: "i", label: "Bear" }), 15)).toBe(true);
    expect(attackSucceeded(payload({ instanceId: "i", label: "Bear" }), undefined)).toBe(false);
    expect(attackSucceeded(payload({ kind: "pc", characterId: "c", label: "Ash", cardId: "x" }), 15)).toBe(false);
  });
});
