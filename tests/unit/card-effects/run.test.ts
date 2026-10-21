import { describe, expect, it } from "vitest";

import { pickUse, rollMatches, run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

// Plan combat-actions, tracer CA1: the card-effect runner. Expected values come from the book's examples where it has
// them (CB p.98 Nolan 3d6+6 = 20, Rune's critical 2d6+1 = 22; CB p.99 26 resisted = 13; CB p.148 2d8+2 critical = 30) and
// otherwise from the card text by hand. RNG order: Hope die, Fear die, advantage dice, then damage dice, d20s and checks
// in the order the steps need them.

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
  loadoutDomains: ["arcana", "blade"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 phy", trait: "finesse", damageType: "physical", range: "melee" } },
  ...over,
});

/** A Bandit-like adversary: Difficulty 12, thresholds 8/14, 5 HP, 3 Stress (CB p.193). */
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

const ally = (id: string): Combatant => ({ id, side: "pc", evasion: 12, thresholds: { major: 6, severe: 12 }, hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, armorMax: 3, defeated: false, conditions: [] });

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

const weaponAttack = card({
  roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
  targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
  steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "primary" }, type: "weapon" }],
});

describe("the book's damage examples (CB p.98, p.99, p.148)", () => {
  it("Nolan: improved shortbow d6+6 at Proficiency 3 rolls 3, 5, 6 for 20 physical damage", () => {
    const nolan = actor({ proficiency: 3, weapons: { primary: { damage: "d6+6 phy", trait: "finesse", damageType: "physical", range: "far" } } });
    const plan = ok(run(weaponAttack, ctx([10, 4, 3, 5, 6], { actor: nolan, targets: [adv("bandit")] })));
    expect(plan.hits).toEqual([{ id: "bandit", hit: true }]);
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "physical", record: { total: 20 } });
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 20, taken: 20, severity: "severe", hpMarked: 3 });
    expect(plan.actor.after.hope).toBe(3);
  });

  it("Rune: a critical with a d6+1 wand at Proficiency 2 starts from 12, rolls 4 and 5, plus 1 = 22 magic", () => {
    const rune = actor({ weapons: { primary: { damage: "d6+1 mag", trait: "knowledge", damageType: "magic", range: "far" } } });
    const plan = ok(run(weaponAttack, ctx([7, 7, 4, 5], { actor: rune, targets: [adv("bandit", { difficulty: 30 })] })));
    expect(plan.roll).toMatchObject({ critical: true, success: true, outcome: "critical" });
    expect(plan.hits).toEqual([{ id: "bandit", hit: true }]);
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 22 } });
    // A critical gains a Hope and clears a Stress (CB p.90).
    expect(plan.actor.after).toMatchObject({ hope: 3, stress: 0 });
  });

  it("26 physical damage against physical resistance is 13 (CB p.99)", () => {
    const effect = card({ steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "flat", amount: fixed(26) }, type: "physical" }] });
    const warrior = adv("warrior", { resistance: { physical: "resistant", magic: "none" } });
    const plan = ok(run(effect, ctx([], { targets: [warrior] })));
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 26, taken: 13, resisted: "resistant" });
  });

  it("an adversary's critical 2d8+2 rolling 5 and 7 deals 30 (CB p.148), against a PC it waits for the reaction window", () => {
    const claw = card({
      roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" }, modifier: fixed(2) },
      targets: { side: "enemy", range: "melee", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "physical" }],
    });
    const plan = ok(run(claw, ctx([20, 5, 7], { targets: [ally("mira")], attackDamage: "2d8+2 phy" })));
    expect(plan.roll).toMatchObject({ critical: true, record: { total: 22 } });
    expect(ofKind(plan, "damageRoll")[0]!.record.total).toBe(30);
    expect(ofKind(plan, "pcDamage")[0]).toEqual({ kind: "pcDamage", targetId: "mira", amount: 30, type: "physical", direct: false });
  });
});

describe("one roll for every target (R1, R9)", () => {
  it("hits per target against each Difficulty; misses take nothing", () => {
    const effect = card({
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "close", count: { kind: "all" } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 6 } }, type: "magic" }],
    });
    // 9 + 4 + Spellcast 3 = 16: beats 12 and 16, not 17.
    const plan = ok(run(effect, ctx([9, 4, 2, 3], { targets: [adv("a"), adv("b", { difficulty: 16 }), adv("c", { difficulty: 17 })] })));
    expect(plan.hits).toEqual([
      { id: "a", hit: true },
      { id: "b", hit: true },
      { id: "c", hit: false },
    ]);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 5],
      ["b", 5],
    ]);
    expect(plan.creatures.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("a miss on every target is a failure; with Fear the GM gains a Fear", () => {
    const plan = ok(run(weaponAttack, ctx([2, 9], { targets: [adv("a", { difficulty: 20 })] })));
    expect(plan.success).toBe(false);
    expect(plan.roll?.outcome).toBe("failFear");
    expect(plan.gmFearDelta).toBe(1);
    expect(ofKind(plan, "damage")).toEqual([]);
  });

  it("a reaction roll changes no Hope, Stress or Fear (CB p.99)", () => {
    const effect = card({ roll: { kind: "reaction", trait: "spellcast", difficulty: fixed(10) }, steps: [] });
    const plan = ok(run(effect, ctx([3, 9])));
    expect(plan.roll?.record.kind).toBe("reaction");
    expect(plan.gmFearDelta).toBe(0);
    expect(plan.actor.after).toEqual(plan.actor.before);
  });
});

describe("Bolt Beacon (CB p.340): Hope from the same roll pays (R8, CB p.90)", () => {
  const boltBeacon = card(
    {
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [
        { kind: "pay", when: ["success"], costs: [{ kind: "hope", amount: fixed(1) }] },
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 8, plus: fixed(2) } }, type: "magic" },
        { kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" },
      ],
    },
    "bolt-beacon",
  );

  it("with 0 Hope, a success with Hope gains one and spends it on the spell", () => {
    const plan = ok(run(boltBeacon, ctx([9, 3, 4, 4], { actor: actor({ hope: 0 }), targets: [adv("bandit")] })));
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "afterRoll", costs: [{ resource: "hope", amount: 1 }], paid: true }]);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 10, severity: "major", hpMarked: 2 });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "bandit", condition: { kind: "standard", condition: "vulnerable" } });
    expect(plan.creatures[0]!.after).toMatchObject({ hp: 2, conditions: ["vulnerable"] });
    expect(plan.actor.after.hope).toBe(0);
  });

  it("a success with Fear gains no Hope: the cost goes unpaid and the rest of the card does nothing", () => {
    const plan = ok(run(boltBeacon, ctx([3, 9], { actor: actor({ hope: 0 }), targets: [adv("bandit")] })));
    expect(plan.success).toBe(true);
    expect(ofKind(plan, "pay")[0]).toMatchObject({ paid: false });
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(ofKind(plan, "condition")).toEqual([]);
    expect(plan.gmFearDelta).toBe(1);
  });
});

describe("refusals before anything is paid", () => {
  it("an exhausted card (CARD_EXHAUSTED, CB p.101)", () => {
    const effect = card({ limit: { per: "rest" } }, "quake");
    const result = run(effect, ctx([], { actor: actor({ featureUses: [{ key: "card:quake", until: "rest" }] }) }));
    expect(result).toEqual({ ok: false, reason: "exhausted", detail: "Back after a rest" });
  });
  it("an unpayable upfront cost (CARD_COST_UNPAID)", () => {
    const effect = card({ costs: [{ kind: "hope", amount: fixed(3) }] });
    expect(run(effect, ctx([]))).toMatchObject({ ok: false, reason: "cost", detail: "hope" });
  });
  it("an unmet requirement", () => {
    const effect = card({ requires: [{ kind: "loadoutDomainCount", domain: "arcana", min: 4 }] });
    expect(run(effect, ctx([]))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("too many targets, a choice out of bounds, an unknown use", () => {
    const one = card({ targets: { side: "enemy", range: "close", count: { kind: "one" } } });
    expect(run(one, ctx([], { targets: [adv("a"), adv("b")] }))).toMatchObject({ ok: false, reason: "targets" });
    const choice = card({ choices: [{ id: "hope", label: "Hope", min: 0, max: { kind: "fixed", value: 3 } }] });
    expect(run(choice, ctx([], { choices: { hope: 4 } }))).toMatchObject({ ok: false, reason: "choice" });
    expect(run(choice, ctx([], { useId: "nope" }))).toMatchObject({ ok: false, reason: "noUse" });
  });
  it("drops targets the card filters out (maxDifficulty, excludeFlying) without telling the number", () => {
    const wave = card({ targets: { side: "enemy", range: "far", count: { kind: "all" }, maxDifficulty: 18, excludeFlying: true } });
    const plan = ok(run(wave, ctx([], { targets: [adv("a"), adv("b", { difficulty: 20 }), adv("c", { flying: true })] })));
    expect(plan.excluded).toEqual(["b", "c"]);
    expect(plan.hits.map((h) => h.id)).toEqual(["a"]);
  });
});

describe("limits (Q3, Q4)", () => {
  const quake = card(
    {
      limit: { per: "rest", consumedOn: "success" },
      roll: { kind: "spellcast", difficulty: fixed(16) },
      targets: { side: "enemy", range: "veryFar", count: { kind: "all" } },
      steps: [],
    },
    "quake",
  );
  it("'once per rest on a success' stays ready after a failure", () => {
    const plan = ok(run(quake, ctx([2, 3])));
    expect(plan.success).toBe(false);
    expect(plan.limit).toEqual({ key: "card:quake", until: "rest", consumed: false });
    expect(plan.actor.featureUses).toEqual([]);
  });
  it("and is used up by a success", () => {
    const plan = ok(run(quake, ctx([10, 9])));
    expect(plan.limit).toEqual({ key: "card:quake", until: "rest", consumed: true });
    expect(plan.actor.featureUses).toEqual([{ key: "card:quake", until: "rest" }]);
  });
  it("a plain limit is used up by any use", () => {
    const plan = ok(run(card({ limit: { per: "longRest" } }, "full-surge"), ctx([])));
    expect(plan.actor.featureUses).toEqual([{ key: "card:full-surge", until: "longRest" }]);
  });
});

describe("damage of one move is totalled before thresholds (R2, CB p.98)", () => {
  it("Rain of Blades: the extra d8 on a Vulnerable target joins the damage before thresholds", () => {
    const rain = card({
      costs: [{ kind: "hope", amount: fixed(1) }],
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "veryClose", count: { kind: "all" } },
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 8, plus: fixed(2) } }, type: "magic" },
        { kind: "modifyDamage", to: "targets", when: ["hit", { kind: "targetHas", condition: { kind: "standard", condition: "vulnerable" } }], change: { kind: "add", amount: { kind: "dice", dice: { count: fixed(1), sides: 8 } } } },
      ],
    });
    const plan = ok(run(rain, ctx([9, 2, 3, 4, 6], { targets: [adv("v", { conditions: ["vulnerable"] }), adv("n")] })));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "upfront", costs: [{ resource: "hope", amount: 1 }] });
    const results = ofKind(plan, "damage").map((d) => d.result);
    expect(results.map((r) => [r.targetId, r.incoming, r.hpMarked])).toEqual([
      ["v", 15, 3],
      ["n", 9, 2],
    ]);
  });

  it("Fireball: the damage is rolled once; who saves takes half (rounded up, CB p.107)", () => {
    const fireball = card({
      roll: { kind: "spellcast", difficulty: fixed(13) },
      targets: { side: "any", range: "veryFar", count: { kind: "one" }, area: "aroundTarget", areaRange: "veryClose" },
      steps: [
        {
          kind: "save",
          to: "targets",
          when: ["success"],
          difficulty: { kind: "fixed", value: 13 },
          onFail: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 20, plus: fixed(5) } }, type: "magic" }],
          onSuccess: [{ kind: "damage", to: "targets", roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 20, plus: fixed(5) } }, type: "magic", scale: "half" }],
        },
      ],
    });
    const plan = ok(run(fireball, ctx([8, 5, 5, 10, 12, 15], { targets: [adv("b1"), adv("b2", { thresholds: { major: 10, severe: 20 } })] })));
    expect(ofKind(plan, "save").map((s) => [s.targetId, s.record.total, s.success])).toEqual([
      ["b1", 5, false],
      ["b2", 15, true],
    ]);
    const rolls = ofKind(plan, "damageRoll").map((r) => r.record.total);
    expect(rolls).toEqual([27, 27]);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.severity])).toEqual([
      ["b1", 27, "severe"],
      ["b2", 14, "major"],
    ]);
  });
});

describe("gates on the move's results", () => {
  const strike = (gate: "targetMarkedHp" | "targetDefeated") =>
    card({
      steps: [
        { kind: "damage", to: "targets", roll: { kind: "flat", amount: fixed(10) }, type: "magic" },
        { kind: "hope", to: "self", when: [gate], change: "gain", amount: fixed(1) },
      ],
    });
  it("targetMarkedHp: only when the target marked HP from this move", () => {
    expect(ok(run(strike("targetMarkedHp"), ctx([], { targets: [adv("a")] }))).actor.after.hope).toBe(3);
    const immune = adv("a", { resistance: { physical: "none", magic: "immune" } });
    expect(ok(run(strike("targetMarkedHp"), ctx([], { targets: [immune] }))).actor.after.hope).toBe(2);
  });
  it("targetDefeated: only when this move defeated it", () => {
    expect(ok(run(strike("targetDefeated"), ctx([], { targets: [adv("a", { hp: 4 })] }))).actor.after.hope).toBe(3);
    expect(ok(run(strike("targetDefeated"), ctx([], { targets: [adv("a")] }))).actor.after.hope).toBe(2);
  });
  it("Blighting Strike (HF p.180): d6+1 with Hope, d10+1 with Fear; on a failure spend a Hope or mark a Stress", () => {
    const blight = card({
      roll: { kind: "spellcast", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [
        { kind: "damage", to: "targets", when: ["hit", "withHope"], roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 6, plus: fixed(1) } }, type: "magic" },
        { kind: "damage", to: "targets", when: ["hit", "withFear"], roll: { kind: "dice", dice: { count: { kind: "proficiency" }, sides: 10, plus: fixed(1) } }, type: "magic" },
        { kind: "pay", when: ["failure"], costs: [{ kind: "either", options: [[{ kind: "hope", amount: fixed(1) }], [{ kind: "stress", amount: fixed(1) }]] }] },
      ],
    });
    const hope = ok(run(blight, ctx([9, 2, 3, 4], { targets: [adv("a")] })));
    expect(ofKind(hope, "damageRoll")[0]!.record.dice.map((d) => d.sides)).toEqual([6, 6]);
    expect(ofKind(hope, "damage")[0]!.result.incoming).toBe(8);
    const fail = ok(run(blight, ctx([2, 9], { targets: [adv("a", { difficulty: 18 })], eitherCosts: [1] })));
    expect(ofKind(fail, "pay")[0]).toMatchObject({ costs: [{ resource: "stress", amount: 1 }], paid: true });
    expect(fail.actor.after.stress).toBe(2);
  });
});

describe("Minions, Stress and forced marks", () => {
  it("offers extra Minions per X damage (CB p.201, Q6)", () => {
    const effect = card({ steps: [{ kind: "damage", to: "targets", roll: { kind: "flat", amount: fixed(7) }, type: "physical" }] });
    const lackey = adv("lackey", { thresholds: { major: null, severe: null }, hpMax: 1, minionX: 3 });
    const plan = ok(run(effect, ctx([], { targets: [lackey] })));
    expect(ofKind(plan, "minionOffer")).toEqual([{ kind: "minionOffer", targetId: "lackey", extra: 2 }]);
    expect(plan.creatures[0]!.after.defeated).toBe(true);
  });
  it("Stress past a full track marks 1 HP (CB p.92)", () => {
    const effect = card({ steps: [{ kind: "markStress", to: "targets", amount: fixed(2) }] });
    const plan = ok(run(effect, ctx([], { targets: [adv("a", { stress: 2 })] })));
    expect(ofKind(plan, "mark")[0]).toMatchObject({ track: "stress", amount: 2, hpMarked: 1, overflow: true });
    expect(plan.creatures[0]!.after).toMatchObject({ stress: 3, hp: 1 });
  });
  it("defeat, markHp, markArmor (PCs only), clear on self", () => {
    const effect = card({
      steps: [
        { kind: "markHp", to: "targets", amount: fixed(2) },
        { kind: "defeat", to: "picked" },
        { kind: "markArmor", to: "allies", amount: fixed(1), noBenefit: true },
        { kind: "clear", to: "self", track: "stress", amount: fixed(1) },
      ],
    });
    const plan = ok(run(effect, ctx([], { targets: [adv("a")], picked: [adv("b")], allies: [ally("mira")] })));
    expect(ofKind(plan, "mark").map((m) => [m.targetId, m.track, m.hpMarked])).toEqual([
      ["a", "hp", 2],
      ["mira", "armor", 0],
    ]);
    expect(ofKind(plan, "mark")[1]).toMatchObject({ noBenefit: true });
    expect(ofKind(plan, "defeat")).toEqual([{ kind: "defeat", targetId: "b" }]);
    expect(plan.actor.after.stress).toBe(0);
  });
});

describe("reactions and riders", () => {
  it("I Am Your Shield (CB p.341): a Stress, then the hit moves to you and any number of Armor Slots (folded by AA1)", () => {
    const shield = card(
      {
        activation: { kind: "reaction", trigger: { kind: "whenAllyWouldTakeDamage", range: "veryClose" } },
        costs: [{ kind: "stress", amount: fixed(1) }],
        steps: [
          { kind: "redirectDamage", to: "triggerSubject", target: "self" },
          { kind: "extraArmorSlots", to: "self", max: "any" },
        ],
      },
      "i-am-your-shield",
    );
    const plan = ok(run(shield, ctx([], { trigger: { subject: ally("mira"), amount: 12 } })));
    expect(plan.activation).toBe("reaction");
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "fold").map((f) => [f.step.kind, f.targetIds, f.amount])).toEqual([
      ["redirectDamage", ["mira"], undefined],
      ["extraArmorSlots", ["pc"], "any"],
    ]);
  });

  it("Champion's Edge: spend chosen Hope, pick that many different options", () => {
    const edge = card({
      activation: { kind: "rider", trigger: { kind: "whenYouAttack", result: "critical" } },
      choices: [{ id: "hope", label: "Hope", min: 0, max: fixed(3) }],
      costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
      steps: [
        {
          kind: "choose",
          id: "edge",
          label: "Choose",
          count: { kind: "spent", resource: "hope" },
          distinct: true,
          options: [
            { id: "hp", label: "Clear a Hit Point", steps: [{ kind: "clear", to: "self", track: "hp", amount: fixed(1) }] },
            { id: "armor", label: "Clear an Armor Slot", steps: [{ kind: "clear", to: "self", track: "armor", amount: fixed(1) }] },
            { id: "mark", label: "The target marks an additional HP", steps: [{ kind: "markHp", to: "targets", amount: fixed(1) }] },
          ],
        },
      ],
    });
    const plan = ok(run(edge, ctx([], { actor: actor({ hp: 2 }), targets: [adv("a")], choices: { hope: 2 }, options: { edge: ["hp", "hp", "mark"] } })));
    expect(plan.actor.after).toMatchObject({ hope: 0, hp: 1 });
    expect(plan.creatures[0]!.after.hp).toBe(1);
    const prompt = ok(run(edge, ctx([], { choices: { hope: 1 } })));
    expect(ofKind(prompt, "prompt")[0]).toMatchObject({ prompt: "choose", text: "Choose" });
  });

  it("a rider's damage change with no damage of its own is folded into the attack", () => {
    const rage = card({ activation: { kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } }, steps: [{ kind: "modifyDamage", to: "targets", change: { kind: "add", amount: { kind: "trait", trait: "strength" } } }] });
    const plan = ok(run(rage, ctx([], { targets: [adv("a")] })));
    expect(ofKind(plan, "fold")[0]).toMatchObject({ amount: 1, targetIds: ["a"] });
  });

  it("Arcane Reflection: Hope-many d6, any 6 reflects the attack", () => {
    const reflect = card({
      activation: { kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", damageType: "magic" } },
      choices: [{ id: "hope", label: "Hope", min: 1, max: { kind: "marked", who: "self", track: "hp" } }],
      costs: [{ kind: "hope", amount: { kind: "chosen", choice: "hope" } }],
      steps: [{ kind: "check", dice: { count: { kind: "spent", resource: "hope" }, sides: 6 }, test: { kind: "anyAtLeast", value: 6 }, then: [{ kind: "redirectDamage", to: "triggerSource", target: "triggerSource" }], otherwise: [] }],
    });
    const source = adv("mage");
    const hit = ok(run(reflect, ctx([3, 6], { actor: actor({ hp: 3 }), choices: { hope: 2 }, trigger: { source } })));
    expect(ofKind(hit, "check")[0]).toEqual({ kind: "check", total: 9, dice: [3, 6], passed: true });
    expect(ofKind(hit, "fold")).toHaveLength(1);
    const miss = ok(run(reflect, ctx([2, 5], { actor: actor({ hp: 3 }), choices: { hope: 2 }, trigger: { source } })));
    expect(ofKind(miss, "fold")).toHaveLength(0);
  });
});

describe("optional add-ons, tokens, Fear, effects, prompts", () => {
  it("Forceful Push's optional Hope for Vulnerable runs only when taken and paid", () => {
    const push = card({
      roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "melee", count: { kind: "one" } },
      steps: [
        { kind: "move", to: "targets", when: ["hit"], mode: "knockBack", range: "close" },
        { kind: "optional", id: "vulnerable", label: "Spend a Hope: Vulnerable", costs: [{ kind: "hope", amount: fixed(1) }], steps: [{ kind: "condition", to: "targets", when: ["hit"], condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" }] },
      ],
    });
    const taken = ok(run(push, ctx([9, 2], { targets: [adv("a")], optionals: ["vulnerable"] })));
    expect(ofKind(taken, "prompt")[0]).toMatchObject({ prompt: "move", text: "Knock back (close)", targetIds: ["a"] });
    expect(ofKind(taken, "condition")).toHaveLength(1);
    expect(taken.actor.after.hope).toBe(2);
    const skipped = ok(run(push, ctx([9, 2], { targets: [adv("a")] })));
    expect(ofKind(skipped, "condition")).toHaveLength(0);
  });

  it("tokens on the card: set to Agility, then spend", () => {
    const flight = card({ steps: [{ kind: "tokens", to: "self", op: "set", amount: { kind: "trait", trait: "agility" } }, { kind: "tokens", to: "self", op: "spend", amount: fixed(1) }] });
    const plan = ok(run(flight, ctx([])));
    expect(ofKind(plan, "tokens").map((t) => [t.op, t.before, t.after])).toEqual([
      ["set", 0, 2],
      ["spend", 2, 1],
    ]);
    expect(plan.actor.after.cardTokens).toBe(1);
  });

  it("the GM's Fear never goes below 0 or above 12", () => {
    const lose = ok(run(card({ steps: [{ kind: "fear", to: "self", change: "lose", amount: fixed(3) }] }), ctx([], { gmFear: 2 })));
    expect(lose.gmFearDelta).toBe(-2);
    const gain = ok(run(card({ steps: [{ kind: "fear", to: "self", change: "gain", amount: fixed(3) }] }), ctx([], { gmFear: 11 })));
    expect(gain.gmFearDelta).toBe(1);
  });

  it("effects resolve their numbers; manual steps carry the card's words; toVault", () => {
    const effect = card({
      exclusive: true,
      steps: [
        { kind: "effect", to: "selfAndAllies", label: "Rousing", mods: [{ kind: "stat", stat: "evasion", delta: { kind: "proficiency" } }, { kind: "advantage", on: "attack" }], duration: "scene" },
        { kind: "manual", to: "self", text: "Ask the GM a question." },
        { kind: "toVault", to: "self" },
      ],
    });
    const plan = ok(run(effect, ctx([], { allies: [ally("mira")] })));
    expect(ofKind(plan, "effect").map((e) => [e.targetId, e.mods])).toEqual([
      ["pc", [{ kind: "stat", stat: "evasion", delta: 2 }, { kind: "advantage", on: "attack" }]],
      ["mira", [{ kind: "stat", stat: "evasion", delta: 2 }, { kind: "advantage", on: "attack" }]],
    ]);
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", text: "Ask the GM a question." });
    expect(ofKind(plan, "toVault")).toEqual([{ kind: "toVault", permanent: false }]);
    expect(plan.exclusive).toBe(true);
  });

  it("conditions as tags carry what they imply (Horrified: Vulnerable)", () => {
    const effect = card({ steps: [{ kind: "condition", to: "targets", condition: { kind: "tag", tag: "Horrified", implies: ["vulnerable"] }, duration: "temporary" }] });
    const plan = ok(run(effect, ctx([], { targets: [adv("a")] })));
    expect(plan.creatures[0]!.after).toMatchObject({ tags: ["Horrified"], conditions: ["vulnerable"] });
  });
});

describe("several targets: follow-ups, splits, dropping dice (R9)", () => {
  it("Whirlwind: the others take half the same damage, compared with the same roll", () => {
    const whirl = card({
      roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "veryClose", count: { kind: "one" } },
      steps: [
        { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "primary" }, type: "weapon" },
        { kind: "followUp", targets: { side: "enemy", range: "veryClose", count: { kind: "all" } }, steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "sameAsMove" }, type: "weapon", scale: "half" }] },
      ],
    });
    // 9 + 2 + Finesse 1 = 12: hits Difficulty 12 and 11, misses 13. Damage 2d8+1 = 4 + 4 + 1 = 9; half = 5.
    const plan = ok(run(whirl, ctx([9, 2, 4, 4], { targets: [adv("a")], followUp: [adv("b", { difficulty: 11 }), adv("c", { difficulty: 13 })] })));
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 9],
      ["b", 5],
    ]);
  });

  it("Splintering Strike (CB p.332): split the damage as the player wishes, an extra die per target", () => {
    const splinter = card({
      roll: { kind: "attack", weapon: "either", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "weapon", count: { kind: "all" } },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "either" }, type: "weapon", distribution: "split", extraDiePerTarget: true }],
    });
    const plan = ok(run(splinter, ctx([9, 2, 5, 4, 3, 2], { targets: [adv("a"), adv("b")], splits: { a: 6, b: 4 } })));
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 9],
      ["b", 6],
    ]);
    const ask = ok(run(splinter, ctx([9, 2, 5, 4], { targets: [adv("a"), adv("b")] })));
    expect(ofKind(ask, "prompt")[0]).toMatchObject({ prompt: "split", amount: 10, targetIds: ["a", "b"] });
    expect(ofKind(ask, "damage")).toEqual([]);
  });

  it("Deathrun: +1 Proficiency, then one die fewer for each later target", () => {
    const deathrun = card({
      roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
      targets: { side: "enemy", range: "weapon", count: { kind: "all" }, area: "path" },
      steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "primary", proficiency: { delta: 1 } }, type: "weapon", distribution: "dropDiePerTarget" }],
    });
    // 3d8+1: 2 + 5 + 7 + 1 = 15; then 15 - 2 = 13; then 13 - 5 = 8.
    const plan = ok(run(deathrun, ctx([9, 2, 2, 5, 7], { targets: [adv("a"), adv("b"), adv("c"), adv("d")] })));
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 15],
      ["b", 13],
      ["c", 8],
    ]);
  });
});

describe("helpers", () => {
  it("pickUse: by id, else the first action use", () => {
    const effect: CardEffect = {
      cardId: "x",
      uses: [
        { id: "passive", name: "P", activation: { kind: "passive" }, steps: [] },
        { id: "go", name: "G", activation: { kind: "action" }, steps: [] },
      ],
    };
    expect(pickUse(effect)?.id).toBe("go");
    expect(pickUse(effect, "passive")?.id).toBe("passive");
    expect(pickUse(effect, "none")).toBeUndefined();
  });
  it("rollMatches: roll filters for riders", () => {
    const attack = { kind: "attack" as const, weapon: "primary" as const, difficulty: { kind: "target" as const } };
    const spell = { kind: "spellcast" as const, difficulty: { kind: "target" as const } };
    const presence = { kind: "trait" as const, trait: ["presence", "instinct"] as const, difficulty: { kind: "target" as const } };
    expect(rollMatches("attack", attack)).toBe(true);
    expect(rollMatches("attack", spell)).toBe(true);
    expect(rollMatches("weaponAttack", spell)).toBe(false);
    expect(rollMatches("spellcast", spell)).toBe(true);
    expect(rollMatches("instinct", presence)).toBe(true);
    expect(rollMatches("any", undefined)).toBe(false);
  });
});
