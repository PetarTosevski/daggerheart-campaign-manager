import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, Requirement } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { BONE_EFFECTS } from "@/lib/srd/card-effects/bone";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-bone: every Bone card used in combat runs through the runner (CA1) with fixed dice.
// Expected numbers are worked out by hand from the card text (CB p.331-332). RNG order: Hope die, Fear die, advantage
// die, then damage dice and checks in the order the steps need them.

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
  spellcast: 1,
  proficiency: 2,
  level: 9,
  tier: 4,
  loadoutDomains: ["bone", "blade"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: {
    primary: { damage: "d8+1 phy", trait: "finesse", damageType: "physical", range: "melee" },
    secondary: { damage: "d6 phy", trait: "agility", damageType: "physical", range: "melee" },
  },
  ...over,
});

/** A Bandit-like adversary: Difficulty 12, thresholds 8/14, 5 HP, 3 Stress. */
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

const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 3, rng: queueRng(dice), ...over });

function entry(cardId: string): CardEffect {
  const found = BONE_EFFECTS.find((e) => e.cardId === cardId);
  if (!found) throw new Error(`No entry for ${cardId}`);
  return found;
}

function cardUse(cardId: string, useId = "main"): CardUse {
  const found = entry(cardId).uses.find((u) => u.id === useId);
  if (!found) throw new Error(`No use ${useId} on ${cardId}`);
  return found;
}

/** The situation texts of a use, as the player would confirm them. */
const situations = (cardId: string, useId = "main"): string[] =>
  (cardUse(cardId, useId).requires ?? []).flatMap((r: Requirement) => (r.kind === "situation" ? [r.text] : []));

/** Runs a card's use and checks the dice queue was used up exactly. */
function ok(cardId: string, context: RunContext): RunPlan {
  const result = run(entry(cardId), context);
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  (context.rng as ReturnType<typeof queueRng>).done();
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const folds = (plan: RunPlan) => ofKind(plan, "fold").map((f) => [f.step.kind, f.targetIds, f.amount]);

describe("the Bone table", () => {
  it("has exactly one entry per Bone card classified combat or passive", () => {
    const expected = Object.entries(CARD_CLASSIFICATION.bone)
      .filter(([, c]) => c.usage !== "outOfCombat")
      .map(([id]) => id)
      .sort();
    const ids = BONE_EFFECTS.map((e) => e.cardId);
    expect([...ids].sort()).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
    expect(ids).not.toContain("recovery");
  });

  it("every entry is a real Bone card and its use ids are unique", () => {
    for (const effect of BONE_EFFECTS) {
      expect(DOMAIN_CARDS.find((c) => c.id === effect.cardId)?.domain).toBe("bone");
      const useIds = effect.uses.map((u) => u.id);
      expect(new Set(useIds).size).toBe(useIds.length);
    }
  });
});

describe("Deft Maneuvers (CB p.331)", () => {
  it("once per rest, a Stress: a sprint prompt and +1 to the next attack", () => {
    const plan = ok("deft-maneuvers", ctx([]));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "upfront", costs: [{ resource: "stress", amount: 1 }] });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["pc"], text: "Sprint anywhere within Far range (no Agility Roll)" });
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", mods: [{ kind: "stat", stat: "attack", delta: 1 }], duration: "nextRoll" });
    expect(plan.actor.after.stress).toBe(2);
    expect(plan.limit).toEqual({ key: "card:deft-maneuvers", until: "rest", consumed: true });
    const again = run(entry("deft-maneuvers"), ctx([], { actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toEqual({ ok: false, reason: "exhausted", detail: "Back after a rest" });
  });
});

describe("I See It Coming (CB p.331)", () => {
  it("a Stress for +d4 Evasion against the attack", () => {
    const plan = ok("i-see-it-coming", ctx([3], { trigger: { source: adv("archer") } }));
    expect(cardUse("i-see-it-coming").activation).toEqual({ kind: "reaction", trigger: { kind: "whenAttacked", stage: "targeted", from: "beyondMelee" } });
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["modifyRoll", ["pc"], 3]]);
  });
});

describe("Untouchable (CB p.331)", () => {
  // The passive mods resolved through an effect step, so run() does the arithmetic.
  const resolved = (agility: number) => {
    const probe: CardEffect = {
      cardId: "probe",
      uses: [{ id: "main", name: "probe", activation: { kind: "action" }, steps: [{ kind: "effect", to: "self", label: "probe", mods: cardUse("untouchable").mods!, duration: "permanent" }] }],
    };
    const result = run(probe, ctx([], { actor: actor({ traits: { ...actor().traits, agility } }) }));
    if (!result.ok) throw new Error("refused");
    return ofKind(result.plan, "effect")[0]!.mods;
  };
  it("is passive: half Agility to Evasion, rounded up (CB p.107)", () => {
    expect(cardUse("untouchable").activation).toEqual({ kind: "passive" });
    expect(resolved(4)).toEqual([{ kind: "stat", stat: "evasion", delta: 2 }]);
    expect(resolved(3)).toEqual([{ kind: "stat", stat: "evasion", delta: 2 }]);
    expect(resolved(1)).toEqual([{ kind: "stat", stat: "evasion", delta: 1 }]);
    expect(ok("untouchable", ctx([])).steps).toEqual([]);
  });
});

describe("Ferocity (CB p.331)", () => {
  it("2 Hope: Evasion up by the HP the adversary marked, until the next attack against you", () => {
    const plan = ok("ferocity", ctx([], { trigger: { amount: 2, subject: adv("a") } }));
    expect(plan.actor.after.hope).toBe(0);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", mods: [{ kind: "stat", stat: "evasion", delta: 2 }], duration: "hit" });
  });
  it("needs 2 Hope", () => {
    expect(run(entry("ferocity"), ctx([], { actor: actor({ hope: 1 }), trigger: { amount: 1 } }))).toMatchObject({ ok: false, reason: "cost", detail: "hope" });
  });
});

describe("Strategic Approach (CB p.331)", () => {
  it("after a long rest: tokens = Knowledge (minimum 1), replacing the unspent ones", () => {
    const three = ok("strategic-approach", ctx([], { useId: "tokens", actor: actor({ cardTokens: 1 }) }));
    expect(ofKind(three, "tokens")).toEqual([{ kind: "tokens", op: "set", before: 1, after: 3 }]);
    const low = ok("strategic-approach", ctx([], { useId: "tokens", actor: actor({ cardTokens: 2, traits: { ...actor().traits, knowledge: -1 } }) }));
    expect(low.actor.after.cardTokens).toBe(1);
  });

  const base = (dice: number[], options: string[], over: Partial<RunContext> = {}) =>
    ctx(dice, { actor: actor({ cardTokens: 2 }), targets: [adv("a")], situations: situations("strategic-approach"), options: { approach: options }, ...over });

  it("a token for a d8 on the damage roll", () => {
    const plan = ok("strategic-approach", base([5], ["d8"]));
    expect(plan.actor.after.cardTokens).toBe(1);
    expect(folds(plan)).toEqual([["modifyDamage", ["a"], 5]]);
  });
  it("a token for advantage on the attack", () => {
    expect(folds(ok("strategic-approach", base([], ["advantage"])))).toEqual([["modifyRoll", ["pc"], undefined]]);
  });
  it("a token to clear a Stress on an ally within Melee range of the adversary", () => {
    const plan = ok("strategic-approach", base([], ["stress"], { picked: [ally("mira", { stress: 2 })] }));
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "mira", track: "stress", amount: 1 }]);
  });
  it("asks for the option; refuses without a token or the first approach", () => {
    expect(ofKind(ok("strategic-approach", base([], [])), "prompt")[0]).toMatchObject({ prompt: "choose" });
    expect(run(entry("strategic-approach"), base([], ["d8"], { actor: actor({ cardTokens: 0 }) }))).toMatchObject({ ok: false, reason: "cost", detail: "tokens" });
    expect(run(entry("strategic-approach"), base([], ["d8"], { situations: [] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Brace (CB p.331)", () => {
  it("a Stress to mark one more Armor Slot against this damage", () => {
    const plan = ok("brace", ctx([]));
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["extraArmorSlots", ["pc"], 1]]);
  });
});

describe("Tactician (CB p.331)", () => {
  it("Help an Ally: the ally spends a Hope to add one of your Experiences to their roll", () => {
    const mira = ally("mira");
    const plan = ok("tactician", ctx([], { useId: "help", situations: situations("tactician", "help"), choices: { experience: 2 }, trigger: { subject: mira } }));
    expect(ofKind(plan, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: -1 }]);
    expect(folds(plan)).toEqual([["modifyRoll", ["mira"], 2]]);
    expect(plan.actor.after.hope).toBe(2);
  });
  it("Tag Team Roll: a d20 as your Hope Die", () => {
    const plan = ok("tactician", ctx([], { useId: "tag-team", situations: situations("tactician", "tag-team") }));
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "hopeDie", sides: 20 } });
  });
});

describe("Boost (CB p.331)", () => {
  const boost = (dice: number[], target: Combatant) => ctx(dice, { targets: [target], situations: situations("boost") });
  it("a Stress, an attack with advantage within Far, a d10 more damage, end within Melee", () => {
    // 9 + 2 + advantage d6 4 + Finesse 1 = 16 hits Difficulty 12 with Hope. Damage 2d8+1 = 5 + 3 + 1 = 9, + d10 6 = 15: Severe.
    const plan = ok("boost", boost([9, 2, 4, 5, 3, 6], adv("a")));
    expect(plan.roll?.record.total).toBe(16);
    expect(plan.hits).toEqual([{ id: "a", hit: true }]);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 15, severity: "severe", hpMarked: 3 });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["pc"] });
    expect(plan.actor.after).toMatchObject({ stress: 2, hope: 3 });
  });
  it("a miss deals nothing; you still land within Melee", () => {
    const plan = ok("boost", boost([2, 3, 1], adv("a", { difficulty: 15 })));
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(ofKind(plan, "prompt")).toHaveLength(1);
  });
  it("needs a willing ally to boost off", () => {
    expect(run(entry("boost"), ctx([], { targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Redirect (CB p.331)", () => {
  const target = adv("b");
  it("Proficiency d6s; on a 6, a Stress redirects the attack to an adversary within Very Close range", () => {
    const plan = ok("redirect", ctx([6, 2], { optionals: ["redirect"], picked: [target], trigger: { source: adv("archer") } }));
    expect(ofKind(plan, "check")[0]).toEqual({ kind: "check", total: 8, dice: [6, 2], passed: true });
    expect(plan.actor.after.stress).toBe(2);
    expect(folds(plan)).toEqual([["redirectDamage", ["b"], undefined]]);
  });
  it("no 6: nothing happens and no Stress is marked", () => {
    const plan = ok("redirect", ctx([5, 2], { optionals: ["redirect"], picked: [target] }));
    expect(folds(plan)).toEqual([]);
    expect(plan.actor.after.stress).toBe(1);
  });
  it("a 6 but the player declines", () => {
    const plan = ok("redirect", ctx([6, 6], { picked: [target] }));
    expect(folds(plan)).toEqual([]);
    expect(plan.actor.after.stress).toBe(1);
  });
});

describe("Know Thy Enemy (CB p.331)", () => {
  it("on a success: a Hope (from the same roll) for information, a Stress to remove a GM Fear", () => {
    // Instinct 0: 10 + 3 = 13 beats Difficulty 12 with Hope (+1 Hope), then spends it.
    const plan = ok("know-thy-enemy", ctx([10, 3], { targets: [adv("a")], optionals: ["fear"] }));
    expect(plan.success).toBe(true);
    expect(plan.actor.after).toMatchObject({ hope: 2, stress: 2 });
    expect(plan.gmFearDelta).toBe(-1);
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", targetIds: ["a"] });
  });
  it("on a failure: no information, no Fear removed", () => {
    const plan = ok("know-thy-enemy", ctx([2, 5], { targets: [adv("a")], optionals: ["fear"] }));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "prompt")).toEqual([]);
    expect(plan.gmFearDelta).toBe(1);
    expect(plan.actor.after.stress).toBe(1);
  });
});

describe("Signature Move (CB p.331)", () => {
  it("once per rest, a d20 as your Hope Die", () => {
    const plan = ok("signature-move", ctx([], { situations: situations("signature-move") }));
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "hopeDie", sides: 20 } });
    expect(plan.limit).toEqual({ key: "card:signature-move", until: "rest", consumed: true });
    const again = run(entry("signature-move"), ctx([], { situations: situations("signature-move"), actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toMatchObject({ ok: false, reason: "exhausted" });
  });
  it("on a success of that roll, clear a Stress", () => {
    expect(cardUse("signature-move", "clear").activation).toEqual({ kind: "rider", trigger: { kind: "afterYouRoll", roll: "action", result: "success" } });
    const plan = ok("signature-move", ctx([], { useId: "clear", situations: situations("signature-move", "clear") }));
    expect(plan.actor.after.stress).toBe(0);
  });
});

describe("Rapid Riposte (CB p.331)", () => {
  it("a Stress: your weapon damage to the attacker", () => {
    // 2d8+1 = 4 + 6 + 1 = 11: Major against 8/14.
    const plan = ok("rapid-riposte", ctx([4, 6], { trigger: { source: adv("brute") } }));
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ targetId: "brute", incoming: 11, severity: "major", hpMarked: 2 });
    expect(plan.actor.after.stress).toBe(2);
  });
  it("with the secondary weapon", () => {
    const plan = ok("rapid-riposte", ctx([4, 6], { trigger: { source: adv("brute") }, roll: { weapon: "secondary" } }));
    expect(ofKind(plan, "damage")[0]!.result.incoming).toBe(10);
  });
});

describe("Bone-Touched (CB p.331)", () => {
  const boneHeavy = (over: Partial<ActorState> = {}) => actor({ loadoutDomains: ["bone", "bone", "bone", "bone", "blade"], hope: 3, ...over });
  it("4+ Bone cards, once per rest, 3 Hope: an attack that succeeded against you fails", () => {
    const plan = ok("bone-touched", ctx([], { actor: boneHeavy(), trigger: { source: adv("brute") } }));
    expect(plan.actor.after.hope).toBe(0);
    expect(folds(plan)).toEqual([["modifyRoll", ["brute"], undefined]]);
    expect(plan.limit).toEqual({ key: "card:bone-touched", until: "rest", consumed: true });
  });
  it("needs 4 Bone cards; +1 Agility is passive", () => {
    expect(run(entry("bone-touched"), ctx([], { trigger: { source: adv("brute") } }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(cardUse("bone-touched", "agility")).toMatchObject({ activation: { kind: "passive" }, mods: [{ kind: "trait", trait: "agility", delta: { kind: "fixed", value: 1 } }] });
    expect(ok("bone-touched", ctx([], { useId: "agility", actor: boneHeavy() })).steps).toEqual([]);
    expect(run(entry("bone-touched"), ctx([], { useId: "agility" }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Cruel Precision (CB p.331)", () => {
  it("a successful weapon attack adds the better of Finesse and Agility", () => {
    expect(folds(ok("cruel-precision", ctx([], { targets: [adv("a")] })))).toEqual([["modifyDamage", ["a"], 2]]);
    const finesse = actor({ traits: { ...actor().traits, finesse: 3 } });
    expect(folds(ok("cruel-precision", ctx([], { actor: finesse, targets: [adv("a")] })))).toEqual([["modifyDamage", ["a"], 3]]);
  });
});

describe("Breaking Blow (CB p.331)", () => {
  it("a Stress marks the target; the next successful attack against it deals an extra 2d12", () => {
    const plan = ok("breaking-blow", ctx([], { targets: [adv("a")] }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Breaking Blow" }, duration: "hit" });
    expect(plan.creatures[0]!.after.tags).toEqual(["Breaking Blow"]);
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", targetIds: ["a"] });
  });
  it("your next successful attack adds 2d12 and clears the mark", () => {
    const plan = ok("breaking-blow", ctx([7, 9], { useId: "extra", targets: [adv("a", { tags: ["Breaking Blow"] })] }));
    expect(folds(plan)).toEqual([["modifyDamage", ["a"], 16]]);
    expect(plan.creatures[0]!.after.tags).toEqual([]);
  });
  it("an unmarked target gets nothing", () => {
    const plan = ok("breaking-blow", ctx([], { useId: "extra", targets: [adv("a")] }));
    expect(plan.steps).toEqual([]);
  });
});

describe("Wrangle (CB p.331)", () => {
  it("an Agility Roll against all within Close; a Hope moves those hit and willing allies", () => {
    // Agility 2: 8 + 3 + 2 = 13 hits Difficulty 12, misses 16; with Hope.
    const plan = ok("wrangle", ctx([8, 3], { targets: [adv("a"), adv("b", { difficulty: 16 })], allies: [ally("mira")] }));
    expect(plan.hits).toEqual([
      { id: "a", hit: true },
      { id: "b", hit: false },
    ]);
    expect(ofKind(plan, "pay")[0]).toMatchObject({ costs: [{ resource: "hope", amount: 1 }], paid: true });
    expect(ofKind(plan, "prompt").map((p) => [p.prompt, p.targetIds])).toEqual([
      ["move", ["a"]],
      ["move", ["mira"]],
    ]);
    expect(plan.actor.after.hope).toBe(2);
  });
  it("misses everyone: nothing moves, nothing is paid", () => {
    const plan = ok("wrangle", ctx([2, 3], { targets: [adv("a", { difficulty: 16 })], allies: [ally("mira")] }));
    expect(ofKind(plan, "pay")).toEqual([]);
    expect(ofKind(plan, "prompt")).toEqual([]);
  });
});

describe("On the Brink (CB p.331)", () => {
  it("with 2 or fewer HP unmarked: no Minor damage", () => {
    expect(cardUse("on-the-brink").mods).toEqual([{ kind: "flag", flag: "noMinorDamage" }]);
    expect(ok("on-the-brink", ctx([], { actor: actor({ hp: 4 }) })).steps).toEqual([]);
    expect(run(entry("on-the-brink"), ctx([], { actor: actor({ hp: 3 }) }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Splintering Strike (CB p.332)", () => {
  const targets = [adv("a"), adv("b")];
  it("a Hope, one attack at all in weapon range; the damage split as the player wishes plus an extra die each", () => {
    // 9 + 2 + 1 = 12 hits both. 2d8+1 = 5 + 4 + 1 = 10, split 6 / 4; extra d8s 3 and 2: 9 and 6.
    const plan = ok("splintering-strike", ctx([9, 2, 5, 4, 3, 2], { targets, splits: { a: 6, b: 4 } }));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "upfront", costs: [{ resource: "hope", amount: 1 }] });
    expect(ofKind(plan, "damageRoll")[0]!.record.total).toBe(10);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.hpMarked])).toEqual([
      ["a", 9, 2],
      ["b", 6, 1],
    ]);
    expect(plan.limit).toEqual({ key: "card:splintering-strike", until: "longRest", consumed: true });
    expect(run(entry("splintering-strike"), ctx([], { targets, actor: actor({ featureUses: plan.actor.featureUses }) }))).toEqual({
      ok: false,
      reason: "exhausted",
      detail: "Back after a long rest",
    });
  });
  it("asks how to split before dealing anything", () => {
    const plan = ok("splintering-strike", ctx([9, 2, 5, 4], { targets }));
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "split", amount: 10, targetIds: ["a", "b"] });
    expect(ofKind(plan, "damage")).toEqual([]);
  });
  it("a miss on every target keeps the once-per-long-rest (Q4)", () => {
    const plan = ok("splintering-strike", ctx([2, 3], { targets: [adv("a", { difficulty: 18 })] }));
    expect(plan.limit).toMatchObject({ consumed: false });
    expect(plan.actor.featureUses).toEqual([]);
  });
});

describe("Deathrun (CB p.332)", () => {
  it("3 Hope, a run within Far, +1 Proficiency, one die fewer for each later target", () => {
    // 3d8+1 = 2 + 5 + 7 + 1 = 15; then without the 2: 13; then without the 5: 8; the fourth gets nothing.
    const plan = ok("deathrun", ctx([9, 2, 2, 5, 7], { actor: actor({ hope: 3 }), targets: [adv("a"), adv("b"), adv("c"), adv("d")] }));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ costs: [{ resource: "hope", amount: 3 }] });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "move", targetIds: ["pc"] });
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming])).toEqual([
      ["a", 15],
      ["b", 13],
      ["c", 8],
    ]);
    expect(plan.actor.after.hope).toBe(1);
  });
  it("needs 3 Hope", () => {
    expect(run(entry("deathrun"), ctx([], { targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "cost", detail: "hope" });
  });
});

describe("Swift Step (CB p.332)", () => {
  it("an attack against you fails: clear a Stress", () => {
    const plan = ok("swift-step", ctx([]));
    expect(plan.actor.after).toMatchObject({ stress: 0, hope: 2 });
  });
  it("with no Stress to clear, gain a Hope", () => {
    const plan = ok("swift-step", ctx([], { actor: actor({ stress: 0 }) }));
    expect(plan.actor.after).toMatchObject({ stress: 0, hope: 3 });
  });
});
