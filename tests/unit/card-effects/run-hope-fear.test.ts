import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

// Plan rule-switches RA2 (bead dcm-jh6d.67, user answers 2026-11-06): the card engine's rolls follow the campaign's R3
// `hopeFearFromRolls` mode (`context.hopeFear`). Manual: a roll with Hope gains no Hope, a roll with Fear gives the GM no
// Fear; a critical still gains a Hope and clears a Stress (CB p.90). A later Hope cost then needs Hope the PC already has
// (R8, CB p.90: "the Hope you gain from that roll can be spent on that feature"; no gain, nothing to spend).
// RNG order: Hope Die, Fear Die, then damage dice.

const fixed = (value: number) => ({ kind: "fixed" as const, value });

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
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 1, knowledge: 3 },
  spellcast: 3,
  proficiency: 2,
  level: 3,
  tier: 2,
  loadoutDomains: ["arcana"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: {},
  ...over,
});

const bandit: Combatant = { id: "bandit", side: "adversary", difficulty: 12, thresholds: { major: 8, severe: 14 }, hp: 0, hpMax: 5, stress: 0, stressMax: 3, defeated: false, conditions: [] };

/** Bolt Beacon's shape (CB p.340): a Spellcast Roll, then a Hope cost paid on a success, then damage on a hit. */
const beacon: CardEffect = {
  cardId: "bolt-beacon",
  uses: [
    {
      id: "main",
      name: "Bolt Beacon",
      activation: { kind: "action" },
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [
        { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: fixed(1) }] },
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: fixed(1), sides: 8 } }, type: "magic" },
      ],
    },
  ],
};

const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 2, targets: [bandit], rng: queueRng(dice), ...over });

function ok(result: ReturnType<typeof run>): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

describe("R3 on the card engine's rolls (context.hopeFear)", () => {
  it("Book (and unset): a roll with Hope gains a Hope; a roll with Fear gives the GM a Fear", () => {
    for (const mode of [undefined, "book" as const]) {
      const hope = ok(run(beacon, ctx([9, 3, 4], { actor: actor({ hope: 2 }), ...(mode ? { hopeFear: mode } : {}) })));
      // 2 + 1 from the roll - 1 paid.
      expect(hope.actor.after.hope).toBe(2);
      expect(hope.gmFearDelta).toBe(0);
      const fear = ok(run(beacon, ctx([3, 9, 4], mode ? { hopeFear: mode } : {})));
      expect(fear.gmFearDelta).toBe(1);
    }
  });

  it("Manual: a roll with Hope gains no Hope, a roll with Fear gives no Fear", () => {
    const hope = ok(run(beacon, ctx([9, 3, 4], { actor: actor({ hope: 2 }), hopeFear: "manual" })));
    expect(hope.roll?.outcome).toBe("successHope");
    // 2 - 1 paid, nothing gained.
    expect(hope.actor.after.hope).toBe(1);
    const fear = ok(run(beacon, ctx([3, 9, 4], { hopeFear: "manual" })));
    expect(fear.roll?.outcome).toBe("successFear");
    expect(fear.gmFearDelta).toBe(0);
    expect(fear.actor.after.hope).toBe(1);
  });

  it("Manual: a later Hope cost needs Hope the PC already holds (the roll's Hope is not there to spend)", () => {
    const book = ok(run(beacon, ctx([9, 3, 4], { actor: actor({ hope: 0 }), hopeFear: "book" })));
    expect(ofKind(book, "pay")).toMatchObject([{ phase: "afterRoll", paid: true }]);
    expect(ofKind(book, "damage")).toHaveLength(1);

    const manual = ok(run(beacon, ctx([9, 3, 4], { actor: actor({ hope: 0 }), hopeFear: "manual" })));
    expect(manual.success).toBe(true);
    expect(ofKind(manual, "pay")).toMatchObject([{ phase: "afterRoll", paid: false }]);
    expect(ofKind(manual, "damage")).toEqual([]);
    expect(manual.actor.after.hope).toBe(0);

    const held = ok(run(beacon, ctx([9, 3, 4], { actor: actor({ hope: 1 }), hopeFear: "manual" })));
    expect(ofKind(held, "pay")).toMatchObject([{ paid: true }]);
    expect(ofKind(held, "damage")).toHaveLength(1);
    expect(held.actor.after.hope).toBe(0);
  });

  it("Manual: a critical still gains a Hope and clears a Stress (user answer 2026-11-06, CB p.90)", () => {
    const plan = ok(run(beacon, ctx([5, 5, 4], { actor: actor({ hope: 0, stress: 2 }), hopeFear: "manual" })));
    expect(plan.roll?.critical).toBe(true);
    // 0 + 1 from the critical, spent on the cost (R8).
    expect(ofKind(plan, "pay")).toMatchObject([{ paid: true }]);
    expect(plan.actor.after.hope).toBe(0);
    expect(plan.actor.after.stress).toBe(1);
    expect(plan.gmFearDelta).toBe(0);
  });

  it("every Hope / Fear Die pair: Manual never gains Hope or Fear except on a critical", () => {
    for (let h = 1; h <= 12; h++) {
      for (let f = 1; f <= 12; f++) {
        const plan = ok(run(beacon, ctx([h, f, 4], { actor: actor({ hope: 6, stress: 2 }), hopeFear: "manual" })));
        const paid = ofKind(plan, "pay").filter((p) => p.paid).length;
        const crit = h === f;
        expect(plan.gmFearDelta).toBe(0);
        expect(plan.actor.after.hope).toBe(6 - paid);
        expect(plan.actor.after.stress).toBe(crit ? 1 : 2);
      }
    }
  });
});
