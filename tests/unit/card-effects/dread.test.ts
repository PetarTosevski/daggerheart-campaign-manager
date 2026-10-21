import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { DREAD_EFFECTS } from "@/lib/srd/card-effects/dread";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-dread: every Dread card's effect entry, run through the CA1 runner with fixed dice.
// Expected values come from the card text (HF p.180-181) by hand. RNG order: Hope die, Fear die, then damage dice, d20s
// and checks in the order the steps need them. The default actor has Spellcast 3, Proficiency 2, 2 Hope, 1 of 6 Stress
// marked and four Dread cards in the loadout; the default adversary has Difficulty 12, thresholds 8/14 and 3 Stress slots.

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
  traits: { agility: 1, strength: 0, finesse: 1, instinct: 2, presence: 3, knowledge: 0 },
  spellcast: 3,
  proficiency: 2,
  level: 10,
  tier: 4,
  loadoutDomains: ["dread", "dread", "dread", "dread", "blade"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 mag", trait: "presence", damageType: "magic", range: "far" } },
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
  const found = DREAD_EFFECTS.find((e) => e.cardId === cardId);
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
const after = (plan: RunPlan, id: string) => plan.creatures.find((c) => c.id === id)?.after;

describe("the Dread table", () => {
  const usable = Object.entries(CARD_CLASSIFICATION.dread)
    .filter(([, c]) => c.usage !== "outOfCombat")
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per combat or passive Dread card (U3)", () => {
    const ids = DREAD_EFFECTS.map((e) => e.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(usable);
    expect(usable).toHaveLength(21);
  });

  it("covers the Dread cards of DOMAIN_CARDS", () => {
    const dread = DOMAIN_CARDS.filter((c) => c.domain === "dread").map((c) => c.id).sort();
    expect(dread).toEqual(usable);
  });

  it("every use runs through run() without throwing", () => {
    const rich = actor({
      hope: 6,
      stress: 0,
      armor: 1,
      cardTokens: 3,
      activeCardEffects: ["umbral-veil", "avatar-of-terror"],
    });
    for (const effect of DREAD_EFFECTS) {
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
          trigger: { amount: 10, source: adv("src"), subject: adv("subj") },
          choices: { tokens: 1, hope: 1, hp: 1, stress: 1 },
          optionals: ["flee", "wall"],
          situations: ["You succeeded with Fear on this roll", "The target is within Very Close range"],
          rng: () => 4,
        });
        expect(result, `${effect.cardId}/${use.id}`).toMatchObject({ ok: true });
      }
    }
  });
});

describe("Blighting Strike (L1, HF p.180): d6+1 with Hope, d10+1 with Fear, half damage next hit", () => {
  it("with Hope: d6+1 magic using Proficiency and the target is Blighted", () => {
    // 9 + 4 + 3 = 16 beats 12; 2d6+1 = 3 + 5 + 1 = 9: Major (8/14), 2 HP.
    const plan = ok("blighting-strike", ctx([9, 4, 3, 5], { targets: [adv("a")] }));
    expect(ofKind(plan, "damageRoll")).toHaveLength(1);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 9, severity: "major", hpMarked: 2 });
    expect(ofKind(plan, "effect")).toEqual([
      { kind: "effect", targetId: "a", label: "Blighted: next successful attack deals half damage", mods: [{ kind: "flag", flag: "halfDamage" }], duration: "hit" },
    ]);
    expect(plan.actor.after.hope).toBe(3);
    expect(ofKind(plan, "pay")).toEqual([]);
  });
  it("with Fear: d10+1 magic using Proficiency; the GM gains a Fear", () => {
    // 4 + 9 + 3 = 16; 2d10+1 = 6 + 7 + 1 = 14: Severe, 3 HP.
    const plan = ok("blighting-strike", ctx([4, 9, 6, 7], { targets: [adv("a")] }));
    expect(ofKind(plan, "damageRoll")[0]!.record.dice.every((d) => d.sides === 10)).toBe(true);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 14, severity: "severe", hpMarked: 3 });
    expect(plan.gmFearDelta).toBe(1);
  });
  it("a critical counts as Hope: d6 dice, starting from their maximum", () => {
    // 5 + 5 is critical; 12 + 1 + 2 + 1 = 16.
    const plan = ok("blighting-strike", ctx([5, 5, 1, 2], { targets: [adv("a")] }));
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 16, severity: "severe" });
    expect(plan.actor.after).toMatchObject({ hope: 3, stress: 0 });
  });
  it("on a failure you spend a Hope or mark a Stress (your pick)", () => {
    // 2 + 3 + 3 = 8 misses.
    const hope = ok("blighting-strike", ctx([2, 3], { targets: [adv("a")] }));
    expect(hope.success).toBe(false);
    expect(ofKind(hope, "damage")).toEqual([]);
    expect(ofKind(hope, "effect")).toEqual([]);
    expect(hope.actor.after).toMatchObject({ hope: 1, stress: 1 });
    const stress = ok("blighting-strike", ctx([2, 3], { targets: [adv("a")], eitherCosts: [1] }));
    expect(stress.actor.after).toMatchObject({ hope: 2, stress: 2 });
  });
});

describe("Umbral Veil (L1, HF p.180): tokens = GM Fear, −1 per token to an attack roll against you", () => {
  it("once per rest, a Stress: tokens equal to the GM's Fear until the end of the scene", () => {
    const plan = ok("umbral-veil", ctx([], { gmFear: 3 }));
    expect(plan.actor.after).toMatchObject({ stress: 2, cardTokens: 3 });
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", duration: "scene" });
    expect(plan.limit).toEqual({ key: "card:umbral-veil", until: "rest", consumed: true });
    const again = run(effectOf("umbral-veil"), ctx([], { actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toMatchObject({ ok: false, reason: "exhausted" });
  });
  it("after an attack roll against you, spend tokens: a −1 penalty per token on the attacker's roll", () => {
    const plan = ok(
      "umbral-veil",
      ctx([], { useId: "spend", actor: actor({ cardTokens: 3, activeCardEffects: ["umbral-veil"] }), choices: { tokens: 2 }, trigger: { source: adv("ogre") } }),
    );
    expect(plan.activation).toBe("reaction");
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["ogre"], amount: -2 }]);
    expect(plan.actor.after.cardTokens).toBe(1);
  });
  it("needs the veil up and enough tokens; the scene's end clears them", () => {
    expect(run(effectOf("umbral-veil"), ctx([], { useId: "spend", actor: actor({ cardTokens: 3 }) }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(
      run(effectOf("umbral-veil"), ctx([], { useId: "spend", actor: actor({ cardTokens: 1, activeCardEffects: ["umbral-veil"] }), choices: { tokens: 2 } })),
    ).toMatchObject({ ok: false, reason: "choice" });
    expect(ok("umbral-veil", ctx([], { useId: "scene-end", actor: actor({ cardTokens: 2 }) })).actor.after.cardTokens).toBe(0);
  });
});

describe("Voice of Dread (L1, HF p.180)", () => {
  it("on a success the target marks a Stress and is temporarily Restrained", () => {
    const plan = ok("voice-of-dread", ctx([9, 4], { targets: [adv("a")] }));
    expect(ofKind(plan, "mark")).toEqual([{ kind: "mark", targetId: "a", track: "stress", amount: 1, hpMarked: 0, overflow: false }]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "standard", condition: "restrained" }, duration: "temporary" });
    expect(after(plan, "a")).toMatchObject({ stress: 1, conditions: ["restrained"] });
  });
  it("needs sight but no range; a miss does nothing", () => {
    const use = effectOf("voice-of-dread").uses[0]!;
    expect(use.targets).toMatchObject({ range: "unlimited", sight: true });
    const plan = ok("voice-of-dread", ctx([2, 3], { targets: [adv("a")] }));
    expect(ofKind(plan, "mark")).toEqual([]);
    expect(ofKind(plan, "condition")).toEqual([]);
  });
});

describe("Hideous Retribution (L2, HF p.180): a Spellcast reaction roll against the attacker, d6 magic back", () => {
  it("on a success, mark a Stress to deal d6 magic using Proficiency to the attacker", () => {
    // Reaction roll 9 + 4 + 3 = 16 beats the ogre's 12; 2d6 = 3 + 4 = 7: Minor, 1 HP.
    const plan = ok("hideous-retribution", ctx([9, 4, 3, 4], { trigger: { amount: 6, source: adv("ogre"), subject: ally("mira") } }));
    expect(plan.roll?.record.kind).toBe("reaction");
    expect(plan.actor.after).toMatchObject({ stress: 2, hope: 2 });
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ targetId: "ogre", incoming: 7, severity: "minor", hpMarked: 1 });
    expect(plan.gmFearDelta).toBe(0);
  });
  it("a failure costs nothing and deals nothing; no free Stress slot stops the damage", () => {
    const fail = ok("hideous-retribution", ctx([2, 3], { trigger: { source: adv("ogre"), subject: ally("mira") } }));
    expect(fail.actor.after).toEqual(fail.actor.before);
    expect(ofKind(fail, "damage")).toEqual([]);
    const full = ok("hideous-retribution", ctx([9, 4], { actor: actor({ stress: 6 }), trigger: { source: adv("ogre"), subject: ally("mira") } }));
    expect(ofKind(full, "pay")[0]).toMatchObject({ paid: false });
    expect(ofKind(full, "damage")).toEqual([]);
  });
});

describe("Siphon Essence (L2, HF p.180): once per long rest on a success, d12+4 using Proficiency", () => {
  it("with Hope: d12+4 x Proficiency; the heal is a manual step; the limit is used", () => {
    // 2d12+4 = 5 + 6 + 4 = 15: Severe, 3 HP.
    const plan = ok("siphon-essence", ctx([9, 4, 5, 6], { targets: [adv("a")] }));
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 15, severity: "severe", hpMarked: 3 });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/clear a number of Hit Points equal/);
    expect(plan.limit).toEqual({ key: "card:siphon-essence", until: "longRest", consumed: true });
  });
  it("with Fear: +1 Proficiency for this attack (3d12+4)", () => {
    // 1 + 2 + 3 + 4 = 10: Major, 2 HP.
    const plan = ok("siphon-essence", ctx([4, 9, 1, 2, 3], { targets: [adv("a")] }));
    expect(ofKind(plan, "damageRoll")[0]!.record.dice.filter((d) => d.role === "damage")).toHaveLength(3);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 10, severity: "major", hpMarked: 2 });
  });
  it("a failure keeps the card ready (Q4) and asks for no heal", () => {
    const plan = ok("siphon-essence", ctx([2, 3], { targets: [adv("a")] }));
    expect(plan.limit?.consumed).toBe(false);
    expect(prompts(plan, "manual")).toEqual([]);
    const used = actor({ featureUses: [{ key: "card:siphon-essence", until: "longRest" }] });
    expect(run(effectOf("siphon-essence"), ctx([], { actor: used, targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Shared Trauma (L3, HF p.180): once per rest, HP marked on one willing creature cleared on another", () => {
  it("the picked creature marks the chosen HP, the target clears as many", () => {
    const plan = ok("shared-trauma", ctx([], { picked: [ally("bran")], targets: [ally("mira", { hp: 4 })], choices: { hp: 2 } }));
    expect(ofKind(plan, "mark")).toEqual([{ kind: "mark", targetId: "bran", track: "hp", amount: 2, hpMarked: 2, overflow: false }]);
    expect(ofKind(plan, "clear")).toEqual([{ kind: "clear", targetId: "mira", track: "hp", amount: 2 }]);
    expect(after(plan, "mira")?.hp).toBe(2);
    expect(plan.limit).toEqual({ key: "card:shared-trauma", until: "rest", consumed: true });
  });
  it("you can be the one who marks", () => {
    const plan = ok("shared-trauma", ctx([], { picked: [actor()], targets: [ally("mira", { hp: 3 })], choices: { hp: 1 } }));
    expect(plan.actor.after.hp).toBe(1);
    expect(after(plan, "mira")?.hp).toBe(2);
  });
});

describe("Terrify (L3, HF p.180): 1d4 Stress, flee, Vulnerable with Fear", () => {
  it("with Hope: 1d4 Stress and an optional flee prompt; no Vulnerable", () => {
    const plan = ok("terrify", ctx([9, 4, 3], { targets: [adv("a")], optionals: ["flee"] }));
    expect(ofKind(plan, "mark")[0]).toMatchObject({ targetId: "a", track: "stress", amount: 3 });
    expect(prompts(plan, "move")).toEqual([expect.objectContaining({ targetIds: ["a"], text: "The target flees one range away from you." })]);
    expect(ofKind(plan, "condition")).toEqual([]);
  });
  it("with Fear: also temporarily Vulnerable; no flee unless chosen", () => {
    const plan = ok("terrify", ctx([4, 9, 2], { targets: [adv("a")] }));
    expect(after(plan, "a")).toMatchObject({ stress: 2, conditions: ["vulnerable"] });
    expect(prompts(plan, "move")).toEqual([]);
  });
  it("a miss does nothing, even with flee chosen", () => {
    const plan = ok("terrify", ctx([2, 3], { targets: [adv("a")], optionals: ["flee"] }));
    expect(ofKind(plan, "mark")).toEqual([]);
    expect(prompts(plan, "move")).toEqual([]);
  });
});

describe("Summon Horror (L4, HF p.180): a Stress, d8+1 using Spellcast, Reaction Roll (12) or Stress", () => {
  it("no attack roll: 3d8+1 magic; a failed save marks Stress equal to the HP marked", () => {
    // 4 + 4 + 4 + 1 = 13: Major, 2 HP; the d20 rolls 10 < 12: marks 2 Stress.
    const plan = ok("summon-horror", ctx([4, 4, 4, 10], { targets: [adv("a")] }));
    expect(plan.roll).toBeNull();
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 13, hpMarked: 2 });
    expect(ofKind(plan, "save")[0]).toMatchObject({ targetId: "a", difficulty: 12, success: false });
    expect(after(plan, "a")).toMatchObject({ hp: 2, stress: 2 });
  });
  it("a successful save marks no Stress", () => {
    const plan = ok("summon-horror", ctx([4, 4, 4, 12], { targets: [adv("a")] }));
    expect(after(plan, "a")?.stress).toBe(0);
  });
  it("no save when the target marks no HP (immune)", () => {
    const plan = ok("summon-horror", ctx([4, 4, 4], { targets: [adv("a", { resistance: { physical: "none", magic: "immune" } })] }));
    expect(ofKind(plan, "save")).toEqual([]);
  });
});

describe("Chains of Affliction (L4, HF p.180): 2 Stress, Chained, their hits mark one fewer HP", () => {
  it("marks 2 Stress and Chains the target; one creature at a time", () => {
    const plan = ok("chains-of-affliction", ctx([], { targets: [adv("a")] }));
    expect(plan.actor.after.stress).toBe(3);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Chained" }, duration: "temporary" });
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "a", mods: [{ kind: "stat", stat: "hpMarked", delta: -1 }], duration: "temporary" });
    expect(plan.exclusive).toBe(true);
  });
  it("refused with fewer than 2 free Stress slots", () => {
    expect(run(effectOf("chains-of-affliction"), ctx([], { actor: actor({ stress: 5 }), targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Dire Strike (L5, HF p.180): a Hope when a target marks HP from your attack, the GM loses a Fear", () => {
  it("spends a Hope and takes a Fear from the GM", () => {
    const plan = ok("dire-strike", ctx([], { trigger: { amount: 2, subject: adv("a") } }));
    expect(plan.activation).toBe("reaction");
    expect(plan.actor.after.hope).toBe(1);
    expect(plan.gmFearDelta).toBe(-1);
  });
  it("the GM's Fear doesn't go below 0; refused without a Hope", () => {
    expect(ok("dire-strike", ctx([], { gmFear: 0 })).gmFearDelta).toBe(0);
    expect(run(effectOf("dire-strike"), ctx([], { actor: actor({ hope: 0 }) }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Spectral Mist (L5, HF p.180): 2 Hope, you and chosen allies incorporeal", () => {
  it("you and each chosen ally are immune to physical damage until your next action roll", () => {
    const plan = ok("spectral-mist", ctx([], { allies: [ally("mira")] }));
    expect(plan.actor.after.hope).toBe(0);
    const effects = ofKind(plan, "effect");
    expect(effects.map((e) => e.targetId)).toEqual(["pc", "mira"]);
    expect(effects[0]).toMatchObject({ mods: [{ kind: "resistance", type: "physical", level: "immune" }], duration: "nextRoll" });
  });
});

describe("Darkfire (L6, HF p.180): Hope per target, Reaction Roll (15), d8+6 using Spellcast, half on a success", () => {
  it("one damage roll: failures take it all, successes half (rounded up)", () => {
    // a: d20 10 fails; 3d8+6 = 2 + 3 + 4 + 6 = 15: Severe. b: d20 17 succeeds; 8: Major.
    const plan = ok("darkfire", ctx([10, 2, 3, 4, 17], { actor: actor({ hope: 3 }), choices: { hope: 2 }, targets: [adv("a"), adv("b")] }));
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "save").map((s) => s.success)).toEqual([false, true]);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.hpMarked])).toEqual([
      ["a", 15, 3],
      ["b", 8, 2],
    ]);
  });
  it("no more targets than Hope spent; refused without the Hope", () => {
    expect(run(effectOf("darkfire"), ctx([], { choices: { hope: 1 }, targets: [adv("a"), adv("b")] }))).toMatchObject({ ok: false, reason: "targets" });
    expect(run(effectOf("darkfire"), ctx([], { choices: { hope: 3 }, targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Jump Scare (L6, HF p.181): after magic damage, a Stress to teleport in; Vulnerable until they mark HP", () => {
  it("a teleport prompt and Vulnerable on the damaged target", () => {
    const plan = ok("jump-scare", ctx([], { trigger: { amount: 9, subject: adv("a") } }));
    expect(plan.actor.after.stress).toBe(2);
    expect(prompts(plan, "move")).toEqual([expect.objectContaining({ targetIds: ["pc"] })]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({
      targetId: "a",
      condition: { kind: "standard", condition: "vulnerable" },
      duration: "manual",
      endsWhen: "they mark 1 or more Hit Points",
    });
  });
});

describe("Dread-Touched (L7, HF p.181): needs 4 Dread cards", () => {
  const fear = ["You succeeded with Fear on this roll"];
  it("succeeding with Fear: 2 Stress to stop the GM's Fear", () => {
    const plan = ok("dread-touched", ctx([], { useId: "prevent", situations: fear }));
    expect(plan.actor.after.stress).toBe(3);
    expect(folds(plan)).toEqual([{ kind: "negate", targetIds: ["pc"], amount: undefined }]);
  });
  it("refused with 3 Dread cards or without the confirmed success with Fear", () => {
    const three = actor({ loadoutDomains: ["dread", "dread", "dread", "blade", "blade"] });
    expect(run(effectOf("dread-touched"), ctx([], { useId: "prevent", actor: three, situations: fear }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(run(effectOf("dread-touched"), ctx([], { useId: "prevent" }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(run(effectOf("dread-touched"), ctx([], { useId: "bonus", actor: three }))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("once per rest: a bonus to an action roll equal to the GM's Fear", () => {
    const plan = ok("dread-touched", ctx([], { useId: "bonus", gmFear: 5 }));
    expect(plan.activation).toBe("rider");
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: 5 }]);
    expect(plan.limit).toEqual({ key: "card:dread-touched:bonus", until: "rest", consumed: true });
    const again = run(effectOf("dread-touched"), ctx([], { useId: "bonus", actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Wall of Hunger (L7, HF p.181): Spellcast (10), a Hope for the wall, 2 Stress to those inside", () => {
  it("on a success the Hope raises the wall: those inside mark 2 Stress; crossing is manual", () => {
    // 9 + 4 + 3 = 16 meets 10; the roll's Hope pays (R8): 2 + 1 - 1 = 2.
    const plan = ok("wall-of-hunger", ctx([9, 4], { optionals: ["wall"], picked: [adv("a"), adv("b")] }));
    expect(plan.actor.after.hope).toBe(2);
    expect(ofKind(plan, "mark").map((m) => [m.targetId, m.amount])).toEqual([
      ["a", 2],
      ["b", 2],
    ]);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", duration: "manual", endsWhen: "you mark a Hit Point or cast this spell again" });
    expect(prompts(plan, "manual")).toHaveLength(1);
    expect(plan.exclusive).toBe(true);
  });
  it("no wall without the Hope, or on a failure", () => {
    expect(ofKind(ok("wall-of-hunger", ctx([9, 4], { picked: [adv("a")] })), "mark")).toEqual([]);
    const fail = ok("wall-of-hunger", ctx([2, 3], { optionals: ["wall"], picked: [adv("a")] }));
    expect(fail.success).toBe(false);
    expect(ofKind(fail, "mark")).toEqual([]);
    expect(ofKind(fail, "pay")).toEqual([]);
  });
});

describe("Dark Army (L8, HF p.181): Spellcast (14), once per long rest on a success, 8 tokens", () => {
  it("a success places 8 tokens and uses the limit; a failure keeps it", () => {
    const plan = ok("dark-army", ctx([9, 4]));
    expect(plan.actor.after.cardTokens).toBe(8);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ duration: "rest" });
    expect(plan.limit).toEqual({ key: "card:dark-army", until: "longRest", consumed: true });
    const fail = ok("dark-army", ctx([2, 3]));
    expect(fail.actor.after.cardTokens).toBe(0);
    expect(fail.limit?.consumed).toBe(false);
  });
  it("dealing damage within Very Close: 1d8 per token spent is added to the damage roll", () => {
    const plan = ok("dark-army", ctx([1, 2, 3], { useId: "strike", actor: actor({ cardTokens: 8 }), targets: [adv("a")], choices: { tokens: 3 }, situations: ["The target is within Very Close range"] }));
    expect(plan.activation).toBe("rider");
    expect(folds(plan)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: 6 }]);
    expect(plan.actor.after.cardTokens).toBe(5);
    expect(run(effectOf("dark-army"), ctx([], { useId: "strike", actor: actor({ cardTokens: 8 }), targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("taking damage: 1d8 per token spent reduces it; a rest clears the tokens", () => {
    const plan = ok("dark-army", ctx([4, 5], { useId: "guard", actor: actor({ cardTokens: 2 }), choices: { tokens: 2 }, trigger: { amount: 12, source: adv("ogre") } }));
    expect(folds(plan)).toEqual([{ kind: "reduceDamage", targetIds: ["pc"], amount: 9 }]);
    expect(plan.actor.after.cardTokens).toBe(0);
    expect(ok("dark-army", ctx([], { useId: "rest", actor: actor({ cardTokens: 4 }) })).actor.after.cardTokens).toBe(0);
  });
});

describe("Eldritch Flesh (L8, HF p.181)", () => {
  it("passive: +1 to both thresholds per marked Stress", () => {
    const use = effectOf("eldritch-flesh").uses.find((u) => u.id === "passive")!;
    expect(use.activation.kind).toBe("passive");
    expect(use.mods).toEqual([
      { kind: "stat", stat: "majorThreshold", delta: { kind: "marked", who: "self", track: "stress" } },
      { kind: "stat", stat: "severeThreshold", delta: { kind: "marked", who: "self", track: "stress" } },
    ]);
    expect(ok("eldritch-flesh", ctx([], { useId: "passive" })).steps).toEqual([]);
  });
  it("after a roll with Fear: 2 Hope to clear an Armor Slot", () => {
    const plan = ok("eldritch-flesh", ctx([], { useId: "armor", actor: actor({ armor: 2 }) }));
    expect(effectOf("eldritch-flesh").uses[0]!.activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "action", result: "withFear" } });
    expect(plan.actor.after).toMatchObject({ hope: 0, armor: 1 });
  });
});

describe("Damnation (L9, HF p.181): on a success, Stress as d20s of magic damage", () => {
  it("marks the chosen Stress and rolls that many d20s", () => {
    // 9 + 4 + 3 = 16; 2d20 = 10 + 10 = 20: Severe, 3 HP; the target survives.
    const plan = ok("damnation", ctx([9, 4, 10, 10], { targets: [adv("a")], picked: [adv("b")], choices: { stress: 2 } }));
    expect(plan.actor.after.stress).toBe(3);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 20, hpMarked: 3, defeated: false });
    expect(ofKind(plan, "mark")).toEqual([]);
  });
  it("defeating the target makes every adversary within Far of it mark a Stress", () => {
    const plan = ok("damnation", ctx([9, 4, 10, 10], { targets: [adv("a", { hp: 4 })], picked: [adv("b"), adv("c")], choices: { stress: 2 } }));
    expect(ofKind(plan, "damage")[0]!.result.defeated).toBe(true);
    expect(ofKind(plan, "mark").map((m) => [m.targetId, m.track, m.amount])).toEqual([
      ["b", "stress", 1],
      ["c", "stress", 1],
    ]);
  });
  it("a miss marks no Stress; without the free Stress slots nothing is dealt", () => {
    const miss = ok("damnation", ctx([2, 3], { targets: [adv("a")], choices: { stress: 2 } }));
    expect(miss.actor.after.stress).toBe(1);
    expect(ofKind(miss, "damage")).toEqual([]);
    const short = ok("damnation", ctx([9, 4], { actor: actor({ stress: 5 }), targets: [adv("a")], choices: { stress: 2 } }));
    expect(ofKind(short, "pay")[0]).toMatchObject({ paid: false });
    expect(ofKind(short, "damage")).toEqual([]);
  });
});

describe("Savor the Anguish (L9, HF p.181)", () => {
  it("an adversary within Close takes Severe damage: clear a Stress, no prompt", () => {
    const plan = ok("savor-the-anguish", ctx([], { trigger: { amount: 16, subject: adv("a") } }));
    expect(plan.activation).toBe("auto");
    expect(effectOf("savor-the-anguish").uses[0]!.activation).toEqual({ kind: "auto", trigger: { kind: "whenEnemyTakesDamage", range: "close", severity: "severe" } });
    expect(plan.actor.after.stress).toBe(0);
  });
});

describe("Avatar of Terror (L10, HF p.181)", () => {
  const form = actor({ activeCardEffects: ["avatar-of-terror"] });
  it("a Stress to transform", () => {
    const plan = ok("avatar-of-terror", ctx([]));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", duration: "manual" });
    expect(plan.exclusive).toBe(true);
  });
  it("in form: 1d6 per Fear in the GM's pool added to your damage", () => {
    const plan = ok("avatar-of-terror", ctx([3, 4], { useId: "damage", actor: form, targets: [adv("a")] }));
    expect(folds(plan)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: 7 }]);
    expect(run(effectOf("avatar-of-terror"), ctx([], { useId: "damage", targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("in form: a Hope when the GM spotlights an adversary within Very Close", () => {
    expect(ok("avatar-of-terror", ctx([], { useId: "spotlight", actor: form })).actor.after.hope).toBe(3);
  });
  it("before each action roll a Hope; with none, you revert (manual)", () => {
    const paid = ok("avatar-of-terror", ctx([], { useId: "upkeep", actor: form }));
    expect(paid.actor.after.hope).toBe(1);
    expect(prompts(paid, "manual")).toEqual([]);
    const broke = ok("avatar-of-terror", ctx([], { useId: "upkeep", actor: actor({ hope: 0, activeCardEffects: ["avatar-of-terror"] }) }));
    expect(prompts(broke, "manual")[0]!.text).toMatch(/revert to your normal form/);
    expect(ofKind(broke, "pay")[0]).toMatchObject({ paid: false });
  });
});

describe("Invoke Torment (L10, HF p.181)", () => {
  it("double damage only to targets with all their Stress marked", () => {
    const plan = ok("invoke-torment", ctx([], { useId: "double", targets: [adv("a", { stress: 3 }), adv("b", { stress: 1 })] }));
    expect(folds(plan)).toEqual([{ kind: "modifyDamage", targetIds: ["a"], amount: undefined }]);
    expect(ofKind(ok("invoke-torment", ctx([], { useId: "double", targets: [adv("b", { stress: 2 })] })), "fold")).toEqual([]);
  });
  it("an adversary within Close defeated with full Stress gives you a Hope", () => {
    const plan = ok("invoke-torment", ctx([], { useId: "hope", trigger: { subject: adv("a", { stress: 3, defeated: true }) } }));
    expect(effectOf("invoke-torment").uses[1]!.activation).toEqual({
      kind: "auto",
      trigger: { kind: "whenEnemyDefeated", byYou: false, range: "close", fullStress: true },
    });
    expect(plan.actor.after.hope).toBe(3);
  });
});
