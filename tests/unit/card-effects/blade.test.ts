import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, Step } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { BLADE_EFFECTS } from "@/lib/srd/card-effects/blade";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-blade: every Blade card's effect run through the CA1 runner with fixed dice. Expected
// values are worked out by hand from the card text (CB p.329-330). RNG order: Hope die, Fear die, advantage dice, then
// damage dice, d20s and checks in the order the steps need them. Every test checks that all queued dice were used.

const effectOf = (cardId: string): CardEffect => {
  const effect = BLADE_EFFECTS.find((e) => e.cardId === cardId);
  if (!effect) throw new Error(`No Blade entry for ${cardId}`);
  return effect;
};
const useOf = (cardId: string, useId = "main"): CardUse => effectOf(cardId).uses.find((u) => u.id === useId)!;

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
  level: 7,
  tier: 3,
  loadoutDomains: ["blade", "blade", "blade", "blade", "valor"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 phy", trait: "finesse", damageType: "physical", range: "veryClose" } },
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

const ally = (id: string, over: Partial<Combatant> = {}): Combatant => ({
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

/** Runs a card with queued dice and checks every die was used. */
function runCard(cardId: string, dice: number[], over: Partial<RunContext> = {}) {
  const rng = queueRng(dice);
  const result = run(effectOf(cardId), { actor: actor(), gmFear: 2, rng, ...over });
  if (result.ok) rng.done();
  return result;
}

function ok(result: ReturnType<typeof run>): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const creature = (plan: RunPlan, id: string) => plan.creatures.find((c) => c.id === id)?.after;

// ---------------------------------------------------------------- the table

describe("the Blade table", () => {
  const expected = Object.entries(CARD_CLASSIFICATION.blade)
    .filter(([, c]) => c.usage !== "outOfCombat")
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per Blade card classified combat or passive (20), none for A Soldier's Bond", () => {
    const ids = BLADE_EFFECTS.map((e) => e.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(expected);
    expect(expected).toHaveLength(20);
    expect(ids).not.toContain("a-soldier-s-bond");
  });

  it("every entry's use ids are unique and passive cards only carry passive or auto uses", () => {
    for (const effect of BLADE_EFFECTS) {
      const useIds = effect.uses.map((u) => u.id);
      expect(new Set(useIds).size, effect.cardId).toBe(useIds.length);
      if (CARD_CLASSIFICATION.blade[effect.cardId]!.usage === "passive") {
        for (const use of effect.uses) expect(["passive", "auto"], effect.cardId).toContain(use.activation.kind);
      }
    }
  });

  it("every entry quotes its card text in a comment", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/srd/card-effects/blade.ts"), "utf8");
    const comments = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("//"))
      .map((line) => line.replace(/^\/\/\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    for (const id of expected) {
      const card = DOMAIN_CARDS.find((c) => c.id === id)!;
      expect(comments, card.name).toContain(card.text.replace(/\s+/g, " "));
    }
  });

  it("every combat-or-passive entry runs through run() without throwing", () => {
    for (const effect of BLADE_EFFECTS) {
      for (const use of effect.uses) {
        const result = run(effect, {
          actor: actor({ hope: 6, stress: 0, hp: 2 }),
          gmFear: 2,
          useId: use.id,
          targets: [adv("bandit")],
          picked: [adv("bandit")],
          allies: [ally("ally")],
          trigger: { source: adv("bandit"), subject: ally("ally") },
          situations: ["You're charging into danger", "The attack doesn't include you"],
          rng: () => 1,
        });
        expect(result.ok, `${effect.cardId}/${use.id}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- level 1

describe("Get Back Up (CB p.329)", () => {
  it("a reaction to Severe damage: mark a Stress, reduce the severity by one threshold", () => {
    expect(useOf("get-back-up").activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", severity: "severe" } });
    const plan = ok(runCard("get-back-up", []));
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "upfront", costs: [{ resource: "stress", amount: 1 }], paid: true }]);
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "reduceSeverity", steps: 1 }, targetIds: ["pc"], amount: 1 }]);
    expect(plan.limit).toBeNull();
  });

  it("can't be used with every Stress slot marked (CARD_COST_UNPAID)", () => {
    expect(runCard("get-back-up", [], { actor: actor({ stress: 6 }) })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Not Good Enough (CB p.329)", () => {
  it("a free rider on the damage roll: reroll the 1s and 2s", () => {
    expect(useOf("not-good-enough").activation).toEqual({ kind: "rider", trigger: { kind: "afterYouRoll", roll: "damage" } });
    const plan = ok(runCard("not-good-enough", [], { targets: [adv("bandit")] }));
    expect(ofKind(plan, "pay")).toEqual([]);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "reroll", atMost: 2 } }, targetIds: ["bandit"] }]);
  });

  it("folded into a weapon attack: 2d8+1 rolling 1 and 2 rerolls both (5 and 6) for 12", () => {
    const attack: CardEffect = {
      cardId: "attack-with-not-good-enough",
      uses: [
        {
          id: "main",
          name: "Attack",
          activation: { kind: "action" },
          roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
          targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
          steps: [...useOf("not-good-enough").steps, { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "primary" }, type: "weapon" }],
        },
      ],
    };
    const rng = queueRng([9, 4, 1, 2, 5, 6]);
    const plan = ok(run(attack, { actor: actor(), gmFear: 2, targets: [adv("bandit")], rng }));
    rng.done();
    expect(ofKind(plan, "damageRoll")[0]!.record.total).toBe(12);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ taken: 12, severity: "major", hpMarked: 2 });
  });
});

describe("Whirlwind (CB p.329)", () => {
  // Finesse 1, d8+1 at Proficiency 2. Roll 9 + 4 + 1 = 14 with Hope: hits the Bandit (12) and the second Bandit (12),
  // not the Knight (20). Damage 3 + 5 + 1 = 9: the Bandit takes 9 (Major, 2 HP), the second Bandit half, 5 (Minor, 1 HP).
  const ctx = (dice: number[], over: Partial<RunContext> = {}) =>
    runCard("whirlwind", dice, { targets: [adv("bandit")], followUp: [adv("bandit-2"), adv("knight", { difficulty: 20 })], ...over });

  it("with the Hope spent: the same roll and damage against all other targets within Very Close, half damage", () => {
    const plan = ok(ctx([9, 4, 3, 5], { optionals: ["whirlwind"] }));
    expect(plan.hits).toEqual([{ id: "bandit", hit: true }]);
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "optional", costs: [{ resource: "hope", amount: 1 }], paid: true }]);
    expect(ofKind(plan, "hits")[1]!.results).toEqual([
      { id: "bandit-2", hit: true },
      { id: "knight", hit: false },
    ]);
    // One damage roll for the move (CB p.104).
    expect(ofKind(plan, "damageRoll").map((d) => d.record.total)).toEqual([9, 9]);
    const damage = Object.fromEntries(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result]));
    expect(damage.bandit).toMatchObject({ incoming: 9, severity: "major", hpMarked: 2 });
    expect(damage["bandit-2"]).toMatchObject({ incoming: 5, severity: "minor", hpMarked: 1 });
    expect(damage.knight).toBeUndefined();
    // 2 Hope + 1 from the roll - 1 spent.
    expect(plan.actor.after.hope).toBe(2);
  });

  it("without the Hope it is a plain attack on the one target", () => {
    const plan = ok(ctx([9, 4, 3, 5]));
    expect(ofKind(plan, "damage").map((d) => d.result.targetId)).toEqual(["bandit"]);
    expect(plan.actor.after.hope).toBe(3);
  });

  it("a miss offers nothing; with 0 Hope and a roll with Fear the Hope can't be paid", () => {
    const miss = ok(ctx([2, 3], { optionals: ["whirlwind"] }));
    expect(miss.success).toBe(false);
    expect(ofKind(miss, "pay")).toEqual([]);
    expect(ofKind(miss, "damage")).toEqual([]);

    const broke = ok(ctx([4, 9, 3, 5], { actor: actor({ hope: 0 }), optionals: ["whirlwind"] }));
    expect(ofKind(broke, "pay")).toMatchObject([{ phase: "optional", paid: false }]);
    expect(ofKind(broke, "damage").map((d) => d.result.targetId)).toEqual(["bandit"]);
  });

  it("targets one enemy within Very Close range", () => {
    expect(useOf("whirlwind").targets).toEqual({ side: "enemy", range: "veryClose", count: { kind: "one" } });
  });
});

// ---------------------------------------------------------------- level 2-4

describe("Reckless (CB p.330)", () => {
  it("before an attack: mark a Stress for advantage", () => {
    expect(useOf("reckless").activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } });
    const plan = ok(runCard("reckless", []));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyRoll", change: { kind: "advantage" } }, targetIds: ["pc"] }]);
  });
});

describe("Scramble (CB p.330)", () => {
  it("once per rest, when a creature in Melee would deal damage: avoid the attack, move out of Melee", () => {
    expect(useOf("scramble").activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouWouldTakeDamage", from: "melee" } });
    const plan = ok(runCard("scramble", [], { trigger: { source: adv("ogre") } }));
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "negate", what: "attack" }, targetIds: ["pc"] }]);
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "move", text: "Move safely out of Melee range of the enemy", targetIds: ["pc"] }]);
    expect(plan.limit).toEqual({ key: "card:scramble", until: "rest", consumed: true });
    expect(plan.actor.featureUses).toEqual([{ key: "card:scramble", until: "rest" }]);
  });

  it("is exhausted until a rest (CARD_EXHAUSTED)", () => {
    const used = actor({ featureUses: [{ key: "card:scramble", until: "rest" }] });
    expect(runCard("scramble", [], { actor: used })).toEqual({ ok: false, reason: "exhausted", detail: "Back after a rest" });
  });
});

describe("Versatile Fighter (CB p.330)", () => {
  it("the different trait is a manual step (vocabulary gap)", () => {
    const plan = ok(runCard("versatile-fighter", [], { useId: "trait" }));
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "manual", targetIds: ["pc"] }]);
    expect(ofKind(plan, "prompt")[0]!.text).toContain("different character trait");
  });

  it("mark a Stress to use the maximum of one damage die", () => {
    const plan = ok(runCard("versatile-fighter", [], { useId: "max-die", targets: [adv("bandit")] }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "maxDice", count: 1 } }, targetIds: ["bandit"] }]);
  });

  it("folded into a weapon attack: 2d8+1 rolling 3 and 6 maxes the 3 for 8 + 6 + 1 = 15", () => {
    const attack: CardEffect = {
      cardId: "attack-with-versatile-fighter",
      uses: [
        {
          id: "main",
          name: "Attack",
          activation: { kind: "action" },
          roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
          targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
          steps: [...useOf("versatile-fighter", "max-die").steps, { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "primary" }, type: "weapon" }],
        },
      ],
    };
    const rng = queueRng([9, 4, 3, 6]);
    const plan = ok(run(attack, { actor: actor(), gmFear: 2, targets: [adv("bandit")], rng }));
    rng.done();
    expect(ofKind(plan, "damageRoll")[0]!.record.total).toBe(15);
  });
});

describe("Deadly Focus (CB p.330)", () => {
  it("once per rest: +1 Proficiency until you attack another creature, defeat the target or the battle ends", () => {
    const plan = ok(runCard("deadly-focus", [], { targets: [adv("ogre")] }));
    expect(ofKind(plan, "effect")).toEqual([
      {
        kind: "effect",
        targetId: "pc",
        label: "Deadly Focus",
        mods: [{ kind: "stat", stat: "proficiency", delta: 1 }],
        duration: "manual",
        endsWhen: "you attack another creature, you defeat the target, or the battle ends",
      },
    ]);
    expect(creature(plan, "ogre")).toMatchObject({ tags: ["Focused"] });
    expect(plan.exclusive).toBe(true);
    expect(plan.limit).toMatchObject({ until: "rest", consumed: true });
  });

  it("one target only", () => {
    expect(runCard("deadly-focus", [], { targets: [adv("a"), adv("b")] })).toMatchObject({ ok: false, reason: "targets" });
  });
});

describe("Fortified Armor (CB p.330)", () => {
  it("while wearing armor: +2 to both damage thresholds", () => {
    const use = useOf("fortified-armor");
    expect(use.activation).toEqual({ kind: "passive" });
    expect(use.mods).toEqual([
      { kind: "stat", stat: "majorThreshold", delta: { kind: "fixed", value: 2 } },
      { kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 2 } },
    ]);
    expect(ok(runCard("fortified-armor", [])).steps).toEqual([]);
    expect(runCard("fortified-armor", [], { actor: actor({ armorWorn: false }) })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

// ---------------------------------------------------------------- level 5-6

describe("Champion's Edge (CB p.330)", () => {
  it("on a critical attack: 3 Hope for all three options", () => {
    expect(useOf("champion-s-edge").activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "critical" } });
    const plan = ok(
      runCard("champion-s-edge", [], {
        actor: actor({ hope: 3, hp: 2, armor: 1 }),
        targets: [adv("bandit", { hp: 1 })],
        choices: { hope: 3 },
        options: { edge: ["clear-hp", "clear-armor", "mark-hp"] },
      }),
    );
    expect(plan.actor.after).toMatchObject({ hope: 0, hp: 1, armor: 0 });
    expect(creature(plan, "bandit")).toMatchObject({ hp: 2 });
  });

  it("can't choose the same option more than once; one option per Hope", () => {
    const plan = ok(
      runCard("champion-s-edge", [], {
        actor: actor({ hope: 2, hp: 3 }),
        targets: [adv("bandit")],
        choices: { hope: 2 },
        options: { edge: ["clear-hp", "clear-hp", "mark-hp"] },
      }),
    );
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "pc", track: "hp", amount: 1 }]);
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "bandit", track: "hp", amount: 1 }]);
    expect(plan.actor.after).toMatchObject({ hope: 0, hp: 2 });
  });

  it("up to 3 Hope, and only the Hope you have", () => {
    expect(runCard("champion-s-edge", [], { actor: actor({ hope: 6 }), choices: { hope: 4 } })).toMatchObject({ ok: false, reason: "choice" });
    expect(runCard("champion-s-edge", [], { actor: actor({ hope: 1 }), choices: { hope: 2 } })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("without picked options it asks", () => {
    const plan = ok(runCard("champion-s-edge", [], { choices: { hope: 1 } }));
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "choose" }]);
  });
});

describe("Vitality (CB p.330)", () => {
  it("is a level-up pick: a passive card whose only step is the card's words", () => {
    expect(useOf("vitality").activation).toEqual({ kind: "passive" });
    const plan = ok(runCard("vitality", []));
    expect(ofKind(plan, "prompt")).toMatchObject([{ prompt: "manual" }]);
    expect(ofKind(plan, "prompt")[0]!.text).toContain("Then place this card in your vault permanently");
  });
});

describe("Battle-Hardened (CB p.330)", () => {
  it("once per long rest, instead of a Death Move: spend a Hope to clear a Hit Point", () => {
    expect(useOf("battle-hardened").activation).toEqual({ kind: "reaction", trigger: { kind: "wouldMakeDeathMove", who: "self" } });
    const plan = ok(runCard("battle-hardened", [], { actor: actor({ hope: 1, hp: 6 }) }));
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "negate", what: "deathMove" } }]);
    expect(plan.actor.after).toMatchObject({ hope: 0, hp: 5 });
    expect(plan.limit).toEqual({ key: "card:battle-hardened", until: "longRest", consumed: true });
  });

  it("needs a Hope", () => {
    expect(runCard("battle-hardened", [], { actor: actor({ hope: 0, hp: 6 }) })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Rage Up (CB p.330)", () => {
  it("twice: 2 Stress for +2 x Strength each (Strength 2: +8)", () => {
    expect(useOf("rage-up").activation).toEqual({ kind: "rider", trigger: { kind: "beforeYouRoll", roll: "attack" } });
    const strong = actor({ traits: { agility: 0, strength: 2, finesse: 0, instinct: 0, presence: 0, knowledge: 0 } });
    const plan = ok(runCard("rage-up", [], { actor: strong, targets: [adv("bandit")], choices: { times: 2 } }));
    expect(plan.actor.after.stress).toBe(3);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "add" } }, targetIds: ["bandit"], amount: 8 }]);
  });

  it("once: +4 with Strength 2; never three times", () => {
    const strong = actor({ traits: { agility: 0, strength: 2, finesse: 0, instinct: 0, presence: 0, knowledge: 0 } });
    expect(ofKind(ok(runCard("rage-up", [], { actor: strong, targets: [adv("bandit")], choices: { times: 1 } })), "fold")[0]!.amount).toBe(4);
    expect(runCard("rage-up", [], { actor: strong, choices: { times: 3 } })).toMatchObject({ ok: false, reason: "choice" });
  });
});

// ---------------------------------------------------------------- level 7-8

describe("Blade-Touched (CB p.330)", () => {
  it("4+ Blade cards in the loadout: +2 attack rolls, +4 Severe threshold", () => {
    const use = useOf("blade-touched");
    expect(use.requires).toEqual([{ kind: "loadoutDomainCount", domain: "blade", min: 4 }]);
    expect(use.mods).toEqual([
      { kind: "stat", stat: "attack", delta: { kind: "fixed", value: 2 } },
      { kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 4 } },
    ]);
    expect(runCard("blade-touched", []).ok).toBe(true);
    expect(runCard("blade-touched", [], { actor: actor({ loadoutDomains: ["blade", "blade", "blade", "bone"] }) })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Glancing Blow (CB p.330)", () => {
  it("after a failed weapon attack, a Stress: weapon damage with half Proficiency (3 -> 2, rounded up, CB p.107)", () => {
    expect(useOf("glancing-blow").activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouAttack", result: "failure", weapon: true } });
    const plan = ok(runCard("glancing-blow", [4, 6], { actor: actor({ proficiency: 3 }), targets: [adv("bandit")] }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "physical", record: { total: 11 } });
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ targetId: "bandit", taken: 11, severity: "major", hpMarked: 2 });
    expect(plan.roll).toBeNull();
  });
});

describe("Battle Cry (CB p.330)", () => {
  const situations = ["You're charging into danger"];

  it("once per long rest: every ally clears a Stress, gains a Hope and has advantage on attacks until a failure with Fear", () => {
    const plan = ok(runCard("battle-cry", [], { situations, allies: [ally("mira", { stress: 2 }), ally("tov")] }));
    expect(ofKind(plan, "clear")).toEqual([
      { kind: "clear", targetId: "mira", track: "stress", amount: 1 },
      { kind: "clear", targetId: "tov", track: "stress", amount: 0 },
    ]);
    expect(ofKind(plan, "hope")).toEqual([
      { kind: "hope", targetId: "mira", delta: 1 },
      { kind: "hope", targetId: "tov", delta: 1 },
    ]);
    expect(ofKind(plan, "effect")).toMatchObject([
      { targetId: "mira", label: "Battle Cry", mods: [{ kind: "advantage", on: "attack" }], duration: "manual", endsWhen: "you or an ally rolls a failure with Fear" },
      { targetId: "tov", label: "Battle Cry" },
    ]);
    // Only the allies: the actor gains nothing.
    expect(plan.actor.after).toEqual(plan.actor.before);
    expect(plan.limit).toMatchObject({ until: "longRest", consumed: true });
  });

  it("only while charging into danger (the player confirms)", () => {
    expect(runCard("battle-cry", [], { allies: [ally("mira")] })).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Frenzy (CB p.330)", () => {
  it("once per long rest: no Armor Slots, +10 damage, +8 Severe threshold until no adversaries are in sight", () => {
    const plan = ok(runCard("frenzy", []));
    expect(ofKind(plan, "effect")).toEqual([
      {
        kind: "effect",
        targetId: "pc",
        label: "Frenzied",
        mods: [
          { kind: "flag", flag: "noArmorSlots" },
          { kind: "stat", stat: "damage", delta: 10 },
          { kind: "stat", stat: "severeThreshold", delta: 8 },
        ],
        duration: "manual",
        endsWhen: "there are no more adversaries within sight",
      },
    ]);
    expect(plan.limit).toEqual({ key: "card:frenzy", until: "longRest", consumed: true });
  });
});

// ---------------------------------------------------------------- level 9-10

describe("Gore and Glory (CB p.330)", () => {
  it("a critical weapon attack: an additional Hope or an additional cleared Stress", () => {
    expect(useOf("gore-and-glory", "critical").activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "critical", weapon: true } });
    const stress = ok(runCard("gore-and-glory", [], { useId: "critical", actor: actor({ stress: 2 }), options: { glory: ["stress"] } }));
    expect(stress.actor.after).toMatchObject({ stress: 1, hope: 2 });
    const hope = ok(runCard("gore-and-glory", [], { useId: "critical", options: { glory: ["hope"] } }));
    expect(hope.actor.after).toMatchObject({ stress: 1, hope: 3 });
  });

  it("defeating an enemy: a Hope or a cleared Stress; only one of the two", () => {
    expect(useOf("gore-and-glory", "defeat").activation).toEqual({ kind: "rider", trigger: { kind: "whenEnemyDefeated", byYou: true } });
    const plan = ok(runCard("gore-and-glory", [], { useId: "defeat", options: { glory: ["hope", "stress"] } }));
    expect(plan.actor.after).toMatchObject({ hope: 3, stress: 1 });
    expect(ofKind(ok(runCard("gore-and-glory", [], { useId: "defeat" })), "prompt")).toMatchObject([{ prompt: "choose" }]);
  });
});

describe("Reaper's Strike (CB p.330)", () => {
  // Finesse 1. Roll 8 + 3 + 1 = 12 with Hope: hits the Bandit (12), not the Knight (20).
  it("once per long rest, a Hope: one attack roll, the picked hit target marks 5 Hit Points (no damage roll)", () => {
    const plan = ok(runCard("reaper-s-strike", [8, 3], { targets: [adv("bandit"), adv("knight", { difficulty: 20 })], picked: [adv("bandit")] }));
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "upfront", costs: [{ resource: "hope", amount: 1 }], paid: true }]);
    expect(plan.hits).toEqual([
      { id: "bandit", hit: true },
      { id: "knight", hit: false },
    ]);
    expect(ofKind(plan, "damageRoll")).toEqual([]);
    expect(ofKind(plan, "mark")).toEqual([{ kind: "mark", targetId: "bandit", track: "hp", amount: 5, hpMarked: 5, overflow: false }]);
    expect(creature(plan, "bandit")).toMatchObject({ hp: 5, defeated: true });
    expect(creature(plan, "knight")).toBeUndefined();
    // 2 - 1 spent + 1 from the roll with Hope.
    expect(plan.actor.after.hope).toBe(2);
    expect(plan.limit).toEqual({ key: "card:reaper-s-strike", until: "longRest", consumed: true });
  });

  it("a roll that hits nobody forces nothing (the long-rest use is still spent)", () => {
    const plan = ok(runCard("reaper-s-strike", [2, 3], { targets: [adv("bandit")], picked: [adv("bandit")] }));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "mark")).toEqual([]);
    expect(plan.limit?.consumed).toBe(true);
  });
});

describe("Battle Monster (CB p.330)", () => {
  it("on a successful attack, 4 Stress: the target marks HP equal to your marked HP instead of rolling damage", () => {
    expect(useOf("battle-monster").activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success" } });
    const plan = ok(runCard("battle-monster", [], { actor: actor({ hp: 3, stress: 1 }), targets: [adv("ogre")] }));
    expect(plan.actor.after.stress).toBe(5);
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "replaceWithHp" } }, targetIds: ["ogre"], amount: 3 }]);
  });

  it("folded into a weapon attack: no damage roll, the Ogre marks 3 HP", () => {
    const attack: CardEffect = {
      cardId: "attack-with-battle-monster",
      uses: [
        {
          id: "main",
          name: "Attack",
          activation: { kind: "action" },
          roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
          targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
          steps: [
            { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "primary" }, type: "weapon" },
            ...(useOf("battle-monster").steps as Step[]),
          ],
        },
      ],
    };
    const rng = queueRng([9, 4, 1, 1]);
    const plan = ok(run(attack, { actor: actor({ hp: 3 }), gmFear: 2, targets: [adv("ogre", { hpMax: 7 })], rng }));
    rng.done();
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "ogre", track: "hp", amount: 3, hpMarked: 3 }]);
    expect(ofKind(plan, "damage")).toEqual([]);
  });

  it("needs 4 free Stress slots", () => {
    expect(runCard("battle-monster", [], { actor: actor({ stress: 3 }) })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Onslaught (CB p.330)", () => {
  it("a successful weapon attack never deals damage beneath the Major threshold", () => {
    expect(useOf("onslaught", "floor").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "success", weapon: true } });
    const plan = ok(runCard("onslaught", [], { useId: "floor", targets: [adv("bandit")] }));
    expect(ofKind(plan, "fold")).toMatchObject([{ step: { kind: "modifyDamage", change: { kind: "minimumSeverity", severity: "major" } }, targetIds: ["bandit"] }]);
  });

  it("folded into a weapon attack: 2d8+1 rolling 1 and 2 (4, Minor) still marks 2 HP", () => {
    const attack: CardEffect = {
      cardId: "attack-with-onslaught",
      uses: [
        {
          id: "main",
          name: "Attack",
          activation: { kind: "action" },
          roll: { kind: "attack", weapon: "primary", difficulty: { kind: "target" } },
          targets: { side: "enemy", range: "weapon", count: { kind: "one" } },
          steps: [
            { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "weapon", weapon: "primary" }, type: "weapon" },
            ...(useOf("onslaught", "floor").steps as Step[]),
          ],
        },
      ],
    };
    const rng = queueRng([9, 4, 1, 2]);
    const plan = ok(run(attack, { actor: actor(), gmFear: 2, targets: [adv("bandit")], rng }));
    rng.done();
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ taken: 4, severity: "major", hpMarked: 2 });
  });

  const situations = ["The attack doesn't include you"];
  const trigger = { source: adv("ogre", { hpMax: 7 }), subject: ally("mira") };

  it("a creature in weapon range damages an ally: a Stress forces a Reaction Roll (15); on a failure it marks a HP", () => {
    expect(useOf("onslaught", "reaction").activation).toEqual({
      kind: "reaction",
      trigger: { kind: "whenAllyTakesDamage", range: "veryFar", sourceWithin: "weapon" },
    });
    const plan = ok(runCard("onslaught", [10], { useId: "reaction", situations, trigger }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "save")).toMatchObject([{ targetId: "ogre", difficulty: 15, success: false }]);
    expect(ofKind(plan, "mark")).toMatchObject([{ targetId: "ogre", track: "hp", amount: 1, hpMarked: 1 }]);
  });

  it("a 15 succeeds: nothing marked", () => {
    const plan = ok(runCard("onslaught", [15], { useId: "reaction", situations, trigger }));
    expect(ofKind(plan, "save")).toMatchObject([{ success: true }]);
    expect(ofKind(plan, "mark")).toEqual([]);
  });

  it("not when the attack includes you (the player confirms)", () => {
    expect(runCard("onslaught", [], { useId: "reaction", trigger })).toMatchObject({ ok: false, reason: "requirement" });
  });
});
