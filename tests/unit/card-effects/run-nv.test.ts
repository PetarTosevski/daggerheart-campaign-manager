import { describe, expect, it } from "vitest";

import { keyAvailability, featureLimitUntil, resolveCosts, stateCheckMet, unaffordable, type RequirementState } from "@/lib/domain/card-effects/availability";
import { run, stepDie, type ActorState, type DelegateHandler, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, DamageChange, DiceExpr, Step } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { resolveDice, resolveNumber, type NumberEnv } from "@/lib/domain/combat-actions/numbers";
import { queueRng } from "@/lib/domain/dice";

// Plan sheet-drawer, tracer SD1: the card runner executes SD0's vocabulary NV1-NV19 (for cards and features alike).
// Expected values come from the book where it has them (CB p.99: 26 physical halved is 13; CB p.107: round up; HF p.14:
// Deathless Embrace counts Patron Dice of 4 or higher) and otherwise from the feature text by hand. RNG order: Hope die,
// Fear die, then damage dice, held dice and checks in the order the steps need them.

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
  loadoutDomains: [],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: {
    primary: { damage: "d8+1 phy", trait: "finesse", damageType: "physical", range: "melee" },
    secondary: { damage: "d6 phy", trait: "finesse", damageType: "physical", range: "melee" },
  },
  ...over,
});

/** A Bandit-like adversary with high thresholds, so damage totals are easy to read (CB p.193). */
const adv = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 30, severe: 60 },
  hp: 0,
  hpMax: 5,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const ally = (id: string): Combatant => ({ id, side: "pc", evasion: 12, thresholds: { major: 6, severe: 12 }, hp: 2, hpMax: 6, stress: 2, stressMax: 6, armor: 0, armorMax: 3, defeated: false, conditions: [] });

const card = (use: Partial<CardUse>, cardId = "test-card"): CardEffect => ({
  cardId,
  uses: [{ id: "main", name: "Test", activation: { kind: "action" }, steps: [], ...use }],
});

const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 2, rng: queueRng(dice), ...over });

function ok(result: ReturnType<typeof run>): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);

describe("NV1: Favor, Focus and held dice", () => {
  it("spends a Favor (HF p.14) from its own pool and reads it as `spent: favor`", () => {
    const effect = card({
      costs: [{ kind: "tokens", amount: fixed(1), pool: "favor" }],
      steps: [{ kind: "clear", to: "self", track: "stress", amount: { kind: "spent", resource: "favor" } }],
    });
    const plan = ok(run(effect, ctx([], { actor: actor({ favor: 2, cardTokens: 5 }) })));
    expect(ofKind(plan, "pay")[0]!.costs).toEqual([{ resource: "tokens", amount: 1, pool: "favor" }]);
    expect(plan.actor.after).toMatchObject({ favor: 1, cardTokens: 5, stress: 0 });
  });

  it("refuses an unpaid Favor or Focus (CARD_COST_UNPAID) even with card tokens to spare", () => {
    const favor = card({ costs: [{ kind: "tokens", amount: fixed(1), pool: "favor" }] });
    expect(run(favor, ctx([], { actor: actor({ favor: 0, cardTokens: 3 }) }))).toMatchObject({ ok: false, reason: "cost", detail: "tokens" });
    const focus = card({ costs: [{ kind: "tokens", amount: fixed(2), pool: "focus" }] });
    expect(run(focus, ctx([], { actor: actor({ focus: 1 }) }))).toMatchObject({ ok: false, reason: "cost" });
    expect(ok(run(focus, ctx([], { actor: actor({ focus: 2 }) }))).actor.after.focus).toBe(0);
  });

  it("spends held Prayer Dice: a stored value counts as is, an unrolled die is rolled (CB p.44)", () => {
    const effect = card({
      activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } },
      costs: [{ kind: "tokens", amount: fixed(2), pool: "prayer" }],
      steps: [{ kind: "reduceDamage", to: "self", amount: { kind: "spent", resource: "heldDie" } }],
    });
    const heldDice = [
      { id: "prayer-1", kind: "prayer" as const, sides: 4, value: 3 },
      { id: "prayer-2", kind: "prayer" as const, sides: 4 },
      { id: "rally-1", kind: "rally" as const, sides: 6 },
    ];
    const plan = ok(run(effect, ctx([2], { actor: actor({ heldDice }) })));
    expect(ofKind(plan, "pay")[0]!.costs).toEqual([{ resource: "tokens", amount: 2, pool: "prayer", values: [3, 2] }]);
    expect(ofKind(plan, "fold")[0]).toMatchObject({ amount: 5 });
    expect(plan.actor.after.heldDice).toEqual([{ id: "rally-1", kind: "rally", sides: 6 }]);
    // Only one Prayer Die held: short.
    expect(run(effect, ctx([], { actor: actor({ heldDice: heldDice.slice(1) }) }))).toMatchObject({ ok: false, reason: "cost" });
  });

  it("the resource step gains Focus up to 6 (HF p.12: 'You can hold a maximum of 6 Focus') and sets or loses Favor", () => {
    const effect = card({
      steps: [
        { kind: "resource", to: "self", resource: "focus", change: "gain", amount: fixed(3) },
        { kind: "resource", to: "self", resource: "favor", change: "lose", amount: fixed(5) },
        { kind: "resource", to: "self", resource: "favor", change: "set", amount: fixed(3) },
      ],
    });
    const plan = ok(run(effect, ctx([], { actor: actor({ focus: 5, favor: 2 }) })));
    expect(ofKind(plan, "resource")).toEqual([
      { kind: "resource", targetId: "pc", resource: "focus", before: 5, after: 6 },
      { kind: "resource", targetId: "pc", resource: "favor", before: 2, after: 0 },
      { kind: "resource", targetId: "pc", resource: "favor", before: 0, after: 3 },
    ]);
    expect(plan.actor.after).toMatchObject({ focus: 6, favor: 3 });
  });

  it("`sidesOf` rolls the actor's own class die; without it on the sheet the printed size", () => {
    const effect = card({
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: fixed(2), sides: 6, sidesOf: "patron" } }, type: "magic" }],
    });
    const d8 = ok(run(effect, ctx([7, 8], { actor: actor({ dieSides: { patron: 8 } }), targets: [adv("a")] })));
    expect(ofKind(d8, "damageRoll")[0]!.record.dice.map((d) => d.sides)).toEqual([8, 8]);
    expect(ofKind(d8, "damageRoll")[0]!.record.total).toBe(15);
    const d6 = ok(run(effect, ctx([6, 6], { targets: [adv("a")] })));
    expect(ofKind(d6, "damageRoll")[0]!.record.dice.map((d) => d.sides)).toEqual([6, 6]);
  });
});

describe("NV12: dice at or above a value", () => {
  it("Deathless Embrace (HF p.14): 3 Favor, 3 Patron Dice rolling 4, 2, 6 clear 2 Hit Points", () => {
    // "Once per rest, spend any number of Favor to roll an equal number of Patron Dice. For each result of 4 or higher, clear a Hit Point."
    const effect = card({
      choices: [{ id: "favor", label: "Favor", min: 1 }],
      costs: [{ kind: "tokens", amount: { kind: "chosen", choice: "favor" }, pool: "favor" }],
      steps: [
        {
          kind: "clear",
          to: "self",
          track: "hp",
          amount: { kind: "dice", dice: { count: { kind: "spent", resource: "favor" }, sides: 6, sidesOf: "patron" }, keep: "countAtLeast", atLeast: 4 },
        },
      ],
    });
    const plan = ok(run(effect, ctx([4, 2, 6], { actor: actor({ hp: 4, favor: 3, dieSides: { patron: 6 } }), choices: { favor: 3 } })));
    expect(ofKind(plan, "clear")[0]).toMatchObject({ track: "hp", amount: 2 });
    expect(plan.actor.after).toMatchObject({ hp: 2, favor: 0 });
  });

  it("`countAtLeast` without `atLeast` counts every die; `plus` is added", () => {
    const env: NumberEnv = {
      traits: actor().traits,
      spellcast: 0,
      proficiency: 1,
      level: 1,
      tier: 1,
      spent: {},
      choices: {},
      cardTokens: 0,
      gmFear: 0,
      self: { hp: 0, stress: 0 },
      markedThisMove: { self: {}, byTarget: {} },
      targetCount: { picked: 0, hit: 0, failedSave: 0 },
      loadoutDomains: [],
      vaultDomains: [],
    };
    expect(resolveNumber({ kind: "dice", dice: { count: fixed(3), sides: 6, plus: fixed(1) }, keep: "countAtLeast" }, env, queueRng([1, 1, 1]))).toBe(4);
    expect(env.lastRoll).toBe(4);
    expect(resolveDice({ count: fixed(1), sides: 6, sidesOf: "unstoppable" }, { ...env, dieSides: { unstoppable: 4 } }, queueRng([]))).toEqual({ count: 1, sides: 4, plus: 0 });
  });
});

describe("NV2: delegate to a D5 feature", () => {
  const effect = card({
    costs: [{ kind: "stress", amount: fixed(1) }],
    steps: [{ kind: "delegate", to: "self", feature: "beastform", params: { choiceFrom: "form" } }],
  });

  it("without a handler the plan carries the step for the server, with the resolved params", () => {
    const plan = ok(run(effect, ctx([], { options: { form: ["agile-scout"] }, dieIndexes: [0] })));
    expect(ofKind(plan, "delegate")).toEqual([
      { kind: "delegate", feature: "beastform", params: { choice: "agile-scout", dieIndexes: [0] }, targetIds: ["pc"], done: false },
    ]);
  });

  it("with a handler it runs in the plan: the actor takes the resources it returns, and its Fear", () => {
    const seen: Parameters<DelegateHandler>[0][] = [];
    const delegate: DelegateHandler = (request) => {
      seen.push(request);
      return { ok: true, actor: { ...request.actor, hope: request.actor.hope + 1, featureUses: [...request.actor.featureUses, { key: "beastform", until: "rest" }] }, summary: "transformed", fearDelta: 1 };
    };
    const plan = ok(run(effect, ctx([], { delegate, options: { form: ["agile-scout"] } })));
    // The handler saw the Stress already marked (the entry's cost).
    expect(seen[0]!.actor).toMatchObject({ stress: 2, hope: 2 });
    expect(ofKind(plan, "delegate")[0]).toMatchObject({ done: true, summary: "transformed" });
    expect(plan.actor.after).toMatchObject({ hope: 3, stress: 2 });
    expect(plan.actor.featureUses).toEqual([{ key: "beastform", until: "rest" }]);
    expect(plan.gmFearDelta).toBe(1);
  });

  it("a D5 refusal refuses the whole use", () => {
    const delegate: DelegateHandler = () => ({ ok: false, detail: "Choose a Beastform." });
    expect(run(effect, ctx([], { delegate }))).toMatchObject({ ok: false, reason: "choice", detail: "Choose a Beastform." });
  });
});

describe("NV4, NV18, NV8 roll changes, Q6: folds with their numbers", () => {
  const reaction = (steps: Step[]): CardEffect => card({ activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage" } }, steps });

  it("Scales (CB p.54): 'mark 1 fewer Hit Points' folds the amount for the hit", () => {
    const plan = ok(run(reaction([{ kind: "adjustHpMarked", to: "self", change: "fewer", amount: fixed(1) }]), ctx([])));
    expect(ofKind(plan, "fold")[0]).toMatchObject({ amount: 1, targetIds: ["pc"] });
  });

  it("halving incoming damage rounds up (CB p.107, Q6): 27 becomes 14; the book's 26 becomes 13 (CB p.99)", () => {
    const halve = reaction([{ kind: "modifyDamage", to: "self", change: { kind: "halve" } }]);
    expect(ofKind(ok(run(halve, ctx([], { trigger: { amount: 27 } }))), "fold")[0]).toMatchObject({ amount: 14 });
    expect(ofKind(ok(run(halve, ctx([], { trigger: { amount: 26 } }))), "fold")[0]).toMatchObject({ amount: 13 });
    // Without a known incoming amount the server folds it in.
    expect(ofKind(ok(run(halve, ctx([]))), "fold")[0]!.amount).toBeUndefined();
  });

  it("Hold Them Off (CB p.38): two more targets for the same roll; Contacts Everywhere's +3 to a duality die (CB p.43)", () => {
    const rider = card({
      activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } },
      steps: [
        { kind: "addTargets", to: "self", count: fixed(2), targets: { side: "enemy", range: "weapon", count: { kind: "upTo", n: fixed(2) } } },
        { kind: "modifyRoll", to: "self", change: { kind: "dieBonus", die: "hopeOrFear", amount: fixed(3) } },
      ],
    });
    const folds = ofKind(ok(run(rider, ctx([]))), "fold");
    expect(folds.map((f) => [f.step.kind, f.amount])).toEqual([
      ["addTargets", 2],
      ["modifyRoll", 3],
    ]);
  });
});

describe("NV8: damage dice changes on this move's damage", () => {
  const attack = (changes: DamageChange[], before = false, dice: DiceExpr = { count: fixed(3), sides: 8 }): CardEffect => {
    const damage: Step = { kind: "damage", to: "targets", roll: { kind: "dice", dice }, type: "physical" };
    const mods: Step[] = changes.map((change) => ({ kind: "modifyDamage", to: "targets", change }));
    return card({ targets: { side: "enemy", range: "close", count: { kind: "one" } }, steps: before ? [...mods, damage] : [damage, ...mods] });
  };
  const total = (plan: RunPlan) => ofKind(plan, "damage")[0]!.result.incoming;

  it("Deadly Raptor (CB p.35): reroll every die under your Proficiency (2), before or after the roll", () => {
    const below = { kind: "rerollChosen", below: { kind: "proficiency" } } as const;
    // 1, 5, 1 then the two 1s reroll to 7 and 4: 16.
    for (const before of [false, true]) {
      const plan = ok(run(attack([below], before), ctx([1, 5, 1, 7, 4], { targets: [adv("a")] })));
      expect(total(plan)).toBe(16);
      expect(ofKind(plan, "damageRoll")).toHaveLength(1);
      expect(ofKind(plan, "damageRoll")[0]!.record.total).toBe(16);
    }
  });

  it("Volatile Magic (CB p.46): reroll the dice the player picked; the new result stands (CB p.107)", () => {
    const plan = ok(run(attack([{ kind: "rerollChosen" }]), ctx([8, 2, 3, 1], { targets: [adv("a")], damageDice: { reroll: [1] } })));
    // 8, 2, 3: the second die rerolls to 1 (lower, but it stands): 12.
    expect(total(plan)).toBe(12);
  });

  it("Sacred Resonance (CB p.44): matching dice are doubled; Manipulate Magic (CB p.47): one chosen die doubled", () => {
    expect(total(ok(run(attack([{ kind: "doubleDice", which: "matching" }]), ctx([3, 3, 5], { targets: [adv("a")] }))))).toBe(17);
    expect(total(ok(run(attack([{ kind: "doubleDice", which: "matching" }]), ctx([3, 4, 5], { targets: [adv("a")] }))))).toBe(12);
    expect(total(ok(run(attack([{ kind: "doubleDice", which: "chosen" }]), ctx([3, 4, 5], { targets: [adv("a")], damageDice: { double: [2] } }))))).toBe(17);
  });

  it("Weapon Specialist (CB p.48): add one die of the secondary weapon (d6)", () => {
    expect(total(ok(run(attack([{ kind: "addWeaponDie", weapon: "secondary" }]), ctx([3, 4, 5, 6], { targets: [adv("a")] }))))).toBe(18);
  });

  it("the Aggressive stance (HF p.12): an extra damage die, the lowest dropped", () => {
    const plan = ok(run(attack([{ kind: "extraDie", drop: "lowest" }], false, { count: fixed(2), sides: 8 }), ctx([2, 7, 5], { targets: [adv("a")] })));
    expect(total(plan)).toBe(12);
    expect(ofKind(plan, "damageRoll")[0]!.record.dice.filter((d) => d.dropped).map((d) => d.value)).toEqual([2]);
  });

  it("Exacting (HF p.12): a 1 counts as the die's highest; Rampage (CB p.33): a 1 adds a d10", () => {
    const d10 = { count: fixed(2), sides: 10 as const };
    expect(total(ok(run(attack([{ kind: "ones", asMax: true }], false, d10), ctx([1, 4], { targets: [adv("a")] }))))).toBe(14);
    expect(total(ok(run(attack([{ kind: "ones", add: { count: fixed(1), sides: 10 } }], false, d10), ctx([1, 4, 6], { targets: [adv("a")] }))))).toBe(11);
  });

  it("Mythic Beast (CB p.35): the damage die one size up (d8 to d10), before the roll", () => {
    const plan = ok(run(attack([{ kind: "dieSize", steps: 1 }], true), ctx([10, 10, 9], { targets: [adv("a")] })));
    expect(ofKind(plan, "damageRoll")[0]!.record.dice.map((d) => d.sides)).toEqual([10, 10, 10]);
    expect(total(plan)).toBe(29);
    expect(stepDie(6, 1)).toBe(8);
    expect(stepDie(20, 1)).toBe(20);
    expect(stepDie(4, -1)).toBe(4);
    expect(stepDie(7, 1)).toBe(7);
  });

  it("Face Your Fear (CB p.51): an extra 1d10 magic on physical damage makes the total both types", () => {
    const effect = card({
      targets: { side: "ally", range: "close", count: { kind: "one" } },
      steps: [
        { kind: "damage", to: "targets", roll: { kind: "flat", amount: fixed(5) }, type: "physical" },
        { kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "dice", dice: { count: fixed(1), sides: 10 } }, type: "magic" } },
      ],
    });
    expect(ofKind(ok(run(effect, ctx([6], { targets: [ally("mira")] }))), "pcDamage")[0]).toMatchObject({ amount: 11, type: "both" });
  });

  it("a dice change with no damage roll of its own is a fold for the move it rides on", () => {
    const rider = card({ activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } }, steps: [{ kind: "modifyDamage", to: "self", change: { kind: "doubleDice", which: "matching" } }] });
    expect(ofKind(ok(run(rider, ctx([]))), "fold")[0]!.step).toMatchObject({ kind: "modifyDamage" });
  });
});

describe("NV5, NV7, NV9, NV14, NV15: lasting effects carry their pieces", () => {
  it("Elemental Incarnation (CB p.30): until Severe damage or the next rest, as the Fire option", () => {
    const effect = card({
      steps: [
        { kind: "effect", to: "self", label: "Channeling Fire", mods: [], duration: "rest", endsOn: ["takeSevere"], option: "fire" },
        { kind: "condition", to: "self", condition: { kind: "tag", tag: "Channeling" }, duration: "rest", endsOn: ["takeSevere"] },
      ],
    });
    const plan = ok(run(effect, ctx([])));
    expect(ofKind(plan, "effect")[0]).toMatchObject({ endsOn: ["takeSevere"], option: "fire", duration: "rest" });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ endsOn: ["takeSevere"] });
  });

  it("Elusive Predator (CB p.39) keys +2 Evasion to the Focus; Draining Bane's d12 and Night's Glamour pass as mods", () => {
    const effect = card({
      steps: [
        {
          kind: "effect",
          to: "self",
          label: "Elusive",
          duration: "permanent",
          mods: [
            { kind: "stat", stat: "evasion", delta: fixed(2), versus: { creature: { kind: "tagged", tag: "Focus" }, on: "attacksByThem" } },
            { kind: "set", stat: "attackDie", to: fixed(12) },
            { kind: "flag", flag: "attackersMarkStress" },
          ],
        },
      ],
    });
    expect(ofKind(ok(run(effect, ctx([]))), "effect")[0]!.mods).toEqual([
      { kind: "stat", stat: "evasion", delta: 2, versus: { creature: { kind: "tagged", tag: "Focus" }, on: "attacksByThem" } },
      { kind: "set", stat: "attackDie", to: 12 },
      { kind: "flag", flag: "attackersMarkStress" },
    ]);
  });

  it("Evolution (CB p.30): +1 to the trait the player picked; Hex (HF p.16) holds on up to Spellcast creatures", () => {
    const effect = card({
      holdLimit: { kind: "spellcast" },
      steps: [{ kind: "effect", to: "self", label: "Evolution", duration: "manual", mods: [{ kind: "trait", trait: "agility", delta: fixed(1), choice: "trait" }] }],
    });
    const picked = ok(run(effect, ctx([], { options: { trait: ["finesse"] } })));
    expect(ofKind(picked, "effect")[0]!.mods).toEqual([{ kind: "trait", trait: "finesse", delta: 1 }]);
    expect(picked.holdLimit).toBe(3);
    // A pick that is no trait keeps the default.
    expect(ofKind(ok(run(effect, ctx([], { options: { trait: ["fire"] } }))), "effect")[0]!.mods).toEqual([{ kind: "trait", trait: "agility", delta: 1 }]);
  });
});

describe("NV7: situations the engine can read", () => {
  const whileFlying = card({ requires: [{ kind: "situation", text: "While flying", check: { kind: "flying" } }], steps: [{ kind: "hope", to: "self", change: "gain", amount: fixed(1) }] });

  it("a known fact decides it without the check box; an unknown one falls back to the player's confirmation (Q13)", () => {
    expect(run(whileFlying, ctx([], { actor: actor({ facts: { flying: true } }) })).ok).toBe(true);
    expect(run(whileFlying, ctx([], { actor: actor({ facts: { flying: false } }), situations: ["While flying"] }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(run(whileFlying, ctx([]))).toMatchObject({ ok: false, reason: "requirement" });
    expect(run(whileFlying, ctx([], { situations: ["While flying"] })).ok).toBe(true);
  });

  it("a `requires` gate reads the facts too (Adrenaline, CB p.42: while Vulnerable)", () => {
    const effect = card({
      steps: [{ kind: "hope", to: "self", change: "gain", amount: fixed(1), when: [{ kind: "requires", requirement: { kind: "situation", text: "While Vulnerable", check: { kind: "hasCondition", condition: { kind: "standard", condition: "vulnerable" } } } }] }],
    });
    expect(ok(run(effect, ctx([], { actor: actor({ facts: { conditions: ["vulnerable"] } }) }))).actor.after.hope).toBe(3);
    expect(ok(run(effect, ctx([], { actor: actor({ facts: { conditions: [] } }) }))).actor.after.hope).toBe(2);
  });

  it("every state check", () => {
    const base: RequirementState = { hp: 4, hpMax: 6, stress: 0, stressMax: 6, armor: 0, hope: 2, armorWorn: true, loadoutDomains: [], activeCardEffects: [], situations: [] };
    const s = (facts: RequirementState["facts"]) => ({ ...base, facts });
    expect(stateCheckMet({ kind: "hopeAtLeast", value: 2 }, base)).toBe(true);
    expect(stateCheckMet({ kind: "hpUnmarkedAtMost", value: 2, who: "self" }, base)).toBe(true);
    expect(stateCheckMet({ kind: "hpUnmarkedAtMost", value: 2, who: "subject" }, base)).toBeUndefined();
    expect(stateCheckMet({ kind: "hpUnmarkedAtMost", value: 2, who: "subject" }, s({ subject: { conditions: [], hp: 1, hpMax: 6 } }))).toBe(false);
    expect(stateCheckMet({ kind: "hasCondition", condition: { kind: "tag", tag: "Hexed" }, who: "target" }, s({ target: { conditions: [], tags: ["Hexed"], hp: 0, hpMax: 5 } }))).toBe(true);
    expect(stateCheckMet({ kind: "featureEffect", featureId: "subclass:warden-of-the-elements:elemental-incarnation", option: "fire" }, s({ featureEffects: [{ featureId: "subclass:warden-of-the-elements:elemental-incarnation", option: "water" }] }))).toBe(false);
    expect(stateCheckMet({ kind: "inBeastform" }, s({ beastformId: null }))).toBe(false);
    expect(stateCheckMet({ kind: "inBeastform", formId: "agile-scout" }, s({ beastformId: "agile-scout" }))).toBe(true);
    expect(stateCheckMet({ kind: "inBeastform" }, base)).toBeUndefined();
    expect(stateCheckMet({ kind: "rollUsedExperience" }, s({ rollUsedExperience: true }))).toBe(true);
    expect(stateCheckMet({ kind: "activeStance", stance: "stance:martial-artist:quick" }, s({ activeStance: "quick" }))).toBe(true);
    expect(stateCheckMet({ kind: "activeStance", stance: "reliable" }, s({ activeStance: null }))).toBe(false);
    expect(stateCheckMet({ kind: "inArea", featureId: "subclass:moon:moonbeam", owner: "self" }, s({ areas: [{ featureId: "subclass:moon:moonbeam", own: false }] }))).toBe(false);
    expect(stateCheckMet({ kind: "inArea", featureId: "subclass:moon:moonbeam" }, s({ areas: [{ featureId: "subclass:moon:moonbeam", own: false }] }))).toBe(true);
    // Isolating (HF p.12): no other creature within Very Close (3 squares) of you or your target.
    const isolated = { kind: "isolated", range: "veryClose", who: "selfOrTarget" } as const;
    expect(stateCheckMet(isolated, s({ isolation: { self: 5, target: 4 } }))).toBe(true);
    expect(stateCheckMet(isolated, s({ isolation: { self: 5, target: 2 } }))).toBe(false);
    expect(stateCheckMet(isolated, s({ isolation: { self: 2 } }))).toBe(false);
    expect(stateCheckMet(isolated, s({ isolation: { self: 5 } }))).toBeUndefined();
    expect(stateCheckMet({ ...isolated, who: "self" }, s({ isolation: { self: 4 } }))).toBe(true);
  });
});

describe("NV11, NV13, NV17, NV19, NV16", () => {
  it("Moonbeam (HF p.17): an area centred on the caster with its mods resolved", () => {
    const effect = card({
      steps: [{ kind: "area", to: "self", area: { label: "Moonbeam", centre: "self", radius: "close", side: "selfAndAllies", mods: [{ kind: "stat", stat: "spellcast", delta: fixed(1) }], duration: "scene" } }],
    });
    expect(ofKind(ok(run(effect, ctx([]))), "area")[0]).toMatchObject({
      centreId: "pc",
      area: { label: "Moonbeam", radius: "close", mods: [{ kind: "stat", stat: "spellcast", delta: 1 }], duration: "scene" },
    });
    const cloud = card({ targets: { side: "point", range: "close", count: { kind: "one" } }, steps: [{ kind: "area", to: "self", area: { label: "Dark Cloud", centre: "point", radius: "veryClose", side: "all", blocksSight: true, duration: "manual" } }] });
    expect(ofKind(ok(run(cloud, ctx([]))), "area")[0]).toMatchObject({ centreId: null, area: { blocksSight: true, mods: [] } });
  });

  it("the companion (Q4): a companion pick is the companion, and the plan says the companion acts", () => {
    const companion: Combatant = { ...ally("companion"), stress: 2 };
    const effect = card({
      actor: "companion",
      steps: [{ kind: "clear", to: "picked", pick: { side: "ally", range: "close", count: { kind: "one" }, companion: true }, track: "stress", amount: fixed(1) }],
    });
    const plan = ok(run(effect, ctx([], { companion, picked: [ally("mira")] })));
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "companion", track: "stress", amount: 1 }]);
    expect(plan.actorKind).toBe("companion");
  });

  it("Favor (HF p.14): a success with Hope takes a Favor instead of the Hope; Ethereal Visage (CB p.45) removes a Fear", () => {
    const roll = { kind: "trait", trait: "presence", difficulty: fixed(10) } as const;
    const favor = card({ roll, steps: [{ kind: "replaceHopeGain", to: "self", when: ["withHope"], with: "favor" }] });
    // Hope 8, Fear 3: a success with Hope, +1 Hope from the roll, then taken as a Favor.
    const plan = ok(run(favor, ctx([8, 3], { actor: actor({ favor: 1 }) })));
    expect(plan.actor.after).toMatchObject({ hope: 2, favor: 2 });
    const fear = card({ roll, steps: [{ kind: "replaceHopeGain", to: "self", when: ["withHope"], with: "removeFear" }] });
    const removed = ok(run(fear, ctx([8, 3])));
    expect(removed.actor.after.hope).toBe(2);
    expect(removed.gmFearDelta).toBe(-1);
    // At full Hope the roll gave none, so nothing is taken back: it is a fold for the server.
    expect(ofKind(ok(run(favor, ctx([8, 3], { actor: actor({ hope: 6, favor: 1 }) }))), "fold")).toHaveLength(1);
  });

  it("a named Help an Ally (Q12, CB p.90): Epic Poetry's d10 (CB p.29), Eloquent's free Help (CB p.29)", () => {
    const effect = card({ steps: [{ kind: "help", to: "picked", pick: { side: "ally", range: "far", count: { kind: "one" } }, die: 10, free: true }] });
    expect(ofKind(ok(run(effect, ctx([], { picked: [ally("mira")] }))), "help")).toEqual([{ kind: "help", targetId: "mira", die: 10, free: true }]);
  });

  it("limit keys: a feature runner's keys and `scene` until (Q7); cards keep `card:` keys with scene stored as session", () => {
    const once = card({ limit: { per: "scene" }, steps: [] }, "flicker");
    const custom = ok(run(once, ctx([], { limitKeys: { key: (useId) => `feat:x:${useId}`, until: featureLimitUntil } })));
    expect(custom.limit).toEqual({ key: "feat:x:main", until: "scene", consumed: true });
    expect(custom.actor.featureUses).toEqual([{ key: "feat:x:main", until: "scene" }]);
    expect(ok(run(once, ctx([]))).limit).toEqual({ key: "card:flicker", until: "session", consumed: true });
    const used = actor({ featureUses: [{ key: "feat:x:main", until: "scene" }] });
    expect(run(once, ctx([], { actor: used, limitKeys: { key: (useId) => `feat:x:${useId}`, until: featureLimitUntil } }))).toMatchObject({ ok: false, reason: "exhausted", detail: "Back after the scene" });
  });
});

describe("availability helpers", () => {
  it("keyAvailability reads any key; a scene entry is the shortest reset", () => {
    const uses = [{ key: "feat:a", until: "scene" as const }, { key: "feat:a", until: "longRest" as const }];
    expect(keyAvailability({ featureUses: uses }, "feat:a", { per: "scene", times: 2 })).toEqual({ state: "exhausted", until: "longRest", label: "Back after a long rest" });
    expect(keyAvailability({ featureUses: uses.slice(0, 1) }, "feat:a")).toEqual({ state: "exhausted", until: "scene", label: "Back after the scene" });
    expect(keyAvailability({ featureUses: [] }, "feat:a", { per: "rest", times: 2 })).toEqual({ state: "ready", usesLeft: 2 });
  });

  it("pooled costs keep their pool; each pool is checked on its own", () => {
    const costs = resolveCosts(
      [
        { kind: "tokens", amount: fixed(1), pool: "card" },
        { kind: "tokens", amount: fixed(1), pool: "rally" },
        { kind: "hope", amount: fixed(1) },
      ],
      (c) => (c.amount.kind === "fixed" ? c.amount.value : 0),
    );
    expect(costs).toEqual([
      { resource: "tokens", amount: 1 },
      { resource: "tokens", amount: 1, pool: "rally" },
      { resource: "hope", amount: 1 },
    ]);
    const payer = { hope: 1, stress: 0, stressMax: 6, hp: 0, hpMax: 6, armor: 0, armorMax: 3, cardTokens: 1 };
    expect(unaffordable(costs, payer)).toEqual(["tokens"]);
    expect(unaffordable(costs, { ...payer, heldDice: { rally: 1 } })).toEqual([]);
  });
});
