import { describe, expect, it } from "vitest";

import { run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { ARCANA_EFFECTS } from "@/lib/srd/card-effects/arcana";
import { CARD_CLASSIFICATION } from "@/lib/srd/card-effects/classification";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";

// Plan combat-actions, tracer CE-arcana: every Arcana card's effect entry, run through the CA1 runner with fixed dice.
// Expected values come from the card text (CB p.328-329) by hand. RNG order: Hope die, Fear die, then damage dice, d20s
// and checks in the order the steps need them. The default actor has Spellcast 3, Proficiency 2, Agility 2, 2 Hope and
// 1 of 6 Stress marked; the default adversary has Difficulty 12 and thresholds 8/14.

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
  level: 8,
  tier: 4,
  loadoutDomains: ["arcana", "codex"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 mag", trait: "knowledge", damageType: "magic", range: "far" } },
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

const ally = (id: string): Combatant => ({
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
});

const effectOf = (cardId: string): CardEffect => {
  const found = ARCANA_EFFECTS.find((e) => e.cardId === cardId);
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

describe("the Arcana table", () => {
  const usable = Object.entries(CARD_CLASSIFICATION.arcana)
    .filter(([, c]) => c.usage !== "outOfCombat")
    .map(([id]) => id)
    .sort();

  it("has exactly one entry per combat or passive Arcana card (U3)", () => {
    const ids = ARCANA_EFFECTS.map((e) => e.cardId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(usable);
    expect(usable).toHaveLength(21);
  });

  it("covers the Arcana cards of DOMAIN_CARDS", () => {
    const arcana = DOMAIN_CARDS.filter((c) => c.domain === "arcana").map((c) => c.id).sort();
    expect(arcana).toEqual(usable);
  });

  it("every use runs through run() without throwing", () => {
    const rich = actor({ hope: 6, stress: 0, cardTokens: 3, loadoutDomains: ["arcana", "arcana", "arcana", "arcana"], activeCardEffects: ["flight", "rift-walker", "confusing-aura"] });
    for (const effect of ARCANA_EFFECTS) {
      const useIds = new Set(effect.uses.map((u) => u.id));
      expect(useIds.size).toBe(effect.uses.length);
      for (const use of effect.uses) {
        const result = run(effect, {
          actor: rich,
          gmFear: 3,
          useId: use.id,
          targets: [adv("a")],
          followUp: [adv("b")],
          trigger: { amount: 10, source: adv("src"), subject: ally("mira") },
          choices: { tokens: 1, layers: 1, stress: 1, hope: 1 },
          roll: { difficulty: 10 },
          rng: () => 4,
        });
        expect(result, `${effect.cardId}/${use.id}`).toMatchObject({ ok: true });
      }
    }
  });
});

describe("Rune Ward (L1, CB p.328): the holder spends a Hope to reduce damage by 1d8", () => {
  it("you hold it: a Hope, the Ward Die reduces your incoming damage", () => {
    const plan = ok("rune-ward", ctx([5], { trigger: { amount: 11, source: adv("ogre") } }));
    expect(plan.activation).toBe("reaction");
    expect(plan.actor.after.hope).toBe(1);
    expect(folds(plan)).toEqual([{ kind: "reduceDamage", targetIds: ["pc"], amount: 5 }]);
    expect(prompts(plan, "manual")).toEqual([]);
  });
  it("an 8 on the Ward Die still reduces, then the ward's power ends until your next rest", () => {
    const plan = ok("rune-ward", ctx([8], { trigger: { amount: 11 } }));
    expect(folds(plan)).toEqual([{ kind: "reduceDamage", targetIds: ["pc"], amount: 8 }]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/recharged for free on your next rest/);
  });
  it("an ally holds it: the ally spends the Hope and their damage is reduced", () => {
    const plan = ok("rune-ward", ctx([3], { useId: "ally", trigger: { amount: 9, subject: ally("mira") } }));
    expect(ofKind(plan, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: -1 }]);
    expect(folds(plan)).toEqual([{ kind: "reduceDamage", targetIds: ["mira"], amount: 3 }]);
    expect(plan.actor.after.hope).toBe(2);
  });
  it("refused without a Hope", () => {
    expect(run(effectOf("rune-ward"), ctx([], { actor: actor({ hope: 0 }) }))).toMatchObject({ ok: false, reason: "cost", detail: "hope" });
  });
});

describe("Unleash Chaos (L1, CB p.328): tokens = Spellcast, d10 per token spent", () => {
  it("spends the chosen tokens; on a success deals that many d10 magic damage", () => {
    // 9 + 4 + Spellcast 3 = 16 beats 12; 2d10 = 6 + 7 = 13: Major (8/14) marks 2 HP.
    const plan = ok("unleash-chaos", ctx([9, 4, 6, 7], { actor: actor({ cardTokens: 3 }), targets: [adv("a")], choices: { tokens: 2 } }));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "upfront", costs: [{ resource: "tokens", amount: 2 }] });
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 13 } });
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 13, severity: "major", hpMarked: 2 });
    expect(plan.actor.after.cardTokens).toBe(1);
  });
  it("a miss still spends the tokens and deals nothing", () => {
    const plan = ok("unleash-chaos", ctx([2, 3], { actor: actor({ cardTokens: 3 }), targets: [adv("a")], choices: { tokens: 3 } }));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(plan.actor.after.cardTokens).toBe(0);
  });
  it("can't be cast with no tokens", () => {
    expect(run(effectOf("unleash-chaos"), ctx([], { targets: [adv("a")], choices: { tokens: 1 } }))).toMatchObject({ ok: false, reason: "choice" });
  });
  it("mark a Stress to replenish up to your Spellcast trait; session start places them, session end clears them", () => {
    const refill = ok("unleash-chaos", ctx([], { useId: "replenish", actor: actor({ cardTokens: 1 }) }));
    expect(refill.actor.after).toMatchObject({ stress: 2, cardTokens: 3 });
    expect(ok("unleash-chaos", ctx([], { useId: "session-start" })).actor.after.cardTokens).toBe(3);
    expect(ok("unleash-chaos", ctx([], { useId: "session-end", actor: actor({ cardTokens: 2 }) })).actor.after.cardTokens).toBe(0);
  });
});

describe("Wall Walk (L1, CB p.328)", () => {
  it("a Hope: a creature you touch climbs walls until the end of the scene; one at a time", () => {
    const plan = ok("wall-walk", ctx([], { targets: [ally("mira")] }));
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "effect")).toEqual([{ kind: "effect", targetId: "mira", label: "Wall Walk: climbs walls and ceilings as easily as walking", mods: [], duration: "scene" }]);
    expect(plan.exclusive).toBe(true);
  });
});

describe("Cinder Grasp (L2, CB p.328)", () => {
  it("on a success 1d20+3 magic and temporarily On Fire; the On Fire damage is a manual step", () => {
    // 8 + 3 + 3 = 14 beats 12; 1d20+3 = 15 + 3 = 18: Severe, 3 HP.
    const plan = ok("cinder-grasp", ctx([8, 3, 15], { targets: [adv("a")] }));
    expect(ofKind(plan, "damage")[0]!.result).toMatchObject({ incoming: 18, severity: "severe", hpMarked: 3 });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "a", condition: { kind: "tag", tag: "On Fire" }, duration: "temporary" });
    expect(plan.creatures[0]!.after.tags).toEqual(["On Fire"]);
    expect(prompts(plan, "manual")[0]).toMatchObject({ targetIds: ["a"] });
  });
  it("a miss does nothing to the target; with Fear the GM gains a Fear", () => {
    const plan = ok("cinder-grasp", ctx([2, 3], { targets: [adv("a")] }));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "damage")).toEqual([]);
    expect(ofKind(plan, "condition")).toEqual([]);
    expect(prompts(plan, "manual")).toEqual([]);
    expect(plan.gmFearDelta).toBe(1);
  });
});

describe("Floating Eye (L2, CB p.328)", () => {
  it("a Hope for the orb; it lasts until it takes damage or leaves Very Far range", () => {
    const plan = ok("floating-eye", ctx([]));
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "pc", label: "Floating Eye", duration: "manual", endsWhen: "the orb takes damage or moves out of Very Far range" });
    expect(prompts(plan, "manual")).toHaveLength(1);
  });
});

describe("Counterspell (L3, CB p.328)", () => {
  it("a Spellcast reaction roll against the GM's Difficulty: on a success the effect stops and the card goes to the vault", () => {
    // 8 + 4 + 3 = 15 meets 14.
    const plan = ok("counterspell", ctx([8, 4], { roll: { difficulty: 14 } }));
    expect(plan.roll?.record.kind).toBe("reaction");
    expect(plan.success).toBe(true);
    expect(folds(plan)).toEqual([{ kind: "negate", targetIds: ["pc"], amount: undefined }]);
    expect(ofKind(plan, "toVault")).toEqual([{ kind: "toVault", permanent: false }]);
    // A reaction roll gains no Hope and gives no Fear (CB p.99).
    expect(plan.actor.after).toEqual(plan.actor.before);
    expect(plan.gmFearDelta).toBe(0);
  });
  it("a failure keeps the card", () => {
    const plan = ok("counterspell", ctx([2, 3], { roll: { difficulty: 14 } }));
    expect(plan.success).toBe(false);
    expect(ofKind(plan, "fold")).toEqual([]);
    expect(ofKind(plan, "toVault")).toEqual([]);
  });
});

describe("Flight (L3, CB p.328)", () => {
  it("Spellcast (15): tokens equal to Agility and Flying", () => {
    const plan = ok("flight", ctx([9, 4]));
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "set", before: 0, after: 2 }]);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ label: "Flying", mods: [{ kind: "flag", flag: "flying" }], duration: "manual" });
  });
  it("minimum 1 token with a negative Agility; nothing on a failure", () => {
    const low = actor({ traits: { agility: -1, strength: 1, finesse: 1, instinct: 0, presence: 1, knowledge: 3 } });
    expect(ok("flight", ctx([9, 4], { actor: low })).actor.after.cardTokens).toBe(1);
    const fail = ok("flight", ctx([2, 3]));
    expect(ofKind(fail, "tokens")).toEqual([]);
    expect(ofKind(fail, "effect")).toEqual([]);
  });
  it("each action roll while flying spends a token; the descent is a manual step", () => {
    const plan = ok("flight", ctx([], { useId: "spend", actor: actor({ cardTokens: 2, activeCardEffects: ["flight"] }) }));
    expect(plan.activation).toBe("auto");
    expect(plan.actor.after.cardTokens).toBe(1);
    expect(prompts(plan, "manual")).toHaveLength(1);
    expect(run(effectOf("flight"), ctx([], { useId: "spend" }))).toMatchObject({ ok: false, reason: "requirement" });
  });
});

describe("Blink Out (L4, CB p.328)", () => {
  it("Spellcast (12): a Hope to teleport, one more Hope per willing passenger", () => {
    // 5 + 6 + 3 = 14 meets 12, with Fear: no Hope gained.
    const plan = ok("blink-out", ctx([5, 6], { actor: actor({ hope: 3 }), targets: [ally("mira"), ally("tom")] }));
    expect(ofKind(plan, "pay").map((p) => [p.costs, p.paid])).toEqual([
      [[{ resource: "hope", amount: 1 }], true],
      [[{ resource: "hope", amount: 2 }], true],
    ]);
    expect(prompts(plan, "move").map((p) => [p.targetIds, p.text])).toEqual([
      [["pc"], "Teleport to a point you can see within Far range"],
      [["mira", "tom"], "Teleports with you"],
    ]);
    expect(plan.actor.after.hope).toBe(0);
  });
  it("short of Hope for the passengers: you blink alone", () => {
    const plan = ok("blink-out", ctx([5, 6], { actor: actor({ hope: 1 }), targets: [ally("mira"), ally("tom")] }));
    expect(ofKind(plan, "pay").map((p) => p.paid)).toEqual([true, false]);
    expect(prompts(plan, "move").map((p) => p.targetIds)).toEqual([["pc"]]);
  });
  it("a failure: no Hope spent, no teleport", () => {
    const plan = ok("blink-out", ctx([2, 3]));
    expect(ofKind(plan, "pay")).toEqual([]);
    expect(prompts(plan, "move")).toEqual([]);
  });
});

describe("Preservation Blast (L4, CB p.328)", () => {
  it("all in Melee: who is beaten is forced back to Far and takes d8+3 using Spellcast (3d8+3)", () => {
    // 7 + 5 + 3 = 15: beats 12, not 20. 3d8+3 = 4 + 6 + 2 + 3 = 15: Severe.
    const plan = ok("preservation-blast", ctx([7, 5, 4, 6, 2], { targets: [adv("a"), adv("b", { difficulty: 20 })] }));
    expect(plan.hits).toEqual([
      { id: "a", hit: true },
      { id: "b", hit: false },
    ]);
    expect(prompts(plan, "move")).toMatchObject([{ text: "Knock back (far)", targetIds: ["a"] }]);
    expect(ofKind(plan, "damageRoll")[0]!.record.dice.map((d) => d.sides)).toEqual([8, 8, 8]);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.severity])).toEqual([["a", 15, "severe"]]);
  });
});

describe("Chain Lightning (L5, CB p.328)", () => {
  it("2 Stress; beaten targets save against your roll's total, failures take 2d8+4; the first link of the chain likewise", () => {
    // 8 + 5 + 3 = 16: beats a (12), not b (20). a saves 10 < 16: fails, 2d8+4 = 3 + 5 + 4 = 12 (Major).
    // The chain: c saves 4 < 16 and takes the same 12 (one damage roll for the move, CB p.104).
    const plan = ok("chain-lightning", ctx([8, 5, 10, 3, 5, 4], { targets: [adv("a"), adv("b", { difficulty: 20 })], followUp: [adv("c")] }));
    expect(ofKind(plan, "pay")[0]).toMatchObject({ phase: "upfront", costs: [{ resource: "stress", amount: 2 }] });
    expect(ofKind(plan, "save").map((s) => [s.targetId, s.difficulty, s.success])).toEqual([
      ["a", 16, false],
      ["c", 16, false],
    ]);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.hpMarked])).toEqual([
      ["a", 12, 2],
      ["c", 12, 2],
    ]);
    expect(plan.actor.after).toMatchObject({ stress: 3, hope: 3 });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/chain continues/);
  });
  it("a target who saves takes nothing", () => {
    const plan = ok("chain-lightning", ctx([8, 5, 16], { targets: [adv("a")] }));
    expect(ofKind(plan, "save")[0]).toMatchObject({ targetId: "a", success: true });
    expect(ofKind(plan, "damage")).toEqual([]);
  });
  it("refused without 2 free Stress slots", () => {
    expect(run(effectOf("chain-lightning"), ctx([], { actor: actor({ stress: 5 }) }))).toMatchObject({ ok: false, reason: "cost", detail: "stress" });
  });
});

describe("Premonition (L5, CB p.328)", () => {
  it("once per long rest: rescind the move and its consequences", () => {
    const plan = ok("premonition", ctx([]));
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: undefined }]);
    expect(prompts(plan, "manual")).toHaveLength(1);
    expect(plan.actor.featureUses).toEqual([{ key: "card:premonition", until: "longRest" }]);
    const again = run(effectOf("premonition"), ctx([], { actor: actor({ featureUses: plan.actor.featureUses }) }));
    expect(again).toEqual({ ok: false, reason: "exhausted", detail: "Back after a long rest" });
  });
});

describe("Rift Walker (L6, CB p.329)", () => {
  it("Spellcast (15) places the marking; the next successful cast opens the rift", () => {
    const mark = ok("rift-walker", ctx([9, 4]));
    expect(ofKind(mark, "effect")[0]).toMatchObject({ label: "Rift Walker marking" });
    expect(mark.exclusive).toBe(true);
    const open = ok("rift-walker", ctx([9, 4], { useId: "open", actor: actor({ activeCardEffects: ["rift-walker"] }) }));
    expect(prompts(open, "manual")[0]!.text).toMatch(/rift opens/);
    expect(run(effectOf("rift-walker"), ctx([], { useId: "open" }))).toMatchObject({ ok: false, reason: "requirement" });
    expect(prompts(ok("rift-walker", ctx([2, 3], { useId: "open", actor: actor({ activeCardEffects: ["rift-walker"] }) })), "manual")).toEqual([]);
  });
});

describe("Telekinesis (L6, CB p.329)", () => {
  it("move the target within Far; throw it with a second Spellcast Roll for d12+4 using Proficiency", () => {
    // 9 + 4 + 3 = 16 beats a. Throw: 6 + 5 + 3 = 14 beats b (14); 2d12+4 = 7 + 3 + 4 = 14: Severe.
    const plan = ok("telekinesis", ctx([9, 4, 6, 5, 7, 3], { targets: [adv("a")], followUp: [adv("b", { difficulty: 14 })], optionals: ["throw"] }));
    expect(prompts(plan, "move")).toMatchObject([{ targetIds: ["a"] }]);
    expect(ofKind(plan, "roll")).toHaveLength(2);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.severity])).toEqual([["b", 14, "severe"]]);
    expect(plan.actor.after.hope).toBe(4);
  });
  it("without the throw there is no second roll and no damage", () => {
    const plan = ok("telekinesis", ctx([9, 4], { targets: [adv("a")], followUp: [adv("b")] }));
    expect(ofKind(plan, "roll")).toHaveLength(1);
    expect(ofKind(plan, "damage")).toEqual([]);
  });
});

describe("Arcana-Touched (L7, CB p.329)", () => {
  const four = actor({ loadoutDomains: ["arcana", "arcana", "arcana", "arcana", "codex"] });
  it("with 4 Arcana cards: once per rest switch the Hope and Fear Dice", () => {
    const plan = ok("arcana-touched", ctx([], { actor: four }));
    expect(plan.useId).toBe("swap");
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["pc"], amount: undefined }]);
    expect(plan.actor.featureUses).toEqual([{ key: "card:arcana-touched:swap", until: "rest" }]);
    expect(run(effectOf("arcana-touched"), ctx([]))).toMatchObject({ ok: false, reason: "requirement" });
  });
  it("+1 to Spellcast Rolls as a passive mod", () => {
    const passive = effectOf("arcana-touched").uses.find((u) => u.id === "passive")!;
    expect(passive.activation.kind).toBe("passive");
    expect(passive.mods).toEqual([{ kind: "stat", stat: "spellcast", delta: { kind: "fixed", value: 1 } }]);
    expect(ok("arcana-touched", ctx([], { actor: four, useId: "passive" })).steps).toEqual([]);
  });
});

describe("Cloaking Blast (L7, CB p.329)", () => {
  it("a rider on another successful spell: a Hope to become Cloaked until you move into sight or attack", () => {
    const plan = ok("cloaking-blast", ctx([]));
    expect(plan.activation).toBe("rider");
    expect(plan.actor.after.hope).toBe(1);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "pc", condition: { kind: "standard", condition: "cloaked" }, duration: "manual" });
  });
});

describe("Arcane Reflection (L8, CB p.329)", () => {
  it("Hope-many d6; any 6 reflects the attack to the caster", () => {
    const caster = adv("mage");
    const hit = ok("arcane-reflection", ctx([3, 6], { actor: actor({ hope: 3 }), choices: { hope: 2 }, trigger: { amount: 12, source: caster } }));
    expect(hit.actor.after.hope).toBe(1);
    expect(ofKind(hit, "check")[0]).toEqual({ kind: "check", total: 9, dice: [3, 6], passed: true });
    expect(folds(hit)).toEqual([{ kind: "redirectDamage", targetIds: ["mage"], amount: undefined }]);
    const miss = ok("arcane-reflection", ctx([5], { choices: { hope: 1 }, trigger: { source: caster } }));
    expect(ofKind(miss, "fold")).toEqual([]);
  });
  it("refused when the Hope chosen exceeds your Hope", () => {
    expect(run(effectOf("arcane-reflection"), ctx([], { choices: { hope: 3 } }))).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Confusing Aura (L8, CB p.329)", () => {
  it("Spellcast (14): one layer plus one per Stress marked (layers are card tokens); once per long rest on a success", () => {
    const plan = ok("confusing-aura", ctx([9, 4], { choices: { layers: 2 } }));
    expect(ofKind(plan, "tokens").map((t) => [t.op, t.after])).toEqual([
      ["set", 1],
      ["add", 3],
    ]);
    expect(plan.actor.after).toMatchObject({ stress: 3, cardTokens: 3 });
    expect(ofKind(plan, "effect")[0]).toMatchObject({ label: "Confusing Aura" });
    expect(plan.limit).toEqual({ key: "card:confusing-aura", until: "longRest", consumed: true });
  });
  it("a failure marks no Stress and keeps the card ready", () => {
    const plan = ok("confusing-aura", ctx([2, 3], { choices: { layers: 2 } }));
    expect(plan.actor.after.stress).toBe(1);
    expect(plan.limit?.consumed).toBe(false);
  });
  it("an attack against you: d6 per layer, a 5+ destroys a layer and the attack fails", () => {
    const aura = actor({ cardTokens: 3, activeCardEffects: ["confusing-aura"] });
    const saved = ok("confusing-aura", ctx([2, 5, 1], { useId: "attacked", actor: aura, trigger: { source: adv("ogre") } }));
    expect(saved.actor.after.cardTokens).toBe(2);
    expect(folds(saved)).toEqual([{ kind: "negate", targetIds: ["pc"], amount: undefined }]);
  });
  it("all 4 or lower: you take the damage and the spell ends", () => {
    const aura = actor({ cardTokens: 3, activeCardEffects: ["confusing-aura"] });
    const broken = ok("confusing-aura", ctx([1, 4, 3], { useId: "attacked", actor: aura }));
    expect(broken.actor.after.cardTokens).toBe(0);
    expect(ofKind(broken, "fold")).toEqual([]);
    expect(prompts(broken, "manual")[0]!.text).toMatch(/Confusing Aura ends/);
  });
});

describe("Earthquake (L9, CB p.329)", () => {
  it("Spellcast (16), once per rest on a success: everyone not flying saves (18); 3d10+8, Vulnerable, half on a save", () => {
    // 10 + 7 + 3 = 20. a saves 5 (fails): 3d10+8 = 4 + 5 + 6 + 8 = 23, Severe, Vulnerable. b saves 18: half, 12 (Major).
    const plan = ok("earthquake", ctx([10, 7, 5, 4, 5, 6, 18], { targets: [adv("a"), adv("b"), adv("c", { flying: true })] }));
    expect(plan.excluded).toEqual(["c"]);
    expect(ofKind(plan, "save").map((s) => [s.targetId, s.success])).toEqual([
      ["a", false],
      ["b", true],
    ]);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.severity])).toEqual([
      ["a", 23, "severe"],
      ["b", 12, "major"],
    ]);
    expect(ofKind(plan, "condition").map((c) => c.targetId)).toEqual(["a"]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/terrain/);
    expect(plan.limit).toEqual({ key: "card:earthquake", until: "rest", consumed: true });
  });
  it("a failed Spellcast Roll does nothing and keeps the card ready", () => {
    const plan = ok("earthquake", ctx([2, 3], { targets: [adv("a")] }));
    expect(ofKind(plan, "save")).toEqual([]);
    expect(prompts(plan, "manual")).toEqual([]);
    expect(plan.limit?.consumed).toBe(false);
  });
});

describe("Sensory Projection (L9, CB p.329)", () => {
  it("once per rest (used up by the attempt): Spellcast (15) for the vision", () => {
    const plan = ok("sensory-projection", ctx([9, 4]));
    expect(ofKind(plan, "effect")[0]).toMatchObject({ label: "Sensory Projection", endsWhen: "you take damage or cast another spell" });
    const fail = ok("sensory-projection", ctx([2, 3]));
    expect(ofKind(fail, "effect")).toEqual([]);
    expect(fail.actor.featureUses).toEqual([{ key: "card:sensory-projection", until: "rest" }]);
  });
});

describe("Adjust Reality (L10, CB p.329)", () => {
  it("after you or a willing ally roll: 5 Hope to set the result", () => {
    const plan = ok("adjust-reality", ctx([], { useId: "main", actor: actor({ hope: 5 }), trigger: { subject: ally("mira") } }));
    expect(plan.actor.after.hope).toBe(0);
    expect(folds(plan)).toEqual([{ kind: "modifyRoll", targetIds: ["mira"], amount: undefined }]);
    expect(run(effectOf("adjust-reality"), ctx([], { useId: "main", actor: actor({ hope: 4 }) }))).toMatchObject({ ok: false, reason: "cost" });
  });
  it("any other roll (damage, reaction) is a manual step for 5 Hope", () => {
    const plan = ok("adjust-reality", ctx([], { useId: "other", actor: actor({ hope: 6 }) }));
    expect(plan.actor.after.hope).toBe(1);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });
});

describe("Falling Sky (L10, CB p.329)", () => {
  it("all adversaries within Far; 1d20+2 magic for each Stress marked to those beaten", () => {
    // 9 + 4 + 3 = 16: beats a, not b (20). Two Stress: (10 + 2) + (5 + 2) = 19: Severe.
    const plan = ok("falling-sky", ctx([9, 4, 10, 5], { targets: [adv("a"), adv("b", { difficulty: 20 })], choices: { stress: 2 } }));
    expect(plan.actor.after.stress).toBe(3);
    expect(ofKind(plan, "damageRoll")[0]!.record.total).toBe(19);
    expect(ofKind(plan, "damage").map((d) => [d.result.targetId, d.result.incoming, d.result.severity])).toEqual([["a", 19, "severe"]]);
  });
  it("at least one Stress", () => {
    expect(run(effectOf("falling-sky"), ctx([], { choices: { stress: 0 } }))).toMatchObject({ ok: false, reason: "choice" });
  });
});
