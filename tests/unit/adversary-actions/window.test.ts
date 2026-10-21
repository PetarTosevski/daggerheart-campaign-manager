import { describe, expect, it } from "vitest";

import {
  awaiting,
  eligibleCards,
  foldsFromPlan,
  isComplete,
  openWindow,
  resolveNow,
  resolveWindow,
  respond,
  runReactionCard,
  targetPrompt,
  type RespondResult,
  type WindowHit,
  type WindowPc,
  type WindowState,
} from "@/lib/domain/adversary-actions";
import type { ActorState } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import { queueRng } from "@/lib/domain/dice";

// Plan combat-actions, tracer AA1: the reaction window (Q13, Q17 a, Q18 a). I Am Your Shield (CB p.341): "When an ally
// within Very Close range would take damage, you can mark a Stress to stand in the way and make yourself the target of
// the attack instead. When you take damage from this attack, you can mark any number of Armor Slots."

const fixed = (value: number) => ({ kind: "fixed" as const, value });

const shield: CardEffect = {
  cardId: "i-am-your-shield",
  uses: [
    {
      id: "main",
      name: "I Am Your Shield",
      activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryClose" } },
      costs: [{ kind: "stress", amount: fixed(1) }],
      steps: [
        { kind: "redirectDamage", to: "self", target: "self" },
        { kind: "extraArmorSlots", to: "self", max: "any" },
      ],
    },
  ],
};

/** A target-side card: "When you take Severe damage, reduce the severity by one threshold" (Get Back Up-like, once per rest). */
const getBackUp: CardEffect = {
  cardId: "get-back-up",
  uses: [
    {
      id: "main",
      name: "Get Back Up",
      activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", severity: "severe" } },
      limit: { per: "rest" },
      steps: [{ kind: "reduceSeverity", to: "self", steps: 1 }],
    },
  ],
};

const pc = (id: string, over: Partial<WindowPc> = {}): WindowPc => ({
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

function ok(r: RespondResult): WindowState {
  if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
  return r.state;
}

const bramActor = (): ActorState => ({
  id: "bram",
  side: "pc",
  evasion: 10,
  thresholds: { major: 8, severe: 16 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  hope: 2,
  hopeMax: 6,
  traits: { agility: 0, strength: 2, finesse: 0, instinct: 1, presence: 1, knowledge: 0 },
  spellcast: 0,
  proficiency: 1,
  level: 1,
  tier: 1,
  loadoutDomains: ["valor"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: {},
});

describe("opening the window (Q13)", () => {
  const party = [pc("mira"), pc("bram", { cards: [shield], bandToTarget: "veryClose" }), pc("cara")];

  it("lists the target (armor) and every ally with an eligible card; not complete until they answer", () => {
    const w = openWindow({ hit: hit(), targetId: "mira", party });
    expect(w.responders).toEqual([
      { characterId: "mira", role: "target", cardIds: [] },
      { characterId: "bram", role: "ally", cardIds: ["i-am-your-shield"] },
    ]);
    expect(awaiting(w)).toEqual(["mira", "bram"]);
    expect(isComplete(w)).toBe(false);
  });

  it("an ally beyond the card's range is not offered it; an unknown band (no map) is (Q18)", () => {
    expect(openWindow({ hit: hit(), targetId: "mira", party: [pc("mira"), pc("bram", { cards: [shield], bandToTarget: "far" })] }).responders).toHaveLength(1);
    expect(openWindow({ hit: hit(), targetId: "mira", party: [pc("mira"), pc("bram", { cards: [shield] })] }).responders).toHaveLength(2);
  });

  it("an exhausted or unaffordable card is not offered (CB p.101, p.90)", () => {
    const fullStress = pc("bram", { cards: [shield], stress: 6 });
    expect(eligibleCards(fullStress, "ally", hit(), "severe", true)).toEqual([]);
    const used = pc("mira", { cards: [getBackUp], featureUses: [{ key: "card:get-back-up", until: "rest" }] });
    expect(eligibleCards(used, "target", hit(), "severe", true)).toEqual([]);
    expect(eligibleCards(pc("mira", { cards: [getBackUp] }), "target", hit(), "severe", true)).toEqual(["get-back-up"]);
    expect(eligibleCards(pc("mira", { cards: [getBackUp] }), "target", hit(), "major", true)).toEqual([]);
  });

  it("with no usable slot (direct damage) and no card the target owes nothing: complete at once", () => {
    const w = openWindow({ hit: hit({ direct: true }), targetId: "mira", party: [pc("mira"), pc("cara")] });
    expect(w.responders).toEqual([]);
    expect(isComplete(w)).toBe(true);
    expect(resolveWindow(w, [pc("mira")]).result).toMatchObject({ severity: "severe", hpMarked: 3, armorSlots: 0 });
  });

  it("the hit PC's prompt shows the damage, its severity against their thresholds and the slots they may mark (Q14)", () => {
    const w = openWindow({ hit: hit(), targetId: "mira", party });
    expect(targetPrompt(w, pc("mira"))).toEqual({ damage: 18, severity: "severe", maxSlots: 1 });
  });
});

describe("answers and completion (Q17 a)", () => {
  const party = [pc("mira"), pc("bram", { cards: [shield] }), pc("cara")];

  it("completes when the target chose armor and every ally answered; resolves with one slot", () => {
    let w = openWindow({ hit: hit(), targetId: "mira", party });
    w = ok(respond(w, { characterId: "mira", choice: { kind: "armor" } }));
    expect(awaiting(w)).toEqual(["bram"]);
    w = ok(respond(w, { characterId: "bram", choice: { kind: "pass" } }));
    expect(isComplete(w)).toBe(true);
    const r = resolveWindow(w, party);
    expect(r).toMatchObject({ targetId: "mira", missed: false, armorSlotsChosen: 1 });
    expect(r.result).toMatchObject({ severityBefore: "severe", severity: "major", hpMarked: 2, armorSlots: 1 });
  });

  it("refuses answers from non-responders, repeated answers, armor from an ally and anything after completion", () => {
    let w = openWindow({ hit: hit(), targetId: "mira", party });
    expect(respond(w, { characterId: "cara", choice: { kind: "pass" } })).toMatchObject({ ok: false, code: "NOT_A_RESPONDER" });
    expect(respond(w, { characterId: "bram", choice: { kind: "armor" } })).toMatchObject({ ok: false, code: "NOT_A_RESPONDER" });
    expect(respond(w, { characterId: "bram", choice: { kind: "card", cardId: "other" } })).toMatchObject({ ok: false, code: "NOT_A_RESPONDER" });
    w = ok(respond(w, { characterId: "mira", choice: { kind: "noArmor" } }));
    expect(respond(w, { characterId: "mira", choice: { kind: "armor" } })).toMatchObject({ ok: false, code: "NOT_A_RESPONDER" });
    w = ok(respond(w, { characterId: "bram", choice: { kind: "pass" } }));
    expect(respond(w, { characterId: "bram", choice: { kind: "pass" } })).toMatchObject({ ok: false, code: "REQUEST_NOT_OPEN" });
  });

  it("the GM's Resolve now closes it; whoever didn't answer takes no armor (no timer)", () => {
    const w = resolveNow(openWindow({ hit: hit(), targetId: "mira", party }));
    expect(isComplete(w)).toBe(true);
    expect(awaiting(w)).toEqual([]);
    expect(resolveWindow(w, party).result).toMatchObject({ armorSlots: 0, hpMarked: 3 });
    expect(respond(w, { characterId: "mira", choice: { kind: "armor" } })).toMatchObject({ ok: false, code: "REQUEST_NOT_OPEN" });
  });
});

describe("I Am Your Shield (CB p.341)", () => {
  const party = [pc("mira"), pc("bram", { cards: [shield] })];

  it("the card's run folds into a redirect and any number of Armor Slots; Bram then chooses armor and takes the hit", () => {
    let w = openWindow({ hit: hit({ amount: 18 }), targetId: "mira", party });
    const { result, folds } = runReactionCard(shield, bramActor(), w, { target: { ...bramActor(), id: "mira" } }, queueRng([]));
    expect(result.ok && result.plan.actor.after.stress).toBe(1); // the Stress it costs
    expect(folds).toEqual([
      { kind: "redirect", to: "bram" },
      { kind: "extraArmorSlots", max: "any", targetIds: ["bram"] },
    ]);
    w = ok(respond(w, { characterId: "bram", choice: { kind: "card", cardId: "i-am-your-shield" }, folds }));
    expect(w.targetId).toBe("bram");
    expect(awaiting(w)).toEqual(["bram"]); // Mira is released; Bram owes the armor answer
    expect(targetPrompt(w, pc("bram"))).toEqual({ damage: 18, severity: "severe", maxSlots: 3 });
    w = ok(respond(w, { characterId: "bram", choice: { kind: "armor", slots: 2 } }));
    expect(isComplete(w)).toBe(true);
    const r = resolveWindow(w, party);
    expect(r).toMatchObject({ originalTargetId: "mira", targetId: "bram" });
    expect(r.result).toMatchObject({ targetId: "bram", severity: "minor", armorSlots: 2, hpMarked: 1 });
  });

  it("a shield-bearer with no free slot takes it without an armor answer", () => {
    const full = [pc("mira"), pc("bram", { cards: [shield], armor: 3 })];
    let w = openWindow({ hit: hit(), targetId: "mira", party: full });
    w = ok(respond(w, { characterId: "bram", choice: { kind: "card", cardId: "i-am-your-shield" }, folds: [{ kind: "redirect", to: "bram" }] }));
    expect(isComplete(w)).toBe(true);
    expect(resolveWindow(w, full).result).toMatchObject({ targetId: "bram", hpMarked: 3 });
  });
});

describe("other folds", () => {
  const party = [pc("mira", { cards: [getBackUp] })];

  it("a target card's severity step applies after armor; the target may still answer armor afterwards", () => {
    let w = openWindow({ hit: hit(), targetId: "mira", party });
    expect(w.responders[0]).toEqual({ characterId: "mira", role: "target", cardIds: ["get-back-up"] });
    const folds = foldsFromPlan({ steps: [{ kind: "fold", step: getBackUp.uses[0]!.steps[0] as never, targetIds: ["mira"], amount: 1 }] }, "mira");
    w = ok(respond(w, { characterId: "mira", choice: { kind: "card", cardId: "get-back-up" }, folds }));
    expect(isComplete(w)).toBe(false);
    w = ok(respond(w, { characterId: "mira", choice: { kind: "armor" } }));
    expect(resolveWindow(w, party).result).toMatchObject({ severity: "minor", hpMarked: 1 });
  });

  it("negateAttack makes a miss; an Evasion bonus that beats the kept total too, unless critical", () => {
    const base = openWindow({ hit: hit({ attackTotal: 13 }), targetId: "mira", party: [pc("mira")] });
    const negated: WindowState = { ...base, responses: [{ characterId: "x", choice: { kind: "pass" }, folds: [{ kind: "negateAttack" }] }] };
    expect(resolveWindow(negated, [pc("mira")])).toMatchObject({ missed: true, negated: true, result: null });
    const evade: WindowState = { ...base, responses: [{ characterId: "x", choice: { kind: "pass" }, folds: [{ kind: "evasion", amount: 2, targetIds: [] }] }] };
    expect(resolveWindow(evade, [pc("mira")]).missed).toBe(true);
    const crit: WindowState = { ...evade, hit: { ...evade.hit, critical: true } };
    expect(resolveWindow(crit, [pc("mira")]).missed).toBe(false);
    const unknown: WindowState = { ...evade, hit: { ...evade.hit, attackTotal: undefined } };
    expect(resolveWindow(unknown, [pc("mira")]).manual).toEqual(["+2 Evasion against this attack"]);
  });

  it("reflect negates the PC's damage and hands the amount to the server", () => {
    const folds = foldsFromPlan(
      { steps: [{ kind: "fold", step: { kind: "redirectDamage", to: "self", target: "triggerSource" }, targetIds: ["mira"] }] },
      "mira",
    );
    const w: WindowState = { ...openWindow({ hit: hit(), targetId: "mira", party: [pc("mira")] }), responses: [{ characterId: "mira", choice: { kind: "card", cardId: "c" }, folds }] };
    const r = resolveWindow(w, [pc("mira")]);
    expect(r).toMatchObject({ negated: true, reflected: [{ to: "attacker", targetIds: ["mira"], amount: 18 }] });
    expect(r.result).toMatchObject({ hpMarked: 0 });
  });

  it("maps reduceDamage, convertMarks and unknown folds", () => {
    const folds = foldsFromPlan(
      {
        steps: [
          { kind: "fold", step: { kind: "reduceDamage", to: "self", amount: { kind: "dice", dice: { count: fixed(1), sides: 8 } } }, targetIds: ["mira"], amount: 6 },
          { kind: "fold", step: { kind: "convertMarks", to: "self", from: "hp", into: "stress" }, targetIds: ["mira"] },
          { kind: "fold", step: { kind: "refreshFeature", to: "self" }, targetIds: [] },
        ],
      },
      "mira",
    );
    expect(folds).toEqual([
      { kind: "reduceDamage", amount: 6, targetIds: ["mira"] },
      { kind: "convert", into: "stress", targetIds: ["mira"] },
      { kind: "manual", text: "refreshFeature" },
    ]);
    const w: WindowState = { ...resolveNow(openWindow({ hit: hit(), targetId: "mira", party: [pc("mira")] })), responses: [{ characterId: "mira", choice: { kind: "card", cardId: "c" }, folds }] };
    // 18 - 6 = 12: Major, 2 marks taken as Stress instead.
    expect(resolveWindow(w, [pc("mira")]).result).toMatchObject({ severity: "major", stressMarked: 2, hpMarked: 0 });
  });
});
