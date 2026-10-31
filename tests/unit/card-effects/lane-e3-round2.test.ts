import { describe, expect, it } from "vitest";

import { parseChoices } from "../../../convex/lib/cardChoices";
import { rollTargetCount, run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, DamageRoll } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

// Plan lanes-2, tracer E3 (round 2; docs/tasks/TASK-LN2-E3.md): the run.ts halves of the wave-8 beads. Inline fixtures
// only (wave 9 switches the SRD entries). RNG order: Hope die, Fear die, then the dice the steps roll in order.

const fixed = (value: number) => ({ kind: "fixed" as const, value });
const d = (sides: 4 | 6 | 8 | 10 | 12 | 20, count = 1): DamageRoll => ({ kind: "dice", dice: { count: fixed(count), sides } });

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
  weapons: { primary: { damage: "d8+1 phy", trait: "finesse", damageType: "physical", range: "melee" } },
  ...over,
});

/** Difficulty 12, thresholds 8/14, 5 HP, 3 Stress. */
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

const pc = (id: string, over: Partial<Combatant> = {}): Combatant => ({
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

const card = (use: Partial<CardUse>, cardId = "e3r2-card"): CardEffect => ({
  cardId,
  uses: [{ id: "main", name: "Test", activation: { kind: "action" }, steps: [], ...use }],
});

const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 2, rng: queueRng(dice), ...over });

function ok(result: ReturnType<typeof run>): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

const oneEnemy = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };

describe("rolls: dcm-mhn critRange, dcm-fjh anyTrait", () => {
  it("an adversary attack with critRange 19 crits on a natural 19", () => {
    const use = card({ roll: { kind: "adversaryAttack", difficulty: fixed(30), critRange: 19 } });
    const plan = ok(run(use, ctx([19])));
    expect(plan.roll?.critical).toBe(true);
    expect(plan.success).toBe(true);
  });

  it("without critRange a natural 19 is no critical", () => {
    const plan = ok(run(card({ roll: { kind: "adversaryAttack", difficulty: fixed(30) } }), ctx([19])));
    expect(plan.roll?.critical).toBe(false);
  });

  it("an anyTrait reaction roll uses the trait the player picked", () => {
    // Hope 3 + Fear 4 + knowledge 3 = 10 (the default instinct 0 would give 7).
    const use = card({ roll: { kind: "reaction", trait: "instinct", anyTrait: true, difficulty: fixed(10) } });
    const plan = ok(run(use, ctx([3, 4], { roll: { trait: "knowledge" } })));
    expect(plan.roll?.record.total).toBe(10);
    expect(plan.success).toBe(true);
  });
});

describe("damage: dcm-b9hc companion die, dcm-86z trigger type, dcm-va0f perArea", () => {
  it("a companion damage roll is the companion die x Proficiency, with the companion's type", () => {
    const use = card({ targets: oneEnemy, steps: [{ kind: "damage", to: "targets", roll: { kind: "companion" }, type: "weapon" }] });
    const plan = ok(run(use, ctx([5, 7], { actor: actor({ dieSides: { companion: 8 }, companionDamageType: "magic" }), targets: [adv("a")] })));
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 12 } });
  });

  it("the companion die defaults to a d6 and physical", () => {
    const use = card({ targets: oneEnemy, steps: [{ kind: "damage", to: "targets", roll: { kind: "companion" }, type: "weapon" }] });
    const plan = ok(run(use, ctx([6, 6], { targets: [adv("a")] })));
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "physical", record: { total: 12, dice: [{ sides: 6 }, { sides: 6 }] } });
  });

  it("sameAsTrigger damage typed `weapon` takes the trigger's damage type", () => {
    const use = card({ targets: oneEnemy, steps: [{ kind: "damage", to: "targets", roll: { kind: "sameAsTrigger" }, type: "weapon" }] });
    const plan = ok(run(use, ctx([], { targets: [adv("a")], trigger: { amount: 9, damageType: "magic" } })));
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 9 } });
  });

  it("perArea damage rolls once per point and each creature takes the sum of its points", () => {
    const use = card({
      targets: { side: "enemy", range: "far", count: { kind: "all" }, area: "aroundPoint", points: fixed(2) },
      steps: [{ kind: "damage", to: "targets", roll: d(10), type: "magic", perArea: true }],
    });
    // Point 0 rolls 4, point 1 rolls 9: a (both) 13, b (point 1) 9.
    const plan = ok(run(use, ctx([4, 9], { targets: [adv("a"), adv("b")], pointsOf: { a: [0, 1], b: [1] } })));
    expect(ofKind(plan, "damageRoll").map((s) => s.record.total)).toEqual([4, 9]);
    expect(ofKind(plan, "damage").map((s) => [s.result.targetId, s.result.incoming])).toEqual([
      ["a", 13],
      ["b", 9],
    ]);
  });
});

describe("held dice: dcm-inou / dcm-sa2 rerollHeld", () => {
  it("rerolls the spent Slayer Dice showing 1 once each; the spent total follows", () => {
    const use = card({
      targets: oneEnemy,
      costs: [{ kind: "tokens", amount: fixed(2), pool: "slayer" }],
      steps: [
        { kind: "modifyRoll", to: "self", change: { kind: "rerollHeld", die: "slayer", atMost: 1 } },
        { kind: "damage", to: "targets", roll: { kind: "flat", amount: { kind: "spent", resource: "heldDie" } }, type: "physical" },
      ],
    });
    const heldDice = [
      { id: "s1", kind: "slayer" as const, sides: 6 },
      { id: "s2", kind: "slayer" as const, sides: 6 },
    ];
    // Spent dice roll 1 and 4; the 1 rerolls to 5: 5 + 4 = 9.
    const rng = queueRng([1, 4, 5]);
    const plan = ok(run(use, { ...ctx([]), rng, actor: actor({ heldDice }), targets: [adv("a")] }));
    rng.done();
    expect(ofKind(plan, "heldReroll")).toEqual([{ kind: "heldReroll", die: "slayer", before: [1], after: [5] }]);
    expect(ofKind(plan, "damageRoll")[0]?.record.total).toBe(9);
  });
});

describe("marks and clears: dcm-nsjj ifUnable, dcm-5kxg, dcm-fbsr, dcm-63j", () => {
  const spit = card({
    targets: { side: "any", range: "far", count: { kind: "one" } },
    steps: [{ kind: "markArmor", to: "targets", amount: fixed(1), ifUnable: [{ kind: "markHp", to: "targets", amount: fixed(1) }] }],
  });

  it("a recipient with a free Armor Slot marks it", () => {
    const plan = ok(run(spit, ctx([], { targets: [pc("p1", { armor: 1 })] })));
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "p1", track: "armor", amount: 1 }]);
  });

  it("a recipient with no free Armor Slot runs ifUnable instead", () => {
    const plan = ok(run(spit, ctx([], { targets: [pc("p1", { armor: 3 })] })));
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "p1", track: "hp", amount: 1 }]);
  });

  it("cannotClearStress stops a Stress clear (a manual line instead)", () => {
    const use = card({ targets: { side: "ally", range: "far", count: { kind: "one" } }, steps: [{ kind: "clear", to: "targets", track: "stress", amount: fixed(2) }] });
    const plan = ok(run(use, ctx([], { targets: [pc("p1", { stress: 3 })], modsOn: { p1: [{ kind: "flag", flag: "cannotClearStress" }] } })));
    expect(ofKind(plan, "clear")).toEqual([]);
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "manual", targetIds: ["p1"] }]);
  });

  it("cannotSpendHope refuses a Hope cost", () => {
    const use = card({ costs: [{ kind: "hope", amount: fixed(1) }] });
    const result = run(use, ctx([], { modsOn: { pc: [{ kind: "flag", flag: "cannotSpendHope" }] } }));
    expect(result).toMatchObject({ ok: false, reason: "cost" });
  });

  it("marksMultiplier doubles the actor's Stress cost and a Stress mark", () => {
    const use = card({ targets: { side: "ally", range: "far", count: { kind: "one" } }, costs: [{ kind: "stress", amount: fixed(1) }], steps: [{ kind: "markStress", to: "targets", amount: fixed(1) }] });
    const unstuck = [{ kind: "marksMultiplier" as const, factor: 2, of: ["hope" as const, "stress" as const, "hp" as const, "armor" as const] }];
    const plan = ok(run(use, ctx([], { targets: [pc("p1")], modsOn: { pc: unstuck, p1: unstuck } })));
    expect(plan.actor.after.stress).toBe(3);
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "p1", track: "stress", amount: 2 }]);
  });

  it("a split markStress spreads the marks as picked and asks for missing shares", () => {
    const use = card({ steps: [{ kind: "markStress", to: "allies", amount: fixed(3), distribution: "split" }] });
    const plan = ok(run(use, ctx([], { allies: [pc("a1"), pc("a2"), pc("a3")], splits: { a1: 2, a2: 5 } })));
    expect(ofKind(plan, "mark").map((m) => [m.targetId, m.amount])).toEqual([
      ["a1", 2],
      ["a2", 1],
    ]);
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "split", amount: 3 }]);
  });
});

describe("hope: dcm-nh44 split", () => {
  it("a split Hope gain goes out as picked, never more than the total", () => {
    const use = card({ steps: [{ kind: "hope", to: "selfAndAllies", change: "gain", amount: fixed(3), distribution: "split" }] });
    const plan = ok(run(use, ctx([], { allies: [pc("a1")], splits: { pc: 1, a1: 4 } })));
    expect(ofKind(plan, "hope").map((h) => [h.targetId, h.delta])).toEqual([
      ["pc", 1],
      ["a1", 2],
    ]);
    expect(ofKind(plan, "prompt")).toEqual([]);
  });
});

describe("lasting steps: dcm-iedr / dcm-b77 condition fields, dcm-rao5 / dcm-8bv", () => {
  it("a condition keeps its mods (a recorded number read), caster and roll ends, escape and endFear", () => {
    const use = card({
      targets: oneEnemy,
      steps: [
        {
          kind: "condition",
          to: "targets",
          condition: { kind: "tag", tag: "banished" },
          duration: "temporary",
          record: fixed(15),
          mods: [{ kind: "stat", stat: "evasion", delta: { kind: "recorded" } }],
          endsOnCaster: ["castsSpell"],
          escape: { trait: "presence", difficulty: fixed(16) },
          endFear: fixed(2),
        },
      ],
    });
    const plan = ok(run(use, ctx([], { targets: [adv("a")] })));
    expect(ofKind(plan, "condition")[0]).toMatchObject({
      targetId: "a",
      recorded: 15,
      mods: [{ kind: "stat", stat: "evasion", delta: 15 }],
      endsOnCaster: ["castsSpell"],
      escape: { trait: "presence" },
      endFear: 2,
    });
  });

  it("an effect carries sharedGrant and endFear", () => {
    const use = card({ steps: [{ kind: "effect", to: "selfAndAllies", label: "Bird's-Eye View", mods: [], duration: "session", sharedGrant: true, endFear: fixed(1) }] });
    const plan = ok(run(use, ctx([], { allies: [pc("a1")] })));
    expect(ofKind(plan, "effect").map((e) => [e.targetId, e.sharedGrant, e.endFear])).toEqual([
      ["pc", true, 1],
      ["a1", true, 1],
    ]);
  });
});

describe("new outcome steps: setStance, exhaust, forcedAttack, changeForm, inventory gifts", () => {
  it("setStance takes the stance named or picked; neither asks the table", () => {
    const named = ok(run(card({ steps: [{ kind: "setStance", to: "self", stance: "bear" }] }), ctx([])));
    expect(ofKind(named, "setStance")).toEqual([{ kind: "setStance", targetId: "pc", stance: "bear" }]);
    const picked = ok(run(card({ steps: [{ kind: "setStance", to: "self", choice: "stance" }] }), ctx([], { options: { stance: ["mantis"] } })));
    expect(ofKind(picked, "setStance")).toEqual([{ kind: "setStance", targetId: "pc", stance: "mantis" }]);
    const none = ok(run(card({ steps: [{ kind: "setStance", to: "self", choice: "stance" }] }), ctx([])));
    expect(ofKind(none, "prompt")).toMatchObject([{ prompt: "manual" }]);
  });

  it("exhaust spends the use until the period: the next use is refused", () => {
    const ward = card({ limit: { per: "rest", times: 3 }, steps: [{ kind: "exhaust", to: "self", per: "rest" }] });
    const plan = ok(run(ward, ctx([])));
    expect(ofKind(plan, "exhaust")).toEqual([{ kind: "exhaust", key: "card:e3r2-card", until: "rest" }]);
    const again = run(ward, ctx([], { actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("forcedAttack names the attackers and the picked victims (never an attacker)", () => {
    const use = card({ targets: oneEnemy, steps: [{ kind: "forcedAttack", to: "targets", against: { side: "enemy", range: "close", count: { kind: "one" } } }] });
    const plan = ok(run(use, ctx([], { targets: [adv("a")], picked: [adv("a"), adv("b")] })));
    expect(ofKind(plan, "forcedAttack")).toMatchObject([{ attackerIds: ["a"], againstIds: ["b"] }]);
  });

  it("changeForm swaps an adversary's stat block; a PC recipient is the table's", () => {
    const use = card({ targets: { side: "any", range: "far", count: { kind: "any" } }, steps: [{ kind: "changeForm", to: "targets", adversaryId: "lykona-dragon" }] });
    const plan = ok(run(use, ctx([], { targets: [adv("a"), pc("p1")] })));
    expect(ofKind(plan, "changeForm")).toEqual([{ kind: "changeForm", targetId: "a", adversaryId: "lykona-dragon" }]);
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "manual", targetIds: ["p1"] }]);
  });

  it("giveGold and giveItem become inventory steps", () => {
    const use = card({
      steps: [
        { kind: "inventory", to: "self", op: "giveGold" },
        { kind: "inventory", to: "self", op: "giveItem", text: "a unique tool" },
      ],
    });
    const plan = ok(run(use, ctx([])));
    expect(ofKind(plan, "inventory")).toEqual([
      { kind: "inventory", targetId: "pc", op: "giveGold", amount: 1 },
      { kind: "inventory", targetId: "pc", op: "giveItem", text: "a unique tool" },
    ]);
  });
});

describe("follow-ups: dcm-4yg4 checkFails and perLink", () => {
  const strike = (check: { dice?: { count: ReturnType<typeof fixed>; sides: 6 | 8 }; test: { kind: "totalAtLeast"; value: number } | { kind: "allEven" } }) =>
    card({
      targets: oneEnemy,
      steps: [
        { kind: "damage", to: "targets", roll: d(8), type: "magic" },
        {
          kind: "followUp",
          targets: oneEnemy,
          // Each bounce is its own attack (a d20 that always hits), so its damage is rolled again.
          roll: { kind: "adversaryAttack", difficulty: fixed(1) },
          repeat: { until: "checkFails", check, perLink: { kind: "add", amount: fixed(-2) } },
          steps: [{ kind: "damage", to: "targets", roll: d(8), type: "magic" }],
        },
      ],
    });

  it("a fresh check below the line stops the chain", () => {
    // Main d8 = 6. Link 0 (b): d20 10, d8 = 5, check d6 = 4 holds. Link 1 (c): d20 10, d8 = 7 - 2 = 5, check d6 = 2 stops.
    const rng = queueRng([6, 10, 5, 4, 10, 7, 2]);
    const plan = ok(
      run(strike({ dice: { count: fixed(1), sides: 6 }, test: { kind: "totalAtLeast", value: 4 } }), {
        ...ctx([]),
        rng,
        targets: [adv("a")],
        followUp: [adv("b")],
        chain: [[adv("c")], [adv("e")]],
      }),
    );
    rng.done();
    expect(ofKind(plan, "check").map((c) => c.passed)).toEqual([true, false]);
    expect(ofKind(plan, "damage").map((s) => [s.result.targetId, s.result.incoming])).toEqual([
      ["a", 6],
      ["b", 5],
      ["c", 5],
    ]);
    expect(ofKind(plan, "prompt")).toEqual([]);
  });

  it("without dice the link's own damage dice are tested (all even goes on)", () => {
    // Main d8 = 3. Link 0 (b): d20 10, d8 = 4 (even) goes on. Link 1 (c): d20 10, d8 = 5 (odd) stops.
    const rng = queueRng([3, 10, 4, 10, 5]);
    const plan = ok(run(strike({ test: { kind: "allEven" } }), { ...ctx([]), rng, targets: [adv("a")], followUp: [adv("b")], chain: [[adv("c")], [adv("e")]] }));
    rng.done();
    expect(ofKind(plan, "check").map((c) => [c.dice, c.passed])).toEqual([
      [[4], true],
      [[5], false],
    ]);
  });
});

describe("costs and numbers: dcm-a9c / dcm-4zti paidBy, dcm-rs1z env", () => {
  const payerWith = (hope: number) => ({ hope, stress: 0, stressMax: 6, hp: 0, hpMax: 6, armor: 0, armorMax: 3, cardTokens: 0 });

  it("a use paidBy the picked ally is paid by them and refused when the server says they can't", () => {
    const use = card({ paidBy: "picked", costs: [{ kind: "hope", amount: fixed(1) }] });
    const paid = ok(run(use, ctx([], { picked: [pc("ally")], payers: { picked: payerWith(2) } })));
    expect(ofKind(paid, "pay")[0]).toMatchObject({ phase: "upfront", paid: true, payerId: "ally" });
    expect(paid.actor.after.hope).toBe(2);
    const short = run(use, ctx([], { picked: [pc("ally")], payers: { picked: payerWith(0) } }));
    expect(short).toMatchObject({ ok: false, reason: "cost" });
  });

  it("tideTokens and class dice reach the numbers", () => {
    const use = card({ steps: [{ kind: "hope", to: "self", change: "gain", amount: { kind: "tideTokens" } }] });
    const plan = ok(run(use, ctx([], { actor: actor({ tideTokens: 3 }) })));
    expect(ofKind(plan, "hope")[0]?.delta).toBe(3);
  });

  it("rollTargetCount reads the player's choices", () => {
    const use: CardUse = {
      id: "ire",
      name: "Otherworldly Ire",
      activation: { kind: "action" },
      targets: { side: "enemy", range: "close", count: { kind: "upTo", rolledFirst: true, n: { kind: "dice", dice: { count: { kind: "chosen", choice: "favor" }, sides: 6 } } } },
      steps: [],
    };
    // Two dice (the 2 Favor chosen): 2 + 5.
    expect(rollTargetCount(use, actor(), queueRng([2, 5]), { favor: 2 })).toBe(7);
  });
});

describe("cardChoices: dcm-86z triggerDamageType", () => {
  it("parses physical / magic / both and refuses anything else", () => {
    expect(parseChoices([{ id: "triggerDamageType", value: "magic" }]).triggerDamageType).toBe("magic");
    expect(() => parseChoices([{ id: "triggerDamageType", value: "fire" }])).toThrow();
  });
});
