import { describe, expect, it } from "vitest";

import { asksTriggerDamageType, swapsWithVault } from "@/components/combat-map/actions/hand/dialog";
import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, DamageRoll, NumberSource } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import type { MapCreature } from "@/lib/domain/combat-actions/numbers";
import { queueRng } from "@/lib/domain/dice";

// Plan lanes-2, tracer E3.3 (round 3; docs/tasks/TASK-LN3-E3.md): map creatures for `creatureCount` (dcm-ldom), stats
// from the creatures (dcm-91tx), payer flags (dcm-hgvx), a fresh damage roll per chain link (dcm-q13x) and the Hand
// dialog's swap / trigger-type asks (dcm-aw16, dcm-u4pq). Inline fixtures. RNG order: Hope die, Fear die, then the dice
// the steps roll in order.

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

const card = (use: Partial<CardUse>, cardId = "e3r3-card"): CardEffect => ({
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

/** A use dealing `amount` flat physical damage to its one target. */
const flatDamage = (amount: NumberSource) => card({ targets: oneEnemy, steps: [{ kind: "damage", to: "targets", roll: { kind: "flat", amount }, type: "physical" }] });

const incoming = (plan: RunPlan) => ofKind(plan, "damage").map((s) => s.result.incoming);

/** A use marking `amount` Stress on its one target: the amount is resolved per recipient, so `who: "target"` reads it. */
const stressMarks = (amount: NumberSource) => card({ targets: oneEnemy, steps: [{ kind: "markStress", to: "targets", amount }] });
const marked = (plan: RunPlan) => ofKind(plan, "mark").map((s) => s.amount);
const roomy = { stressMax: 30 };

describe("dcm-ldom: map creatures for creatureCount", () => {
  const map: MapCreature[] = [
    { id: "a", side: "enemy", pc: false },
    { id: "b", side: "enemy", pc: false },
    { id: "p1", side: "ally", pc: true },
  ];
  const count = flatDamage({ kind: "creatureCount", side: "enemies" });

  it("reads RunContext.creatures (Hive Mind, HF p.65)", () => {
    expect(incoming(ok(run(count, ctx([], { targets: [adv("a")], creatures: map }))))).toEqual([2]);
  });

  it("RunContext.creatures wins over numbers.creatures; numbers.creatures still works alone", () => {
    const one: MapCreature[] = [{ id: "a", side: "enemy", pc: false }];
    expect(incoming(ok(run(count, ctx([], { targets: [adv("a")], creatures: map, numbers: { creatures: one } }))))).toEqual([2]);
    expect(incoming(ok(run(count, ctx([], { targets: [adv("a")], numbers: { creatures: one } }))))).toEqual([1]);
  });

  it("without creatures the count reads 0, as before", () => {
    const plan = ok(run(count, ctx([], { targets: [adv("a")] })));
    expect(incoming(plan).every((n) => n === 0)).toBe(true);
  });
});

describe("dcm-91tx: stats from the creatures", () => {
  it("a target's Major threshold comes from its thresholds", () => {
    const plan = ok(run(stressMarks({ kind: "stat", stat: "majorThreshold", who: "target" }), ctx([], { targets: [adv("a", roomy)] })));
    expect(marked(plan)).toEqual([8]);
  });

  it("the actor's Armor Score is its Armor Slots; a PC target's Evasion is its own", () => {
    expect(incoming(ok(run(flatDamage({ kind: "stat", stat: "armorScore", who: "self" }), ctx([], { targets: [adv("a")] }))))).toEqual([3]);
    const plan = ok(run(stressMarks({ kind: "stat", stat: "evasion", who: "target" }), ctx([], { targets: [pc("p1", roomy)] })));
    expect(marked(plan)).toEqual([12]);
  });

  it("the server's numbers and the actor's own stats win over the derived ones", () => {
    const major = stressMarks({ kind: "stat", stat: "majorThreshold", who: "target" });
    const byId = { a: { hp: 0, stress: 0, stats: { majorThreshold: 5 } } };
    expect(marked(ok(run(major, ctx([], { targets: [adv("a", roomy)], numbers: { byId } }))))).toEqual([5]);
    const armor = flatDamage({ kind: "stat", stat: "armorScore", who: "self" });
    expect(incoming(ok(run(armor, ctx([], { actor: actor({ stats: { armorScore: 6 } }), targets: [adv("a")] }))))).toEqual([6]);
  });

  it("a Minion's missing thresholds read 0", () => {
    const minion = adv("m", { thresholds: { major: null, severe: null } });
    const plan = ok(run(stressMarks({ kind: "stat", stat: "severeThreshold", who: "target" }), ctx([], { targets: [minion] })));
    expect(marked(plan).every((n) => n === 0)).toBe(true);
  });
});

describe("dcm-hgvx: payer flags", () => {
  const hope = { kind: "hope" as const, amount: fixed(1) };
  const described = { hope: 5, stress: 0, stressMax: 6, hp: 0, hpMax: 6, armor: 0, armorMax: 3, cardTokens: 0 };
  const ravenous = [{ kind: "flag" as const, flag: "cannotSpendHope" as const }];

  it("the actor's cannotSpendHope refuses a Hope cost through PayerState.flags (Ravenous, HF p.94)", () => {
    const result = run(card({ costs: [hope] }), ctx([], { modsOn: { pc: ravenous } }));
    expect(result).toMatchObject({ ok: false, reason: "cost" });
  });

  it("a described payer gets its creature's flags: a Ravenous holder can't pay", () => {
    const use = card({ paidBy: "triggerSubject", costs: [hope] });
    const subject = pc("p1");
    expect(run(use, ctx([], { trigger: { subject }, payers: { triggerSubject: described }, modsOn: { p1: ravenous } }))).toMatchObject({ ok: false, reason: "cost" });
    expect(run(use, ctx([], { trigger: { subject }, payers: { triggerSubject: described } }))).toMatchObject({ ok: true });
  });

  it("an optional Hope add-on is skipped while the actor can't spend Hope", () => {
    const use = card({ steps: [{ kind: "optional", id: "more", label: "More", costs: [hope], steps: [{ kind: "hope", to: "self", change: "gain", amount: fixed(2) }] }] });
    const plan = ok(run(use, ctx([], { optionals: ["more"], modsOn: { pc: ravenous } })));
    expect(ofKind(plan, "pay")).toMatchObject([{ phase: "optional", paid: false }]);
  });

  it("cannotClearHp turns an HP clear into a manual line (Afflicted, HF p.95); Stress still clears", () => {
    const use = card({
      steps: [
        { kind: "clear", to: "picked", track: "hp", amount: fixed(1) },
        { kind: "clear", to: "picked", track: "stress", amount: fixed(1) },
      ],
    });
    const plan = ok(run(use, ctx([], { picked: [pc("p1", { hp: 2, stress: 2 })], modsOn: { p1: [{ kind: "flag", flag: "cannotClearHp" }] } })));
    expect(ofKind(plan, "clear").map((s) => [s.track, s.amount])).toEqual([["stress", 1]]);
    expect(ofKind(plan, "prompt").map((p) => p.text)).toEqual(["Can't clear Hit Points now"]);
  });
});

describe("dcm-q13x / dcm-rou: a fresh damage roll per chain link (Chain Lightning, CB p.328)", () => {
  const chain = card({
    roll: { kind: "spellcast", difficulty: { kind: "target" } },
    targets: oneEnemy,
    steps: [
      { kind: "damage", to: "targets", when: ["hit"], roll: d(4), type: "magic" },
      {
        kind: "followUp",
        targets: { side: "enemy", range: "close", count: { kind: "any" }, origin: "chain" },
        repeat: { until: "noTargets" },
        steps: [{ kind: "damage", to: "targets", roll: d(4), type: "magic" }],
      },
    ],
  });
  const links = { targets: [adv("a")], followUp: [adv("b", { difficulty: 1 }), adv("c", { difficulty: 1 })], chain: [[adv("d", { difficulty: 1 })], []] };

  it("with freshLinkDamage each link rolls again; the creatures of one link share that link's roll (R9)", () => {
    // Main 6 + 4 + 3 = 13 hits a: d4 = 1. Link 0 (b, c): d4 = 2 for both. Link 1 (d): d4 = 3. Link 2: empty.
    const rng = queueRng([6, 4, 1, 2, 3]);
    const plan = ok(run(chain, { ...ctx([]), rng, ...links, freshLinkDamage: true }));
    rng.done();
    expect(ofKind(plan, "damageRoll").map((s) => s.record.total)).toEqual([1, 2, 3]);
    expect(ofKind(plan, "damage").map((s) => [s.result.targetId, s.result.incoming])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 2],
      ["d", 3],
    ]);
  });

  it("without it the links share the move's damage, as before", () => {
    const rng = queueRng([6, 4, 1]);
    const plan = ok(run(chain, { ...ctx([]), rng, ...links }));
    rng.done();
    expect(ofKind(plan, "damage").map((s) => s.result.incoming)).toEqual([1, 1, 1, 1]);
  });

  it("a follow-up with its own roll already rolls its own damage, flag or not", () => {
    const own = card({
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: oneEnemy,
      steps: [
        {
          kind: "followUp",
          roll: { kind: "spellcast", difficulty: { kind: "target" } },
          targets: oneEnemy,
          repeat: { until: "miss" },
          steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: d(4), type: "physical" }],
        },
      ],
    });
    // Main 6 + 4. Link 0 vs b: 6 + 3 + 3 = 12 hits, d4 = 2. Link 1 vs c: 1 + 2 + 3 = 6 misses: stop.
    const rng = queueRng([6, 4, 6, 3, 2, 1, 2]);
    const plan = ok(run(own, { ...ctx([]), rng, targets: [adv("a")], followUp: [adv("b")], chain: [[adv("c")]], freshLinkDamage: true }));
    rng.done();
    expect(ofKind(plan, "damage").map((s) => [s.result.targetId, s.result.incoming])).toEqual([["b", 2]]);
  });
});

describe("dcm-aw16 / dcm-u4pq: the Hand dialog's asks", () => {
  const use = (steps: CardUse["steps"]): CardUse => ({ id: "main", name: "Test", activation: { kind: "action" }, steps });

  it("swapsWithVault finds a loadout swapWithVault step, also inside an optional (Codex-Touched, CB p.333)", () => {
    expect(swapsWithVault(use([{ kind: "loadout", to: "self", op: "swapWithVault" }]))).toBe(true);
    expect(swapsWithVault(use([{ kind: "optional", id: "o", label: "Swap", steps: [{ kind: "loadout", to: "self", op: "swapWithVault" }] }]))).toBe(true);
    expect(swapsWithVault(use([{ kind: "hope", to: "self", change: "gain", amount: fixed(1) }]))).toBe(false);
  });

  it("asksTriggerDamageType finds a sameAsTrigger damage step (Encore, CB p.335)", () => {
    expect(asksTriggerDamageType(use([{ kind: "damage", to: "targets", roll: { kind: "sameAsTrigger" }, type: "weapon" }]))).toBe(true);
    expect(asksTriggerDamageType(use([{ kind: "damage", to: "targets", roll: d(6), type: "magic" }]))).toBe(false);
  });
});
