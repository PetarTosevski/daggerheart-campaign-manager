import { describe, expect, it } from "vitest";

import { afterHitTriggerFits, afterHitUses, foldsFromPlan, openWindow, resolveWindow, respond, triggerFits, type WindowHit, type WindowPc } from "@/lib/domain/adversary-actions/window";
import { cardEffect } from "@/lib/srd/card-effects";

// Plan combat-actions, tracer AA2b: the window's after-hit uses (CE-valor "For AA2": Unbreakable, Rise Up, Valor-Touched)
// and Bold Presence against a hit's condition riders (user answer 2026-10-22: riders move with the damage).

const cards = (...ids: string[]) => ids.map((id) => cardEffect(id)!);

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
  cards: [],
  ...over,
});

const hit = (over: Partial<WindowHit> = {}): WindowHit => ({ amount: 10, type: "physical", direct: false, attackerId: "bear", critical: false, ...over });

describe("AA2b: after-hit uses", () => {
  const facts = { hpMarked: 2, deathMove: false, armorSlots: 0, fromAttack: true };

  it("Rise Up's Stress clear runs when the hit marks HP from an attack; Valor-Touched's only without armor", () => {
    expect(afterHitUses(pc("ash", { cards: cards("rise-up") }), facts).auto).toEqual([{ cardId: "rise-up", useId: "stress" }]);
    expect(afterHitUses(pc("ash", { cards: cards("rise-up") }), { ...facts, hpMarked: 0 }).auto).toEqual([]);
    expect(afterHitTriggerFits({ kind: "whenYouMarkHp", withoutArmor: true }, { ...facts, armorSlots: 1 })).toBe(false);
    expect(afterHitTriggerFits({ kind: "whenYouMarkHp", withoutArmor: true }, facts)).toBe(true);
  });

  it("Unbreakable is offered only when the hit marked the last HP; a used-up limit or a missing death move offers nothing", () => {
    const ash = pc("ash", { cards: cards("unbreakable") });
    expect(afterHitUses(ash, facts).offers).toEqual([]);
    expect(afterHitUses(ash, { ...facts, deathMove: true }).offers).toEqual(["unbreakable"]);
    expect(afterHitTriggerFits({ kind: "wouldMakeDeathMove", who: "self" }, { ...facts, deathMove: true })).toBe(true);
    expect(afterHitTriggerFits({ kind: "wouldMakeDeathMove", who: "ally" }, { ...facts, deathMove: true })).toBe(false);
  });
});

describe("AA2b: Bold Presence against condition riders", () => {
  it("offers Bold Presence to the target only when the hit carries a condition rider; its fold keeps the conditions off", () => {
    const ash = pc("ash", { cards: cards("bold-presence") });
    const trigger = { kind: "wouldGainCondition" } as const;
    expect(triggerFits(trigger, "target", ash, hit(), "major", true)).toBe(false);
    expect(triggerFits(trigger, "target", ash, hit({ conditionRiders: true }), "major", true)).toBe(true);
    expect(triggerFits(trigger, "ally", ash, hit({ conditionRiders: true }), "major", true)).toBe(false);

    const w = openWindow({ hit: hit({ conditionRiders: true }), targetId: "ash", party: [ash] });
    expect(w.responders).toEqual([{ characterId: "ash", role: "target", cardIds: ["bold-presence"] }]);
    const folds = foldsFromPlan({ steps: [{ kind: "fold", step: { kind: "negate", to: "self", what: "condition" }, targetIds: ["ash"] }] }, "ash");
    expect(folds).toEqual([{ kind: "negateCondition" }]);
    const played = respond(w, { characterId: "ash", choice: { kind: "card", cardId: "bold-presence", useId: "condition" }, folds });
    if (!played.ok) throw new Error(played.detail);
    const done = respond(played.state, { characterId: "ash", choice: { kind: "noArmor" } });
    if (!done.ok) throw new Error(done.detail);
    expect(resolveWindow(done.state, [ash])).toMatchObject({ conditionNegated: true, negated: false });
    expect(resolveWindow(w, [ash]).conditionNegated).toBe(false);
  });
});
