import { describe, expect, it } from "vitest";

import { matchesTrigger, passiveSummary, triggeredUses, type AdversaryState } from "@/lib/domain/adversary-actions";
import { run, runStandardAttack, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext } from "@/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryFeatureUse } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { hordeDamage } from "@/lib/domain/adversaries";
import { queueRng } from "@/lib/domain/dice";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryEffects, adversaryGroup } from "@/lib/srd/adversary-effects";
import { T1_HF_EFFECTS } from "@/lib/srd/adversary-effects/t1-hf";
import type { AdversaryDef } from "@/lib/srd/types";

// Plan combat-actions, tracer AE-t1-hf: every feature of the 35 tier 1 Hope & Fear adversaries (HF p.62-69, p.143) runs
// through the adversary runner (AA1) with fixed dice. Expected numbers are worked out by hand from the feature text and
// the stat block (ATK, damage). RNG order (TASK-CA-AA1): the d20(s), then damage dice and checks in step order, then
// prompt numbers (summon counts, countdown starts). Every PC target has Evasion 12 unless noted.

const GROUP: readonly AdversaryDef[] = ADVERSARIES.filter((a) => adversaryGroup(a) === "t1-hf");

function def(id: string): AdversaryDef {
  const found = GROUP.find((a) => a.id === id);
  if (!found) throw new Error(`No tier 1 Hope & Fear adversary ${id}`);
  return found;
}

function entry(adversaryId: string, feature: string): AdversaryFeatureEffect {
  const found = T1_HF_EFFECTS.find((e) => e.adversaryId === adversaryId && e.feature === feature);
  if (!found) throw new Error(`No entry for ${adversaryId}/${feature}`);
  return found;
}

const use = (adversaryId: string, feature: string, useId = "main"): AdversaryFeatureUse => {
  const found = entry(adversaryId, feature).uses.find((u) => u.id === useId);
  if (!found) throw new Error(`No use ${useId} on ${adversaryId}/${feature}`);
  return found;
};

/** The instance of an SRD adversary, unhurt. */
const inst = (adversaryId: string, over: Partial<Combatant> = {}): Combatant => {
  const d = def(adversaryId);
  return {
    id: `${adversaryId}-1`,
    side: "adversary",
    difficulty: d.difficulty,
    thresholds: d.thresholds,
    hp: 0,
    hpMax: d.hp,
    stress: 0,
    stressMax: d.stress ?? 0,
    defeated: false,
    conditions: [],
    ...over,
  };
};

const pc = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "pc",
  evasion: 12,
  thresholds: { major: 7, severe: 14 },
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

const mira = pc("mira");
const bram = pc("bram", { evasion: 16 });

const ctx = (adversaryId: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunContext => {
  const d = def(adversaryId);
  return {
    adversaryId,
    self: inst(adversaryId),
    attack: d.attack,
    tier: 1,
    gmFear: 5,
    spotlit: true,
    fearConfirmed: true,
    targets: [],
    rng: queueRng(dice),
    ...over,
  };
};

/** Runs one use and checks every queued die was used. */
function ok(adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryPlan {
  const context = ctx(adversaryId, dice, over);
  const result = run(entry(adversaryId, feature), context);
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  (context.rng as ReturnType<typeof queueRng>).done();
  return result.plan;
}

const refusal = (adversaryId: string, feature: string, over: Partial<AdversaryRunContext> = {}) => run(entry(adversaryId, feature), ctx(adversaryId, [], over));

const ofKind = <K extends AdversaryPlanStep["kind"]>(plan: AdversaryPlan, kind: K) => plan.steps.filter((s): s is Extract<AdversaryPlanStep, { kind: K }> => s.kind === kind);
const prompts = (plan: AdversaryPlan, prompt: string) => ofKind(plan, "prompt").filter((p) => p.prompt === prompt);
const folds = (plan: AdversaryPlan) => ofKind(plan, "fold").map((f) => [f.step.kind, f.targetIds, f.amount]);
const after = (plan: AdversaryPlan, id: string) => plan.creatures.find((c) => c.id === id)?.after;

const state = (adversaryId: string, over: Partial<AdversaryState> = {}): AdversaryState => {
  const d = def(adversaryId);
  return { hp: 0, hpMax: d.hp, stress: 0, stressMax: d.stress ?? 0, conditions: [], tokens: 0, ...over };
};
const summary = (adversaryId: string, over: Partial<AdversaryState> = {}, dice: number[] = []) =>
  passiveSummary(adversaryEffects(adversaryId), state(adversaryId, over), 1, dice.length > 0 ? queueRng(dice) : undefined);

const fearOf = (costs: readonly AdversaryCost[] | undefined) => (costs ?? []).filter((c) => c.kind === "fear").reduce((n, c) => n + (c.amount.kind === "fixed" ? c.amount.value : 0), 0);
const stressOf = (costs: readonly AdversaryCost[] | undefined) => (costs ?? []).filter((c) => c.kind === "stress").reduce((n, c) => n + (c.amount.kind === "fixed" ? c.amount.value : 0), 0);

// ---------------------------------------------------------------- the table as a whole (Q15)

describe("the tier 1 Hope & Fear table", () => {
  it("covers the 35 adversaries and 103 features of the group (AA0 counts)", () => {
    expect(GROUP).toHaveLength(35);
    expect(GROUP.reduce((n, a) => n + a.features.length, 0)).toBe(103);
  });

  it("has exactly one entry per printed feature and nothing else", () => {
    const printed = GROUP.flatMap((a) => a.features.map((x) => `${a.id}/${x.name}`)).sort();
    const entries = T1_HF_EFFECTS.map((e) => `${e.adversaryId}/${e.feature}`).sort();
    expect(entries).toEqual(printed);
    expect(new Set(entries).size).toBe(entries.length);
  });

  it("is what the registry serves for these adversaries", () => {
    for (const a of GROUP) expect(adversaryEffects(a.id).map((e) => e.feature)).toEqual(a.features.map((x) => x.name));
  });

  it("gives every use a unique id; actions need the spotlight, the rest don't (CB p.194)", () => {
    for (const e of T1_HF_EFFECTS) {
      expect(new Set(e.uses.map((u) => u.id)).size, e.feature).toBe(e.uses.length);
      for (const u of e.uses) expect(u.needsSpotlight, `${e.adversaryId}/${e.feature}:${u.id}`).toBe(u.activation.kind === "action");
    }
  });

  it("charges the printed Fear cost and nothing more (CB p.194)", () => {
    for (const a of GROUP) {
      for (const x of a.features) {
        const fears = entry(a.id, x.name).uses.map((u) => fearOf(u.costs));
        if (x.fearCost) expect(fears, `${a.id}/${x.name}`).toContain(x.fearCost);
        for (const n of fears) expect([0, x.fearCost ?? 0], `${a.id}/${x.name}`).toContain(n);
      }
    }
  });

  it("charges the adversary's Stress where the text says 'mark a Stress to' (CB p.194)", () => {
    for (const a of GROUP) {
      for (const x of a.features) {
        const marks = /(^|\. |you can )mark a Stress to/i.test(x.text);
        const charged = entry(a.id, x.name).uses.some((u) => stressOf(u.costs) > 0);
        expect(charged, `${a.id}/${x.name}`).toBe(marks);
      }
    }
  });

  it("asks before spending Fear on every Fear feature (Q19), and refuses an action without the spotlight", () => {
    for (const e of T1_HF_EFFECTS) {
      for (const u of e.uses) {
        if (u.requires?.length) continue;
        const context = { useId: u.id, targets: [mira], trigger: { source: mira, subject: mira, amount: 1 }, self: inst(e.adversaryId, { hp: 1, stress: 0 }) };
        if (fearOf(u.costs) > 0) {
          expect(refusal(e.adversaryId, e.feature, { ...context, fearConfirmed: false }), `${e.feature}:${u.id}`).toMatchObject({ ok: false, reason: "confirmFear", detail: String(fearOf(u.costs)) });
          expect(refusal(e.adversaryId, e.feature, { ...context, gmFear: 0 }), `${e.feature}:${u.id}`).toMatchObject({ ok: false, reason: "cost", code: "NOT_ENOUGH_FEAR" });
        }
        if (u.needsSpotlight) {
          expect(refusal(e.adversaryId, e.feature, { ...context, spotlit: false }), `${e.feature}:${u.id}`).toMatchObject({ ok: false, reason: "spotlight", code: "ADVERSARY_NOT_SPOTLIT" });
        }
      }
    }
  });
});

// ---------------------------------------------------------------- the shared shapes

describe("Relentless, Minion, Horde and Group Attack", () => {
  it("Relentless (X) is X spotlights per GM turn (CB p.195)", () => {
    expect(summary("darkweave-queen").relentless).toBe(3);
    expect(summary("mountain-troll").relentless).toBe(3);
    expect(summary("rugaru").relentless).toBe(3);
    expect(summary("soul-shattered-mage").relentless).toBe(3);
    expect(summary("waxwork-creation").relentless).toBe(2);
  });

  it("Minion (X) (CB p.201)", () => {
    expect(summary("darkweave-crawler").minion).toBe(3);
    expect(summary("redcap-skinner").minion).toBe(4);
    expect(summary("viper").minion).toBe(4);
  });

  it("Horde (X): the standard attack deals X once half the HP is marked (CB p.199)", () => {
    expect(summary("darkweave-swarmlings").horde).toBe("1d4");
    expect(summary("grimmling-warband").horde).toBe("1d4+1");
    expect(summary("rabble-mawb").horde).toBe("1d4+1");
    expect(summary("redcap-biters").horde).toBe("1d4+2");
    // Swarmlings at 4 of 8 HP: Nibble 1d8 becomes 1d4. d20 12 + ATK 0 hits Evasion 12; the d4 rolls 3.
    const swarm = runStandardAttack(ctx("darkweave-swarmlings", [12, 3], { self: inst("darkweave-swarmlings", { hp: 4 }), targets: [mira], passives: summary("darkweave-swarmlings", { hp: 4 }) }));
    expect(swarm).toMatchObject({ ok: true, plan: { incoming: [{ targetId: "mira", amount: 3, type: "physical" }] } });
    // Will-o'-the-Wisps: Horde (1d4−1) magic. The entry holds 1d4 + (−1); the server passes `hordeDamage(def)`.
    expect(use("will-o-the-wisps", "Horde (1d4−1)").modifiers).toEqual([{ kind: "horde", damage: { kind: "dice", dice: { count: { kind: "fixed", value: 1 }, sides: 4, plus: { kind: "fixed", value: -1 } } } }]);
    const wisps = runStandardAttack(ctx("will-o-the-wisps", [15, 3], { self: inst("will-o-the-wisps", { hp: 2 }), targets: [mira], hordeX: hordeDamage(def("will-o-the-wisps")) }));
    expect(wisps).toMatchObject({ ok: true, plan: { incoming: [{ targetId: "mira", amount: 2, type: "magic" }] } });
  });

  it("Group Attack: one shared roll, X per Minion, combined (CB p.201)", () => {
    // Crawlers: d20 14 − 2 = 12 hits; 2 damage x 4 Crawlers = 8.
    const crawlers = ok("darkweave-crawler", "Group Attack", [14], { targets: [mira], group: [inst("darkweave-crawler", { id: "c2" }), inst("darkweave-crawler", { id: "c3" }), inst("darkweave-crawler", { id: "c4" })] });
    expect(crawlers).toMatchObject({ fearSpent: 1, group: ["c2", "c3", "c4"], incoming: [{ targetId: "mira", amount: 8 }] });
    // Common Ruffians are not Minions but use the same shape: 1d8 each, rolled per Ruffian (3 + 5 + 6 = 14).
    const ruffians = ok("common-ruffian", "Group Attack", [15, 3, 5, 6], { targets: [mira], group: [inst("common-ruffian", { id: "r2" }), inst("common-ruffian", { id: "r3" })] });
    expect(ruffians.incoming).toMatchObject([{ targetId: "mira", amount: 14, type: "physical" }]);
    // Skinners: 2 each; Vipers: 1 each.
    expect(ok("redcap-skinner", "Group Attack", [13], { targets: [mira], group: [inst("redcap-skinner", { id: "s2" })] }).incoming[0]!.amount).toBe(4);
    expect(ok("viper", "Group Attack", [9], { targets: [mira], group: [inst("viper", { id: "v2" }), inst("viper", { id: "v3" })] }).incoming[0]!.amount).toBe(3);
    // A miss deals nothing: d20 5 + 3 = 8 < 12.
    expect(ok("viper", "Group Attack", [5], { targets: [mira], group: [inst("viper", { id: "v2" })] }).incoming).toEqual([]);
  });
});

// ---------------------------------------------------------------- per adversary

describe("Ahuizotl (HF p.62)", () => {
  it("Aquatic Attacker: from the water, advantage and +1d6 to its attack", () => {
    expect(summary("ahuizotl").attackDamageAdd).toBe(0);
    const s = summary("ahuizotl", { situations: ["The Ahuizotl attacks from the water"] }, [4]);
    expect(s.attackDamageAdd).toBe(4);
    expect(use("ahuizotl", "Aquatic Attacker").modifiers).toContainEqual({ kind: "mod", mod: { kind: "advantage", on: "attack" } });
    // Advantage: d20s 5 and 14, keep 14 + 2 = 16; Bite 1d6+2 rolls 3, + 4 = 9.
    const plan = runStandardAttack(ctx("ahuizotl", [5, 14, 3], { targets: [mira], passives: s, advantage: 1 }));
    expect(plan).toMatchObject({ ok: true, plan: { incoming: [{ targetId: "mira", amount: 9 }] } });
  });

  it("Tail Swat: a Stress, an attack within Very Close, 1d8+2 physical on a hit", () => {
    const plan = ok("ahuizotl", "Tail Swat", [10, 5], { targets: [mira] });
    expect(plan.self.after.stress).toBe(1);
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: 7, type: "physical", direct: false, forcedArmor: 0, critical: false, attackTotal: 12 }]);
    expect(use("ahuizotl", "Tail Swat").targets).toMatchObject({ range: "veryClose", count: { kind: "one" } });
  });

  it("Drag and Bag: a Fear, no roll, pulled into Melee and temporarily Restrained", () => {
    const plan = ok("ahuizotl", "Drag and Bag", [], { targets: [mira] });
    expect(plan).toMatchObject({ fearSpent: 1, roll: null });
    expect(prompts(plan, "move")[0]).toMatchObject({ targetIds: ["mira"], step: { mode: "pull", range: "melee" } });
    expect(after(plan, "mira")).toMatchObject({ conditions: ["restrained"], tags: ["Bagged"] });
    expect(ofKind(plan, "condition")[0]).toMatchObject({ duration: "temporary" });
    expect(prompts(plan, "manual")).toHaveLength(1);
  });
});

describe("Atototl (HF p.62)", () => {
  it("Wind Lord: attacks against it have disadvantage while it flies", () => {
    expect(refusal("atototl", "Wind Lord", { spotlit: false })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = ok("atototl", "Wind Lord", [], { situations: ["The Atototl is flying"] });
    expect(plan.modifiers).toEqual([{ kind: "mod", mod: { kind: "disadvantageAgainst", on: "attack" } }]);
  });

  it("Stone of Omens: a GM button when a PC searches the remains; a d12 fate roll, the even / odd outcome by hand", () => {
    const plan = ok("atototl", "Stone of Omens", [7]);
    expect(plan).toMatchObject({ activation: "reaction", needsSpotlight: false });
    expect(ofKind(plan, "check")).toMatchObject([{ total: 7, dice: [7], passed: true }]);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Archer's Bane: a Fear, an attack roll against the far attacker; a hit negates the damage and deals it back", () => {
    const u = use("atototl", "Archer’s Bane");
    if (u.activation.kind !== "reaction") throw new Error("reaction");
    expect(matchesTrigger(u.activation.trigger, { kind: "onDamaged", stage: "would", fromAttack: true, attackerBand: "far" })).toBe(true);
    expect(matchesTrigger(u.activation.trigger, { kind: "onDamaged", stage: "would", fromAttack: true, attackerBand: "melee" })).toBe(false);
    // d20 11 + 1 = 12 hits the ranger's Evasion 12; their 6 damage comes back to them.
    const plan = ok("atototl", "Archer’s Bane", [11], { trigger: { amount: 6, source: pc("ranger") } });
    expect(plan.fearSpent).toBe(1);
    expect(folds(plan)).toEqual([["negate", ["atototl-1"], undefined]]);
    expect(plan.incoming).toMatchObject([{ targetId: "ranger", amount: 6 }]);
    // A miss: nothing reflected.
    const miss = ok("atototl", "Archer’s Bane", [3], { trigger: { amount: 6, source: pc("ranger") } });
    expect(miss.incoming).toEqual([]);
    expect(folds(miss)).toEqual([]);
  });
});

describe("Bugboar (HF p.62)", () => {
  it("Surprise!: its first attack before any HP or Stress has advantage and +1d8", () => {
    const first = { situations: ["The Bugboar's first attack in this scene"] };
    expect(summary("bugboar", first, [5]).attackDamageAdd).toBe(5);
    expect(summary("bugboar", { ...first, hp: 1 }).attackDamageAdd).toBe(0);
    expect(summary("bugboar", { ...first, stress: 1 }).attackDamageAdd).toBe(0);
  });

  it("Brutal: after a standard-attack hit, a Stress adds 1d6 to that hit's damage", () => {
    const plan = ok("bugboar", "Brutal", [4], { trigger: { subject: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(folds(plan)).toEqual([["modifyDamage", ["mira"], 4]]);
    const u = use("bugboar", "Brutal");
    if (u.activation.kind !== "reaction") throw new Error("reaction");
    expect(matchesTrigger(u.activation.trigger, { kind: "onHit", attack: "feature" })).toBe(false);
  });

  it("Warheart: a Fear negates a condition about to be imposed", () => {
    const plan = ok("bugboar", "Warheart", []);
    expect(plan.fearSpent).toBe(1);
    expect(folds(plan)).toEqual([["negate", ["bugboar-1"], undefined]]);
    expect(triggeredUses(adversaryEffects("bugboar"), { kind: "wouldGainCondition", condition: { kind: "standard", condition: "restrained" } }, state("bugboar")).map((t) => t.effect.feature)).toEqual(["Warheart"]);
  });
});

describe("Common Ruffian (HF p.62)", () => {
  it("Survival Instinct: at half its HP, a d6: 4+ flees, else the GM gains a Fear", () => {
    const u = use("common-ruffian", "Survival Instinct");
    if (u.activation.kind !== "reaction") throw new Error("reaction");
    expect(matchesTrigger(u.activation.trigger, { kind: "onHpMarked", before: 1, after: 2, hpMax: 4 })).toBe(true);
    expect(matchesTrigger(u.activation.trigger, { kind: "onHpMarked", before: 2, after: 3, hpMax: 4 })).toBe(false);
    const fled = ok("common-ruffian", "Survival Instinct", [4]);
    expect(prompts(fled, "manual")[0]!.text).toMatch(/flees/);
    expect(fled.gmFearDelta).toBe(0);
    const stays = ok("common-ruffian", "Survival Instinct", [3]);
    expect(stays.gmFearDelta).toBe(1);
    expect(prompts(stays, "manual")).toEqual([]);
  });
});

describe("Darkweave Crawler (HF p.63)", () => {
  it("Skin-Crawling: a Fear; every PC within Melee marks a Stress", () => {
    const plan = ok("darkweave-crawler", "Skin-Crawling", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(plan.creatures.map((c) => [c.id, c.after.stress])).toEqual([["mira", 1], ["bram", 1]]);
  });

  it("Darkweave Venom: after a hit, a Stress Exhausts the target until a Strength Roll (9)", () => {
    const plan = ok("darkweave-crawler", "Darkweave Venom", [], { trigger: { subject: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "condition")).toMatchObject([{ targetId: "mira", condition: { kind: "tag", tag: "Exhausted" }, duration: "manual", endsWhen: "they succeed on a Strength Roll (9)" }]);
    expect(prompts(plan, "manual")[0]).toMatchObject({ targetIds: ["mira"] });
    // The Crawler's one Stress slot can't pay twice.
    expect(refusal("darkweave-crawler", "Darkweave Venom", { self: inst("darkweave-crawler", { stress: 1 }), trigger: { subject: mira } })).toMatchObject({ ok: false, reason: "cost", code: "ADVERSARY_FEATURE_UNAVAILABLE" });
  });
});

describe("Darkweave Queen (HF p.63)", () => {
  it("Den Mother: once per scene, 2 Fear to summon up to two Darkweave adversaries, who take the spotlight", () => {
    const plan = ok("darkweave-queen", "Den Mother", []);
    expect(plan.fearSpent).toBe(2);
    expect(ofKind(plan, "summon")).toEqual([{ kind: "summon", label: "Up to two Darkweave adversaries (not Darkweave Queens)", count: 2, range: "close" }]);
    expect(ofKind(plan, "spotlight")).toMatchObject([{ who: "picked" }]);
    expect(refusal("darkweave-queen", "Den Mother", { featureUses: plan.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Quicker Than She Looks: a Fear, a move up to Far, a standard attack with advantage", () => {
    // d20s 5 and 10, keep 10 + 3 = 13; Spider Bite 1d12+4 rolls 8 = 12.
    const plan = ok("darkweave-queen", "Quicker Than She Looks", [5, 10, 8], { targets: [mira] });
    expect(plan.roll!.record.total).toBe(13);
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 12, type: "physical" }]);
    expect(prompts(plan, "move")[0]).toMatchObject({ targetIds: ["darkweave-queen-1"] });
  });

  it("Darkfang Envenomation: a Fear makes the hit target Vulnerable and Restrained until a Strength Roll (12) or a rest", () => {
    const plan = ok("darkweave-queen", "Darkfang Envenomation", [], { trigger: { subject: mira } });
    expect(plan.fearSpent).toBe(1);
    expect(after(plan, "mira")!.conditions).toEqual(["vulnerable", "restrained"]);
    expect(ofKind(plan, "condition").every((c) => c.endsWhen === "they succeed on a Strength Roll (12) or take a rest")).toBe(true);
  });

  it("Terrifying: a PC's failed attack against her gains a Fear, automatically", () => {
    const plan = ok("darkweave-queen", "Terrifying", []);
    expect(plan).toMatchObject({ activation: "auto", gmFearDelta: 1 });
    expect(triggeredUses(adversaryEffects("darkweave-queen"), { kind: "onAttacked", stage: "failed" }, state("darkweave-queen"))).toMatchObject([{ mode: "auto", effect: { feature: "Terrifying" } }]);
  });
});

describe("Darkweave Spinner (HF p.63)", () => {
  it("Wrap in Shadow-Silk: a Stress, a Melee attack; a hit is Vulnerable and Restrained until a Strength Roll (10)", () => {
    const plan = ok("darkweave-spinner", "Wrap in Shadow-Silk", [11], { targets: [mira] });
    expect(plan.self.after.stress).toBe(1);
    expect(after(plan, "mira")!.conditions).toEqual(["vulnerable", "restrained"]);
    expect(ok("darkweave-spinner", "Wrap in Shadow-Silk", [10], { targets: [mira] }).creatures).toEqual([]); // 11 < 12
  });

  it("Shadow Fang: after a Melee hit, a Fear makes the target Shaky until an Instinct Roll (10)", () => {
    const u = use("darkweave-spinner", "Shadow Fang");
    if (u.activation.kind !== "reaction") throw new Error("reaction");
    expect(matchesTrigger(u.activation.trigger, { kind: "onHit", attack: "feature", band: "melee" })).toBe(true);
    expect(matchesTrigger(u.activation.trigger, { kind: "onHit", attack: "standard", band: "close" })).toBe(false);
    const plan = ok("darkweave-spinner", "Shadow Fang", [], { trigger: { subject: mira } });
    expect(after(plan, "mira")!.tags).toEqual(["Shaky"]);
    expect(plan.fearSpent).toBe(1);
  });
});

describe("Darkweave Swarmlings (HF p.63)", () => {
  it("Get 'em Off: when its attack makes a target mark HP, a Stress covers them in spiders (temporary)", () => {
    const plan = ok("darkweave-swarmlings", "“Get ’em Off, Get ’em Off!”", [], { trigger: { subject: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "condition")).toMatchObject([{ targetId: "mira", condition: { tag: "Covered in Spiders" }, duration: "temporary" }]);
    expect(triggeredUses(adversaryEffects("darkweave-swarmlings"), { kind: "onTargetMarksHp", attack: "standard" }, state("darkweave-swarmlings"))).toHaveLength(1);
  });
});

describe("Elk (HF p.64)", () => {
  it("Headbutt: after moving from Close or farther, its standard attack deals 1d12+2 instead", () => {
    expect(refusal("elk", "Headbutt", { useId: "headbutt", targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = ok("elk", "Headbutt", [12, 7], { targets: [mira], situations: ["The Elk moved from Close range or farther before this attack"] });
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 9, type: "physical" }]);
  });

  it("Bolt: after marking HP or Stress, a Reaction Roll (10) or it flees", () => {
    const fails = ok("elk", "Bolt", [9], { useId: "hp" });
    expect(ofKind(fails, "save")).toMatchObject([{ targetId: "elk-1", difficulty: 10, success: false }]);
    expect(prompts(fails, "manual")[0]!.text).toMatch(/flees/);
    const holds = ok("elk", "Bolt", [10], { useId: "stress" });
    expect(prompts(holds, "manual")).toEqual([]);
    expect(triggeredUses(adversaryEffects("elk"), { kind: "onMarkStress", last: false }, state("elk"))).toMatchObject([{ mode: "auto", use: { id: "stress" } }]);
  });
});

describe("Falcon (HF p.64)", () => {
  it("Nimble Flyer: +3 Difficulty while flying", () => {
    expect(summary("falcon").difficulty).toBe(0);
    expect(summary("falcon", { situations: ["The Falcon is flying"] }).difficulty).toBe(3);
  });

  it("Dive Bomb: a Stress, a standard attack with +2 to the attack and the damage", () => {
    // d20 8 + 2 ATK + 2 = 12 hits; Talons 1d6+1 rolls 4 = 5, + 2 = 7.
    const plan = ok("falcon", "Dive Bomb", [8, 4], { targets: [mira] });
    expect(plan.roll!.record.total).toBe(12);
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 7 }]);
    expect(plan.self.after.stress).toBe(1);
  });
});

describe("Grimmling Warband (HF p.64)", () => {
  it("Cowardly: at its last Stress or when a Leader ally falls, a d6 of 2 or lower and it flees", () => {
    expect(prompts(ok("grimmling-warband", "Cowardly", [2], { useId: "last-stress" }), "manual")[0]!.text).toMatch(/flees/);
    expect(prompts(ok("grimmling-warband", "Cowardly", [3], { useId: "leader-defeated" }), "manual")).toEqual([]);
    const effects = adversaryEffects("grimmling-warband");
    expect(triggeredUses(effects, { kind: "onMarkStress", last: false }, state("grimmling-warband"))).toEqual([]);
    expect(triggeredUses(effects, { kind: "onMarkStress", last: true }, state("grimmling-warband"))).toHaveLength(1);
    expect(triggeredUses(effects, { kind: "allyDefeated" }, state("grimmling-warband"))).toHaveLength(1);
  });
});

describe("Harpy (HF p.64)", () => {
  it("Toxic Aura: everyone within Very Close range is Vulnerable", () => {
    expect(summary("harpy").auras).toEqual([{ kind: "conditionAura", condition: { kind: "standard", condition: "vulnerable" }, to: "all", within: "veryClose" }]);
  });

  it("Swooping Attack: a Stress, a straight-line move, an attack on a target in its path for 3d6", () => {
    const plan = ok("harpy", "Swooping Attack", [12, 1, 2, 3], { targets: [mira] });
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 6, type: "physical" }]);
    expect(prompts(plan, "move")).toHaveLength(1);
    expect(use("harpy", "Swooping Attack").targets).toMatchObject({ range: "far", area: "path" });
  });
});

describe("Kelpie (HF p.64) and the other 'mark a Stress to move out' passives", () => {
  it("Captivating and Ankle Weights: a PC leaving Melee range marks a Stress, automatically", () => {
    for (const [id, feature] of [["kelpie", "Captivating"], ["redcap-biters", "Ankle Weights"]] as const) {
      const plan = ok(id, feature, [], { trigger: { source: mira } });
      expect(plan.activation).toBe("auto");
      expect(after(plan, "mira")!.stress).toBe(1);
      expect(triggeredUses(adversaryEffects(id), { kind: "pcMoves", outOf: "melee" }, state(id))).toHaveLength(1);
    }
  });

  it("Heart's Desire: story only, shown to the GM", () => {
    expect(prompts(ok("kelpie", "Heart’s Desire", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Shapeshifter: a Stress to change form; the viewers' disadvantage is manual", () => {
    const plan = ok("kelpie", "Shapeshifter", []);
    expect(plan.self.after).toMatchObject({ stress: 1, tags: ["Shapeshifted"] });
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Enchant: a Fear; the PC makes an Instinct Reaction Roll against the Kelpie's Difficulty or is Enchanted", () => {
    const plan = ok("kelpie", "Enchant", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(prompts(plan, "pcSave")).toMatchObject([{ targetIds: ["mira"], step: { trait: "instinct", difficulty: { kind: "actorDifficulty" } } }]);
  });
});

describe("Masque Muerte (HF p.65)", () => {
  it("Libre: can't be Restrained", () => {
    expect(summary("masque-muerte").flags).toEqual(["cannotBeRestrained"]);
  });

  it("Heel Turn: a Stress, an attack within Close; a hit marks a Stress and is temporarily Vulnerable", () => {
    const plan = ok("masque-muerte", "Heel Turn", [8], { targets: [mira] });
    expect(after(plan, "mira")).toMatchObject({ stress: 1, conditions: ["vulnerable"] });
    expect(plan.incoming).toEqual([]);
  });

  it("Spectral Suplex: a Fear, 1d10+6 magic to a Restrained PC, no roll", () => {
    const plan = ok("masque-muerte", "Spectral Suplex", [3], { targets: [pc("mira", { conditions: ["restrained"] })] });
    expect(plan).toMatchObject({ roll: null, fearSpent: 1, incoming: [{ targetId: "mira", amount: 9, type: "magic" }] });
    expect(ok("masque-muerte", "Spectral Suplex", [], { targets: [mira] }).incoming).toEqual([]);
  });

  it("Unmasking Death: a Fear; each PC within Close makes a Presence Reaction Roll or marks a Stress", () => {
    const plan = ok("masque-muerte", "Unmasking Death", [], { targets: [mira, bram] });
    expect(prompts(plan, "pcSave").map((p) => p.targetIds)).toEqual([["mira"], ["bram"]]);
  });

  it("Tag Team: after damaging a PC, a Fear Pins them (Restrained) until a Strength Roll", () => {
    const plan = ok("masque-muerte", "Tag Team", [], { trigger: { subject: mira } });
    expect(after(plan, "mira")).toMatchObject({ tags: ["Pinned"], conditions: ["restrained"] });
    expect(plan.fearSpent).toBe(1);
  });
});

describe("Mechanorb (HF p.65)", () => {
  it("Hive Mind: shown (the vocabulary can't count allies)", () => {
    expect(prompts(ok("mechanorb", "Hive Mind", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Adaptive Tactics: a miss adds a Pool token, tokens add to attacks, Severe damage or a defeat clears them", () => {
    expect(ok("mechanorb", "Adaptive Tactics", [], { useId: "add", tokens: 1 }).self.tokens).toEqual({ before: 1, after: 2 });
    expect(summary("mechanorb", { tokens: 2 }).attackBonus).toBe(2);
    for (const useId of ["clear-severe", "clear-defeated", "clear-ally-defeated"]) {
      expect(ok("mechanorb", "Adaptive Tactics", [], { useId, tokens: 3 }).self.tokens.after).toBe(0);
    }
    const effects = adversaryEffects("mechanorb");
    expect(triggeredUses(effects, { kind: "onMiss", attack: "standard" }, state("mechanorb")).map((t) => t.use.id)).toEqual(["add"]);
    expect(triggeredUses(effects, { kind: "onDamaged", stage: "did", severity: "major" }, state("mechanorb"))).toEqual([]);
    expect(triggeredUses(effects, { kind: "onDamaged", stage: "did", severity: "severe" }, state("mechanorb")).map((t) => t.use.id)).toEqual(["clear-severe"]);
    expect(triggeredUses(effects, { kind: "allyDefeated", allyName: "Mechanorb" }, state("mechanorb")).map((t) => t.use.id)).toEqual(["clear-ally-defeated"]);
    // The Pool bonus reaches its attack: d20 9 + 1 ATK + 2 tokens = 12.
    const attack = runStandardAttack(ctx("mechanorb", [9, 1], { targets: [mira], tokens: 2, passives: summary("mechanorb", { tokens: 2 }) }));
    expect(attack).toMatchObject({ ok: true, plan: { hits: [{ id: "mira", hit: true }] } });
  });
});

describe("Mountain Troll (HF p.65)", () => {
  it("Stolen Armor: at combat start a countdown (one per PC, entered by the GM); each damage is a step lower and ticks it", () => {
    const start = ok("mountain-troll", "Stolen Armor", [], { useId: "start" });
    expect(ofKind(start, "countdown")).toEqual([
      { kind: "countdown", op: "start", label: "Stolen Armor", loop: false, onTrigger: "The Troll evolves (Enraged Mountain Troll).", note: "Start value: the number of PCs" },
    ]);
    const hit = ok("mountain-troll", "Stolen Armor", [], { useId: "reduce" });
    expect(folds(hit)).toEqual([["reduceSeverity", ["mountain-troll-1"], 1]]);
    expect(ofKind(hit, "countdown")).toMatchObject([{ op: "tick", label: "Stolen Armor", amount: 1 }]);
    expect(triggeredUses(adversaryEffects("mountain-troll"), { kind: "onDamaged", stage: "would" }, state("mountain-troll")).map((t) => t.use.id)).toEqual(["reduce"]);
  });

  it("Flail Swipe: a Stress, one roll against everyone in front within Very Close, 2d8+2 to each hit", () => {
    const plan = ok("mountain-troll", "Flail Swipe", [10, 3, 4], { targets: [mira, bram] });
    expect(plan.hits).toEqual([{ id: "mira", hit: true }, { id: "bram", hit: false }]);
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 9 }]);
  });

  it("Enraged Mountain Troll: once a scene, +1 Difficulty and the feature swap by hand", () => {
    const plan = ok("mountain-troll", "Enraged Mountain Troll", []);
    expect(ofKind(plan, "effect")).toMatchObject([{ targetId: "mountain-troll-1", mods: [{ kind: "stat", stat: "difficulty", delta: 1 }], duration: "permanent" }]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Claw Swipe/);
    expect(refusal("mountain-troll", "Enraged Mountain Troll", { featureUses: plan.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Double Swipe: a Fear, two Claw Swipe attacks on one target; two hits combine and cost a Hope", () => {
    // d20 10 + 2 = 12 hits (1d10+3: 5 + 3 = 8); second d20 11 + 2 = 13 hits (6 + 3 = 9): one hit of 17, a Hope lost.
    const both = ok("mountain-troll", "Double Swipe", [10, 5, 11, 6], { targets: [mira], followUp: [mira] });
    expect(both.incoming).toMatchObject([{ targetId: "mira", amount: 17 }]);
    expect(ofKind(both, "hope")).toEqual([{ kind: "hope", targetId: "mira", delta: -1 }]);
    // First misses (3 + 2 = 5), second hits (15 + 2): 4 + 3 = 7 alone, no Hope.
    const one = ok("mountain-troll", "Double Swipe", [3, 15, 4], { targets: [mira], followUp: [mira] });
    expect(one.incoming).toMatchObject([{ targetId: "mira", amount: 7 }]);
    expect(ofKind(one, "hope")).toEqual([]);
    // First hits, second misses: 8 alone, no Hope.
    const first = ok("mountain-troll", "Double Swipe", [10, 5, 2], { targets: [mira], followUp: [mira] });
    expect(first.incoming).toMatchObject([{ targetId: "mira", amount: 8 }]);
    expect(ofKind(first, "hope")).toEqual([]);
  });
});

describe("Octopus (HF p.66)", () => {
  it("Grapple: an attack within Close; a hit is Restrained and Vulnerable until a Strength Roll", () => {
    const plan = ok("octopus", "Grapple", [13], { targets: [mira] });
    expect(after(plan, "mira")!.conditions).toEqual(["restrained", "vulnerable"]);
    expect(plan.self.after.stress).toBe(0);
  });

  it("Squirt Ink: a Stress; the GM picks land or underwater and the area is manual", () => {
    const land = ok("octopus", "Squirt Ink", [], { options: { where: ["land"] } });
    expect(prompts(land, "manual")[0]!.text).toMatch(/Agility Reaction Roll/);
    expect(prompts(ok("octopus", "Squirt Ink", [], { options: { where: ["underwater"] } }), "manual")[0]!.text).toMatch(/line of sight/);
    expect(prompts(ok("octopus", "Squirt Ink", []), "choose")).toHaveLength(1);
  });
});

describe("Panther (HF p.66)", () => {
  it("Shadow Stalker: +2 to its attacks while Hidden", () => {
    expect(summary("panther").attackBonus).toBe(0);
    expect(summary("panther", { conditions: ["hidden"] }).attackBonus).toBe(2);
  });

  it("Pouncing Strike: a Stress, a leap into Melee of a target within Far, 1d12+2", () => {
    const plan = ok("panther", "Pouncing Strike", [10, 6], { targets: [mira] });
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 8 }]);
    expect(prompts(plan, "move")[0]).toMatchObject({ targetIds: ["panther-1"], step: { range: "melee", relativeTo: "target" } });
  });
});

describe("Phantom (HF p.66)", () => {
  it("Incorporeal: resistant to physical damage", () => {
    expect(summary("phantom").resistance).toEqual({ physical: "resistant", magic: "none" });
  });

  it("Fear Aura: a GM button; the PC makes a Presence Reaction Roll (10) or marks a Stress", () => {
    const plan = ok("phantom", "Fear Aura", [], { targets: [mira] });
    expect(prompts(plan, "pcSave")).toMatchObject([{ targetIds: ["mira"], step: { trait: "presence", difficulty: { kind: "fixed", value: 10 } } }]);
  });

  it("Lingering Haunt: a Fear starts a 1d6 countdown at its defeat; Fear rolls tick it; at 0 it returns spotlit", () => {
    const start = ok("phantom", "Lingering Haunt", [4], { useId: "activate", self: inst("phantom", { hp: 2, defeated: true }) });
    expect(start.fearSpent).toBe(1);
    expect(ofKind(start, "countdown")).toMatchObject([{ op: "start", label: "Lingering Haunt", start: 4 }]);
    expect(start.self.after.tags).toEqual(["Lingering Haunt"]);
    const haunting = inst("phantom", { hp: 2, defeated: true, tags: ["Lingering Haunt"] });
    expect(refusal("phantom", "Lingering Haunt", { useId: "tick" })).toMatchObject({ ok: false, reason: "requirement" });
    expect(ofKind(ok("phantom", "Lingering Haunt", [], { useId: "tick", self: haunting }), "countdown")).toMatchObject([{ op: "tick", amount: 1 }]);
    expect(triggeredUses(adversaryEffects("phantom"), { kind: "pcRolls", roll: { kind: "action", success: true, withHope: false, withFear: true } }, state("phantom", { tags: ["Lingering Haunt"] })).map((t) => t.use.id)).toEqual(["tick"]);
    const back = ok("phantom", "Lingering Haunt", [], { useId: "return", self: haunting });
    expect(back.self.after).toMatchObject({ hp: 0, tags: [] });
    expect(ofKind(back, "spotlight")).toMatchObject([{ who: "self" }]);
  });
});

describe("Poltergeist (HF p.66)", () => {
  it("Specter: resistant to physical damage; a Stress to move up to Close through solid objects", () => {
    expect(summary("poltergeist").resistance).toEqual({ physical: "resistant", magic: "none" });
    const move = ok("poltergeist", "Specter", [], { useId: "move" });
    expect(move.self.after.stress).toBe(1);
    expect(prompts(move, "move")).toHaveLength(1);
  });

  it("Possessor: a Stress to possess an object; the next damage destroys it instead", () => {
    expect(ok("poltergeist", "Possessor", []).self.after).toMatchObject({ stress: 1, tags: ["Possessing"] });
    const effects = adversaryEffects("poltergeist");
    expect(triggeredUses(effects, { kind: "onDamaged", stage: "would" }, state("poltergeist"))).toEqual([]);
    expect(triggeredUses(effects, { kind: "onDamaged", stage: "would" }, state("poltergeist", { tags: ["Possessing"] })).map((t) => t.use.id)).toEqual(["expelled"]);
    const expelled = ok("poltergeist", "Possessor", [], { useId: "expelled", self: inst("poltergeist", { tags: ["Possessing"] }) });
    expect(folds(expelled)).toEqual([["negate", ["poltergeist-1"], undefined]]);
    expect(expelled.self.after.tags).toEqual([]);
  });

  it("Ghost Storm: a Fear; each target within Very Close makes an Agility Reaction Roll (half damage on a success)", () => {
    const plan = ok("poltergeist", "Ghost Storm", [], { targets: [mira, bram] });
    expect(prompts(plan, "pcSave")).toHaveLength(2);
    expect(prompts(plan, "pcSave")[0]).toMatchObject({ step: { trait: "agility", difficulty: { kind: "actorDifficulty" }, onSuccess: [{ scale: "half" }] } });
  });
});

describe("Rabble Mawb (HF p.66)", () => {
  it("Come Back Worse: a Fear revives it with all HP and Stress cleared and a lasting +1 per use", () => {
    const plan = ok("rabble-mawb", "Come Back Worse", [], { self: inst("rabble-mawb", { hp: 4, stress: 1, defeated: true }) });
    expect(plan.fearSpent).toBe(1);
    expect(plan.self.after).toMatchObject({ hp: 0, stress: 0 });
    expect(ofKind(plan, "effect")).toMatchObject([{ targetId: "rabble-mawb-1", mods: [{ kind: "stat", stat: "attack", delta: 1 }], duration: "permanent" }]);
  });
});

describe("Redcap Breaker (HF p.67)", () => {
  it("Backbreaker: a Stress, 3d4+10 on a hit; a target who marks HP from it is Restrained until they clear a HP", () => {
    const plan = ok("redcap-breaker", "Backbreaker", [11, 1, 2, 3], { targets: [mira] });
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 16 }]);
    const restrain = ok("redcap-breaker", "Backbreaker", [], { useId: "restrain", trigger: { subject: mira } });
    expect(ofKind(restrain, "condition")).toMatchObject([{ targetId: "mira", condition: { condition: "restrained" }, endsWhen: "they clear a HP" }]);
  });

  it("Kneecapper: after a standard-attack hit, a Fear makes the target temporarily Vulnerable", () => {
    const plan = ok("redcap-breaker", "Kneecapper", [], { trigger: { subject: mira } });
    expect(ofKind(plan, "condition")).toMatchObject([{ targetId: "mira", duration: "temporary" }]);
  });
});

describe("Redcap Butcher (HF p.67)", () => {
  it("Chop Happy: a Stress, one standard attack against up to three targets; a Fear per target who marks HP", () => {
    const cass = pc("cass");
    const plan = ok("redcap-butcher", "Chop Happy", [11, 5], { targets: [mira, bram, cass] });
    expect(plan.incoming.map((h) => [h.targetId, h.amount])).toEqual([["mira", 6], ["cass", 6]]);
    expect(refusal("redcap-butcher", "Chop Happy", { targets: [mira, bram, cass, pc("dax")] })).toMatchObject({ ok: false, reason: "targets" });
    expect(ok("redcap-butcher", "Chop Happy", [], { useId: "fear" }).gmFearDelta).toBe(1);
  });

  it("Knife Thrower: a Stress, a standard attack within Far; with advantage while Hidden", () => {
    expect(ok("redcap-butcher", "Knife Thrower", [11, 5], { targets: [mira] }).incoming).toMatchObject([{ amount: 6 }]);
    expect(refusal("redcap-butcher", "Knife Thrower", { useId: "hidden", targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const hidden = ok("redcap-butcher", "Knife Thrower", [4, 11, 5], { useId: "hidden", targets: [mira], self: inst("redcap-butcher", { conditions: ["hidden"] }) });
    expect(hidden.roll!.record.total).toBe(12);
  });
});

describe("Redcap Candlemaker (HF p.67)", () => {
  it("Hand of Glory: 5 tokens and Hidden when it appears; a token off per HP it marks", () => {
    const appear = ok("redcap-candlemaker", "Hand of Glory", [], { useId: "appear" });
    expect(appear.self.tokens).toEqual({ before: 0, after: 5 });
    expect(appear.self.after.conditions).toEqual(["hidden"]);
    const burn = ok("redcap-candlemaker", "Hand of Glory", [], { useId: "burn", tokens: 5, trigger: { amount: 2 } });
    expect(burn.self.tokens).toEqual({ before: 5, after: 3 });
    expect(triggeredUses(adversaryEffects("redcap-candlemaker"), { kind: "onMarkHp", stage: "did", amount: 1, last: false }, state("redcap-candlemaker"))).toEqual([]);
  });

  it("Torchbearer: while it has tokens, Redcap allies within Close get +1 damage", () => {
    expect(summary("redcap-candlemaker").auras).toEqual([]);
    expect(summary("redcap-candlemaker", { tokens: 1 }).auras).toEqual([{ kind: "mod", mod: { kind: "stat", stat: "damage", delta: { kind: "fixed", value: 1 } }, to: "allies", within: "close" }]);
  });

  it("Dance in the Flames: spends a token; a group within Far makes Agility Reaction Rolls (2d10 magic, half on a success)", () => {
    expect(refusal("redcap-candlemaker", "Dance in the Flames", { targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = ok("redcap-candlemaker", "Dance in the Flames", [], { tokens: 2, targets: [mira, bram] });
    expect(plan.self.tokens).toEqual({ before: 2, after: 1 });
    expect(prompts(plan, "pcSave")).toHaveLength(2);
  });
});

describe("Redcap Skinner (HF p.67)", () => {
  it("Shallow Cuts: a PC's failed roll is a GM prompt (1 damage per Skinner in Melee, combined, by hand)", () => {
    const plan = ok("redcap-skinner", "Shallow Cuts", [], { trigger: { source: mira } });
    expect(prompts(plan, "manual")[0]).toMatchObject({ targetIds: ["mira"] });
    const fail = { kind: "pcRolls" as const, roll: { kind: "action" as const, success: false, withHope: true, withFear: false } };
    expect(triggeredUses(adversaryEffects("redcap-skinner"), fail, state("redcap-skinner"))).toHaveLength(1);
  });
});

describe("Rugaru (HF p.68)", () => {
  it("Child of Night: +2 Difficulty in moonlight", () => {
    expect(summary("rugaru", { situations: ["The Rugaru is in moonlight"] }).difficulty).toBe(2);
  });

  it("Bloodthirsty: a token per PC marking HP from its standard attack, +1 attack per token, cleared by Severe damage", () => {
    expect(ok("rugaru", "Bloodthirsty", [], { useId: "add" }).self.tokens.after).toBe(1);
    expect(summary("rugaru", { tokens: 3 }).attackBonus).toBe(3);
    expect(ok("rugaru", "Bloodthirsty", [], { useId: "clear", tokens: 3 }).self.tokens.after).toBe(0);
    expect(triggeredUses(adversaryEffects("rugaru"), { kind: "onTargetMarksHp", attack: "feature" }, state("rugaru"))).toEqual([]);
  });

  it("Howl at the Moon: a Stress; each PC within Far makes a Presence Reaction Roll (15) or loses a Hope (a Fear for each)", () => {
    const plan = ok("rugaru", "Howl at the Moon", [], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    expect(prompts(plan, "pcSave")[0]).toMatchObject({ step: { trait: "presence", difficulty: { kind: "fixed", value: 15 } } });
  });

  it("Flesh Ripper: a Stress, 1d12+2 direct physical on a Melee hit", () => {
    const plan = ok("rugaru", "Flesh Ripper", [8, 5], { targets: [mira] });
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 7, direct: true }]);
  });
});

describe("Sawtoothed Gillbeast (HF p.68)", () => {
  it("Ka-Chomp: a Stress, 1d12 and a forced Armor Slot without its benefit", () => {
    const plan = ok("sawtoothed-gillbeast", "Ka-Chomp", [11, 6], { targets: [mira] });
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: 6, type: "physical", direct: false, forcedArmor: 1, critical: false, attackTotal: 12 }]);
  });

  it("Feeding Frenzy: a Fear when a creature marks HP spotlights the Gillbeasts within Very Close of them", () => {
    const plan = ok("sawtoothed-gillbeast", "Feeding Frenzy", [], { useId: "pc", trigger: { subject: mira } });
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "spotlight")).toEqual([{ kind: "spotlight", who: "sameName", name: "Sawtoothed Gillbeast", within: "veryClose" }]);
    expect(prompts(plan, "manual")[0]).toMatchObject({ targetIds: ["mira"] });
    const effects = adversaryEffects("sawtoothed-gillbeast");
    expect(triggeredUses(effects, { kind: "pcMarksHp" }, state("sawtoothed-gillbeast")).map((t) => t.use.id)).toEqual(["pc"]);
    expect(triggeredUses(effects, { kind: "allyMarksHp" }, state("sawtoothed-gillbeast")).map((t) => t.use.id)).toEqual(["ally"]);
  });

  it("Scaly: before it marks HP, a d6; on a 6 it marks a Stress instead", () => {
    expect(folds(ok("sawtoothed-gillbeast", "Scaly", [6]))).toEqual([["convertMarks", ["sawtoothed-gillbeast-1"], undefined]]);
    expect(folds(ok("sawtoothed-gillbeast", "Scaly", [5]))).toEqual([]);
  });
});

describe("Soul-Shattered Mage (HF p.68)", () => {
  it("Broken Magic: a Stress; the GM picks the move the d6 shows", () => {
    expect(prompts(ok("soul-shattered-mage", "Broken Magic", []), "choose")).toHaveLength(1);
    // 1–2 Dimension Rift: teleport and 2d6 direct magic (3 + 4).
    const rift = ok("soul-shattered-mage", "Broken Magic", [3, 4], { options: { move: ["dimension-rift"] }, followUp: [mira] });
    expect(rift.incoming).toMatchObject([{ targetId: "mira", amount: 7, type: "magic", direct: true }]);
    expect(prompts(rift, "move")[0]).toMatchObject({ step: { mode: "teleport" } });
    // 3–4 Time Dilation: the group is Slowed (Vulnerable) until they roll with Hope.
    const slow = ok("soul-shattered-mage", "Broken Magic", [], { options: { move: ["time-dilation"] }, followUp: [mira, bram] });
    expect(slow.creatures.map((c) => [c.id, c.after.tags, c.after.conditions])).toEqual([["mira", ["Slowed"], ["vulnerable"]], ["bram", ["Slowed"], ["vulnerable"]]]);
    // 5–6 Discordant Visions: d20 10 + 2 = 12 hits Mira only; 2d8 direct magic (3 + 4).
    const visions = ok("soul-shattered-mage", "Broken Magic", [10, 3, 4], { options: { move: ["discordant-visions"] }, followUp: [mira, bram] });
    expect(visions.incoming).toMatchObject([{ targetId: "mira", amount: 7, direct: true }]);
    expect(visions.self.after.stress).toBe(1);
  });

  it("Feel My Pain: when it marks HP, d6s equal to its marked Stress as direct magic to every PC within Very Close", () => {
    const plan = ok("soul-shattered-mage", "Feel My Pain", [3, 5], { self: inst("soul-shattered-mage", { stress: 2, hp: 1 }), targets: [mira, bram] });
    expect(plan.incoming.map((h) => [h.targetId, h.amount, h.type, h.direct])).toEqual([["mira", 8, "magic", true], ["bram", 8, "magic", true]]);
  });
});

describe("Spellbound Armor (HF p.68)", () => {
  it("Tireless: shown (no modifier for immunity to forced Stress)", () => {
    expect(prompts(ok("spellbound-armor", "Tireless", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Clatter & Recombobulate: once a scene at its defeat, a Fear clears 2 HP and spotlights it", () => {
    const plan = ok("spellbound-armor", "Clatter & Recombobulate", [], { self: inst("spellbound-armor", { hp: 6, defeated: true }) });
    expect(plan.self.after.hp).toBe(4);
    expect(ofKind(plan, "spotlight")).toMatchObject([{ who: "self" }]);
    expect(refusal("spellbound-armor", "Clatter & Recombobulate", { featureUses: plan.self.featureUses })).toMatchObject({ ok: false, reason: "exhausted" });
  });
});

describe("Viper (HF p.69)", () => {
  it("Venomous: its standard-attack hit makes the target temporarily Envenomated, automatically", () => {
    const plan = ok("viper", "Venomous", [], { trigger: { subject: mira } });
    expect(plan.activation).toBe("auto");
    expect(after(plan, "mira")!.tags).toEqual(["Envenomated"]);
  });
});

describe("Waxwork Creation (HF p.69)", () => {
  it("No Vital Organs: shown (no modifier for critical-damage immunity)", () => {
    expect(prompts(ok("waxwork-creation", "No Vital Organs", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Wax Ball: a Stress, an attack within Far; 1d12+2 and Restrained until a Strength Roll (15)", () => {
    const plan = ok("waxwork-creation", "Wax Ball", [10, 7], { targets: [mira] });
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 9 }]);
    expect(after(plan, "mira")!.conditions).toEqual(["restrained"]);
  });

  it("Splutch!: a weapon attack from Melee, a d6; 5+ sticks the weapon", () => {
    expect(after(ok("waxwork-creation", "Splutch!", [5], { trigger: { source: mira } }), "mira")!.tags).toEqual(["Weapon stuck"]);
    expect(ok("waxwork-creation", "Splutch!", [4], { trigger: { source: mira } }).creatures).toEqual([]);
    const effects = adversaryEffects("waxwork-creation");
    expect(triggeredUses(effects, { kind: "onAttacked", stage: "targeted", attackerBand: "melee", weapon: false }, state("waxwork-creation"))).toEqual([]);
    expect(triggeredUses(effects, { kind: "onAttacked", stage: "targeted", attackerBand: "melee", weapon: true }, state("waxwork-creation"))).toHaveLength(1);
  });

  it("Smothering Grapple: after a Melee standard-attack hit, a Fear Traps the target (Restrained)", () => {
    const plan = ok("waxwork-creation", "Smothering Grapple", [], { trigger: { subject: mira } });
    expect(after(plan, "mira")).toMatchObject({ tags: ["Trapped"], conditions: ["restrained"] });
  });
});

describe("Weredrake (HF p.143)", () => {
  it("Climber: story only", () => {
    expect(prompts(ok("weredrake", "Climber", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Pack Tactics: with another Weredrake in Melee of the target, its standard attack deals 1d8+6 and gains a Fear", () => {
    expect(refusal("weredrake", "Pack Tactics", { targets: [mira], allyWithin: () => false })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = ok("weredrake", "Pack Tactics", [10, 2], { targets: [mira], allyWithin: (r) => r.name === "Weredrake" && r.of === "target" });
    expect(plan.incoming).toMatchObject([{ targetId: "mira", amount: 8 }]);
    expect(plan.gmFearDelta).toBe(1);
    expect(ok("weredrake", "Pack Tactics", [3], { targets: [mira] }).gmFearDelta).toBe(0); // a miss: no Fear
  });

  it("Innocent Guise: takes its human form until it uses the feature again", () => {
    expect(ok("weredrake", "Innocent Guise", []).self.after.tags).toEqual(["Innocent Guise"]);
  });
});

describe("Will-o'-the-Wisps (HF p.69)", () => {
  it("Kaleidoscopic: everyone within Very Close range is Vulnerable", () => {
    expect(summary("will-o-the-wisps").auras).toEqual([{ kind: "conditionAura", condition: { kind: "standard", condition: "vulnerable" }, to: "all", within: "veryClose" }]);
  });

  it("Fascinating: a Fear; each PC within Far makes an Instinct Reaction Roll (13) or marks a Stress and moves closer", () => {
    const plan = ok("will-o-the-wisps", "Fascinating", [], { targets: [mira, bram] });
    expect(prompts(plan, "pcSave")[0]).toMatchObject({ step: { trait: "instinct", difficulty: { kind: "fixed", value: 13 } } });
  });
});

describe("Yufo (HF p.69)", () => {
  it("Telepathic and Psychic Strongbox: shown", () => {
    expect(prompts(ok("yufo", "Telepathic", [], { spotlit: false }), "manual")).toHaveLength(1);
    expect(prompts(ok("yufo", "Psychic Strongbox", [], { spotlit: false }), "manual")).toHaveLength(1);
  });

  it("Glitch Wave: a Fear; up to three targets within Close make Instinct Reaction Rolls or are desynced", () => {
    const plan = ok("yufo", "Glitch Wave", [], { targets: [mira, bram] });
    expect(prompts(plan, "pcSave")).toHaveLength(2);
    expect(refusal("yufo", "Glitch Wave", { targets: [mira, bram, pc("c"), pc("d")] })).toMatchObject({ ok: false, reason: "targets" });
  });

  it("Temporal Corrosion: after a standard-attack hit, a Stress gives the target −2 to both thresholds until they repair their armor", () => {
    const plan = ok("yufo", "Temporal Corrosion", [], { trigger: { subject: mira } });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "effect")).toEqual([
      {
        kind: "effect",
        targetId: "mira",
        label: "Temporal Corrosion",
        mods: [
          { kind: "stat", stat: "majorThreshold", delta: -2 },
          { kind: "stat", stat: "severeThreshold", delta: -2 },
        ],
        duration: "manual",
        endsWhen: "they use a downtime move to repair their armor",
      },
    ]);
  });
});
