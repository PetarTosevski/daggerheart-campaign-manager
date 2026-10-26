import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { SPLENDOR_EFFECTS } from "@/lib/srd/card-effects/splendor";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-splendor: every Splendor card's effect entry, run through the CA1 runner with fixed
// dice. Expected values come from the card text (CB p.340-341) by hand. RNG order: Hope die, Fear die, then damage dice,
// d20s and checks in the order the steps need them. The default actor has Spellcast 3, Proficiency 2, 2 Hope and 1 of 6
// Stress marked; the default adversary has Difficulty 12 and thresholds 8/14.

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
  traits: { agility: 0, strength: 1, finesse: 1, instinct: 2, presence: 1, knowledge: 0 },
  spellcast: 3,
  proficiency: 2,
  level: 8,
  tier: 4,
  loadoutDomains: ["splendor", "valor"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 phy", trait: "strength", damageType: "physical", range: "melee" } },
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
  hp: 3,
  hpMax: 6,
  stress: 3,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

const effectOf = (cardId: string): CardEffect => {
  const found = SPLENDOR_EFFECTS.find((e) => e.cardId === cardId);
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
const clears = (plan: RunPlan) => ofKind(plan, "clear").map(({ targetId, track, amount }) => ({ targetId, track, amount }));

describe("the Splendor table", () => {
  const usable = Object.entries(CARD_CLASSIFICATION.splendor)
    .filter(([, c]) => c.usage !== "outOfCombat")
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per combat or passive Splendor card (U3)", () => {
    const ids = SPLENDOR_EFFECTS.map((e) => e.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(usable);
    expect(usable).toHaveLength(20);
  });

  it("covers the Splendor cards of DOMAIN_CARDS except the out-of-combat Divination", () => {
    const splendor = DOMAIN_CARDS.filter((c) => c.domain === "splendor").map((c) => c.id).sort();
    expect(splendor.filter((id) => id !== "divination")).toEqual(usable);
    expect(CARD_CLASSIFICATION.splendor.divination!.usage).toBe("outOfCombat");
  });

  it("every use runs through run() without throwing", () => {
    const rich = actor({
      hope: 6,
      stress: 6,
      cardTokens: 3,
      loadoutDomains: ["splendor", "splendor", "splendor", "splendor"],
      activeCardEffects: ["smite", "overwhelming-aura"],
    });
    const situations = SPLENDOR_EFFECTS.flatMap((e) => e.uses.flatMap((u) => (u.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : []))));
    for (const effect of SPLENDOR_EFFECTS) {
      const useIds = new Set(effect.uses.map((u) => u.id));
      expect(useIds.size).toBe(effect.uses.length);
      for (const use of effect.uses) {
        const result = run(effect, {
          actor: use.id === "main" && effect.cardId !== "voice-of-reason" ? { ...rich, stress: 0 } : rich,
          gmFear: 3,
          useId: use.id,
          targets: [adv("a")],
          picked: [adv("a")],
          trigger: { amount: 10, source: adv("src"), subject: ally("mira", { tags: ["Life Ward", "Shield Aura"] }) },
          choices: { tokens: 1, hope: 1, stress: 1 },
          situations: [...situations, "The attack succeeded with Hope"],
          rng: () => 4,
        });
        expect(result, `${effect.cardId}/${use.id}`).toMatchObject({ ok: true });
      }
    }
  });
});

describe("Bolt Beacon (L1, CB p.340): Spellcast vs Far, a Hope on success, d8+2 magic using Proficiency, Vulnerable", () => {
  it("on a hit spends a Hope (the roll's own Hope pays), deals 2d8+2 magic and makes the target temporarily Vulnerable", () => {
    // 9 + 4 + Spellcast 3 = 16 beats 12, with Hope: 2 + 1 - 1 = 2 Hope. 2d8+2 = 5 + 6 + 2 = 13: Major (8/14), 2 HP.
    const plan = ok("bolt-beacon", ctx([9, 4, 5, 6], { targets: [adv("a")] }));
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "afterRoll", costs: [{ resource: "hope", amount: 1 }], paid: true }]);
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 13 } });
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 13, severity: "major", hpMarked: 2 });
    expect(ofKind(plan, "condition")).toEqual([
      { kind: "condition", targetId: "a", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" },
    ]);
    expect(plan.actor.after.hope).toBe(2);
  });
  it("a miss spends nothing and deals nothing", () => {
    const plan = ok("bolt-beacon", ctx([2, 3], { targets: [adv("a")] }));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "pay")).toEqual([]);
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(plan.actor.after.hope).toBe(2);
  });
  it("with no Hope to spend after a hit with Fear, the bolt is not sent", () => {
    const plan = ok("bolt-beacon", ctx([4, 9], { actor: actor({ hope: 0 }), targets: [adv("a")] }));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ paid: false });
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(ofKind(plan, "condition")).toEqual([]);
  });
});

describe("Mending Touch (L1, CB p.340): a few minutes, 2 Hope, clear a HP or a Stress", () => {
  it("needs the few minutes confirmed", () => {
    expect(run(effectOf("mending-touch"), ctx([], { targets: [ally("mira")] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("2 Hope: clears a Hit Point or a Stress, as picked", () => {
    const situations = ["You can take a few minutes to focus on the target"];
    const hp = ok("mending-touch", ctx([], { targets: [ally("mira")], situations, options: { heal: ["hp"] } }));
    expect(hp.actor.after.hope).toBe(0);
    expect(clears(hp)).toEqual([{ targetId: "mira", track: "hp", amount: 1 }]);
    const stress = ok("mending-touch", ctx([], { targets: [ally("mira")], situations, options: { heal: ["stress"] } }));
    expect(clears(stress)).toEqual([{ targetId: "mira", track: "stress", amount: 1 }]);
    expect(prompts(ok("mending-touch", ctx([], { targets: [ally("mira")], situations })), "choose")).toHaveLength(1);
  });
  it("once per long rest, learning something new: 2 Hit Points or 2 Stress instead", () => {
    const situations = [
      "You can take a few minutes to focus on the target",
      "You spend the healing time learning something new about them or revealing something about yourself",
    ];
    const plan = ok("mending-touch", ctx([], { useId: "bond", targets: [ally("mira")], situations, options: { heal: ["stress"] } }));
    expect(clears(plan)).toEqual([{ targetId: "mira", track: "stress", amount: 2 }]);
    expect(plan.limit).toEqual({ key: "card:mending-touch:bond", until: "longRest", consumed: true });
    const again = run(effectOf("mending-touch"), ctx([], { useId: "bond", actor: actor({ featureUses: plan.actor.featureUses }), targets: [ally("mira")], situations }));
    expect(again).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Reassurance (L1, CB p.340): once per rest, an ally rerolls their dice", () => {
  it("folds a reroll of all dice into the ally's roll and uses the once-per-rest limit", () => {
    const plan = ok("reassurance", ctx([], { trigger: { subject: ally("mira") } }));
    expect(plan.activation).toBe("reaction");
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["mira"], amount: undefined }]);
    expect(plan.limit).toEqual({ key: "card:reassurance", until: "rest", consumed: true });
    expect(run(effectOf("reassurance"), ctx([], { actor: actor({ featureUses: plan.actor.featureUses }), trigger: { subject: ally("mira") } }))).toMatchObject({
      ok: false,
      reason: "exhausted",
    });
  });
});

describe("Final Words (L2, CB p.340): Spellcast (13), the corpse answers", () => {
  it("success with Hope: up to three questions; with Fear: one; failure: dust", () => {
    expect(prompts(ok("final-words", ctx([9, 4])), "manual").map((p) => p.text)).toEqual([expect.stringMatching(/up to three questions/)]);
    expect(prompts(ok("final-words", ctx([4, 9])), "manual").map((p) => p.text)).toEqual([expect.stringMatching(/answers one question/)]);
    expect(prompts(ok("final-words", ctx([2, 3])), "manual").map((p) => p.text)).toEqual(["The body turns to dust."]);
  });
  it("a critical counts as a success with Hope (CB p.90)", () => {
    expect(prompts(ok("final-words", ctx([5, 5])), "manual")[0]!.text).toMatch(/three questions/);
  });
});

describe("Healing Hands (L2, CB p.340): Spellcast (13), a Stress, once per target per long rest", () => {
  it("success: mark a Stress to clear 2 Hit Points or 2 Stress on the target", () => {
    // 8 + 3 + 3 = 14 >= 13.
    const plan = ok("healing-hands", ctx([8, 3], { targets: [ally("mira")], options: { heal: ["hp"] } }));
    expect(plan.success).toBe(true);
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "afterRoll", costs: [{ resource: "stress", amount: 1 }], paid: true }]);
    expect(clears(plan)).toEqual([{ targetId: "mira", track: "hp", amount: 2 }]);
    expect(plan.actor.after.stress).toBe(2);
    expect(plan.limit).toEqual({ key: "card:healing-hands:mira", until: "longRest", consumed: true });
  });
  it("failure: mark a Stress to clear one Hit Point or one Stress", () => {
    // 2 + 3 + 3 = 8 < 13.
    const plan = ok("healing-hands", ctx([2, 3], { targets: [ally("mira")], options: { "heal-failure": ["stress"] } }));
    expect(plan.success).toBe(false);
    expect(clears(plan)).toEqual([{ targetId: "mira", track: "stress", amount: 1 }]);
    expect(plan.actor.after.stress).toBe(2);
  });
  it("the same target can't be healed again before a long rest; another target can", () => {
    const first = ok("healing-hands", ctx([8, 3], { targets: [ally("mira")], options: { heal: ["hp"] } }));
    const used = actor({ featureUses: first.actor.featureUses });
    expect(run(effectOf("healing-hands"), ctx([8, 3], { actor: used, targets: [ally("mira")] }))).toMatchObject({ ok: false, reason: "exhausted" });
    expect(run(effectOf("healing-hands"), ctx([8, 3], { actor: used, targets: [ally("kai")] }))).toMatchObject({ ok: true });
  });
});

describe("Second Wind (L3, CB p.340): once per rest on a successful attack", () => {
  it("clears 3 Stress or a Hit Point on you", () => {
    const plan = ok("second-wind", ctx([], { actor: actor({ stress: 4 }), options: { self: ["stress"] } }));
    expect(plan.activation).toBe("rider");
    expect(clears(plan)).toEqual([{ targetId: "pc", track: "stress", amount: 3 }]);
    expect(plan.limit).toEqual({ key: "card:second-wind", until: "rest", consumed: true });
  });
  it("on a success with Hope also clears 3 Stress or a Hit Point on an ally within Close range", () => {
    const plan = ok("second-wind", ctx([], { actor: actor({ hp: 2 }), picked: [ally("mira")], situations: ["The attack succeeded with Hope"], options: { self: ["hp"], ally: ["stress"] } }));
    expect(clears(plan)).toEqual([
      { targetId: "pc", track: "hp", amount: 1 },
      { targetId: "mira", track: "stress", amount: 3 },
    ]);
  });
  it("without Hope on the attack the ally gets nothing", () => {
    const plan = ok("second-wind", ctx([], { actor: actor({ hp: 2 }), picked: [ally("mira")], options: { self: ["hp"], ally: ["stress"] } }));
    expect(clears(plan)).toEqual([{ targetId: "pc", track: "hp", amount: 1 }]);
  });
});

describe("Voice of Reason (L3, CB p.340): passive", () => {
  it("+1 Proficiency only while every Stress slot is marked", () => {
    expect(run(effectOf("voice-of-reason"), ctx([], { actor: actor({ stress: 6 }) }))).toMatchObject({ ok: true });
    expect(run(effectOf("voice-of-reason"), ctx([]))).toMatchObject({ ok: false, reason: "requirement", detail: "stressFull" });
    expect(effectOf("voice-of-reason").uses[0]!.mods).toEqual([{ kind: "stat", stat: "proficiency", delta: { kind: "fixed", value: 1 } }]);
  });
  it("advantage on de-escalating or leading, confirmed by the player", () => {
    const use = effectOf("voice-of-reason").uses.find((u) => u.id === "authority")!;
    expect(use.activation.kind).toBe("passive");
    expect(use.mods).toEqual([{ kind: "advantage", on: "action" }]);
  });
});

describe("Life Ward (L4, CB p.340): 3 Hope, an ally clears a Hit Point instead of a death move", () => {
  it("3 Hope: the ally in Close range carries the sigil until your long rest; one at a time", () => {
    const plan = ok("life-ward", ctx([], { actor: actor({ hope: 3 }), targets: [ally("mira")] }));
    expect(plan.actor.after.hope).toBe(0);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "mira", condition: { kind: "tag", tag: "Life Ward" }, duration: "longRest" });
    expect(plan.exclusive).toBe(true);
    expect(run(effectOf("life-ward"), ctx([], { targets: [ally("mira")] }))).toMatchObject({ ok: false, reason: "cost" });
  });
  it("the warded ally's death move is negated, they clear a Hit Point and the sigil ends", () => {
    const warded = ally("mira", { hp: 6, tags: ["Life Ward"] });
    const plan = ok("life-ward", ctx([], { useId: "save", trigger: { subject: warded } }));
    expect(plan.activation).toBe("auto");
    expect(folds(plan)).toEqual([{ kind: "negate", targetIds: ["mira"], amount: undefined }]);
    expect(clears(plan)).toEqual([{ targetId: "mira", track: "hp", amount: 1 }]);
    expect(ofKind(plan, "clearCondition")).toEqual([{ kind: "clearCondition", targetId: "mira", condition: { kind: "tag", tag: "Life Ward" } }]);
  });
  it("an ally without the sigil is not saved", () => {
    const plan = ok("life-ward", ctx([], { useId: "save", trigger: { subject: ally("kai", { hp: 6 }) } }));
    expect(plan.steps).toEqual([]);
  });
});

describe("Shape Material (L5, CB p.340)", () => {
  it("a Hope; the shaping is a manual step", () => {
    const plan = ok("shape-material", ctx([]));
    expect(plan.actor.after.hope).toBe(1);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/no larger than you/);
  });
});

describe("Smite (L5, CB p.340): once per rest, 3 Hope; the next weapon hit doubles and deals magic damage", () => {
  it("charge: 3 Hope, a self effect until the next successful weapon attack; once per rest", () => {
    expect(run(effectOf("smite"), ctx([]))).toMatchObject({ ok: false, reason: "cost", detail: "hope" });
    const plan = ok("smite", ctx([], { actor: actor({ hope: 3 }) }));
    expect(plan.actor.after.hope).toBe(0);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", duration: "manual", endsWhen: "You next successfully attack with a weapon." });
    expect(plan.limit).toEqual({ key: "card:smite", until: "rest", consumed: true });
  });
  it("strike: a rider while charged that doubles the damage roll and makes it magic", () => {
    const plan = ok("smite", ctx([], { useId: "strike", actor: actor({ activeCardEffects: ["smite"] }), targets: [adv("a")] }));
    expect(plan.activation).toBe("rider");
    expect(folds(plan)).toEqual([
      { kind: "modifyDamage", targetIds: ["a"], amount: undefined },
      { kind: "modifyDamage", targetIds: ["a"], amount: undefined },
    ]);
    expect(ofKind(plan, "fold").map((f) => (f.step.kind === "modifyDamage" ? f.step.change : null))).toEqual([
      { kind: "multiply", factor: 2 },
      { kind: "type", type: "magic" },
    ]);
    expect(run(effectOf("smite"), ctx([], { useId: "strike", targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Restoration (L6, CB p.340): tokens = Spellcast after a long rest", () => {
  it("spend tokens: 2 Hit Points or 2 Stress for each token, picked per token", () => {
    const plan = ok("restoration", ctx([], { actor: actor({ cardTokens: 3 }), targets: [ally("mira")], choices: { tokens: 2 }, options: { heal: ["hp", "stress"] } }));
    expect(clears(plan)).toEqual([
      { targetId: "mira", track: "hp", amount: 2 },
      { targetId: "mira", track: "stress", amount: 2 },
    ]);
    expect(plan.actor.after.cardTokens).toBe(1);
  });
  it("can't spend more tokens than the card holds", () => {
    expect(run(effectOf("restoration"), ctx([], { actor: actor({ cardTokens: 1 }), targets: [ally("mira")], choices: { tokens: 2 } }))).toMatchObject({ ok: false, reason: "choice" });
  });
  it("a token clears Vulnerable, or heals an ailment as a manual step", () => {
    const vuln = ok("restoration", ctx([], { useId: "cure", actor: actor({ cardTokens: 1 }), targets: [ally("mira", { conditions: ["vulnerable"] })], options: { cure: ["vulnerable"] } }));
    expect(ofKind(vuln, "clearCondition")).toEqual([{ kind: "clearCondition", targetId: "mira", condition: { kind: "standard", condition: "vulnerable" } }]);
    expect(vuln.actor.after.cardTokens).toBe(0);
    const ailment = ok("restoration", ctx([], { useId: "cure", actor: actor({ cardTokens: 1 }), targets: [ally("mira")], options: { cure: ["ailment"] } }));
    expect(prompts(ailment, "manual")[0]!.text).toMatch(/additional tokens/);
  });
  it("after a long rest the card holds tokens equal to your Spellcast trait (unspent ones cleared)", () => {
    expect(ok("restoration", ctx([], { useId: "long-rest", actor: actor({ cardTokens: 1 }) })).actor.after.cardTokens).toBe(3);
  });
});

describe("Zone of Protection (L6, CB p.340): Spellcast (16), once per long rest on a success", () => {
  it("success: the die is placed at 1 and the allies in the zone get the effect; the limit is used", () => {
    // 9 + 5 + 3 = 17 >= 16.
    const plan = ok("zone-of-protection", ctx([9, 5], { targets: [ally("mira"), ally("kai")] }));
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "set", before: 0, after: 1, die: 6 }]);
    expect(ofKind(plan, "effect").map((e) => e.targetId)).toEqual(["mira", "kai"]);
    expect(plan.limit).toEqual({ key: "card:zone-of-protection", until: "longRest", consumed: true });
  });
  it("a failure doesn't use the limit (Q4)", () => {
    const plan = ok("zone-of-protection", ctx([2, 3], { targets: [ally("mira")] }));
    expect(ofKind(plan, "tokens")).toEqual([]);
    expect(plan.limit).toMatchObject({ consumed: false });
  });
  it("an ally in the zone reduces damage by the die's value, then the die goes up by one", () => {
    const plan = ok("zone-of-protection", ctx([], { useId: "reduce", actor: actor({ cardTokens: 3 }), situations: ["The creature taking damage is inside your zone of protection"], trigger: { amount: 10, subject: ally("mira") } }));
    expect(folds(plan)).toEqual([{ kind: "reduceDamage", targetIds: ["mira"], amount: 3 }]);
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "add", before: 3, after: 4, die: 6 }]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/exceed 6/);
  });
});

describe("Healing Strike (L7, CB p.340): when you deal damage, 2 Hope clears an ally's Hit Point", () => {
  it("2 Hope: an ally within Close range clears a Hit Point", () => {
    const plan = ok("healing-strike", ctx([], { picked: [ally("mira")] }));
    expect(plan.activation).toBe("reaction");
    expect(plan.actor.after.hope).toBe(0);
    expect(clears(plan)).toEqual([{ targetId: "mira", track: "hp", amount: 1 }]);
  });
});

describe("Splendor-Touched (L7, CB p.340): 4 Splendor cards", () => {
  const four = actor({ loadoutDomains: ["splendor", "splendor", "splendor", "splendor"] });
  it("+3 Severe threshold (passive) only with 4 Splendor cards", () => {
    expect(effectOf("splendor-touched").uses[0]!.mods).toEqual([{ kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 3 } }]);
    expect(run(effectOf("splendor-touched"), ctx([], { actor: four }))).toMatchObject({ ok: true });
    expect(run(effectOf("splendor-touched"), ctx([]))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("once per long rest: mark Stress or spend Hope instead of the Hit Points", () => {
    const plan = ok("splendor-touched", ctx([], { useId: "convert", actor: four, trigger: { amount: 12 }, options: { into: ["hope"] } }));
    expect(ofKind(plan, "fold").map((f) => f.step)).toEqual([{ kind: "convertMarks", to: "self", from: "hp", into: "hope" }]);
    expect(plan.limit).toEqual({ key: "card:splendor-touched:convert", until: "longRest", consumed: true });
  });
});

describe("Shield Aura (L8, CB p.341): a Stress; an Armor Slot reduces one more threshold", () => {
  it("a Stress: the target in Very Close range carries the aura; one creature at a time", () => {
    const plan = ok("shield-aura", ctx([], { targets: [ally("mira")] }));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "mira", condition: { kind: "tag", tag: "Shield Aura" }, duration: "manual" });
    expect(plan.exclusive).toBe(true);
  });
  it("when the bearer marks an Armor Slot the severity drops one more threshold", () => {
    const plan = ok("shield-aura", ctx([], { useId: "aura-ally", trigger: { subject: ally("mira", { tags: ["Shield Aura"] }) } }));
    expect(folds(plan)).toEqual([{ kind: "reduceSeverity", targetIds: ["mira"], amount: 1 }]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/no Hit Points/);
    expect(ok("shield-aura", ctx([], { useId: "aura-ally", trigger: { subject: ally("kai") } })).steps).toEqual([]);
  });
  it("on yourself, behind a confirmation", () => {
    expect(run(effectOf("shield-aura"), ctx([], { useId: "aura-self" }))).toMatchObject({ ok: false, reason: "requirement" });
    const plan = ok("shield-aura", ctx([], { useId: "aura-self", situations: ["You hold your own Shield Aura"] }));
    expect(folds(plan)).toEqual([{ kind: "reduceSeverity", targetIds: ["pc"], amount: 1 }]);
  });
});

describe("Stunning Sunlight (L8, CB p.341): Hope picks who saves (14)", () => {
  it("spends the Hope; the picked targets save: success 3d20+3, failure 4d20+5 and Stunned", () => {
    // 9 + 4 + 3 = 16 hits all three (12), with Hope: 2 + 1 - 2 = 1 Hope.
    // a saves 15 >= 14: 3d20+3 = 10 + 10 + 10 + 3 = 33. b saves 5: 4d20+5 = 1 + 2 + 3 + 4 + 5 = 15. Both Severe (14).
    const plan = ok("stunning-sunlight", ctx([9, 4, 15, 10, 10, 10, 5, 1, 2, 3, 4], { targets: [adv("a"), adv("b"), adv("c")], picked: [adv("a"), adv("b")], choices: { hope: 2 } }));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "afterRoll", costs: [{ resource: "hope", amount: 2 }], paid: true });
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "save").map(({ targetId, difficulty, success }) => ({ targetId, difficulty, success }))).toEqual([
      { targetId: "a", difficulty: 14, success: true },
      { targetId: "b", difficulty: 14, success: false },
    ]);
    expect(ofKind(plan, "damage").map((d) => [d.result.after.id, d.result.incoming, d.result.severity])).toEqual([
      ["a", 33, "severe"],
      ["b", 15, "severe"],
    ]);
    expect(ofKind(plan, "condition")).toEqual([{ kind: "condition", targetId: "b", condition: { kind: "tag", tag: "Stunned" }, duration: "temporary" }]);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "b", mods: [{ kind: "flag", flag: "cannotReact" }, { kind: "flag", flag: "cannotAct" }] });
  });
  it("a miss spends no Hope and nobody saves", () => {
    const plan = ok("stunning-sunlight", ctx([2, 3], { targets: [adv("a")], picked: [adv("a")], choices: { hope: 1 } }));
    expect(ofKind(plan, "pay")).toEqual([]);
    expect(ofKind(plan, "save")).toEqual([]);
  });
});

describe("Overwhelming Aura (L9, CB p.341): Spellcast (15), 2 Hope", () => {
  it("success: Presence becomes your Spellcast trait until your next long rest", () => {
    // 9 + 4 + 3 = 16 >= 15, with Hope: 2 + 1 - 2 = 1.
    const plan = ok("overwhelming-aura", ctx([9, 4]));
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", mods: [{ kind: "set", stat: "presence", to: 3 }], duration: "longRest" });
  });
  it("while active, an adversary that targets you marks a Stress", () => {
    const plan = ok("overwhelming-aura", ctx([], { useId: "attacked", actor: actor({ activeCardEffects: ["overwhelming-aura"] }), trigger: { source: adv("ogre") } }));
    expect(ofKind(plan, "mark")).toEqual([{ kind: "mark", targetId: "ogre", track: "stress", amount: 1, hpMarked: 0, overflow: false }]);
    expect(run(effectOf("overwhelming-aura"), ctx([], { useId: "attacked", trigger: { source: adv("ogre") } }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Salvation Beam (L9, CB p.341): Spellcast (16), Stress as Hit Points divided along a line of allies", () => {
  it("success: marks the Stress and clears that many Hit Points, divided as the player wishes", () => {
    const plan = ok("salvation-beam", ctx([9, 5], { targets: [ally("mira"), ally("kai")], choices: { stress: 3 }, splits: { mira: 2, kai: 1 } }));
    expect(plan.actor.after.stress).toBe(4);
    expect(clears(plan)).toEqual([
      { targetId: "mira", track: "hp", amount: 2 },
      { targetId: "kai", track: "hp", amount: 1 },
    ]);
  });
  it("without a split the dialog asks how to divide", () => {
    const plan = ok("salvation-beam", ctx([9, 5], { targets: [ally("mira"), ally("kai")], choices: { stress: 2 } }));
    expect(prompts(plan, "split")[0]).toMatchObject({ amount: 2, targetIds: ["mira", "kai"] });
  });
  it("a failure marks no Stress", () => {
    const plan = ok("salvation-beam", ctx([2, 3], { targets: [ally("mira")], choices: { stress: 2 } }));
    expect(plan.actor.after.stress).toBe(1);
    expect(clears(plan)).toEqual([]);
  });
});

describe("Invigoration (L10, CB p.341): Hope as d6s, a 6 refreshes the feature", () => {
  it("any 6 makes the feature usable again", () => {
    const plan = ok("invigoration", ctx([3, 6], { choices: { hope: 2 }, trigger: { subject: ally("mira") } }));
    expect(plan.actor.after.hope).toBe(0);
    expect(ofKind(plan, "check")[0]).toMatchObject({ dice: [3, 6], passed: true });
    expect(folds(plan)).toEqual([{ kind: "refreshFeature", targetIds: ["mira"], amount: undefined }]);
  });
  it("no 6: nothing comes back, the Hope is still spent", () => {
    const plan = ok("invigoration", ctx([2, 5], { choices: { hope: 2 }, trigger: { subject: ally("mira") } }));
    expect(folds(plan)).toEqual([]);
    expect(plan.actor.after.hope).toBe(0);
  });
});

describe("Resurrection (L10, CB p.341): Spellcast (20)", () => {
  it("success: the restoration is a manual step; a d6 of 5 or lower vaults the card permanently", () => {
    // 12 + 9 + 3 = 24 >= 20.
    const plan = ok("resurrection", ctx([12, 9, 5]));
    expect(prompts(plan, "manual")[0]!.text).toMatch(/full strength/);
    expect(ofKind(plan, "toVault")).toEqual([{ kind: "toVault", permanent: true }]);
    expect(ofKind(ok("resurrection", ctx([12, 9, 6])), "toVault")).toEqual([]);
  });
  it("failure: no casting for a week (manual)", () => {
    const plan = ok("resurrection", ctx([2, 3]));
    expect(prompts(plan, "manual").map((p) => p.text)).toEqual(["You can't cast Resurrection again for a week."]);
  });
});
