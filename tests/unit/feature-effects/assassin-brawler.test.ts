import { describe, expect, it } from "vitest";

import type { ActorState, PlanStep, RunPlan } from "@/lib/domain/card-effects/run";
import type { CardUse, Step } from "@/lib/domain/card-effects/types";
import { brawlersStrike } from "@/lib/domain/class-features/classes/brawler";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import type { RollRecord } from "@/lib/domain/duality";
import { delegatedKeys, delegateFeature } from "@/lib/domain/feature-effects/delegate";
import { parseFeatureId } from "@/lib/domain/feature-effects/ids";
import { holdingsFor, owned } from "@/lib/domain/feature-effects/owned";
import { runFeature, type FeatureRunContext, type FeatureRunResult } from "@/lib/domain/feature-effects/run";
import type { FeatureEffect } from "@/lib/domain/feature-effects/types";
import { applyUpgrades, type Holdings } from "@/lib/domain/feature-effects/upgrades";
import { ASSASSIN_BRAWLER_EFFECTS, MARKED_FOR_DEATH } from "@/lib/srd/feature-effects/assassin-brawler";
import { FEATURE_CLASSIFICATION } from "@/lib/srd/feature-effects/classification";
import { featureEffect } from "@/lib/srd/feature-effects/index";
import { SUBCLASSES } from "@/lib/srd/subclasses";
import { actorOf, sheetOf } from "./engine/fixtures";

// Plan sheet-drawer, tracer FE-assassin-brawler: every Assassin and Brawler entry run through runFeature with fixed dice.
// Expected values are worked out by hand from the book (HF p.8-11, printed pages). RNG order: Hope die, Fear die, then
// damage dice, token dice and D5 dice in the order the steps need them; every test checks that all queued dice were used.

const OWNERS = new Set(["assassin", "brawler", "executioners-guild", "poisoners-guild", "juggernaut", "martial-artist"]);

const effectOf = (id: string): FeatureEffect => {
  const e = ASSASSIN_BRAWLER_EFFECTS.find((x) => x.featureId === id);
  if (!e) throw new Error(`No entry for ${id}`);
  return e;
};
const useOf = (id: string, useId = "main"): CardUse => effectOf(id).uses.find((u) => u.id === useId)!;

const none = (): Holdings => ({ rank: "foundation", featureIds: new Set(), level: 1 });
const holding = (rank: Holdings["rank"], ...ids: string[]): Holdings => ({ rank, featureIds: new Set(ids), level: 1 });

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
const marked = (id: string) => adv(id, { tags: [MARKED_FOR_DEATH] });

const assassin = sheetOf("assassin", "executioners-guild");
const poisoner = sheetOf("assassin", "poisoners-guild");
const juggernaut = sheetOf("brawler", "juggernaut");
const martial = sheetOf("brawler", "martial-artist", { subclassRank: "mastery" });

type Ctx = Partial<FeatureRunContext> & { actor?: ActorState };

/** Runs a use with queued dice and checks every die was used. */
function go(id: string, useId: string | undefined, dice: number[], ctx: Ctx = {}): FeatureRunResult {
  const rng = queueRng(dice);
  const result = runFeature(effectOf(id), useId, { actor: actorOf(assassin), gmFear: 2, rng, ...ctx });
  if (result.ok) rng.done();
  return result;
}
function ok(result: FeatureRunResult): RunPlan {
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  return result.plan;
}
const ofKind = <K extends PlanStep["kind"]>(plan: RunPlan, kind: K) => plan.steps.filter((s): s is Extract<PlanStep, { kind: K }> => s.kind === kind);
const after = (plan: RunPlan, id: string) => plan.creatures.find((c) => c.id === id)?.after;
const fold = (plan: RunPlan) => ofKind(plan, "fold");

/** A finished action roll (what a delegated D5 feature reads as the latest roll). */
const actionRoll = (outcome: RollRecord["outcome"]): RollRecord => ({
  kind: "action",
  dice: [
    { sides: 12, value: 9, role: "hope" },
    { sides: 12, value: 4, role: "fear" },
  ],
  modifier: 2,
  total: 15,
  difficulty: 12,
  outcome,
  manual: false,
});
/** Brawler's Strike damage at Proficiency 1: d8 5 + d6 3 = 8. */
const damageRoll: RollRecord = {
  kind: "damage",
  dice: [
    { sides: 8, value: 5, role: "damage" },
    { sides: 6, value: 3, role: "damage" },
  ],
  modifier: 0,
  total: 8,
  outcome: "none",
  manual: false,
};

// ---------------------------------------------------------------- the table

describe("the Assassin and Brawler table", () => {
  // The 16 martial stances share the owner `martial-artist` but belong to FE-stances' table.
  const group = Object.entries(FEATURE_CLASSIFICATION).filter(([id]) => parseFeatureId(id)?.source !== "stance" && OWNERS.has(parseFeatureId(id)?.owner ?? ""));
  const expected = group.filter(([, c]) => c.usage === "combat" || c.usage === "passive").map(([id]) => id).sort();

  it("has exactly one entry per feature classified combat or passive (25 of 28)", () => {
    const ids = ASSASSIN_BRAWLER_EFFECTS.map((e) => e.featureId);
    expect(group).toHaveLength(28);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(expected);
    expect(expected).toHaveLength(25);
    for (const id of ["class:assassin:get-in-get-out", "subclass:poisoners-guild:adders-blessing", "subclass:martial-artist:limit-breaker"]) {
      expect(ids).not.toContain(id);
    }
  });

  it("every entry is in the registry and its source, owner and subclass card match its id and the data", () => {
    for (const e of ASSASSIN_BRAWLER_EFFECTS) {
      expect(featureEffect(e.featureId)).toBe(e);
      const parsed = parseFeatureId(e.featureId)!;
      expect(e.source).toBe(parsed.source);
      expect(e.owner).toBe(parsed.owner);
      if (e.source === "subclass") {
        const sub = SUBCLASSES.find((s) => s.id === e.owner)!;
        const card = (["foundation", "specialization", "mastery"] as const).find((c) => sub[c].some((f) => `subclass:${sub.id}:${parsed.slug}` === e.featureId && f.name.length > 0 && e.uses.length > 0 && matchSlug(f.name, parsed.slug!)));
        expect(e.card, e.featureId).toBe(card);
      } else expect(e.card).toBeUndefined();
      const useIds = e.uses.map((u) => u.id);
      expect(new Set(useIds).size).toBe(useIds.length);
    }
  });

  it("passive features carry only passive uses; every upgrade names a feature of the group; delegates exist in D5", () => {
    for (const e of ASSASSIN_BRAWLER_EFFECTS) {
      if (FEATURE_CLASSIFICATION[e.featureId]!.usage === "passive") for (const u of e.uses) expect(u.activation.kind, e.featureId).toBe("passive");
      for (const up of e.upgrades ?? []) {
        if (up.when.kind === "feature") expect(FEATURE_CLASSIFICATION[up.when.featureId], up.when.featureId).toBeDefined();
        if (up.useId) expect(e.uses.some((u) => u.id === up.useId)).toBe(true);
      }
    }
    const brawler = sheetOf("brawler", "juggernaut");
    expect(delegatedKeys(useOf("class:assassin:marked-for-death"))).toEqual(["markedForDeath"]);
    expect(delegateFeature(assassin, "markedForDeath")?.name).toBe("Marked for Death");
    expect(delegateFeature(brawler, "comboStrike")?.name).toBe("Combo Strike");
  });
});

function matchSlug(name: string, slug: string): boolean {
  return name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") === slug;
}

// ---------------------------------------------------------------- Assassin

describe("Deadly Determination (HF p.8): spend 3 Hope to clear 2 Stress", () => {
  it("pays 3 Hope and clears 2 Stress; 6 Hope activates it twice (no roll, CB p.107)", () => {
    const once = ok(go("hope:assassin", undefined, [], { actor: actorOf(assassin, { hope: 3, stress: 3 }) }));
    expect(once.actor.after).toMatchObject({ hope: 0, stress: 1 });
    const twice = ok(go("hope:assassin", undefined, [], { actor: actorOf(assassin, { hope: 6, stress: 4 }), times: 2 }));
    expect(twice.actor.after).toMatchObject({ hope: 0, stress: 0 });
  });

  it("refuses with 2 Hope", () => {
    expect(go("hope:assassin", undefined, [], { actor: actorOf(assassin, { hope: 2 }) })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("Marked for Death (HF p.8)", () => {
  it("on a successful weapon attack, a Stress tags the target (one at a time) and D5 keeps its sheet effect", () => {
    const sheet = { ...assassin, stress: 1 };
    const result = go("class:assassin:marked-for-death", "main", [], { actor: actorOf(sheet), sheet, targets: [adv("bandit")], delegateRoll: actionRoll("successHope") });
    const plan = ok(result);
    expect(plan.activation).toBe("rider");
    expect(plan.exclusive).toBe(true);
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "condition")).toEqual([
      expect.objectContaining({ targetId: "bandit", condition: { kind: "tag", tag: MARKED_FOR_DEATH }, duration: "rest" }),
    ]);
    expect(after(plan, "bandit")?.tags).toEqual([MARKED_FOR_DEATH]);
    expect(ofKind(plan, "delegate")).toEqual([expect.objectContaining({ feature: "markedForDeath", done: true })]);
    expect(result.ok && result.sheet?.effects.some((e) => e.id === "marked-for-death" && e.until === "rest")).toBe(true);
  });

  it("D5 refuses without a successful attack, so nothing is written; two targets are refused", () => {
    const sheet = assassin;
    expect(go("class:assassin:marked-for-death", "main", [], { sheet, targets: [adv("a")], delegateRoll: actionRoll("failFear") })).toMatchObject({ ok: false, reason: "choice" });
    expect(go("class:assassin:marked-for-death", "main", [], { sheet, targets: [adv("a"), adv("b")], delegateRoll: actionRoll("successHope") })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("damage to the Marked target adds tier d4s; other targets get none", () => {
    // Tier 2: 2d4 = 3 + 4 = 7, only on the tagged bandit.
    const plan = ok(go("class:assassin:marked-for-death", "damage", [3, 4], { actor: actorOf(assassin, { tier: 2 }), targets: [marked("a"), adv("b")], holdings: none() }));
    expect(plan.activation).toBe("auto");
    expect(fold(plan)).toEqual([expect.objectContaining({ targetIds: ["a"], amount: 7 })]);
    // Tier 4: 4d4.
    expect(fold(ok(go("class:assassin:marked-for-death", "damage", [1, 2, 3, 4], { actor: actorOf(assassin, { tier: 4 }), targets: [marked("a")] })))[0]?.amount).toBe(10);
    // Not Marked: no dice are rolled.
    expect(fold(ok(go("class:assassin:marked-for-death", "damage", [], { targets: [adv("b")] })))).toEqual([]);
  });

  it("Ambush makes them d6s, Backstab d8s (from the sheet's held features)", () => {
    const at = (rank: "foundation" | "mastery") => {
      const sheet = { ...assassin, subclassRank: rank };
      return holdingsFor(sheet, owned(sheet), "assassin");
    };
    // Tier 1, foundation (Ambush): 1d6 = 6. A d4 could not roll 6 (the queue checks the die size).
    expect(fold(ok(go("class:assassin:marked-for-death", "damage", [6], { targets: [marked("a")], holdings: at("foundation") })))[0]?.amount).toBe(6);
    // Mastery (Backstab): 1d8 = 8.
    expect(fold(ok(go("class:assassin:marked-for-death", "damage", [8], { targets: [marked("a")], holdings: at("mastery") })))[0]?.amount).toBe(8);
    // A Poisoners Guild assassin keeps d4s.
    expect(() => go("class:assassin:marked-for-death", "damage", [6], { targets: [marked("a")], holdings: holdingsFor(poisoner, owned(poisoner), "assassin") })).toThrow();
  });
});

describe("First Strike (HF p.8): the first successful attack in a scene deals double damage", () => {
  it("doubles the attack's damage once per scene (Q7)", () => {
    const plan = ok(go("subclass:executioners-guild:first-strike", undefined, [], { targets: [adv("a")] }));
    expect(useOf("subclass:executioners-guild:first-strike").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "success", firstInScene: true } });
    expect(fold(plan)).toEqual([expect.objectContaining({ step: expect.objectContaining({ change: { kind: "multiply", factor: 2 } }), targetIds: ["a"] })]);
    expect(plan.limit).toEqual({ key: "feat:subclass:executioners-guild:first-strike", until: "scene", consumed: true });
    const used = actorOf(assassin, { featureUses: plan.actor.featureUses });
    expect(go("subclass:executioners-guild:first-strike", undefined, [], { actor: used, targets: [adv("a")] })).toMatchObject({ ok: false, reason: "exhausted", detail: "Back after the scene" });
  });
});

describe("Death Strike (HF p.8): Severe damage, mark a Stress, one more Hit Point", () => {
  it("the creature that took Severe damage marks an additional HP", () => {
    const plan = ok(go("subclass:executioners-guild:death-strike", undefined, [], { trigger: { subject: adv("a", { hp: 3 }) } }));
    expect(useOf("subclass:executioners-guild:death-strike").activation).toEqual({ kind: "rider", trigger: { kind: "whenTargetMarksHp", severity: "severe" } });
    expect(plan.actor.after.stress).toBe(assassin.stress + 1);
    expect(after(plan, "a")?.hp).toBe(4);
  });
});

describe("Scorpion's Poise (HF p.8): +2 Evasion against attacks by your Marked for Death target", () => {
  it("is a passive Evasion bonus keyed to the tagged attacker (NV9)", () => {
    expect(useOf("subclass:executioners-guild:scorpions-poise").mods).toEqual([
      { kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 2 }, versus: { creature: { kind: "tagged", tag: MARKED_FOR_DEATH }, on: "attacksByThem" } },
    ]);
  });
});

describe("True Strike (HF p.8): once per long rest, a failed attack becomes a success for a Hope", () => {
  it("is an after-roll answer (Q1) that spends a Hope and sets the outcome", () => {
    const plan = ok(go("subclass:executioners-guild:true-strike", undefined, [], { actor: actorOf(assassin, { hope: 1 }) }));
    expect(useOf("subclass:executioners-guild:true-strike").activation).toEqual({ kind: "reaction", trigger: { kind: "afterYouRoll", roll: "attack", result: "failure" } });
    expect(plan.actor.after.hope).toBe(0);
    expect(fold(plan)[0]?.step).toMatchObject({ kind: "modifyRoll", change: { kind: "setOutcome", outcome: "success" } });
    expect(plan.limit).toMatchObject({ key: "feat:subclass:executioners-guild:true-strike", until: "longRest", consumed: true });
    expect(go("subclass:executioners-guild:true-strike", undefined, [], { actor: actorOf(assassin, { featureUses: plan.actor.featureUses }) })).toMatchObject({
      ok: false,
      reason: "exhausted",
      detail: "Back after a long rest",
    });
  });
});

describe("Toxic Concoctions (HF p.9)", () => {
  const toxic = "subclass:poisoners-guild:toxic-concoctions";
  const actor = (tokens: number) => actorOf(poisoner, { cardTokens: tokens });

  it("brew: mark a Stress to place 1d4+1 tokens (added to any left)", () => {
    const plan = ok(go(toxic, "brew", [3], { actor: actor(1) }));
    expect(plan.actor.after.stress).toBe(poisoner.stress + 1);
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "add", before: 1, after: 5 }]);
  });

  it("poison: on a successful weapon attack, a token for Ghost Petal, Grave Spore or Leech Weed", () => {
    expect(useOf(toxic, "poison").activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true } });
    const ghost = ok(go(toxic, "poison", [], { actor: actor(2), targets: [adv("a")], options: { poison: ["ghost-petal"] } }));
    expect(ghost.actor.after.cardTokens).toBe(1);
    expect(ofKind(ghost, "condition")).toEqual([expect.objectContaining({ targetId: "a", condition: { kind: "standard", condition: "vulnerable" }, duration: "temporary" })]);
    const spore = ok(go(toxic, "poison", [], { actor: actor(1), targets: [adv("a")], options: { poison: ["grave-spore"] } }));
    expect(after(spore, "a")?.stress).toBe(1);
    const leech = ok(go(toxic, "poison", [5], { actor: actor(1), targets: [adv("a")], options: { poison: ["leech-weed"] } }));
    expect(fold(leech)).toEqual([expect.objectContaining({ targetIds: ["a"], amount: 5 })]);
    expect(go(toxic, "poison", [], { actor: actor(0), targets: [adv("a")], options: { poison: ["ghost-petal"] } })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("the poison list grows with Poison Compendium and Venomancer", () => {
    const poisons = (h: Holdings) => {
      const choose = applyUpgrades(effectOf(toxic), h).uses.find((u) => u.id === "poison")!.steps[0] as Extract<Step, { kind: "choose" }>;
      return choose.options.map((o) => o.id);
    };
    expect(poisons(none())).toEqual(["ghost-petal", "grave-spore", "leech-weed"]);
    const spec = holding("specialization", "subclass:poisoners-guild:poison-compendium", "subclass:poisoners-guild:twin-fang");
    expect(poisons(spec)).toEqual(["ghost-petal", "grave-spore", "leech-weed", "midnight-vine", "gorgon-root"]);
    const mastery = holdingsFor({ ...poisoner, subclassRank: "mastery" }, owned({ ...poisoner, subclassRank: "mastery" }), "poisoners-guild");
    expect(poisons(mastery)).toEqual(["ghost-petal", "grave-spore", "leech-weed", "midnight-vine", "gorgon-root", "blight-seed", "fear-leaf", "corpse-thorn"]);
  });

  it("the specialization and mastery poisons (HF p.9)", () => {
    const mastery = holding("mastery", "subclass:poisoners-guild:poison-compendium", "subclass:poisoners-guild:venomancer");
    const use = (poison: string, dice: number[] = [], choices: Record<string, number> = {}) =>
      ok(go(toxic, "poison", dice, { actor: actor(1), targets: [adv("a")], options: { poison: [poison] }, choices, holdings: mastery }));
    expect(ofKind(use("midnight-vine"), "effect")[0]).toMatchObject({ label: "Midnight Vine", mods: [{ kind: "flag", flag: "attackDisadvantage" }], duration: "manual", endsOn: ["bearerMarksStress"] });
    expect(ofKind(use("gorgon-root"), "condition")[0]).toMatchObject({ condition: { kind: "standard", condition: "restrained" }, duration: "temporary" });
    expect(ofKind(use("blight-seed"), "effect")[0]).toMatchObject({
      label: "Blight Seed",
      duration: "scene",
      mods: [
        { kind: "stat", stat: "majorThreshold", delta: -3 },
        { kind: "stat", stat: "severeThreshold", delta: -3 },
      ],
    });
    // Fear Leaf: the Fear Die's result (4) as the dialog's number (dcm-d1b).
    expect(fold(use("fear-leaf", [], { fearDie: 4 }))).toEqual([expect.objectContaining({ amount: 4 })]);
    expect(ofKind(use("corpse-thorn"), "effect")[0]).toMatchObject({ label: "Corpse Thorn", mods: [{ kind: "flag", flag: "reactionDisadvantage" }], duration: "scene" });
  });

  it("Twin Fang: a Marked for Death target takes a second poison for another token", () => {
    const h = holding("specialization", "subclass:poisoners-guild:twin-fang", "subclass:poisoners-guild:poison-compendium");
    const twin = (target: Combatant, tokens: number) =>
      ok(go(toxic, "poison", [], { actor: actor(tokens), targets: [target], holdings: h, optionals: ["twin-fang"], options: { poison: ["ghost-petal"], "second-poison": ["gorgon-root"] } }));
    const hit = twin(marked("a"), 2);
    expect(hit.actor.after.cardTokens).toBe(0);
    expect(ofKind(hit, "condition").map((c) => c.condition)).toEqual([
      { kind: "standard", condition: "vulnerable" },
      { kind: "standard", condition: "restrained" },
    ]);
    // Not Marked: only the first poison.
    const plain = twin(adv("b"), 2);
    expect(plain.actor.after.cardTokens).toBe(1);
    expect(ofKind(plain, "condition")).toHaveLength(1);
    // Without Twin Fang there is no second poison.
    const without = ok(go(toxic, "poison", [], { actor: actor(2), targets: [marked("a")], optionals: ["twin-fang"], options: { poison: ["ghost-petal"], "second-poison": ["grave-spore"] } }));
    expect(without.actor.after.cardTokens).toBe(1);
  });

  it("a long rest clears every unspent token", () => {
    const plan = ok(go(toxic, "long-rest", [], { actor: actor(4) }));
    expect(useOf(toxic, "long-rest").activation).toEqual({ kind: "auto", trigger: { kind: "timing", at: "afterLongRest" } });
    expect(ofKind(plan, "tokens")).toEqual([{ kind: "tokens", op: "clear", before: 4, after: 0 }]);
  });
});

describe("upgrade-only features carry no mods of their own", () => {
  it.each([
    ["subclass:executioners-guild:ambush", "class:assassin:marked-for-death"],
    ["subclass:executioners-guild:backstab", "class:assassin:marked-for-death"],
    ["subclass:poisoners-guild:poison-compendium", "subclass:poisoners-guild:toxic-concoctions"],
    ["subclass:poisoners-guild:twin-fang", "subclass:poisoners-guild:toxic-concoctions"],
    ["subclass:poisoners-guild:venomancer", "subclass:poisoners-guild:toxic-concoctions"],
    ["subclass:martial-artist:flow-state", "class:brawler:combo-strike"],
    ["subclass:martial-artist:flow-state", "subclass:martial-artist:stance-fighter"],
  ])("%s upgrades %s", (feature, target) => {
    const e = effectOf(feature);
    expect(e.uses).toEqual([{ id: "main", name: e.uses[0]!.name, activation: { kind: "passive" }, steps: [] }]);
    expect(effectOf(target).upgrades?.some((u) => u.when.kind === "feature" && u.when.featureId === feature)).toBe(true);
  });
});

// ---------------------------------------------------------------- Brawler

describe("Square Up (HF p.10): 3 Hope, a target within Close is temporarily Vulnerable", () => {
  it("pays 3 Hope and makes the target Vulnerable", () => {
    const plan = ok(go("hope:brawler", undefined, [], { actor: actorOf(juggernaut, { hope: 3 }), targets: [adv("a")] }));
    expect(useOf("hope:brawler").targets).toEqual({ side: "enemy", range: "close", count: { kind: "one" } });
    expect(plan.actor.after.hope).toBe(0);
    expect(after(plan, "a")?.conditions).toEqual(["vulnerable"]);
    expect(go("hope:brawler", undefined, [], { actor: actorOf(juggernaut, { hope: 2 }), targets: [adv("a")] })).toMatchObject({ ok: false, reason: "cost" });
  });
});

describe("I Am the Weapon (HF p.10)", () => {
  it("D5's Brawler's Strike override is the record: d8+d6 using Proficiency and +1 Evasion; the entry adds no mods", () => {
    expect(brawlersStrike(2)).toMatchObject({ dice: [{ count: 2, sides: 8 }, { count: 2, sides: 6 }], evasionBonus: 1 });
    expect(useOf("class:brawler:i-am-the-weapon")).toEqual({ id: "main", name: "I Am the Weapon", activation: { kind: "passive" }, steps: [] });
  });
});

describe("Combo Strike (HF p.10): delegated to D5", () => {
  it("marks a Stress and rolls the Combo Die chain on the damage roll (d4: 2, 3, 1 stops: +6)", () => {
    const sheet = { ...juggernaut, stress: 1 };
    const result = go("class:brawler:combo-strike", undefined, [2, 3, 1], { actor: actorOf(sheet), sheet, delegateRoll: damageRoll, options: { cost: ["stress"] } });
    const plan = ok(result);
    expect(useOf("class:brawler:combo-strike").activation).toEqual({ kind: "rider", trigger: { kind: "whenYouAttack", result: "success", weapon: true, weaponRange: "melee" } });
    expect(plan.actor.after.stress).toBe(2);
    expect(ofKind(plan, "delegate")).toEqual([expect.objectContaining({ feature: "comboStrike", done: true })]);
    expect(result.ok && result.rolls[0]?.total).toBe(14);
  });

  it("without the damage roll D5 refuses; with full Stress the Stress is not paid and nothing runs", () => {
    expect(go("class:brawler:combo-strike", undefined, [], { sheet: juggernaut, options: { cost: ["stress"] } })).toMatchObject({ ok: false, reason: "choice" });
    const full = ok(go("class:brawler:combo-strike", undefined, [], { actor: actorOf(juggernaut, { stress: 6 }), sheet: juggernaut, delegateRoll: damageRoll, options: { cost: ["stress"] } }));
    expect(ofKind(full, "delegate")).toEqual([]);
    expect(ofKind(full, "pay")).toEqual([expect.objectContaining({ paid: false })]);
  });

  it("Flow State (HF p.11): a Focus instead of the Stress", () => {
    const flow = holdingsFor(martial, owned(martial), "brawler");
    const result = go("class:brawler:combo-strike", undefined, [4, 1], { actor: actorOf(martial, { focus: 2 }), sheet: martial, delegateRoll: damageRoll, holdings: flow, options: { cost: ["focus"] } });
    const plan = ok(result);
    expect(plan.actor.after).toMatchObject({ focus: 1, stress: martial.stress });
    expect(result.ok && result.rolls[0]?.total).toBe(13);
    // Without Flow State the Focus option does not exist.
    const plain = ok(go("class:brawler:combo-strike", undefined, [], { actor: actorOf(juggernaut, { focus: 2 }), sheet: juggernaut, delegateRoll: damageRoll, holdings: none(), options: { cost: ["focus"] } }));
    expect(ofKind(plain, "delegate")).toEqual([]);
    expect(plain.actor.after.focus).toBe(2);
  });
});

describe("Juggernaut (HF p.10)", () => {
  it("Rugged: +3 Severe threshold", () => {
    expect(useOf("subclass:juggernaut:rugged").mods).toEqual([{ kind: "stat", stat: "severeThreshold", delta: { kind: "fixed", value: 3 } }]);
  });

  it("Overwhelm: a Hope to throw the target within Close or make it mark a Stress", () => {
    const thrown = ok(go("subclass:juggernaut:overwhelm", undefined, [], { actor: actorOf(juggernaut, { hope: 1 }), targets: [adv("a")], options: { overwhelm: ["throw"] } }));
    expect(thrown.actor.after.hope).toBe(0);
    expect(ofKind(thrown, "prompt")).toEqual([expect.objectContaining({ prompt: "move", text: "Throw the target within Close range", targetIds: ["a"] })]);
    const stressed = ok(go("subclass:juggernaut:overwhelm", undefined, [], { actor: actorOf(juggernaut, { hope: 1 }), targets: [adv("a")], options: { overwhelm: ["stress"] } }));
    expect(after(stressed, "a")?.stress).toBe(1);
    expect(go("subclass:juggernaut:overwhelm", undefined, [], { actor: actorOf(juggernaut, { hope: 0 }), targets: [adv("a")] })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Surrounded: any number of Hope for that many extra targets in Melee (NV18), with a Melee weapon", () => {
    const melee = ["You make this attack with a Melee weapon"];
    const plan = ok(go("subclass:juggernaut:surrounded", undefined, [], { actor: actorOf(juggernaut, { hope: 3 }), choices: { hope: 2 }, situations: melee }));
    expect(plan.actor.after.hope).toBe(1);
    expect(fold(plan)).toEqual([expect.objectContaining({ step: expect.objectContaining({ kind: "addTargets", targets: expect.objectContaining({ range: "melee" }) }), amount: 2 })]);
    expect(go("subclass:juggernaut:surrounded", undefined, [], { actor: actorOf(juggernaut, { hope: 3 }), choices: { hope: 4 }, situations: melee })).toMatchObject({ ok: false, reason: "cost" });
    expect(go("subclass:juggernaut:surrounded", undefined, [], { actor: actorOf(juggernaut, { hope: 3 }), choices: { hope: 1 } })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Eye for an Eye: once per rest, a Stress makes the adversary in Melee mark the same HP", () => {
    const plan = ok(go("subclass:juggernaut:eye-for-an-eye", undefined, [], { actor: actorOf(juggernaut), trigger: { amount: 2, source: adv("ogre", { hp: 1 }) } }));
    expect(useOf("subclass:juggernaut:eye-for-an-eye").activation).toEqual({ kind: "reaction", trigger: { kind: "whenYouMarkHp", sourceWithin: "melee" } });
    expect(plan.actor.after.stress).toBe(juggernaut.stress + 1);
    expect(after(plan, "ogre")?.hp).toBe(3);
    expect(plan.limit).toMatchObject({ until: "rest", consumed: true });
  });

  it("Pummeljoy: a Melee weapon critical gives another Hope, clears another Stress and +1 Proficiency", () => {
    const plan = ok(go("subclass:juggernaut:pummeljoy", undefined, [], { actor: actorOf(juggernaut, { hope: 2, stress: 2 }), targets: [adv("a")] }));
    expect(useOf("subclass:juggernaut:pummeljoy").activation).toEqual({ kind: "auto", trigger: { kind: "whenYouAttack", result: "critical", weapon: true, weaponRange: "melee" } });
    expect(plan.actor.after).toMatchObject({ hope: 3, stress: 1 });
    expect(fold(plan)).toEqual([expect.objectContaining({ step: expect.objectContaining({ change: { kind: "proficiency", delta: 1 } }), amount: 1 })]);
  });

  it("Not Done Yet: Severe damage taken, gain a Hope or clear a Stress", () => {
    const hope = ok(go("subclass:juggernaut:not-done-yet", undefined, [], { actor: actorOf(juggernaut, { hope: 1, stress: 2 }), options: { "not-done-yet": ["hope"] } }));
    expect(hope.actor.after).toMatchObject({ hope: 2, stress: 2 });
    const stress = ok(go("subclass:juggernaut:not-done-yet", undefined, [], { actor: actorOf(juggernaut, { hope: 1, stress: 2 }), options: { "not-done-yet": ["stress"] } }));
    expect(stress.actor.after).toMatchObject({ hope: 1, stress: 1 });
  });
});

describe("Martial Artist (HF p.11-12)", () => {
  it("Stance Fighter: shifting costs a Focus (a Stress with Flow State); the stance itself is SD3's shiftStance", () => {
    const plain = ok(go("subclass:martial-artist:stance-fighter", "shift", [], { actor: actorOf(martial, { focus: 3 }), holdings: none(), options: { cost: ["focus"] } }));
    expect(plain.actor.after.focus).toBe(2);
    expect(ofKind(plain, "prompt")).toEqual([expect.objectContaining({ prompt: "manual" })]);
    const flow = holdingsFor(martial, owned(martial), "martial-artist");
    const stress = ok(go("subclass:martial-artist:stance-fighter", "shift", [], { actor: actorOf(martial, { focus: 0 }), holdings: flow, options: { cost: ["stress"] } }));
    expect(stress.actor.after).toMatchObject({ focus: 0, stress: martial.stress + 1 });
    // No Focus and no Flow State: the payment fails and nothing shifts.
    const broke = ok(go("subclass:martial-artist:stance-fighter", "shift", [], { actor: actorOf(martial, { focus: 0 }), holdings: none(), options: { cost: ["focus"] } }));
    expect(ofKind(broke, "prompt")).toEqual([]);
  });

  it("Keen Defenses: targeted by an attack, a Focus for + tier Evasion against it (Q2)", () => {
    const plan = ok(go("subclass:martial-artist:keen-defenses", undefined, [], { actor: actorOf(martial, { focus: 1, tier: 3 }) }));
    expect(useOf("subclass:martial-artist:keen-defenses").activation).toEqual({ kind: "reaction", trigger: { kind: "whenAttacked", stage: "targeted" } });
    expect(plan.actor.after.focus).toBe(0);
    expect(fold(plan)).toEqual([expect.objectContaining({ step: expect.objectContaining({ change: expect.objectContaining({ kind: "evasion" }) }), amount: 3 })]);
    expect(go("subclass:martial-artist:keen-defenses", undefined, [], { actor: actorOf(martial, { focus: 0 }) })).toMatchObject({ ok: false, reason: "cost" });
  });

  it("Focus Cannon: a Focus, an Instinct Roll against an adversary within Far, d20+3 magic using Proficiency", () => {
    const actor = actorOf(martial, { focus: 1, proficiency: 2, traits: { ...martial.traits, instinct: 2 } });
    // Hope 7, Fear 4: 7 + 4 + 2 = 13 against Difficulty 12, a hit with Hope. Damage 2d20+3 = 10 + 5 + 3 = 18 magic: Severe (14).
    const plan = ok(go("subclass:martial-artist:focus-cannon", undefined, [7, 4, 10, 5], { actor, targets: [adv("a")] }));
    expect(plan.actor.after.focus).toBe(0);
    expect(plan.roll?.withHope).toBe(true);
    expect(ofKind(plan, "damageRoll")[0]).toMatchObject({ type: "magic", record: { total: 18 } });
    expect(ofKind(plan, "damage")[0]?.result).toMatchObject({ severity: "severe", hpMarked: 3 });
    // A miss: 2 + 3 + 2 = 7, no damage dice.
    const miss = ok(go("subclass:martial-artist:focus-cannon", undefined, [2, 3], { actor, targets: [adv("a")] }));
    expect(ofKind(miss, "damageRoll")).toEqual([]);
    expect(go("subclass:martial-artist:focus-cannon", undefined, [], { actor: actorOf(martial, { focus: 0 }), targets: [adv("a")] })).toMatchObject({ ok: false, reason: "cost" });
  });
});
