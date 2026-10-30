import { describe, expect, it } from "vitest";

import { parseChoices } from "../../../convex/lib/cardChoices";
import { run, type ActorState, type DelegateRequest, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, DamageRoll, Step } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

// Plan lanes, tracer E3: card and feature steps, choices and saves in the pure runner (docs/tasks/TASK-LN-E3.md). Every
// entry here is an inline fixture (wave 5 switches the SRD entries over). Expected values are worked by hand from the
// fixture and the queued dice. RNG order: Hope die, Fear die, then the dice the steps roll in order.

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

const card = (use: Partial<CardUse>, cardId = "e3-card"): CardEffect => ({
  cardId,
  uses: [{ id: "main", name: "Test", activation: { kind: "action" }, steps: [], ...use }],
});

const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 2, rng: queueRng(dice), ...over });

function ok(result: ReturnType<typeof run>): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

const spellcast = { kind: "spellcast" as const, difficulty: { kind: "target" as const } };
const oneEnemy = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };

describe("dcm-vv2 item 2: a follow-up's damage is its own roll", () => {
  const twice = card({
    roll: spellcast,
    targets: oneEnemy,
    steps: [
      { kind: "damage", to: "targets", when: ["hit"], roll: d(8), type: "magic" },
      { kind: "followUp", roll: spellcast, targets: oneEnemy, steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: d(8), type: "magic" }] },
    ],
  });

  it("the same damage expression rolls again for the follow-up", () => {
    // Main: 6 + 4 + 3 = 13 hits a (12); d8 = 5. Follow-up: 5 + 3 + 3 = 11 hits b (10); d8 = 7 (not the cached 5).
    const rng = queueRng([6, 4, 5, 5, 3, 7]);
    const plan = ok(run(twice, { ...ctx([]), rng, targets: [adv("a")], followUp: [adv("b", { difficulty: 10 })] }));
    rng.done();
    expect(ofKind(plan, "damageRoll").map((s) => s.record.total)).toEqual([5, 7]);
  });

  it("a follow-up's critical is its own roll's, not the main roll's", () => {
    // Main: 4 / 4 critical, d8 = 2 plus the maximum 8 = 10. Follow-up: 6 + 2 + 3 = 11 hits b; d8 = 3, no critical.
    const rng = queueRng([4, 4, 2, 6, 2, 3]);
    const plan = ok(run(twice, { ...ctx([]), rng, targets: [adv("a")], followUp: [adv("b", { difficulty: 10 })] }));
    rng.done();
    expect(ofKind(plan, "damageRoll").map((s) => s.record.total)).toEqual([10, 3]);
  });
});

describe("dcm-bz8 / dcm-6ju: per-recipient choices (`by`)", () => {
  const inspiration = card({
    steps: [
      {
        kind: "choose",
        id: "boon",
        label: "Clear a Stress or gain a Hope",
        by: { to: "allies" },
        options: [
          { id: "stress", label: "Clear a Stress", steps: [{ kind: "clear", to: "chooser", track: "stress", amount: fixed(1) }] },
          { id: "hope", label: "Gain a Hope", steps: [{ kind: "hope", to: "chooser", change: "gain", amount: fixed(1) }] },
        ],
      },
    ],
  });

  it("each ally's own pick runs on them; an ally without a pick is asked", () => {
    const allies = [pc("a1", { stress: 2 }), pc("a2"), pc("a3")];
    const plan = ok(run(inspiration, ctx([], { allies, chooserOptions: { boon: { a1: ["stress"], a2: ["hope"] } } })));
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "a1", track: "stress", amount: 1 }]);
    expect(ofKind(plan, "hope")).toEqual([{ kind: "hope", targetId: "a2", delta: 1 }]);
    expect(ofKind(plan, "prompt").map((p) => [p.prompt, p.chooserId])).toEqual([["choose", "a3"]]);
  });

  it("an optional with `by`: each chooser that takes it pays for themselves", () => {
    const money = card({
      steps: [
        {
          kind: "optional",
          id: "pay",
          label: "Mark a Stress",
          costs: [{ kind: "stress", amount: fixed(1) }],
          by: { to: "allies" },
          steps: [{ kind: "hope", to: "chooser", change: "gain", amount: fixed(1) }],
        },
      ],
    });
    const plan = ok(run(money, ctx([], { allies: [pc("a1"), pc("a2")], chooserOptionals: { pay: { a1: true, a2: false } } })));
    expect(ofKind(plan, "pay").map((p) => [p.payerId, p.paid])).toEqual([["a1", true]]);
    expect(ofKind(plan, "mark").map((m) => [m.targetId, m.track, m.amount])).toEqual([["a1", "stress", 1]]);
    expect(ofKind(plan, "hope")).toEqual([{ kind: "hope", targetId: "a1", delta: 1 }]);
  });
});

describe("dcm-40m: two choose steps kept distinct", () => {
  const poison = (id: string): Step => ({
    kind: "choose",
    id,
    label: id,
    ...(id === "second" ? { distinctFrom: "first" } : {}),
    options: [
      { id: "numbing", label: "Numbing", steps: [{ kind: "manual", to: "self", text: "numbing" }] },
      { id: "grasping", label: "Grasping", steps: [{ kind: "manual", to: "self", text: "grasping" }] },
    ],
  });
  const twinFang = card({ steps: [poison("first"), poison("second")] });

  it("the same option twice refuses the use", () => {
    const result = run(twinFang, ctx([], { options: { first: ["numbing"], second: ["numbing"] } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("choice");
  });

  it("two different options both run", () => {
    const plan = ok(run(twinFang, ctx([], { options: { first: ["numbing"], second: ["grasping"] } })));
    expect(ofKind(plan, "prompt").map((p) => p.text)).toEqual(["numbing", "grasping"]);
  });
});

describe("number choices: dcm-uyc listed values, dcm-fnq max after the targets, dcm-8x8 free slots", () => {
  const teleport = card({ choices: [{ id: "bonus", label: "Bonus", min: -2, values: [3, 1, 0, -2] }] });

  it("only a listed value passes; the default is the first listed", () => {
    expect(run(teleport, ctx([], { choices: { bonus: 2 } })).ok).toBe(false);
    expect(run(teleport, ctx([], { choices: { bonus: -2 } })).ok).toBe(true);
    expect(run(teleport, ctx([])).ok).toBe(true);
  });

  it("an afterTargets max reads the target's marked Stress (Share the Burden)", () => {
    const share = card({
      targets: { side: "ally", range: "melee", count: { kind: "one" } },
      choices: [{ id: "n", label: "Stress", min: 0, max: { kind: "marked", who: "target", track: "stress" }, afterTargets: true }],
      steps: [{ kind: "hope", to: "self", change: "gain", amount: { kind: "chosen", choice: "n" } }],
    });
    const ally = pc("a1", { stress: 2 });
    expect(run(share, ctx([], { targets: [ally], choices: { n: 3 } })).ok).toBe(false);
    expect(ofKind(ok(run(share, ctx([], { targets: [ally], choices: { n: 2 } }))), "hope")).toEqual([{ kind: "hope", targetId: "pc", delta: 2 }]);
  });

  it("a `free` max is the unmarked Stress slots (Confusing Aura: mark any number of Stress)", () => {
    const aura = card({ choices: [{ id: "n", label: "Stress", min: 0, max: { kind: "free", who: "self", track: "stress" } }] });
    expect(run(aura, ctx([], { choices: { n: 5 } })).ok).toBe(true);
    expect(run(aura, ctx([], { choices: { n: 6 } })).ok).toBe(false);
  });
});

describe("number sources and recipients", () => {
  it("dcm-0ib: markedThisMove who:target for a self recipient reads the use's target (Siphon Essence)", () => {
    const siphon = card({
      roll: spellcast,
      targets: oneEnemy,
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "flat", amount: fixed(10) }, type: "magic" },
        { kind: "clear", to: "self", track: "hp", amount: { kind: "markedThisMove", who: "target", track: "hp" } },
      ],
    });
    // 10 damage against 8/14 is Major: 2 HP. The actor clears 2 of its 3 marked HP.
    const plan = ok(run(siphon, ctx([6, 4], { actor: actor({ hp: 3 }), targets: [adv("a")] })));
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "pc", track: "hp", amount: 2 }]);
  });

  it("dcm-d1b: dualityDie reads this move's Fear Die, else the host roll's (Midnight-Touched)", () => {
    const own = card({ roll: spellcast, targets: oneEnemy, steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "flat", amount: { kind: "dualityDie", die: "fear" } }, type: "magic" }] });
    expect(ofKind(ok(run(own, ctx([5, 6], { targets: [adv("a")] }))), "damageRoll")[0]!.record.total).toBe(6);
    const rider = card({ steps: [{ kind: "damage", to: "targets", roll: { kind: "flat", amount: { kind: "dualityDie", die: "fear" } }, type: "magic" }], targets: oneEnemy });
    expect(ofKind(ok(run(rider, ctx([], { targets: [adv("a")], hostRoll: { hope: 7, fear: 4 } }))), "damageRoll")[0]!.record.total).toBe(4);
  });

  it("dcm-y45: a pick among the targets the roll hit (Stunning Sunlight)", () => {
    const sunlight = card({
      roll: spellcast,
      targets: { side: "enemy", range: "far", count: { kind: "any" } },
      steps: [{ kind: "condition", to: "picked", pick: { side: "enemy", range: "far", count: { kind: "any" }, among: "hit" }, condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }],
    });
    // 5 + 4 + 3 = 12: a (12) is hit, b (14) is not; c is not a target at all.
    const plan = ok(run(sunlight, ctx([5, 4], { targets: [adv("a"), adv("b", { difficulty: 14 })], picked: [adv("a"), adv("b", { difficulty: 14 }), adv("c")] })));
    expect(ofKind(plan, "condition").map((c) => c.targetId)).toEqual(["a"]);
  });

  it("dcm-qbn: the picked held dice are spent first (Prayer Dice)", () => {
    const prayer = card({ costs: [{ kind: "tokens", amount: fixed(1), pool: "prayer" }], steps: [{ kind: "clear", to: "self", track: "stress", amount: { kind: "spent", resource: "heldDie" } }] });
    const heldDice = [
      { id: "p1", kind: "prayer" as const, sides: 4, value: 2 },
      { id: "p2", kind: "prayer" as const, sides: 4, value: 4 },
    ];
    const plan = ok(run(prayer, ctx([], { actor: actor({ stress: 5, heldDice }), heldDicePicks: ["p2"] })));
    expect(ofKind(plan, "clear")[0]!.amount).toBe(4);
    expect(plan.actor.after.heldDice?.map((x) => x.id)).toEqual(["p1"]);
  });
});

describe("steps", () => {
  it("dcm-5xi: a target who can't lose a Hope marks 2 Stress instead (Dreadhowl)", () => {
    const dreadhowl = card({
      targets: { side: "enemy", range: "veryClose", count: { kind: "all" } },
      steps: [{ kind: "hope", to: "targets", change: "lose", amount: fixed(1), ifUnable: [{ kind: "markStress", to: "targets", amount: fixed(2) }] }],
    });
    const plan = ok(run(dreadhowl, ctx([], { targets: [pc("p1"), pc("p2"), pc("p3")], hopeOf: { p1: 0, p2: 2 } })));
    expect(ofKind(plan, "mark").map((m) => [m.targetId, m.track, m.amount])).toEqual([["p1", "stress", 2]]);
    expect(ofKind(plan, "hope").map((h) => [h.targetId, h.delta])).toEqual([
      ["p2", -1],
      ["p3", -1],
    ]);
    // p3's Hope is unknown: the loss goes out and the table is asked about the alternative.
    expect(ofKind(plan, "prompt").map((p) => p.targetIds)).toEqual([["p3"]]);
  });

  it("dcm-xp0: bramble tokens on a creature, and a gate that reads them (Encumber, Crush)", () => {
    const encumber = card({
      targets: oneEnemy,
      steps: [
        { kind: "tokens", to: "targets", holder: "recipient", name: "bramble", op: "add", amount: fixed(1) },
        { kind: "condition", to: "targets", when: [{ kind: "targetCheck", check: { kind: "tokens", who: "target", name: "bramble", atLeast: 3 } }], condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" },
      ],
    });
    const two = ok(run(encumber, ctx([], { targets: [pc("p1")], creatureTokens: { p1: { bramble: 2 } } })));
    expect(ofKind(two, "creatureTokens")).toEqual([{ kind: "creatureTokens", targetId: "p1", name: "bramble", op: "add", before: 2, after: 3 }]);
    expect(ofKind(two, "condition").map((c) => c.targetId)).toEqual(["p1"]);
    const none = ok(run(encumber, ctx([], { targets: [pc("p1")] })));
    expect(ofKind(none, "condition")).toEqual([]);
  });

  it("dcm-5xi / dcm-18i: a `track` state check reads the recipient's marks and free slots", () => {
    const gate = card({
      targets: { side: "enemy", range: "far", count: { kind: "all" } },
      steps: [{ kind: "markHp", to: "targets", when: [{ kind: "targetCheck", check: { kind: "track", who: "target", track: "armor", measure: "free", atMost: 0 } }], amount: fixed(1) }],
    });
    const plan = ok(run(gate, ctx([], { targets: [pc("full", { armor: 3 }), pc("room", { armor: 1 })] })));
    expect(ofKind(plan, "mark").map((m) => m.targetId)).toEqual(["full"]);
  });

  it("dcm-730: clear every condition and tag (Purifying Aura)", () => {
    const aura = card({ steps: [{ kind: "clearCondition", to: "allies", all: true, condition: { kind: "standard", condition: "vulnerable" } }] });
    const plan = ok(run(aura, ctx([], { allies: [pc("a1", { conditions: ["vulnerable", "restrained"], tags: ["Horrified"] })] })));
    expect(ofKind(plan, "clearCondition").map((c) => c.condition)).toEqual([
      { kind: "standard", condition: "vulnerable" },
      { kind: "standard", condition: "restrained" },
      { kind: "tag", tag: "Horrified" },
    ]);
    expect(plan.creatures[0]!.after.conditions).toEqual([]);
  });

  it("dcm-8x8 / dcm-5fc: end this card's own effect, or another feature's", () => {
    const ends = card({
      steps: [
        { kind: "endEffect", to: "self" },
        { kind: "endEffect", to: "self", of: "wolf-form" },
      ],
    });
    expect(ofKind(ok(run(ends, ctx([]))), "endEffect")).toEqual([
      { kind: "endEffect", targetId: "pc", of: "e3-card", own: true },
      { kind: "endEffect", targetId: "pc", of: "wolf-form", own: false },
    ]);
  });

  it("dcm-0gh: an inventory step with a gold amount (Quick Hands, Expensive Failure)", () => {
    const thief = card({
      targets: oneEnemy,
      steps: [
        { kind: "inventory", to: "targets", op: "take", item: "consumable" },
        { kind: "inventory", to: "targets", op: "takeGold", amount: { kind: "gold", who: "target", unit: "handful" } },
      ],
    });
    expect(ofKind(ok(run(thief, ctx([], { targets: [pc("p1")], goldOf: { p1: 13 } }))), "inventory")).toEqual([
      { kind: "inventory", targetId: "p1", op: "take", item: "consumable" },
      { kind: "inventory", targetId: "p1", op: "takeGold", amount: 13 },
    ]);
  });

  it("dcm-yzr: ground a flyer (Mystic Tether)", () => {
    const tether = card({ targets: oneEnemy, steps: [{ kind: "move", to: "targets", mode: "ground" }] });
    const plan = ok(run(tether, ctx([], { targets: [adv("a", { flying: true })] })));
    expect(plan.creatures[0]!.after.flying).toBe(false);
    expect(ofKind(plan, "prompt").map((p) => p.text)).toEqual(["Ground"]);
  });

  it("dcm-zhc: forced HP marks spread, at most three on one creature (Force Salvo)", () => {
    const salvo = card({ steps: [{ kind: "markHp", to: "picked", distribution: "split", maxPer: 3, amount: fixed(5) }] });
    const plan = ok(run(salvo, ctx([], { picked: [pc("p1"), pc("p2")], splits: { p1: 4, p2: 2 } })));
    expect(ofKind(plan, "mark").map((m) => [m.targetId, m.amount])).toEqual([
      ["p1", 3],
      ["p2", 2],
    ]);
    const asked = ok(run(salvo, ctx([], { picked: [pc("p1"), pc("p2")], splits: { p1: 1 } })));
    expect(ofKind(asked, "prompt").map((p) => [p.prompt, p.amount])).toEqual([["split", 5]]);
  });

  it("dcm-kkx: a non-stacking effect is dropped on a creature that has it (Blight Seed)", () => {
    const seed = card({ targets: oneEnemy, steps: [{ kind: "effect", to: "targets", label: "Blight Seed", mods: [], duration: "scene", stacking: "refuse" }] });
    expect(ofKind(ok(run(seed, ctx([], { targets: [adv("a")], effectsOn: { a: ["Blight Seed"] } }))), "effect")).toEqual([]);
    expect(ofKind(ok(run(seed, ctx([], { targets: [adv("a")] }))), "effect").map((e) => e.stacking)).toEqual(["refuse"]);
  });

  it("dcm-d1d: a delegate step gets the use's own roll and whether it hit (Ranger's Focus)", () => {
    const seen: DelegateRequest[] = [];
    const focus = card({ roll: spellcast, targets: oneEnemy, steps: [{ kind: "delegate", to: "targets", feature: "rangersFocus" }] });
    ok(
      run(
        focus,
        ctx([6, 4], {
          targets: [adv("a")],
          delegate: (request) => {
            seen.push(request);
            return { ok: true, actor: request.actor, summary: "Focus" };
          },
        }),
      ),
    );
    expect(seen[0]!.roll?.total).toBe(13);
    expect(seen[0]!.hit).toBe(true);
  });
});

describe("dcm-27j: checks with a table and a parity test", () => {
  const broken = card({
    steps: [
      {
        kind: "check",
        dice: { count: fixed(1), sides: 6 },
        test: { kind: "totalAtLeast", value: 99 },
        then: [],
        otherwise: [{ kind: "manual", to: "self", text: "no row" }],
        table: [
          { atLeast: 1, atMost: 2, label: "one", steps: [{ kind: "manual", to: "self", text: "1-2" }] },
          { atLeast: 3, atMost: 4, label: "two", steps: [{ kind: "manual", to: "self", text: "3-4" }] },
          { atLeast: 5, atMost: 6, label: "three", steps: [{ kind: "manual", to: "self", text: "5-6" }] },
        ],
      },
    ],
  });

  it("the row holding the total runs (Broken Magic)", () => {
    const plan = ok(run(broken, ctx([4])));
    expect(ofKind(plan, "check")).toEqual([{ kind: "check", total: 4, dice: [4], passed: true, row: 1, label: "two" }]);
    expect(ofKind(plan, "prompt").map((p) => p.text)).toEqual(["3-4"]);
  });

  it("an even / odd test (Stone of Omens)", () => {
    const omen = card({ steps: [{ kind: "check", dice: { count: fixed(1), sides: 12 }, test: { kind: "even" }, then: [{ kind: "manual", to: "self", text: "even" }], otherwise: [{ kind: "manual", to: "self", text: "odd" }] }] });
    expect(ofKind(ok(run(omen, ctx([8]))), "prompt").map((p) => p.text)).toEqual(["even"]);
    expect(ofKind(ok(run(omen, ctx([7]))), "prompt").map((p) => p.text)).toEqual(["odd"]);
  });
});

describe("dcm-rou / dcm-7az: repeating follow-ups", () => {
  const chain = card({
    roll: spellcast,
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

  it("each link drops creatures already targeted and the chain stops at an empty link (Chain Lightning)", () => {
    // Main 6 + 4 + 3 = 13 hits a: d4 = 1. Links without a roll of their own share the move's damage (R9, as CA's Chain
    // Lightning entry reads it): link 0 (b), link 1 (c; a was targeted already). Link 2: empty.
    const rng = queueRng([6, 4, 1]);
    const plan = ok(run(chain, { ...ctx([]), rng, targets: [adv("a")], followUp: [adv("b", { difficulty: 1 })], chain: [[adv("c", { difficulty: 1 }), adv("a")], []] }));
    rng.done();
    expect(ofKind(plan, "damageRoll").map((s) => s.record.total)).toEqual([1, 1, 1]);
    expect(ofKind(plan, "damage").map((s) => s.result.targetId)).toEqual(["a", "b", "c"]);
    expect(ofKind(plan, "prompt")).toEqual([]);
  });

  it("out of links, the plan asks for the next one", () => {
    const plan = ok(run(chain, ctx([6, 4, 1], { targets: [adv("a")], followUp: [adv("b", { difficulty: 1 })] })));
    expect(ofKind(plan, "prompt").map((p) => [p.prompt, p.amount, p.targetIds])).toEqual([["followUp", 1, ["b"]]]);
  });

  it("until a miss, paying a Stress before each repeat (Rip & Tear)", () => {
    const rip = card({
      roll: spellcast,
      targets: oneEnemy,
      steps: [
        {
          kind: "followUp",
          roll: spellcast,
          targets: oneEnemy,
          repeat: { until: "miss", costEach: [{ kind: "stress", amount: fixed(1) }] },
          steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: d(4), type: "physical" }],
        },
      ],
    });
    // Main 6 + 4 + 3 = 13. Link 0 vs b: 6 + 3 + 3 = 12 hits (12), d4 = 2. Stress paid. Link 1 vs c: 1 + 2 + 3 = 6 misses: stop.
    const rng = queueRng([6, 4, 6, 3, 2, 1, 2]);
    const plan = ok(run(rip, { ...ctx([]), rng, targets: [adv("a")], followUp: [adv("b")], chain: [[adv("c")], [adv("d")]] }));
    rng.done();
    expect(ofKind(plan, "pay").map((p) => [p.phase, p.paid])).toEqual([["afterRoll", true]]);
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "damage").map((s) => s.result.targetId)).toEqual(["b"]);
    expect(ofKind(plan, "prompt")).toEqual([]);
  });
});

describe("saves: dcm-fev auto-fail, dcm-rb0 advantage, dcm-q0a raised, dcm-b77 falling", () => {
  const base = (over: Partial<Extract<Step, { kind: "save" }>>): CardEffect =>
    card({
      targets: { side: "enemy", range: "veryClose", count: { kind: "all" } },
      steps: [{ kind: "save", to: "targets", difficulty: fixed(12) as never, onFail: [{ kind: "markStress", to: "targets", amount: fixed(1) }], onSuccess: [], ...over }],
    });

  it("restrained recipients fail without rolling (Bee-Ruption)", () => {
    const bee = base({ difficulty: { kind: "fixed", value: 12 }, autoFail: [{ kind: "standard", condition: "restrained" }] });
    const plan = ok(run(bee, ctx([], { targets: [pc("p1", { conditions: ["restrained"] }), pc("p2")] })));
    expect(ofKind(plan, "save").map((s) => [s.targetId, s.success, s.autoFail])).toEqual([["p1", false, true]]);
    expect(ofKind(plan, "mark").map((m) => m.targetId)).toEqual(["p1"]);
    expect(ofKind(plan, "prompt").map((p) => [p.prompt, p.targetIds])).toEqual([["pcSave", ["p2"]]]);
  });

  it("disadvantage only while `modsWhen` holds (Entice); an adversary rolls two d20s", () => {
    const entice = base({ difficulty: { kind: "fixed", value: 12 }, disadvantage: true, modsWhen: [{ kind: "targetHas", condition: { kind: "tag", tag: "Trusting" } }] });
    const plan = ok(run(entice, ctx([15, 9, 15], { targets: [adv("a", { tags: ["Trusting"] }), adv("b")] })));
    expect(ofKind(plan, "save").map((s) => [s.targetId, s.record.total, s.success, s.disadvantage])).toEqual([
      ["a", 9, false, 1],
      ["b", 15, true, undefined],
    ]);
    const pcPlan = ok(run(entice, ctx([], { targets: [pc("p1", { tags: ["Trusting"] })] })));
    expect(ofKind(pcPlan, "prompt").map((p) => [p.prompt, p.disadvantage, p.difficulty])).toEqual([["pcSave", 1, 12]]);
  });

  it("allies who mark a Stress each raise the Difficulty by 1 (Enchanting Song)", () => {
    const song = base({ difficulty: { kind: "raised", base: { kind: "fixed", value: 13 }, allies: { within: "close", of: "target" }, cost: { kind: "stress", amount: fixed(1) }, each: 1 } });
    const plan = ok(run(song, ctx([], { targets: [pc("p1")], saveRaisers: [adv("s1"), adv("s2")] })));
    expect(ofKind(plan, "prompt").map((p) => p.difficulty)).toEqual([15]);
    expect(ofKind(plan, "mark").map((m) => [m.targetId, m.track])).toEqual([
      ["s1", "stress"],
      ["s2", "stress"],
    ]);
  });

  it("a falling Difficulty drops by its step per earlier attempt (Banish's return)", () => {
    const banish = base({ difficulty: { kind: "falling", start: fixed(16), step: 1 } });
    expect(ofKind(ok(run(banish, ctx([], { targets: [pc("p1")], saveAttempt: 2 }))), "prompt")[0]!.difficulty).toBe(14);
  });
});

describe("cardChoices: the E3 choice ids", () => {
  it("parses per-chooser picks, held dice, chain links and raisers", () => {
    const parsed = parseChoices([
      { id: "by:boon:tok1", value: ["hope"] },
      { id: "byOptional:pay:tok2", value: true },
      { id: "heldDice", value: ["p2"] },
      { id: "chain:2", value: ["tok3"] },
      { id: "raisers", value: ["tok4"] },
    ]);
    expect(parsed.chooserOptions).toEqual({ boon: { tok1: ["hope"] } });
    expect(parsed.chooserOptionals).toEqual({ pay: { tok2: true } });
    expect(parsed.heldDice).toEqual(["p2"]);
    expect(parsed.chain).toEqual([[], ["tok3"]]);
    expect(parsed.raisers).toEqual(["tok4"]);
  });

  it("refuses a chain link out of bounds and a `by` id without a creature", () => {
    expect(() => parseChoices([{ id: "chain:0", value: [] }])).toThrow();
    expect(() => parseChoices([{ id: "by:boon", value: ["x"] }])).toThrow();
  });
});
