import { describe, expect, it } from "vitest";

import {
  applyHitToPc,
  armorOptions,
  armorPreview,
  awaiting,
  eligibleCards,
  grantAnswers,
  grantOffers,
  grantsTaken,
  isComplete,
  openWindow,
  respond,
  type RespondResult,
  type WindowHit,
  type WindowPc,
  type WindowState,
} from "@/lib/domain/adversary-actions";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import { afterAnswer, grantAmount, grantMax, type HitView } from "@/components/combat-map/actions/reactions/model";

// Plan lanes-2, E2.3 (docs/tasks/TASK-LN3-E2.md): Unstuck's two free slots (dcm-3m5k), the attacker's grants (dcm-nnbl
// Hope before forced HP, HF p.75; dcm-5cn5 Money Talks' gold, CB p.228) and the payer's flags (dcm-hgvx, Ravenous HF p.94).

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
const hit = (over: Partial<WindowHit> = {}): WindowHit => ({ attackerId: "demon", amount: 10, type: "physical", direct: false, critical: false, ...over });
const unstuck = { factor: 2, of: ["hope", "hp", "stress", "armor"] as const };

function ok(r: RespondResult): WindowState {
  if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
  return r.state;
}

describe("dcm-3m5k: under Unstuck an Armor Slot needs two free slots", () => {
  it("two free: one slot offered, both marked; one free: no armor option", () => {
    const two = pc("a", { armor: 1, marksMultiplier: unstuck });
    expect(armorOptions(two, hit())).toMatchObject({ canUseArmor: true, maxSlots: 1 });
    expect(applyHitToPc(two, hit(), { armorSlots: 1 }).after.armor).toBe(3);
    const one = pc("a", { armor: 2, marksMultiplier: unstuck });
    expect(armorOptions(one, hit())).toMatchObject({ canUseArmor: false, maxSlots: 0 });
    expect(armorPreview(one, hit()).map((p) => p.slots)).toEqual([0]);
    // Without Unstuck one free slot is enough.
    expect(armorOptions(pc("a", { armor: 2 }), hit()).canUseArmor).toBe(true);
  });

  it("forced slots are doubled before the free ones are counted", () => {
    expect(armorOptions(pc("a", { marksMultiplier: unstuck }), hit({ forcedArmor: 1 })).canUseArmor).toBe(false);
    expect(armorOptions(pc("a", { armorMax: 4, marksMultiplier: unstuck }), hit({ forcedArmor: 1 })).maxSlots).toBe(1);
  });

  it("the window's target prompt shows OK only (no armor answer)", () => {
    const state = openWindow({ hit: hit(), targetId: "a", party: [pc("a", { armor: 2, marksMultiplier: unstuck })] });
    expect(state.armorCapable.a).toBe(false);
  });
});

describe("grants: Hope before forced HP (dcm-nnbl), gold instead of HP (dcm-5cn5)", () => {
  it("grantOffers: hope up to the reducible HP and the Hope held; none under cannotSpendHope; Unstuck halves it", () => {
    expect(grantOffers(hit({ grants: { hopeHp: 3 } }), pc("a", { hope: 2 }))).toEqual([{ id: "hope", max: 2 }]);
    expect(grantOffers(hit({ grants: { hopeHp: 1 } }), pc("a", { hope: 5 }))).toEqual([{ id: "hope", max: 1 }]);
    expect(grantOffers(hit({ grants: { hopeHp: 3 } }), pc("a", { hope: 5, flags: ["cannotSpendHope"] }))).toEqual([]);
    expect(grantOffers(hit({ grants: { hopeHp: 3 } }), pc("a", { hope: 3, marksMultiplier: unstuck }))).toEqual([{ id: "hope", max: 1 }]);
    expect(grantOffers(hit({ grants: { hopeHp: 3 } }), pc("a", { hope: 0 }))).toEqual([]);
  });

  it("grantOffers: gold while granted and a handful is held", () => {
    expect(grantOffers(hit({ grants: { goldForHp: true } }), pc("a", { gold: 4 }))).toEqual([{ id: "gold", max: 4 }]);
    expect(grantOffers(hit({ grants: { goldForHp: true } }), pc("a"))).toEqual([]);
    expect(grantOffers(hit(), pc("a", { gold: 4 }))).toEqual([]);
  });

  it("a forced-HP hit with no damage still asks a target who can't mark armor", () => {
    const target = pc("a", { armor: 3, hope: 2 });
    const plain = openWindow({ hit: hit({ amount: 0 }), targetId: "a", party: [target] });
    expect(isComplete(plain)).toBe(true);
    const state = openWindow({ hit: hit({ amount: 0, grants: { hopeHp: 2 } }), targetId: "a", party: [target] });
    expect(awaiting(state)).toEqual(["a"]);
    expect(grantAnswers(state, "a")).toEqual([{ id: "hope", max: 2 }]);
  });

  it("respond: the target takes a grant once, within its most; an ally can't; the turn goes on to the armor answer", () => {
    const state = openWindow({ hit: hit({ grants: { hopeHp: 2, goldForHp: true } }), targetId: "a", party: [pc("a", { hope: 2, gold: 3 }), pc("b")] });
    expect(respond(state, { characterId: "a", choice: { kind: "grant", id: "hope", amount: 3 } }).ok).toBe(false);
    expect(respond(state, { characterId: "a", choice: { kind: "grant", id: "silver", amount: 1 } }).ok).toBe(false);
    expect(respond(state, { characterId: "b", choice: { kind: "grant", id: "hope", amount: 1 } }).ok).toBe(false);
    const s1 = ok(respond(state, { characterId: "a", choice: { kind: "grant", id: "hope", amount: 2 } }));
    expect(respond(s1, { characterId: "a", choice: { kind: "grant", id: "hope", amount: 1 } }).ok).toBe(false);
    const s2 = ok(respond(s1, { characterId: "a", choice: { kind: "grant", id: "gold", amount: 3 } }));
    expect(grantsTaken(s2)).toEqual({ hope: 2, gold: 3 });
    expect(awaiting(s2)).toEqual(["a"]);
    const s3 = ok(respond(s2, { characterId: "a", choice: { kind: "armor", slots: 1 } }));
    expect(isComplete(s3)).toBe(true);
  });
});

describe("dcm-hgvx: the payer's flags in the window", () => {
  const ward: CardEffect = {
    cardId: "hope-ward",
    uses: [{ id: "main", name: "Hope Ward", activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } }, costs: [{ kind: "hope", amount: { kind: "fixed", value: 1 } }], steps: [{ kind: "reduceSeverity", to: "self", steps: 1 }] }],
  };
  it("a Hope-cost card is not offered while cannotSpendHope holds", () => {
    expect(eligibleCards(pc("a", { cards: [ward] }), "target", hit(), "major", true)).toEqual(["hope-ward"]);
    expect(eligibleCards(pc("a", { cards: [ward], flags: ["cannotSpendHope"] }), "target", hit(), "major", true)).toEqual([]);
  });
});

describe("the prompt model's grants", () => {
  it("clamps the count and drops a taken grant optimistically", () => {
    expect(grantMax({ amount: 3 })).toBe(3);
    expect(grantAmount({ amount: 3 }, 9)).toBe(3);
    expect(grantAmount({ amount: 3 }, 0)).toBe(1);
    const view = { requestId: "r", role: "target", awaiting: true, cardIds: [], grants: [{ id: "hope", label: "Hope", amount: 2 }, { id: "gold", label: "Gold", amount: 1 }] } as unknown as HitView;
    const [after] = afterAnswer([view], view.requestId, { kind: "grant", id: "hope", amount: 2 });
    expect(after!.grants?.map((g) => g.id)).toEqual(["gold"]);
    expect(after!.awaiting).toBe(true);
  });
});
