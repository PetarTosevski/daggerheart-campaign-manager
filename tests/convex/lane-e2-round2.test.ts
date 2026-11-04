/**
 * Plan lanes-2, tracer E2 (docs/tasks/TASK-LN2-E2.md): round-2 pieces of the reaction window, pure, with fixture entries
 * (the SRD data switches in wave 9). Printed pages: CB = Core Book, HF = Hope & Fear. Thresholds 8 / 15 (CB p.91).
 *
 * - dcm-dv6: a hit's keyword (Fireproof, HF p.22: "damage from magical or mundane flame").
 * - dcm-nt4: Rejuvenation Barrier (CB p.339: "resistance to physical damage from outside the barrier").
 * - dcm-kvx4: Burrowing Leechpoles (HF p.90: "any damage the target takes gains a +1 bonus for each leechpole").
 * - dcm-fbsr: Unstuck (CB p.237: "they must double the amount spent or marked").
 * - dcm-ofo: `whenAllyWouldTakeDamage.unlimited` (Enchanted Talisman, HF p.16) and the subject's facts.
 */
import { describe, expect, it } from "vitest";

import { hitKeyword, resistanceHolds } from "../../convex/lib/adversaryHits";
import { isMaintainId, maintainId } from "../../convex/lib/incomingHits";
import { actorWithSubject, applyHitToPc, armorPreview, damageBeforeArmor, marksFactor, triggerFits, type WindowHit, type WindowPc } from "../../src/lib/domain/adversary-actions/index";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import type { ActorState } from "../../src/lib/domain/card-effects/run";

const THRESHOLDS = { major: 8, severe: 15 };

function actor(id: string, over: Partial<ActorState> = {}): ActorState {
  return {
    id,
    side: "pc",
    evasion: 10,
    thresholds: THRESHOLDS,
    hp: 0,
    hpMax: 6,
    stress: 1,
    stressMax: 6,
    armor: 1,
    armorMax: 3,
    defeated: false,
    conditions: [],
    hope: 4,
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
    facts: { conditions: [], tags: [], flying: false, featureEffects: [], items: ["Enchanted Talisman"] },
    ...over,
  };
}

const defense = (over: Partial<WindowPc> = {}): WindowPc => ({ id: "mira", thresholds: THRESHOLDS, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, armorMax: 3, hope: 3, featureUses: [], cards: [], ...over });
const hit = (amount: number, over: Partial<WindowHit> = {}): WindowHit => ({ amount, type: "physical", direct: false, attackerId: "bandit", critical: false, ...over });

describe("E2 dcm-dv6: the hit's keyword", () => {
  it("a keyword resistance holds only on a hit carrying it", () => {
    const fireproof = { kind: "resistance", type: "both", level: "immune", keyword: "fire" } as const;
    expect(resistanceHolds(fireproof, undefined)).toBe(false);
    expect(resistanceHolds(fireproof, undefined, { keyword: "fire" })).toBe(true);
  });

  it("a keyword trigger doesn't fit a hit with another keyword; an unknown keyword still offers it (Q13)", () => {
    const trigger = { kind: "whenYouWouldTakeDamage", keyword: "fire" } as const;
    const pc = defense();
    expect(triggerFits(trigger, "target", pc, hit(10, { keyword: "fire" }), "major", true)).toBe(true);
    expect(triggerFits(trigger, "target", pc, hit(10), "major", true)).toBe(true);
    expect(triggerFits(trigger, "ally", pc, hit(10, { keyword: "fire" }), "major", true)).toBe(false);
  });

  it("hitKeyword reads the attacking feature's damage step; none for another feature or the standard attack", () => {
    const effects = [
      {
        feature: "Fire Breath",
        uses: [{ id: "breath", activation: { kind: "action" }, steps: [{ kind: "damage", dice: { count: 2, sides: 10 }, type: "magic", keyword: "fire" }] }],
      },
    ] as unknown as AdversaryFeatureEffect[];
    expect(hitKeyword(effects, "Fire Breath")).toBe("fire");
    expect(hitKeyword(effects, "Claws")).toBeUndefined();
    expect(hitKeyword(effects, undefined)).toBeUndefined();
  });
});

describe("E2 dcm-nt4: resistance from outside an area", () => {
  const barrier = { kind: "resistance", type: "physical", level: "resistant", from: "outsideArea" } as const;
  it("holds unless the attacker stands in a live area of the same source; unknown position holds (Q18)", () => {
    expect(resistanceHolds(barrier, "far", { sourceId: "rejuvenation-barrier" })).toBe(true);
    expect(resistanceHolds(barrier, "far", { sourceId: "rejuvenation-barrier", attackerAreas: [] })).toBe(true);
    expect(resistanceHolds(barrier, "far", { sourceId: "rejuvenation-barrier", attackerAreas: ["other-area"] })).toBe(true);
    expect(resistanceHolds(barrier, "melee", { sourceId: "rejuvenation-barrier", attackerAreas: ["rejuvenation-barrier"] })).toBe(false);
  });
});

describe("E2 dcm-kvx4: a bonus on any damage the bearer takes", () => {
  it("adds to the damage before resistance and thresholds; damage reduced to 0 gains nothing", () => {
    expect(damageBeforeArmor(defense({ damageTakenBonus: 2 }), hit(7)).severity).toBe("major");
    expect(damageBeforeArmor(defense({ damageTakenBonus: 2 }), hit(7)).taken).toBe(9);
    expect(damageBeforeArmor(defense({ damageTakenBonus: 2 }), hit(3), 3).taken).toBe(0);
    // Resistance halves after the bonus (CB p.99): (7 + 2) / 2 rounds up to 5.
    expect(damageBeforeArmor(defense({ damageTakenBonus: 2, resistance: { physical: "resistant", magic: "none" } }), hit(7)).taken).toBe(5);
  });
});

describe("E2 dcm-fbsr: Unstuck doubles what the hit marks", () => {
  const unstuck = { factor: 2, of: ["hope", "hp", "stress", "armor"] as const };

  it("marksFactor reads the tracks it names", () => {
    expect(marksFactor(defense({ marksMultiplier: unstuck }), "hp")).toBe(2);
    expect(marksFactor(defense({ marksMultiplier: { factor: 2, of: ["stress"] } }), "hp")).toBe(1);
    expect(marksFactor(defense(), "hp")).toBe(1);
  });

  it("a Major hit marks 4 HP; the preview shows it", () => {
    const pc = defense({ marksMultiplier: unstuck });
    expect(applyHitToPc(pc, hit(10), {}).after.hp).toBe(4);
    expect(armorPreview(pc, hit(10), 0).map((p) => p.hp)).toEqual([4, 2]);
  });

  it("one Armor Slot marks two (capped at a full track) and still steps down once", () => {
    const pc = defense({ marksMultiplier: unstuck });
    const r = applyHitToPc(pc, hit(10), { armorSlots: 1 });
    expect(r.after.armor).toBe(2);
    expect(r.after.hp).toBe(2);
    expect(applyHitToPc(defense({ marksMultiplier: unstuck, armor: 2 }), hit(10), { armorSlots: 1 }).after.armor).toBe(3);
  });

  it("Hope spent instead of HP costs double; what the Hope can't cover is marked as HP (doubled)", () => {
    const pc = defense({ marksMultiplier: unstuck, hope: 3 });
    const r = applyHitToPc(pc, hit(10), { convert: "hope" });
    // 2 marks: 1 covered for 2 Hope, 1 left as 2 HP.
    expect(r.after.hope).toBe(1);
    expect(r.after.hp).toBe(2);
  });
});

describe("E2 dcm-ofo: unlimited range and the subject's facts", () => {
  it("whenAllyWouldTakeDamage.unlimited fits an ally at any distance", () => {
    const far = defense({ id: "ally", bandToTarget: "veryFar" });
    expect(triggerFits({ kind: "whenAllyWouldTakeDamage", range: "close" }, "ally", far, hit(5), "minor", true)).toBe(false);
    expect(triggerFits({ kind: "whenAllyWouldTakeDamage", range: "close", unlimited: true }, "ally", far, hit(5), "minor", true)).toBe(true);
  });

  it("the subject carries its Stress, Armor Slots, Hope and held items", () => {
    const helper = actor("ally", { facts: {} });
    const subject = actor("mira");
    const facts = actorWithSubject(helper, subject).facts?.subject;
    expect(facts).toMatchObject({ stress: 1, stressMax: 6, armor: 1, armorMax: 3, hope: 4, items: ["Enchanted Talisman"] });
  });
});

describe("E2 dcm-4qv: maintain offers", () => {
  it("are feature-shaped ids the after-hit offer can carry", () => {
    expect(maintainId("e1")).toBe("maintain:e1");
    expect(isMaintainId(maintainId("e1"))).toBe(true);
    expect(isMaintainId("valor:not-done-yet")).toBe(false);
  });
});
