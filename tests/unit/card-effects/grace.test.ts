import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { GRACE_EFFECTS } from "@/lib/srd/card-effects/grace";
import { CARD_EFFECTS } from "@/lib/srd/card-effects";

// Plan combat-actions, tracer CE-grace: every Grace card usable in combat runs through the runner with fixed dice.
// Expected values come from the card texts (CB p.334-335) by hand. RNG order (TASK-CA-CA1): Hope die, Fear die, then
// damage dice, d20s and number dice in the order the steps need them. Spellcast 3, Presence 2, Proficiency 2 below.

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
  traits: { agility: 1, strength: 0, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
  spellcast: 3,
  proficiency: 2,
  level: 5,
  tier: 3,
  loadoutDomains: ["grace", "grace", "grace", "codex", "codex"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 phy", trait: "finesse", damageType: "physical", range: "melee" } },
  ...over,
});

/** Difficulty 12, thresholds 8/14, 5 HP, 3 Stress (CB p.193). */
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
  hp: 2,
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
  const effect = GRACE_EFFECTS.find((e) => e.cardId === cardId);
  if (!effect) throw new Error(`no entry for ${cardId}`);
  return effect;
};

const ctx = (dice: number[], over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 2, rng: queueRng(dice), ...over });

function ok(result: ReturnType<typeof run>): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}

const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const after = (plan: RunPlan, id: string) => plan.creatures.find((c) => c.id === id)?.after;
const manualTexts = (plan: RunPlan) => ofKind(plan, "prompt").filter((p) => p.prompt === "manual").map((p) => p.text);

describe("Grace table coverage", () => {
  it("has exactly one entry per Grace card classified combat or passive, and none for out-of-combat cards", () => {
    const expected = Object.entries(CARD_CLASSIFICATION.grace)
      .filter(([, c]) => c.usage !== "outOfCombat")
      .map(([id]) => id)
      .sort();
    const ids = GRACE_EFFECTS.map((e) => e.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(expected);
    expect(ids).toHaveLength(16);
  });

  it("is merged into the registry", () => {
    for (const e of GRACE_EFFECTS) expect(CARD_EFFECTS.get(e.cardId)).toBe(e);
  });

  it("every use has a unique id within its card", () => {
    for (const e of GRACE_EFFECTS) {
      const ids = e.uses.map((u) => u.id);
      expect(new Set(ids).size, e.cardId).toBe(ids.length);
    }
  });
});

describe("Enrapture (CB p.334)", () => {
  const enrapture = effectOf("enrapture");

  it("a hit makes the target temporarily Enraptured; without the add-on nothing else happens", () => {
    // 8 + 4 + Spellcast 3 = 15 vs Difficulty 12.
    const plan = ok(run(enrapture, ctx([8, 4], { targets: [adv("a")] })));
    expect(plan.hits).toEqual([{ id: "a", hit: true }]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "Enraptured" }, duration: "temporary" });
    expect(after(plan, "a")).toMatchObject({ tags: ["Enraptured"], stress: 0 });
    expect(plan.actor.after.stress).toBe(1);
    expect(plan.limit).toBeNull();
  });

  it("once per rest on a success: mark a Stress, the Enraptured target marks one too", () => {
    const plan = ok(run(enrapture, ctx([8, 4], { targets: [adv("a")], optionals: ["stress"] })));
    expect(ofKind(plan, "pay")).toEqual([{ kind: "pay", phase: "optional", costs: [{ resource: "stress", amount: 1 }], paid: true }]);
    expect(after(plan, "a")).toMatchObject({ stress: 1 });
    expect(plan.actor.after.stress).toBe(2);
    expect(plan.actor.featureUses).toEqual([{ key: "card:enrapture:main:stress", until: "rest" }]);
  });

  it("the add-on is not offered again before a rest, and a miss neither enraptures nor uses it", () => {
    const used = actor({ featureUses: [{ key: "card:enrapture:main:stress", until: "rest" }] });
    const again = ok(run(enrapture, ctx([8, 4], { actor: used, targets: [adv("a")], optionals: ["stress"] })));
    expect(ofKind(again, "pay")).toEqual([]);
    expect(after(again, "a")).toMatchObject({ stress: 0, tags: ["Enraptured"] });
    // 2 + 5 + 3 = 10 < 12: a miss with Fear.
    const miss = ok(run(enrapture, ctx([2, 5], { targets: [adv("a")], optionals: ["stress"] })));
    expect(miss.success).toBe(false);
    expect(ofKind(miss, "condition")).toEqual([]);
    expect(miss.actor.featureUses).toEqual([]);
    expect(miss.gmFearDelta).toBe(1);
  });
});

describe("Inspirational Words (CB p.334)", () => {
  const words = effectOf("inspirational-words");

  it("after a long rest the card holds Presence tokens (unspent ones replaced)", () => {
    const plan = ok(run(words, ctx([], { useId: "tokens", actor: actor({ cardTokens: 1 }) })));
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "set", before: 1, after: 2 }]);
    expect(plan.activation).toBe("auto");
  });

  it("spends a token to give an ally one benefit: clear a Stress, clear a Hit Point or gain a Hope", () => {
    const base = { actor: actor({ cardTokens: 2 }), targets: [ally("mira")] };
    const stress = ok(run(words, ctx([], { ...base, options: { benefit: ["stress"] } })));
    expect(stress.actor.after.cardTokens).toBe(1);
    expect(after(stress, "mira")).toMatchObject({ stress: 2, hp: 2 });
    const hp = ok(run(words, ctx([], { ...base, options: { benefit: ["hp"] } })));
    expect(after(hp, "mira")).toMatchObject({ stress: 3, hp: 1 });
    const hope = ok(run(words, ctx([], { ...base, options: { benefit: ["hope"] } })));
    expect(ofKind(hope, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: 1 }]);
  });

  it("asks for the benefit when none is picked, and refuses without a token", () => {
    const plan = ok(run(words, ctx([], { actor: actor({ cardTokens: 1 }), targets: [ally("mira")] })));
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "choose" });
    expect(run(words, ctx([], { targets: [ally("mira")] }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Tell No Lies (CB p.334)", () => {
  const tell = effectOf("tell-no-lies");

  it("a hit puts the truth spell on the target until they leave Close range or refuse", () => {
    const plan = ok(run(tell, ctx([9, 3], { targets: [adv("a")] })));
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", duration: "manual", endsWhen: "they leave Close range, or refuse to answer a question" });
  });

  it("a refusal makes the target mark a Stress and ends the effect", () => {
    const spelled = adv("a", { tags: ["Can't lie (Tell No Lies)"] });
    const plan = ok(run(tell, ctx([], { useId: "refuses", targets: [spelled] })));
    expect(after(plan, "a")).toMatchObject({ stress: 1, tags: [] });
    // Without the spell on them, a refusal costs nothing.
    const free = ok(run(tell, ctx([], { useId: "refuses", targets: [adv("b")] })));
    expect(ofKind(free, "mark")).toEqual([]);
  });
});

describe("Troublemaker (CB p.334)", () => {
  const trouble = effectOf("troublemaker");

  it("a Presence Roll; on a success, Proficiency d4s and the target marks the highest as Stress", () => {
    // 6 + 5 + Presence 2 = 13 vs 12; d4s 1 and 3: marks 3 Stress.
    const plan = ok(run(trouble, ctx([6, 5, 1, 3], { targets: [adv("a")] })));
    expect(plan.roll?.record.total).toBe(13);
    expect(ofKind(plan, "mark")[0]).toMatchObject({ targetId: "a", track: "stress", amount: 3, overflow: false });
    expect(after(plan, "a")).toMatchObject({ stress: 3 });
    expect(plan.limit).toEqual({ key: "card:troublemaker", until: "rest", consumed: true });
  });

  it("Stress past a full track marks a Hit Point (CB p.92); a failure leaves the card ready (Q4)", () => {
    const plan = ok(run(trouble, ctx([6, 5, 4, 4], { targets: [adv("a", { stress: 2 })] })));
    expect(ofKind(plan, "mark")[0]).toMatchObject({ amount: 4, overflow: true, hpMarked: 1 });
    const miss = ok(run(trouble, ctx([2, 3], { targets: [adv("a")] })));
    expect(miss.limit).toMatchObject({ consumed: false });
    expect(ofKind(miss, "mark")).toEqual([]);
  });

  it("is exhausted until a rest after a success", () => {
    const used = actor({ featureUses: [{ key: "card:troublemaker", until: "rest" }] });
    expect(run(trouble, ctx([6, 5], { actor: used, targets: [adv("a")] }))).toEqual({ ok: false, reason: "exhausted", detail: "Back after a rest" });
  });
});

describe("Hypnotic Shimmer (CB p.334)", () => {
  const shimmer = effectOf("hypnotic-shimmer");

  it("one roll against every adversary in front; those it beats are Stunned and mark a Stress", () => {
    // 7 + 4 + 3 = 14: beats 12, not 15.
    const plan = ok(run(shimmer, ctx([7, 4], { targets: [adv("a"), adv("b", { difficulty: 15 })] })));
    expect(plan.hits).toEqual([
      { id: "a", hit: true },
      { id: "b", hit: false },
    ]);
    expect(after(plan, "a")).toMatchObject({ stress: 1, tags: ["Stunned"] });
    expect(after(plan, "b")).toBeUndefined();
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "a", label: "Stunned", duration: "temporary", mods: [{ kind: "flag", flag: "cannotReact" }, { kind: "flag", flag: "cannotAct" }] });
    expect(plan.limit).toMatchObject({ key: "card:hypnotic-shimmer", until: "rest", consumed: true });
  });

  it("a failure against all of them does not use the once-per-rest limit", () => {
    const plan = ok(run(shimmer, ctx([1, 2], { targets: [adv("a"), adv("b")] })));
    expect(plan.success).toBe(false);
    expect(plan.limit).toMatchObject({ consumed: false });
  });
});

describe("Invisibility (CB p.334)", () => {
  const invis = effectOf("invisibility");

  it("Spellcast (10): on a success mark a Stress, the target is Invisible, Spellcast tokens on the card", () => {
    // 4 + 3 + 3 = 10 meets 10.
    const plan = ok(run(invis, ctx([4, 3], { targets: [ally("mira")] })));
    expect(plan.success).toBe(true);
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "afterRoll", costs: [{ resource: "stress", amount: 1 }], paid: true });
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "mira", label: "Invisible", mods: [{ kind: "disadvantageAgainst", on: "attack" }], duration: "manual" });
    expect(ofKind(plan, "tokens")[0]).toEqual({ kind: "tokens", op: "set", before: 0, after: 3 });
    expect(plan.actor.after).toMatchObject({ stress: 2, cardTokens: 3 });
    expect(plan.exclusive).toBe(true);
  });

  it("a failure costs no Stress and places no tokens", () => {
    const plan = ok(run(invis, ctx([2, 3], { targets: [ally("mira")] })));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "pay")).toEqual([]);
    expect(plan.actor.after).toMatchObject({ stress: 1, cardTokens: 0 });
  });

  it("each action of the Invisible creature spends a token", () => {
    const plan = ok(run(invis, ctx([], { useId: "spend-token", actor: actor({ cardTokens: 1 }) })));
    expect(plan.actor.after.cardTokens).toBe(0);
    expect(manualTexts(plan)).toEqual(["If that was the last token, Invisibility ends once this action is resolved."]);
    expect(run(invis, ctx([], { useId: "spend-token" }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Through Your Eyes (CB p.335)", () => {
  it("an effect on you until your next rest (or another spell) and the senses as a manual step", () => {
    const plan = ok(run(effectOf("through-your-eyes"), ctx([], { targets: [adv("a")] })));
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", label: "Through Your Eyes", duration: "rest", endsWhen: "you cast another spell" });
    expect(ofKind(plan, "prompt")[0]).toMatchObject({ prompt: "manual", targetIds: ["a"] });
    expect(plan.roll).toBeNull();
  });
});

describe("Thought Delver (CB p.335)", () => {
  const delver = effectOf("thought-delver");

  it("a Hope reads the surface thoughts", () => {
    const plan = ok(run(delver, ctx([], { targets: [adv("a")] })));
    expect(plan.actor.after.hope).toBe(1);
    expect(manualTexts(plan)).toEqual(["The GM tells you the target's vague surface thoughts."]);
  });

  it("delving rolls Spellcast against the target; with Fear the target may notice", () => {
    const hope = ok(run(delver, ctx([9, 4], { useId: "delve", targets: [adv("a")] })));
    expect(manualTexts(hope)).toEqual(["The GM tells you the target's deeper, more hidden thoughts."]);
    // 4 + 9 + 3 = 16: a success with Fear.
    const fear = ok(run(delver, ctx([4, 9], { useId: "delve", targets: [adv("a")] })));
    expect(manualTexts(fear)).toHaveLength(2);
    expect(fear.gmFearDelta).toBe(1);
    // "On a roll with Fear": a failure with Fear may be noticed too; a failure with Hope reveals nothing.
    const missFear = ok(run(delver, ctx([1, 3], { useId: "delve", targets: [adv("a")] })));
    expect(manualTexts(missFear)).toEqual(["At the GM's discretion, the target becomes aware you're reading their thoughts."]);
    const missHope = ok(run(delver, ctx([3, 1], { useId: "delve", targets: [adv("a")] })));
    expect(manualTexts(missHope)).toEqual([]);
  });
});

describe("Words of Discord (CB p.335)", () => {
  const words = effectOf("words-of-discord");

  it("Spellcast (13): on a success the target marks a Stress and attacks another adversary (manual)", () => {
    const plan = ok(run(words, ctx([6, 4], { targets: [adv("a")] })));
    expect(plan.roll?.record.total).toBe(13);
    expect(after(plan, "a")).toMatchObject({ stress: 1 });
    expect(manualTexts(plan)).toHaveLength(1);
  });

  it("the next cast on the same target takes a -5 penalty", () => {
    const situation = "You have cast Words of Discord on this target before";
    const plan = ok(run(words, ctx([6, 4], { useId: "again", situations: [situation], targets: [adv("a")] })));
    expect(plan.roll?.record.total).toBe(8);
    expect(plan.success).toBe(false);
    expect(after(plan, "a")).toBeUndefined();
    expect(run(words, ctx([6, 4], { useId: "again", targets: [adv("a")] }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Never Upstaged (CB p.335)", () => {
  const upstaged = effectOf("never-upstaged");

  it("after marking HP from an attack, a Stress places that many tokens", () => {
    const plan = ok(run(upstaged, ctx([], { useId: "main", trigger: { amount: 2 }, actor: actor({ cardTokens: 1 }) })));
    expect(plan.activation).toBe("reaction");
    expect(plan.actor.after).toMatchObject({ stress: 2, cardTokens: 3 });
  });

  it("the next successful attack gains +5 damage per token, then the tokens clear", () => {
    const plan = ok(run(upstaged, ctx([], { useId: "bonus", trigger: { subject: adv("a") }, actor: actor({ cardTokens: 3 }) })));
    const fold = ofKind(plan, "fold")[0]!;
    expect(fold).toMatchObject({ targetIds: ["a"], amount: 15 });
    expect(fold.step).toMatchObject({ kind: "modifyDamage" });
    expect(ofKind(plan, "tokens")[0]).toEqual({ kind: "tokens", op: "clear", before: 3, after: 0 });
  });
});

describe("Share the Burden (CB p.335)", () => {
  const share = effectOf("share-the-burden");

  it("moves the chosen Stress from a willing creature to you and gains a Hope per Stress, once per rest", () => {
    const plan = ok(run(share, ctx([], { targets: [ally("mira")], choices: { stress: 2 } })));
    expect(after(plan, "mira")).toMatchObject({ stress: 1 });
    expect(plan.actor.after).toMatchObject({ stress: 3, hope: 4 });
    expect(plan.limit).toEqual({ key: "card:share-the-burden", until: "rest", consumed: true });
    const used = actor({ featureUses: [{ key: "card:share-the-burden", until: "rest" }] });
    expect(run(share, ctx([], { actor: used, targets: [ally("mira")], choices: { stress: 1 } }))).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("refuses zero Stress", () => {
    expect(run(share, ctx([], { targets: [ally("mira")], choices: { stress: 0 } }))).toMatchObject({ ok: false, reason: "choice" });
  });
});

describe("Grace-Touched (CB p.335)", () => {
  const touched = effectOf("grace-touched");
  const four = actor({ loadoutDomains: ["grace", "grace", "grace", "grace", "codex"] });

  it("needs 4 Grace cards in the loadout", () => {
    expect(run(touched, ctx([], { useId: "armor-for-stress" }))).toMatchObject({ ok: false, reason: "requirement", detail: "loadoutDomainCount" });
  });

  it("an Armor Slot instead of a Stress is folded into the Stress you mark", () => {
    const plan = ok(run(touched, ctx([], { useId: "armor-for-stress", actor: four })));
    expect(ofKind(plan, "fold")[0]).toMatchObject({ targetIds: ["pc"], step: { kind: "convertMarks", from: "stress", into: "armor" } });
    expect(plan.actor.after).toEqual(plan.actor.before);
  });

  it("Hit Points you would force a target to mark become Stress", () => {
    const plan = ok(run(touched, ctx([], { useId: "stress-for-hp", actor: four, trigger: { subject: adv("a") } })));
    expect(plan.activation).toBe("rider");
    expect(ofKind(plan, "fold")[0]).toMatchObject({ targetIds: ["a"], step: { kind: "convertMarks", from: "hp", into: "stress" } });
  });
});

describe("Astral Projection (CB p.335)", () => {
  const astral = effectOf("astral-projection");

  it("once per long rest, a Stress for a projection until your next rest", () => {
    const plan = ok(run(astral, ctx([])));
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", label: "Astral Projection", duration: "rest" });
    expect(manualTexts(plan)).toHaveLength(1);
    expect(plan.limit).toEqual({ key: "card:astral-projection", until: "longRest", consumed: true });
    const used = actor({ featureUses: [{ key: "card:astral-projection", until: "longRest" }] });
    expect(run(astral, ctx([], { actor: used }))).toEqual({ ok: false, reason: "exhausted", detail: "Back after a long rest" });
  });
});

describe("Mass Enrapture (CB p.335)", () => {
  const mass = effectOf("mass-enrapture");

  it("one roll against every target within Far; those it beats are Enraptured", () => {
    // 8 + 3 + 3 = 14: beats 12 and 14, not 16.
    const plan = ok(run(mass, ctx([8, 3], { targets: [adv("a"), adv("b", { difficulty: 14 }), adv("c", { difficulty: 16 })] })));
    expect(plan.hits.map((h) => h.hit)).toEqual([true, true, false]);
    expect(ofKind(plan, "condition").map((c) => c.targetId)).toEqual(["a", "b"]);
  });

  it("a Stress makes every Enraptured target mark a Stress and ends the spell", () => {
    const rapt = { tags: ["Enraptured"] };
    const plan = ok(run(mass, ctx([], { useId: "release", targets: [adv("a", rapt), adv("b", rapt), adv("c")] })));
    expect(plan.actor.after.stress).toBe(2);
    expect(after(plan, "a")).toMatchObject({ stress: 1, tags: [] });
    expect(after(plan, "b")).toMatchObject({ stress: 1, tags: [] });
    expect(after(plan, "c")).toBeUndefined();
  });
});

describe("Copycat (CB p.335)", () => {
  const copycat = effectOf("copycat");

  it("once per long rest, Hope equal to half the copied card's level (rounded up, CB p.107)", () => {
    const plan = ok(run(copycat, ctx([], { actor: actor({ hope: 4 }), targets: [ally("mira")], choices: { level: 5 } })));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "upfront", costs: [{ resource: "hope", amount: 3 }] });
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ label: "Copycat", duration: "rest" });
    expect(manualTexts(plan)).toHaveLength(1);
    expect(plan.limit).toMatchObject({ until: "longRest", consumed: true });
  });

  it("refuses a card above level 8 and an unaffordable cost", () => {
    expect(run(copycat, ctx([], { targets: [ally("mira")], choices: { level: 9 } }))).toMatchObject({ ok: false, reason: "choice" });
    expect(run(copycat, ctx([], { targets: [ally("mira")], choices: { level: 8 } }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Encore (CB p.335)", () => {
  const encore = effectOf("encore");
  const bandit = adv("a", { thresholds: { major: 8, severe: 14 } });

  it("on a success with Hope, deals the ally's damage again to the same target", () => {
    const plan = ok(run(encore, ctx([9, 4], { trigger: { amount: 9, subject: bandit, source: ally("mira") } })));
    expect(plan.hits).toEqual([{ id: "a", hit: true }]);
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 9, severity: "major", hpMarked: 2 });
    expect(ofKind(plan, "toVault")).toEqual([]);
  });

  it("a success with Fear deals the damage and places the card in your vault; a critical does not", () => {
    const fear = ok(run(encore, ctx([5, 9], { trigger: { amount: 9, subject: bandit } })));
    expect(ofKind(fear, "damage")).toHaveLength(1);
    expect(ofKind(fear, "toVault")).toEqual([{ kind: "toVault", permanent: false }]);
    // A critical's damage is the ally's number, not dice: no maximum added.
    const crit = ok(run(encore, ctx([6, 6], { trigger: { amount: 9, subject: bandit } })));
    expect(ofKind(crit, "damage")[0]!.result.incoming).toBe(9);
    expect(ofKind(crit, "toVault")).toEqual([]);
  });

  it("a failure deals nothing and keeps the card", () => {
    const plan = ok(run(encore, ctx([2, 5], { trigger: { amount: 9, subject: bandit } })));
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(ofKind(plan, "toVault")).toEqual([]);
  });
});
