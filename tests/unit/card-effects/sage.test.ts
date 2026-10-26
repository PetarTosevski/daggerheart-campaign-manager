import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, Requirement, Step } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { SAGE_EFFECTS } from "@/lib/srd/card-effects/sage";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-sage: every Sage card's effect entry, run through the CA1 runner with fixed dice.
// Expected values come from the card text (CB p.338-339) by hand. RNG order: Hope die, Fear die, then damage dice, d20s
// and checks in the order the steps need them. The default actor has Spellcast 3, Proficiency 2, 2 Hope and 1 of 6
// Stress marked; the default adversary has Difficulty 12 and thresholds 8/14 (Minor 1-7, Major 8-13, Severe 14+).

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
  traits: { agility: 2, strength: 1, finesse: 1, instinct: 3, presence: 1, knowledge: 0 },
  spellcast: 3,
  proficiency: 2,
  level: 10,
  tier: 4,
  loadoutDomains: ["sage", "arcana"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 mag", trait: "instinct", damageType: "magic", range: "far" } },
  ...over,
});

const adv = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 6,
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

const effectOf = (cardId: string): CardEffect => {
  const found = SAGE_EFFECTS.find((e) => e.cardId === cardId);
  if (!found) throw new Error(`No entry for ${cardId}`);
  return found;
};

const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 2, rng: queueRng(dice), ...over });

/** Runs a card and checks every queued die was used. */
function ok(cardId: string, context: RunContext): RunPlan {
  const result = run(effectOf(cardId), context);
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  (context.rng as ReturnType<typeof queueRng>).done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const prompts = (plan: RunPlan, prompt: string) => ofKind(plan, "prompt").filter((p) => p.prompt === prompt);
const folds = (plan: RunPlan) => ofKind(plan, "fold").map((f) => ({ kind: f.step.kind, targetIds: f.targetIds, amount: f.amount }));
const damageOf = (plan: RunPlan) => ofKind(plan, "damage").map((d) => ({ id: d.result.targetId, incoming: d.result.incoming, hpMarked: d.result.hpMarked }));

/** Every situation text a Sage requirement or gate asks the player to confirm. */
function situationsOf(effects: readonly CardEffect[]): string[] {
  const texts = new Set<string>();
  const fromReq = (r: Requirement) => {
    if (r.kind === "situation") texts.add(r.text);
  };
  const walk = (steps: readonly Step[]) => {
    for (const s of steps) {
      for (const g of s.when ?? []) if (typeof g !== "string" && g.kind === "requires") fromReq(g.requirement);
      if (s.kind === "optional") walk(s.steps);
      if (s.kind === "choose") s.options.forEach((o) => walk(o.steps));
      if (s.kind === "save") walk([...s.onFail, ...s.onSuccess]);
      if (s.kind === "check") walk([...s.then, ...s.otherwise]);
      if (s.kind === "followUp") walk(s.steps);
    }
  };
  for (const e of effects) for (const u of e.uses) {
    (u.requires ?? []).forEach(fromReq);
    walk(u.steps);
  }
  return [...texts];
}

describe("the Sage table", () => {
  const usable = Object.entries(CARD_CLASSIFICATION.sage)
    .filter(([, c]) => c.usage !== "outOfCombat")
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per combat or passive Sage card (U3)", () => {
    const ids = SAGE_EFFECTS.map((e) => e.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(usable);
    expect(usable).toHaveLength(18);
  });

  it("leaves out exactly the out-of-combat Sage cards of DOMAIN_CARDS", () => {
    const sage = DOMAIN_CARDS.filter((c) => c.domain === "sage").map((c) => c.id);
    expect(sage).toHaveLength(21);
    expect(sage.filter((id) => !usable.includes(id)).sort()).toEqual(["forager", "gifted-tracker", "nature-s-tongue"]);
  });

  it("every use runs through run() without throwing", () => {
    const rich = actor({
      hope: 6,
      stress: 0,
      cardTokens: 3,
      loadoutDomains: ["sage", "sage", "sage", "sage"],
      activeCardEffects: SAGE_EFFECTS.map((e) => e.cardId),
    });
    for (const effect of SAGE_EFFECTS) {
      const useIds = new Set(effect.uses.map((u) => u.id));
      expect(useIds.size).toBe(effect.uses.length);
      for (const use of effect.uses) {
        const result = run(effect, {
          actor: rich,
          gmFear: 3,
          useId: use.id,
          targets: [adv("a")],
          picked: [adv("b")],
          allies: [ally("mira")],
          trigger: { amount: 10, source: adv("src"), subject: ally("mira") },
          choices: { hope: 1, tokens: 1, stress: 2, damage: 16 },
          options: { grip: ["vines"], trait: ["agility"], tempest: ["sandstorm"] },
          optionals: ["second", "keep", "flies", "corrode", "two"],
          situations: situationsOf(SAGE_EFFECTS),
          roll: { difficulty: 10 },
          rng: () => 4,
        });
        expect(result, `${effect.cardId}/${use.id}`).toMatchObject({ ok: true });
      }
    }
  });
});

describe("Vicious Entangle (L1, CB p.338)", () => {
  it("on a success 1d8+1 physical (no Proficiency) and temporarily Restrained", () => {
    // 9 + 4 + 3 = 16 beats 12 with Hope; 1d8+1 = 5 + 1 = 6: Minor, 1 HP.
    const plan = ok("vicious-entangle", ctx([9, 4, 5], { targets: [adv("a")] }));
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "physical", record: { total: 6 } });
    expect(damageOf(plan)).toEqual([{ id: "a", incoming: 6, hpMarked: 1 }]);
    expect(ofKind(plan, "condition")).toEqual([{ kind: "condition", targetId: "a", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" }]);
    expect(plan.actor.after.hope).toBe(3);
  });
  it("a Hope (the roll's own may pay) Restrains another adversary within Very Close range of the target", () => {
    const plan = ok("vicious-entangle", ctx([9, 4, 5], { actor: actor({ hope: 0 }), targets: [adv("a")], picked: [adv("b")], optionals: ["second"] }));
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "optional", costs: [{ resource: "hope", amount: 1 }], paid: true }]);
    expect(ofKind(plan, "condition").map((c) => c.targetId)).toEqual(["a", "b"]);
    expect(plan.actor.after.hope).toBe(0);
  });
  it("a critical adds the d8's maximum: 8 + 3 + 1 = 12, Major", () => {
    const plan = ok("vicious-entangle", ctx([6, 6, 3], { targets: [adv("a")] }));
    expect(plan.roll?.critical).toBe(true);
    expect(damageOf(plan)).toEqual([{ id: "a", incoming: 12, hpMarked: 2 }]);
  });
  it("a miss deals nothing and the extra Restrain is not offered", () => {
    const plan = ok("vicious-entangle", ctx([2, 3], { targets: [adv("a")], picked: [adv("b")], optionals: ["second"] }));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(ofKind(plan, "condition")).toEqual([]);
    expect(plan.actor.after.hope).toBe(2);
  });
});

describe("Conjure Swarm (L2, CB p.338)", () => {
  it("Tekaira Armored Beetles: a Stress conjures the beetles", () => {
    const plan = ok("conjure-swarm", ctx([], { useId: "beetles" }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", label: "Tekaira Armored Beetles", duration: "manual" });
  });
  it("when you next take damage the severity drops one threshold; a Hope keeps the beetles", () => {
    const base = { useId: "beetles-damage", actor: actor({ activeCardEffects: ["conjure-swarm"] }), trigger: { amount: 9, source: adv("ogre") } };
    const plain = ok("conjure-swarm", ctx([], base));
    expect(plain.activation).toBe("reaction");
    expect(folds(plain)).toEqual([{ kind: "reduceSeverity", targetIds: ["pc"], amount: 1 }]);
    expect(prompts(plain, "manual").map((p) => p.text)).toEqual([expect.stringMatching(/beetles disperse/)]);
    const kept = ok("conjure-swarm", ctx([], { ...base, optionals: ["keep"] }));
    expect(kept.actor.after.hope).toBe(1);
    expect(prompts(kept, "manual")[0]!.text).toMatch(/stay conjured/);
  });
  it("needs the beetles to be conjured", () => {
    expect(run(effectOf("conjure-swarm"), ctx([], { useId: "beetles-damage" }))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("Fire Flies: one roll against all within Close; a Hope deals 2d8+3 magic to those hit", () => {
    // 7 + 5 + 3 = 15: hits a (12), misses b (20). Hope 2 + 1 (with Hope) - 1 = 2. 2d8+3 = 4 + 6 + 3 = 13: Major.
    const plan = ok("conjure-swarm", ctx([7, 5, 4, 6], { useId: "fire-flies", targets: [adv("a"), adv("b", { difficulty: 20 })] }));
    expect(plan.hits).toEqual([{ id: "a", hit: true }, { id: "b", hit: false }]);
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "afterRoll", paid: true });
    expect(damageOf(plan)).toEqual([{ id: "a", incoming: 13, hpMarked: 2 }]);
    expect(plan.actor.after.hope).toBe(2);
  });
  it("Fire Flies without a Hope to spend deals nothing", () => {
    const plan = ok("conjure-swarm", ctx([3, 8], { useId: "fire-flies", actor: actor({ hope: 0 }), targets: [adv("a")] }));
    expect(plan.success).toBe(true);
    expect(ofKind(plan, "pay")[0]).toMatchObject({ paid: false });
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(plan.gmFearDelta).toBe(1);
  });
});

describe("Natural Familiar (L2, CB p.338)", () => {
  it("a Hope summons the familiar until your next rest; one at a time", () => {
    const plan = ok("natural-familiar", ctx([]));
    expect(plan.actor.after.hope).toBe(1);
    expect(plan.exclusive).toBe(true);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ label: "Natural Familiar", duration: "rest", endsWhen: "the familiar is targeted by an attack" });
  });
  it("an additional Hope summons a familiar that flies", () => {
    const plan = ok("natural-familiar", ctx([], { optionals: ["flies"] }));
    expect(plan.actor.after.hope).toBe(0);
    expect(prompts(plan, "manual").map((p) => p.text)).toContain("Your familiar can fly.");
  });
  it("command (Spellcast, GM Difficulty) and see through their eyes (a Stress) need the familiar", () => {
    const withFamiliar = actor({ activeCardEffects: ["natural-familiar"] });
    const command = ok("natural-familiar", ctx([6, 3], { useId: "command", actor: withFamiliar, roll: { difficulty: 10 } }));
    expect(command.success).toBe(true);
    expect(prompts(command, "manual")).toHaveLength(1);
    expect(ok("natural-familiar", ctx([], { useId: "see", actor: withFamiliar })).actor.after.stress).toBe(2);
    expect(run(effectOf("natural-familiar"), ctx([], { useId: "see" }))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("adds a d6 to damage against an adversary within Melee range of the familiar", () => {
    const familiar = { actor: actor({ activeCardEffects: ["natural-familiar"] }), useId: "damage" };
    const plan = ok("natural-familiar", ctx([4], { ...familiar, targets: [adv("a")], situations: ["The adversary is within Melee range of your familiar"] }));
    expect(plan.activation).toBe("rider");
    expect(folds(plan)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: 4 }]);
    expect(run(effectOf("natural-familiar"), ctx([], familiar))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Corrosive Projectile (L3, CB p.338)", () => {
  it("on a success d6+4 magic using Proficiency", () => {
    // 8 + 5 + 3 = 16 hits; 2d6+4 = 3 + 6 + 4 = 13: Major.
    const plan = ok("corrosive-projectile", ctx([8, 5, 3, 6], { targets: [adv("a")] }));
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 13 } });
    expect(damageOf(plan)).toEqual([{ id: "a", incoming: 13, hpMarked: 2 }]);
    expect(plan.actor.after.stress).toBe(1);
    expect(ofKind(plan, "condition")).toEqual([]);
  });
  it("4 Stress: permanently Corroded, -2 Difficulty; 3 Stress gives -1", () => {
    const four = ok("corrosive-projectile", ctx([8, 5, 3, 6], { targets: [adv("a")], optionals: ["corrode"], choices: { stress: 4 } }));
    expect(four.actor.after.stress).toBe(5);
    expect(ofKind(four, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Corroded" }, duration: "permanent" });
    expect(ofKind(four, "effect")[0]).toMatchObject({ targetId: "a", label: "Corroded", mods: [{ kind: "stat", stat: "difficulty", delta: -2 }], duration: "permanent" });
    const three = ok("corrosive-projectile", ctx([8, 5, 3, 6], { targets: [adv("a")], optionals: ["corrode"], choices: { stress: 3 } }));
    expect(ofKind(three, "effect")[0]!.mods).toEqual([{ kind: "stat", stat: "difficulty", delta: -1 }]);
  });
  it("fewer than 2 Stress is refused; a miss marks no Stress", () => {
    expect(run(effectOf("corrosive-projectile"), ctx([], { targets: [adv("a")], choices: { stress: 1 } }))).toMatchObject({ ok: false, reason: "choice" });
    const miss = ok("corrosive-projectile", ctx([2, 3], { targets: [adv("a")], optionals: ["corrode"], choices: { stress: 2 } }));
    expect(miss.actor.after.stress).toBe(1);
  });
});

describe("Towering Stalk (L3, CB p.338)", () => {
  it("the stalk is once per rest", () => {
    const plan = ok("towering-stalk", ctx([], { useId: "stalk" }));
    expect(plan.limit).toEqual({ key: "card:towering-stalk:stalk", until: "rest", consumed: true });
    expect(prompts(plan, "manual")).toHaveLength(1);
    const again = run(effectOf("towering-stalk"), ctx([], { useId: "stalk", actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toMatchObject({ ok: false, reason: "exhausted", detail: "Back after a rest" });
  });
  it("the attack: a Stress, one roll against a group within Close, d8 physical using Proficiency rolled once", () => {
    // 10 + 2 + 3 = 15 hits both; 2d8 = 3 + 7 = 10: Major for each.
    const plan = ok("towering-stalk", ctx([10, 2, 3, 7], { useId: "attack", targets: [adv("a"), adv("b")] }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "damageRoll")).toHaveLength(1);
    expect(damageOf(plan)).toEqual([
      { id: "a", incoming: 10, hpMarked: 2 },
      { id: "b", incoming: 10, hpMarked: 2 },
    ]);
  });
});

describe("Death Grip (L4, CB p.338)", () => {
  it("asks for the option when none was picked", () => {
    const plan = ok("death-grip", ctx([9, 3], { targets: [adv("a")] }));
    expect(prompts(plan, "choose")).toHaveLength(1);
    expect(ofKind(plan, "condition")).toHaveLength(1);
  });
  it("pull: a movement prompt and temporarily Restrained", () => {
    const plan = ok("death-grip", ctx([9, 3], { targets: [adv("a")], options: { grip: ["pull"] } }));
    expect(prompts(plan, "move")).toMatchObject([{ targetIds: ["a"] }]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" });
  });
  it("constrict: the target marks 2 Stress", () => {
    const plan = ok("death-grip", ctx([9, 3], { targets: [adv("a")], options: { grip: ["constrict"] } }));
    expect(ofKind(plan, "mark")).toEqual([{ kind: "mark", targetId: "a", track: "stress", amount: 2, hpMarked: 0, overflow: false }]);
  });
  it("vines: adversaries between you and the target save (13) or take 3d6+2 physical", () => {
    // b rolls 5 (fails): 3d6+2 = 2 + 3 + 4 + 2 = 11, Major. c rolls 15 (succeeds).
    const plan = ok("death-grip", ctx([9, 3, 5, 2, 3, 4, 15], { targets: [adv("a")], picked: [adv("b"), adv("c")], options: { grip: ["vines"] } }));
    expect(ofKind(plan, "save").map((s) => ({ id: s.targetId, difficulty: s.difficulty, success: s.success }))).toEqual([
      { id: "b", difficulty: 13, success: false },
      { id: "c", difficulty: 13, success: true },
    ]);
    expect(damageOf(plan)).toEqual([{ id: "b", incoming: 11, hpMarked: 2 }]);
    expect(ofKind(plan, "condition").map((c) => c.targetId)).toEqual(["a"]);
  });
  it("a miss causes nothing", () => {
    const plan = ok("death-grip", ctx([2, 3], { targets: [adv("a")], options: { grip: ["constrict"] } }));
    expect(ofKind(plan, "mark")).toEqual([]);
    expect(ofKind(plan, "condition")).toEqual([]);
  });
});

describe("Healing Field (L4, CB p.338)", () => {
  const hurt = { actor: actor({ hp: 3 }), allies: [ally("mira", { hp: 2 })] };
  it("once per long rest: you and the allies within Close clear a Hit Point", () => {
    const plan = ok("healing-field", ctx([], hurt));
    expect(ofKind(plan, "clear")).toEqual([
      { kind: "clear", targetId: "pc", track: "hp", amount: 1 },
      { kind: "clear", targetId: "mira", track: "hp", amount: 1 },
    ]);
    expect(plan.limit).toEqual({ key: "card:healing-field", until: "longRest", consumed: true });
    const again = run(effectOf("healing-field"), ctx([], { ...hurt, actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toMatchObject({ ok: false, reason: "exhausted", detail: "Back after a long rest" });
  });
  it("2 Hope: everyone clears 2 instead", () => {
    const plan = ok("healing-field", ctx([], { ...hurt, optionals: ["two"] }));
    expect(plan.actor.after).toMatchObject({ hope: 0, hp: 1 });
    expect(ofKind(plan, "clear").map((c) => c.amount)).toEqual([2, 2]);
  });
});

describe("Thorn Skin (L5, CB p.338)", () => {
  it("once per rest, a Hope: tokens equal to your Spellcast trait", () => {
    const plan = ok("thorn-skin", ctx([]));
    expect(plan.actor.after).toMatchObject({ hope: 1, cardTokens: 3 });
    expect(ofKind(plan, "effect")[0]).toMatchObject({ label: "Thorn Skin", duration: "rest" });
    expect(plan.limit).toMatchObject({ until: "rest", consumed: true });
  });
  const thorny = { useId: "thorns", actor: actor({ cardTokens: 3, activeCardEffects: ["thorn-skin"] }), trigger: { amount: 12, source: adv("ogre") } };
  it("spend tokens: their d6s reduce the damage; in Melee the attacker takes that much back", () => {
    // 2 tokens: 4 + 5 = 9 off the damage, and 9 back to the ogre: Major.
    const plan = ok("thorn-skin", ctx([4, 5], { ...thorny, choices: { tokens: 2 }, situations: ["You're within Melee range of the attacker"] }));
    expect(folds(plan)).toEqual([{ kind: "reduceDamage", targetIds: ["pc"], amount: 9 }]);
    expect(damageOf(plan)).toEqual([{ id: "ogre", incoming: 9, hpMarked: 2 }]);
    expect(plan.actor.after.cardTokens).toBe(1);
  });
  it("beyond Melee range nothing is dealt back; more tokens than held is refused", () => {
    const plan = ok("thorn-skin", ctx([6], { ...thorny, choices: { tokens: 1 } }));
    expect(folds(plan)).toEqual([{ kind: "reduceDamage", targetIds: ["pc"], amount: 6 }]);
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(run(effectOf("thorn-skin"), ctx([], { ...thorny, choices: { tokens: 4 } }))).toMatchObject({ ok: false, reason: "choice" });
  });
  it("a rest clears the unspent tokens", () => {
    expect(ok("thorn-skin", ctx([], { useId: "rest", actor: actor({ cardTokens: 2 }) })).actor.after.cardTokens).toBe(0);
  });
});

describe("Wild Fortress (L5, CB p.339)", () => {
  it("Spellcast (13); on a success 2 Hope: you and one ally can't be targeted by attacks or attack", () => {
    // 8 + 6 + 3 = 17 succeeds with Hope: 2 + 1 - 2 = 1.
    const plan = ok("wild-fortress", ctx([8, 6], { targets: [ally("mira")] }));
    expect(plan.actor.after.hope).toBe(1);
    const effects = ofKind(plan, "effect");
    expect(effects.map((e) => e.targetId)).toEqual(["pc", "mira"]);
    expect(effects[0]!.mods).toEqual([{ kind: "flag", flag: "cannotBeTargeted" }, { kind: "flag", flag: "cannotAttack" }]);
    expect(plan.exclusive).toBe(true);
  });
  it("a failure costs nothing; two allies are refused", () => {
    const fail = ok("wild-fortress", ctx([2, 5], { targets: [ally("mira")] }));
    expect(fail.actor.after.hope).toBe(2);
    expect(ofKind(fail, "effect")).toEqual([]);
    expect(run(effectOf("wild-fortress"), ctx([], { targets: [ally("mira"), ally("tom")] }))).toMatchObject({ ok: false, reason: "targets" });
  });
  const dome = (damage: number, tokens: number) =>
    ok("wild-fortress", ctx([], { useId: "dome-damage", actor: actor({ cardTokens: tokens, activeCardEffects: ["wild-fortress"] }), choices: { damage } }));
  it("the dome marks HP against 15/30 and falls at 3", () => {
    expect(dome(20, 0).actor.after.cardTokens).toBe(2);
    expect(dome(14, 0).actor.after.cardTokens).toBe(1);
    expect(dome(0, 1).actor.after.cardTokens).toBe(1);
    const falls = dome(32, 1);
    expect(falls.actor.after.cardTokens).toBe(0);
    expect(prompts(falls, "manual")[0]!.text).toMatch(/falls/);
    expect(prompts(dome(15, 0), "manual")).toEqual([]);
  });
});

describe("Conjured Steeds (L6, CB p.339)", () => {
  it("a Hope per steed; riders get -2 to attack rolls and +2 to damage rolls until the next long rest", () => {
    const self = actor();
    const plan = ok("conjured-steeds", ctx([], { targets: [self, ally("mira")], choices: { hope: 2 } }));
    expect(plan.actor.after.hope).toBe(0);
    expect(ofKind(plan, "effect").map((e) => ({ id: e.targetId, mods: e.mods, duration: e.duration }))).toEqual([
      { id: "pc", mods: [{ kind: "stat", stat: "attack", delta: -2 }, { kind: "stat", stat: "damage", delta: 2 }], duration: "longRest" },
      { id: "mira", mods: [{ kind: "stat", stat: "attack", delta: -2 }, { kind: "stat", stat: "damage", delta: 2 }], duration: "longRest" },
    ]);
  });
  it("more riders than steeds is refused", () => {
    expect(run(effectOf("conjured-steeds"), ctx([], { targets: [ally("a"), ally("b")], choices: { hope: 1 } }))).toMatchObject({ ok: false, reason: "targets" });
  });
});

describe("Sage-Touched (L7, CB p.339)", () => {
  const sage4 = actor({ loadoutDomains: ["sage", "sage", "sage", "sage", "arcana"] });
  it("+2 to Spellcast Rolls in a natural environment, with 4 Sage cards", () => {
    const plan = ok("sage-touched", ctx([], { useId: "nature", actor: sage4, situations: ["You're in a natural environment"] }));
    expect(plan.activation).toBe("rider");
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: 2 }]);
    expect(run(effectOf("sage-touched"), ctx([], { useId: "nature", actor: sage4 }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(run(effectOf("sage-touched"), ctx([], { useId: "nature", situations: ["You're in a natural environment"] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("once per rest, double Agility or Instinct, chosen before the roll", () => {
    const plan = ok("sage-touched", ctx([], { useId: "double", actor: sage4, options: { trait: ["instinct"] } }));
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "doubleTrait", trait: "instinct" } });
    expect(plan.limit).toEqual({ key: "card:sage-touched:double", until: "rest", consumed: true });
    expect(prompts(ok("sage-touched", ctx([], { useId: "double", actor: sage4 })), "choose")).toHaveLength(1);
  });
});

describe("Wild Surge (L7, CB p.339)", () => {
  it("once per long rest, a Stress: the Wild Surge Die starts at 1", () => {
    const plan = ok("wild-surge", ctx([]));
    expect(plan.actor.after).toMatchObject({ stress: 2, cardTokens: 1 });
    expect(plan.limit).toEqual({ key: "card:wild-surge", until: "longRest", consumed: true });
  });
  const surging = (value: number) => ({ useId: "surge", actor: actor({ cardTokens: value, activeCardEffects: ["wild-surge"] }) });
  it("adds the die to the action roll, then the die goes up by one", () => {
    const plan = ok("wild-surge", ctx([], surging(3)));
    expect(plan.activation).toBe("auto");
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: 3 }]);
    expect(plan.actor.after).toMatchObject({ cardTokens: 4, stress: 1 });
  });
  it("past 6 the form drops and you mark an additional Stress", () => {
    const plan = ok("wild-surge", ctx([], surging(6)));
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: 6 }]);
    expect(plan.actor.after).toMatchObject({ cardTokens: 0, stress: 2 });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/form drops/);
  });
  it("a rest drops the form with a Stress", () => {
    const plan = ok("wild-surge", ctx([], { useId: "rest", actor: actor({ cardTokens: 4, activeCardEffects: ["wild-surge"] }) }));
    expect(plan.actor.after).toMatchObject({ cardTokens: 0, stress: 2 });
  });
});

describe("Forest Sprites (L8, CB p.339)", () => {
  it("Spellcast (13); on a success one sprite per Hope spent", () => {
    // 7 + 4 + 3 = 14 succeeds with Hope: 2 + 1 - 2 = 1.
    const plan = ok("forest-sprites", ctx([7, 4], { choices: { hope: 2 } }));
    expect(plan.actor.after).toMatchObject({ hope: 1, cardTokens: 2 });
    expect(ofKind(plan, "effect")[0]).toMatchObject({ label: "Forest Sprites" });
  });
  const sprites = { actor: actor({ cardTokens: 2, activeCardEffects: ["forest-sprites"] }), trigger: { subject: ally("mira") } };
  it("an ally's attack near a sprite gains +3, and the sprite vanishes", () => {
    const plan = ok("forest-sprites", ctx([], { ...sprites, useId: "attack", situations: ["The ally's attack roll is against an adversary within Melee range of a sprite"] }));
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["mira"], amount: 3 }]);
    expect(plan.actor.after.cardTokens).toBe(1);
  });
  it("an ally near a sprite marks an additional Armor Slot, and the sprite vanishes", () => {
    const plan = ok("forest-sprites", ctx([], { ...sprites, useId: "armor", situations: ["The ally is within Melee range of a sprite"] }));
    expect(folds(plan)).toEqual([{ kind: "extraArmorSlots", targetIds: ["mira"], amount: 1 }]);
    expect(plan.actor.after.cardTokens).toBe(1);
  });
  it("a damaged sprite vanishes", () => {
    expect(ok("forest-sprites", ctx([], { ...sprites, useId: "sprite-damaged" })).actor.after.cardTokens).toBe(1);
  });
});

describe("Rejuvenation Barrier (L8, CB p.339)", () => {
  it("Spellcast (15), once per rest on a success: 1d4 HP cleared (rolled once) and physical resistance", () => {
    // 10 + 5 + 3 = 18 succeeds; 1d4 = 3: you clear 3 of 4, Mira 2 of 2.
    const plan = ok("rejuvenation-barrier", ctx([10, 5, 3], { actor: actor({ hp: 4 }), allies: [ally("mira", { hp: 2 })] }));
    expect(ofKind(plan, "clear")).toEqual([
      { kind: "clear", targetId: "pc", track: "hp", amount: 3 },
      { kind: "clear", targetId: "mira", track: "hp", amount: 2 },
    ]);
    expect(ofKind(plan, "effect").map((e) => ({ id: e.targetId, mods: e.mods }))).toEqual([
      { id: "pc", mods: [{ kind: "resistance", type: "physical", level: "resistant" }] },
      { id: "mira", mods: [{ kind: "resistance", type: "physical", level: "resistant" }] },
    ]);
    expect(plan.limit).toEqual({ key: "card:rejuvenation-barrier", until: "rest", consumed: true });
  });
  it("a failure clears nothing and does not use the card up (Q4)", () => {
    const plan = ok("rejuvenation-barrier", ctx([3, 4], { allies: [ally("mira", { hp: 2 })] }));
    expect(ofKind(plan, "clear")).toEqual([]);
    expect(plan.limit?.consumed).toBe(false);
  });
});

describe("Fane of the Wilds (L9, CB p.339)", () => {
  it("after a Spellcast Roll, spend tokens for +1 each", () => {
    const plan = ok("fane-of-the-wilds", ctx([], { actor: actor({ cardTokens: 3 }), choices: { tokens: 2 } }));
    expect(plan.activation).toBe("rider");
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: 2 }]);
    expect(plan.actor.after.cardTokens).toBe(1);
  });
  it("after a long rest, tokens = Sage cards in loadout and vault (unspent ones are gone)", () => {
    const plan = ok("fane-of-the-wilds", ctx([], { useId: "long-rest", actor: actor({ cardTokens: 2, loadoutDomains: ["sage", "sage", "sage", "codex"], vaultDomains: ["sage", "bone"] }) }));
    expect(plan.actor.after.cardTokens).toBe(4);
  });
  it("a critical on a Sage domain spell gains a token", () => {
    const plan = ok("fane-of-the-wilds", ctx([], { useId: "critical", actor: actor({ cardTokens: 1 }), situations: ["The Spellcast Roll was for a Sage domain spell"] }));
    expect(plan.actor.after.cardTokens).toBe(2);
    expect(run(effectOf("fane-of-the-wilds"), ctx([], { useId: "critical" }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Plant Dominion (L9, CB p.339)", () => {
  it("Spellcast (18), once per long rest on a success", () => {
    const plan = ok("plant-dominion", ctx([12, 7]));
    expect(plan.success).toBe(true);
    expect(prompts(plan, "manual")).toHaveLength(1);
    expect(plan.limit).toEqual({ key: "card:plant-dominion", until: "longRest", consumed: true });
    const fail = ok("plant-dominion", ctx([5, 7]));
    expect(fail.limit?.consumed).toBe(false);
    expect(prompts(fail, "manual")).toEqual([]);
  });
});

describe("Force of Nature (L10, CB p.339)", () => {
  it("a Stress to transform: you can't be Restrained", () => {
    const plan = ok("force-of-nature", ctx([], { actor: actor({ conditions: ["restrained"] }) }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ label: "Force of Nature", mods: [{ kind: "flag", flag: "cannotBeRestrained" }] });
    expect(ofKind(plan, "clearCondition")).toEqual([{ kind: "clearCondition", targetId: "pc", condition: { kind: "standard", condition: "restrained" } }]);
  });
  const spirit = actor({ armor: 2, activeCardEffects: ["force-of-nature"] });
  it("+10 to the damage roll of a successful attack or Spellcast Roll", () => {
    const plan = ok("force-of-nature", ctx([], { useId: "damage", actor: spirit, targets: [adv("a")] }));
    expect(plan.activation).toBe("auto");
    expect(folds(plan)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: 10 }]);
  });
  it("defeating a creature within Close range clears an Armor Slot", () => {
    const plan = ok("force-of-nature", ctx([], { useId: "absorb", actor: spirit }));
    expect(plan.actor.after.armor).toBe(1);
  });
  it("a Hope before each action roll; with none you revert", () => {
    const paid = ok("force-of-nature", ctx([], { useId: "upkeep", actor: spirit }));
    expect(paid.actor.after.hope).toBe(1);
    expect(prompts(paid, "manual")).toEqual([]);
    const broke = ok("force-of-nature", ctx([], { useId: "upkeep", actor: actor({ hope: 0, activeCardEffects: ["force-of-nature"] }) }));
    expect(ofKind(broke, "pay")[0]).toMatchObject({ paid: false });
    expect(prompts(broke, "manual")[0]!.text).toMatch(/revert to your normal form/);
  });
});

describe("Tempest (L10, CB p.339)", () => {
  const two = [adv("a"), adv("b", { difficulty: 16 })];
  it("Blizzard: 2d20+8 magic to every target hit, temporarily Vulnerable", () => {
    // 11 + 3 + 3 = 17 hits a (12) and b (16); 2d20+8 = 10 + 5 + 8 = 23: Severe.
    const plan = ok("tempest", ctx([11, 3, 10, 5], { targets: two, options: { tempest: ["blizzard"] } }));
    expect(damageOf(plan)).toEqual([
      { id: "a", incoming: 23, hpMarked: 3 },
      { id: "b", incoming: 23, hpMarked: 3 },
    ]);
    expect(ofKind(plan, "condition").map((c) => [c.targetId, c.condition, c.duration])).toEqual([
      ["a", { kind: "standard", condition: "vulnerable" }, "temporary"],
      ["b", { kind: "standard", condition: "vulnerable" }, "temporary"],
    ]);
  });
  it("Hurricane: 3d10+10 magic and the wind direction (manual)", () => {
    // 9 + 2 + 3 = 14 hits a only; 3d10+10 = 4 + 5 + 6 + 10 = 25.
    const plan = ok("tempest", ctx([9, 2, 4, 5, 6], { targets: two, options: { tempest: ["hurricane"] } }));
    expect(damageOf(plan)).toEqual([{ id: "a", incoming: 25, hpMarked: 3 }]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Hurricane" }, duration: "manual" });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/direction the wind/);
  });
  it("Sandstorm: 5d6+9 magic and the beyond-Melee disadvantage (manual)", () => {
    // 1 + 2 + 3 + 4 + 5 + 9 = 24.
    const plan = ok("tempest", ctx([9, 2, 1, 2, 3, 4, 5], { targets: [adv("a")], options: { tempest: ["sandstorm"] } }));
    expect(damageOf(plan)).toEqual([{ id: "a", incoming: 24, hpMarked: 3 }]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ condition: { kind: "tag", tag: "Sandstorm" } });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/beyond Melee range/);
  });
  it("asks for the tempest when none was picked", () => {
    expect(prompts(ok("tempest", ctx([9, 2], { targets: [adv("a")] })), "choose")).toHaveLength(1);
  });
});
