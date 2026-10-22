import { describe, expect, it } from "vitest";

import { matchesTrigger, passiveSummary, triggeredUses, type AdversaryEvent, type AdversaryState } from "@/lib/domain/adversary-actions";
import { run, runStandardAttack, upfrontFear, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext, type AdversaryRunResult } from "@/lib/domain/adversary-effects/run";
import type { AdversaryCost, AdversaryFeatureEffect, AdversaryFeatureUse, AdversaryStep } from "@/lib/domain/adversary-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import { adversaryGroup } from "@/lib/srd/adversary-effects";
import { T4_HF_EFFECTS } from "@/lib/srd/adversary-effects/t4-hf";

// Plan combat-actions, tracer AE-t4-hf: every feature of the 29 tier 4 Hope & Fear adversaries (HF p.90-97, Forlorne
// Lykona HF p.142-143) run through the adversary runner (AA1) with fixed dice. Expected values are worked out by hand
// from the feature text and the stat block. RNG order: the d20(s), then damage dice and rolled numbers in step order,
// then prompt numbers (summon counts, countdown starts, spotlight counts). Every successful run checks that all queued
// dice were used. PCs' reaction rolls are prompts (AR11): their branches run when the PC rolls, so the tests check the
// prompt and its step.

const GROUP = ADVERSARIES.filter((a) => adversaryGroup(a) === "t4-hf");
const def = (id: string) => {
  const d = GROUP.find((a) => a.id === id);
  if (!d) throw new Error(`No tier 4 Hope & Fear adversary ${id}`);
  return d;
};
const effectOf = (adversaryId: string, feature: string): AdversaryFeatureEffect => {
  const e = T4_HF_EFFECTS.find((x) => x.adversaryId === adversaryId && x.feature === feature);
  if (!e) throw new Error(`No entry for ${adversaryId}/${feature}`);
  return e;
};
const getUse = (adversaryId: string, feature: string, useId = "main"): AdversaryFeatureUse => {
  const u = effectOf(adversaryId, feature).uses.find((x) => x.id === useId);
  if (!u) throw new Error(`No use ${useId} on ${adversaryId}/${feature}`);
  return u;
};
const triggerOf = (u: AdversaryFeatureUse) => {
  if (u.activation.kind !== "reaction" && u.activation.kind !== "auto") throw new Error(`${u.id} has no trigger`);
  return u.activation.trigger;
};
const fires = (adversaryId: string, feature: string, useId: string, event: AdversaryEvent) => matchesTrigger(triggerOf(getUse(adversaryId, feature, useId)), event);

const selfOf = (adversaryId: string, over: Partial<Combatant> = {}): Combatant => {
  const d = def(adversaryId);
  return {
    id: "self",
    side: "adversary",
    difficulty: d.difficulty,
    thresholds: { major: d.thresholds.major ?? 0, severe: d.thresholds.severe ?? 0 },
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
  thresholds: { major: 20, severe: 40 },
  hp: 0,
  hpMax: 8,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 6,
  defeated: false,
  conditions: [],
  ...over,
});

const ally = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  side: "adversary",
  difficulty: 17,
  thresholds: { major: 25, severe: 45 },
  hp: 0,
  hpMax: 6,
  stress: 1,
  stressMax: 4,
  defeated: false,
  conditions: [],
  ...over,
});

const mira = pc("mira");
const bram = pc("bram", { evasion: 15 });
const cora = pc("cora", { evasion: 30 });

function context(adversaryId: string, over: Partial<AdversaryRunContext> = {}): AdversaryRunContext {
  const d = def(adversaryId);
  return {
    adversaryId,
    self: selfOf(adversaryId),
    attack: d.attack,
    tier: 4,
    gmFear: 6,
    spotlit: true,
    fearConfirmed: true,
    rng: queueRng([]),
    ...over,
  };
}

/** Runs one use with queued dice, throws on a refusal and checks every die was used. */
function runUse(adversaryId: string, feature: string, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryPlan {
  const rng = queueRng(dice);
  const result = run(effectOf(adversaryId, feature), context(adversaryId, { ...over, rng }));
  if (!result.ok) throw new Error(`refused: ${result.reason} ${result.detail}`);
  rng.done();
  return result.plan;
}
const attempt = (adversaryId: string, feature: string, over: Partial<AdversaryRunContext> = {}): AdversaryRunResult => run(effectOf(adversaryId, feature), context(adversaryId, over));

const ofKind = <K extends AdversaryPlanStep["kind"]>(plan: AdversaryPlan, kind: K) => plan.steps.filter((s): s is Extract<AdversaryPlanStep, { kind: K }> => s.kind === kind);
const prompts = (plan: AdversaryPlan, prompt: "move" | "manual" | "pcSave" | "choose") => ofKind(plan, "prompt").filter((p) => p.prompt === prompt);
const after = (plan: AdversaryPlan, id: string) => plan.creatures.find((c) => c.id === id)?.after;
const saveStep = (p: { step?: unknown }) => p.step as Extract<AdversaryStep, { kind: "save" }>;
const saves = (plan: AdversaryPlan) => prompts(plan, "pcSave");
const hitsOf = (plan: AdversaryPlan) => plan.incoming.map((h) => [h.targetId, h.amount, h.type, h.direct] as const);

const state = (over: Partial<AdversaryState> = {}): AdversaryState => ({ hp: 0, hpMax: 8, stress: 0, stressMax: 6, conditions: [], tokens: 0, ...over });
const effectsOf = (adversaryId: string) => T4_HF_EFFECTS.filter((e) => e.adversaryId === adversaryId);

const fearOf = (costs: readonly AdversaryCost[] | undefined): number =>
  (costs ?? []).reduce((n, c) => n + (c.kind === "fear" && c.amount.kind === "fixed" ? c.amount.value : 0), 0);

const pcRoll = (over: Partial<{ trait: "presence"; attack: boolean; success: boolean; withHope: boolean; withFear: boolean }> = {}) => ({
  kind: "action" as const,
  success: false,
  withHope: false,
  withFear: true,
  ...over,
});

// ---------------------------------------------------------------- the table

describe("the tier 4 Hope & Fear table", () => {
  it("has exactly one entry per printed feature of the 29 tier 4 Hope & Fear adversaries (135 features, Q15)", () => {
    const expected = GROUP.flatMap((a) => a.features.map((f) => `${a.id}/${f.name}`)).sort();
    const actual = T4_HF_EFFECTS.map((e) => `${e.adversaryId}/${e.feature}`);
    expect(GROUP).toHaveLength(29);
    expect(expected).toHaveLength(135);
    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual(expected);
  });

  it("use ids are unique per feature; actions need the spotlight, passives, reactions and autos don't (CB p.194)", () => {
    for (const effect of T4_HF_EFFECTS) {
      const ids = effect.uses.map((u) => u.id);
      expect(new Set(ids).size, effect.feature).toBe(ids.length);
      for (const u of effect.uses) {
        expect(u.needsSpotlight, `${effect.adversaryId}/${effect.feature}:${u.id}`).toBe(u.activation.kind === "action");
        // Only Relentless (X) carries a step on a passive: its count of PCs is a manual note.
        if (u.activation.kind === "passive" && effect.feature !== "Relentless (X)") expect(u.steps, effect.feature).toEqual([]);
      }
    }
  });

  it("Fear costs match the stat block's printed Fear", () => {
    for (const a of GROUP) {
      for (const f of a.features) {
        const effect = effectOf(a.id, f.name);
        const fear = Math.max(0, ...effect.uses.map((u) => fearOf(u.costs)));
        expect(fear, `${a.id}/${f.name}`).toBe(f.fearCost ?? 0);
      }
    }
  });

  it("every use of every entry runs through run() (dice at half their sides, all situations confirmed)", () => {
    const situations = new Set<string>();
    const collect = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(collect);
      else if (o && typeof o === "object") {
        const r = o as Record<string, unknown>;
        if (r.kind === "situation" && typeof r.text === "string") situations.add(r.text);
        Object.values(r).forEach(collect);
      }
    };
    collect(T4_HF_EFFECTS);
    for (const effect of T4_HF_EFFECTS) {
      for (const u of effect.uses) {
        const result = run(effect, {
          ...context(effect.adversaryId),
          useId: u.id,
          tokens: 1,
          targets: [pc("a", { tags: ["Grappled"], conditions: ["vulnerable", "restrained"] })],
          picked: [pc("p")],
          allies: [ally("x")],
          followUp: [pc("f")],
          trigger: { amount: 2, source: pc("src"), subject: pc("sub") },
          situations: [...situations],
          rng: (sides: number) => Math.ceil(sides / 2),
        });
        expect(result.ok, `${effect.adversaryId}/${effect.feature}:${u.id} ${result.ok ? "" : result.detail}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- shared features

describe("shared features", () => {
  const minions = [
    ["cephilith-hatchling", 12, 9, "physical"],
    ["cephilith-novitiate", 12, 12, "physical"],
    ["severed-shadow", 12, 10, "magic"],
    ["wyrmfiend", 13, 11, "physical"],
  ] as const;

  it.each(minions)("%s: Minion (%i) is a passive Minion modifier (CB p.201)", (id, x) => {
    const plan = runUse(id, `Minion (${x})`, [], { spotlit: false });
    expect(plan).toMatchObject({ activation: "passive", needsSpotlight: false, modifiers: [{ kind: "minion", threshold: x }], gmFearDelta: 0 });
    expect(passiveSummary(effectsOf(id), state()).minion).toBe(x);
  });

  it.each(minions)("%s: Group Attack asks for a Fear, rolls once and combines %i… per Minion (AR9)", (id, _x, damage, type) => {
    expect(attempt(id, "Group Attack", { targets: [mira], fearConfirmed: false })).toMatchObject({ ok: false, reason: "confirmFear", detail: "1" });
    expect(attempt(id, "Group Attack", { targets: [mira], spotlit: false })).toMatchObject({ ok: false, code: "ADVERSARY_NOT_SPOTLIT" });
    const group = [selfOf(id, { id: "m2" }), selfOf(id, { id: "m3" })];
    const plan = runUse(id, "Group Attack", [16], { targets: [mira], group });
    expect(plan).toMatchObject({ fearSpent: 1, gmFearDelta: -1, group: ["m2", "m3"] });
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: damage * 3, type, direct: false, forcedArmor: 0, critical: false, attackTotal: 16 + Number(def(id).attack.modifier) }]);
    expect(prompts(plan, "move")).toHaveLength(1);
    expect(runUse(id, "Group Attack", [2], { targets: [mira], group }).incoming).toEqual([]);
  });

  it.each([
    ["cipactli", 3],
    ["demon-lord-berzug", 3],
    ["dragon-mother-mitera", 3],
    ["fire-titan-warlord", 2],
    ["forlorne-lykona-dragon-form", 4],
    ["forlorne-lykona-faun-form", 4],
    ["gargantuan-war-machine", 3],
    ["harbinger-of-death", 3],
    ["harbinger-of-famine", 2],
    ["harbinger-of-war", 2],
    ["ruby-dragon", 3],
    ["supreme-demiurge-adonix", 4],
    ["temporal-enforcer", 2],
  ] as const)("%s: Relentless (%i)", (id, x) => {
    expect(runUse(id, `Relentless (${x})`, []).modifiers).toEqual([{ kind: "relentless", times: x }]);
    expect(passiveSummary(effectsOf(id), state()).relentless).toBe(x);
  });

  it.each(["cephilith-titan", "xero-the-castle-killer"])("%s: Relentless (X) (X = the number of PCs) is a manual note: no fixed count", (id) => {
    const plan = runUse(id, "Relentless (X)", [], { spotlit: false });
    expect(plan.modifiers).toEqual([]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/number of PCs in the scene/);
    expect(passiveSummary(effectsOf(id), state()).relentless).toBeNull();
  });

  it.each([
    ["ghastly-legion", "2d6+5", [15, 3, 4], 12, "magic"],
    ["hallowed-choir", "2d10", [15, 3, 4], 7, "magic"],
    ["wyrmlings", "2d6+5", [15, 1, 1], 7, "physical"],
  ] as const)("%s: Horde (%s) once half the HP is marked (CB p.199)", (id, x, dice, amount, type) => {
    expect(passiveSummary(effectsOf(id), state()).horde).toBe(x);
    const half = Math.ceil(def(id).hp / 2);
    const passives = passiveSummary(effectsOf(id), state({ hp: half, hpMax: def(id).hp }));
    const rng = queueRng([...dice]);
    const result = runStandardAttack(context(id, { self: selfOf(id, { hp: half }), passives, targets: [pc("t", { evasion: 1 })], rng }));
    expect(result.ok && [result.plan.incoming[0]!.amount, result.plan.incoming[0]!.type]).toEqual([amount, type]);
    rng.done();
  });

  it.each([
    ["cephilith-titan", "close"],
    ["forlorne-lykona-dragon-form", "far"],
  ] as const)("%s: Terrifying: every PC within %s loses a Hope and the GM gains a Fear on a hit", (id, range) => {
    const u = getUse(id, "Terrifying");
    expect(u.steps[0]).toMatchObject({ kind: "hope", to: "picked", pick: { range } });
    const plan = runUse(id, "Terrifying", [], { spotlit: false, picked: [mira, bram] });
    expect(plan.activation).toBe("auto");
    expect(ofKind(plan, "hope")).toEqual([
      { kind: "hope", targetId: "mira", delta: -1 },
      { kind: "hope", targetId: "bram", delta: -1 },
    ]);
    expect(plan.gmFearDelta).toBe(1);
    expect(fires(id, "Terrifying", "main", { kind: "onHit", attack: "feature" })).toBe(true);
  });

  it.each(["harbinger-of-death", "harbinger-of-famine", "harbinger-of-pestilence", "harbinger-of-war"])(
    "%s: Mount: +2 Difficulty while mounted; knocked off by Severe damage; a Stress calls the mount back",
    (id) => {
      const mounted = "While the Harbinger is on their mount";
      expect(passiveSummary(effectsOf(id), state()).difficulty).toBe(0);
      expect(passiveSummary(effectsOf(id), state({ situations: [mounted] })).difficulty).toBe(2);
      expect(fires(id, "Mount", "unhorsed", { kind: "onDamaged", stage: "did", severity: "severe" })).toBe(true);
      expect(fires(id, "Mount", "unhorsed", { kind: "onDamaged", stage: "did", severity: "major" })).toBe(false);
      expect(attempt(id, "Mount", { useId: "unhorsed", spotlit: false })).toMatchObject({ ok: false, reason: "requirement" });
      expect(prompts(runUse(id, "Mount", [], { useId: "unhorsed", spotlit: false, situations: [mounted] }), "manual")).toHaveLength(1);
      const back = runUse(id, "Mount", [], { useId: "resummon" });
      expect(back).toMatchObject({ needsSpotlight: true, self: { after: { stress: 1 } } });
    },
  );

  it.each(["forlorne-lykona-dragon-form", "forlorne-lykona-faun-form"])("%s: Transform and Feed on Fear", (id) => {
    const t = runUse(id, "Transform", []);
    expect(t.self.after.stress).toBe(1);
    expect(prompts(t, "manual")[0]!.text).toMatch(/swap her stat block/);
    expect(fires(id, "Feed on Fear", "main", { kind: "pcRolls", roll: pcRoll(), band: "close" })).toBe(true);
    expect(fires(id, "Feed on Fear", "main", { kind: "pcRolls", roll: pcRoll({ success: true }), band: "close" })).toBe(false);
    expect(fires(id, "Feed on Fear", "main", { kind: "pcRolls", roll: pcRoll(), band: "far" })).toBe(false);
    const hurt = selfOf(id, { hp: 3, stress: 2 });
    expect(runUse(id, "Feed on Fear", [], { spotlit: false, self: hurt, options: { clear: ["hp"] } }).self.after).toMatchObject({ hp: 2, stress: 2 });
    expect(runUse(id, "Feed on Fear", [], { spotlit: false, self: hurt, options: { clear: ["stress"] } }).self.after).toMatchObject({ hp: 3, stress: 1 });
  });
});

// ---------------------------------------------------------------- adversary by adversary

describe("Cephilith Abomination (HF p.90)", () => {
  it("Toxic Skin: on contact the PC rolls a d6; on 3 or lower they mark an Armor Slot or 2 HP (their pick)", () => {
    expect(getUse("cephilith-abomination", "Toxic Skin").activation).toMatchObject({ kind: "reaction", trigger: { kind: "situation" } });
    expect(after(runUse("cephilith-abomination", "Toxic Skin", [3], { spotlit: false, targets: [mira], options: { toxic: ["hp"] } }), "mira")!.hp).toBe(2);
    expect(after(runUse("cephilith-abomination", "Toxic Skin", [1], { spotlit: false, targets: [mira], options: { toxic: ["armor"] } }), "mira")!.armor).toBe(1);
    expect(runUse("cephilith-abomination", "Toxic Skin", [4], { spotlit: false, targets: [mira], options: { toxic: ["hp"] } }).creatures).toEqual([]);
  });

  it("Bear Hug: a Stress, a standard attack (4d10+10) and Grappled (Vulnerable and Restrained)", () => {
    // d20 10 + 4 = 14 hits Evasion 12; 4d10 1+2+3+4 + 10 = 20.
    const plan = runUse("cephilith-abomination", "Bear Hug", [10, 1, 2, 3, 4], { targets: [mira] });
    expect(plan.self.after.stress).toBe(1);
    expect(hitsOf(plan)).toEqual([["mira", 20, "physical", false]]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "mira", condition: { kind: "tag", tag: "Grappled", implies: ["vulnerable", "restrained"] }, endsWhen: "they escape with a successful Strength Roll" });
    expect(runUse("cephilith-abomination", "Bear Hug", [7], { targets: [mira] }).incoming).toEqual([]);
  });

  it("Crunch!: a Fear, 4d12 direct physical damage to a Grappled creature only", () => {
    const grappled = pc("gus", { tags: ["Grappled"] });
    const plan = runUse("cephilith-abomination", "Crunch!", [1, 2, 3, 4], { targets: [grappled] });
    expect(plan.fearSpent).toBe(1);
    expect(hitsOf(plan)).toEqual([["gus", 10, "physical", true]]);
    expect(runUse("cephilith-abomination", "Crunch!", [], { targets: [mira] }).incoming).toEqual([]);
  });

  it("Tongue Attack: a Fear pulls a target within Far into Melee and spotlights the Abomination again", () => {
    const plan = runUse("cephilith-abomination", "Tongue Attack", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(prompts(plan, "move")[0]!.targetIds).toEqual(["mira"]);
    expect(ofKind(plan, "spotlight")).toEqual([{ kind: "spotlight", who: "self", note: "Immediately spotlight the Abomination again" }]);
  });

  it("Burrowing Leechpoles: on Major or greater damage, PCs within Close make an Agility reaction roll; leechpoles are manual", () => {
    expect(fires("cephilith-abomination", "Burrowing Leechpoles", "main", { kind: "onDamaged", stage: "did", severity: "major" })).toBe(true);
    expect(fires("cephilith-abomination", "Burrowing Leechpoles", "main", { kind: "onDamaged", stage: "did", severity: "minor" })).toBe(false);
    const plan = runUse("cephilith-abomination", "Burrowing Leechpoles", [], { spotlit: false, targets: [mira, bram] });
    expect(saves(plan).map((s) => s.targetIds[0])).toEqual(["mira", "bram"]);
    const step = saveStep(saves(plan)[0]!);
    expect(step).toMatchObject({ trait: "agility", difficulty: { kind: "actorDifficulty" } });
    expect(step.onFail[0]).toMatchObject({ kind: "condition", condition: { tag: "Leechpoles" }, endsWhen: "they are dug out with a successful Finesse Roll (21)" });
    expect(step.onFail[1]).toMatchObject({ kind: "manual" });
  });
});

describe("Cephilith Hatchling (HF p.90)", () => {
  it("Comatize: a Fear; the PC marks a Stress and carries the Hatchling", () => {
    const plan = runUse("cephilith-hatchling", "Comatize", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(after(plan, "mira")).toMatchObject({ stress: 1, tags: ["Comatized"] });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/death move/);
  });

  it("Comatize: every failure with Fear makes each latched PC mark a Stress (automatic)", () => {
    expect(fires("cephilith-hatchling", "Comatize", "latched", { kind: "pcRolls", roll: pcRoll() })).toBe(true);
    expect(fires("cephilith-hatchling", "Comatize", "latched", { kind: "pcRolls", roll: pcRoll({ withFear: false, withHope: true }) })).toBe(false);
    const latched = pc("lia", { tags: ["Comatized"], stress: 2 });
    const plan = runUse("cephilith-hatchling", "Comatize", [], { useId: "latched", spotlit: false, targets: [mira, latched] });
    expect(plan.activation).toBe("auto");
    expect(plan.creatures.map((c) => [c.id, c.after.stress])).toEqual([["lia", 3]]);
  });

  it("Comatize: a dead latched PC rises as a Cephilith Novitiate for a Fear", () => {
    const plan = runUse("cephilith-hatchling", "Comatize", [], { useId: "resurrect", spotlit: false });
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "summon")).toEqual([{ kind: "summon", label: "The PC rises as a Cephilith Novitiate", count: 1, adversaryId: "cephilith-novitiate" }]);
  });
});

describe("Cephilith Novitiate (HF p.90)", () => {
  it("Sacrifice Self: a Fear, 12 direct magic damage to a target within Far, then the Novitiate is defeated", () => {
    const plan = runUse("cephilith-novitiate", "Sacrifice Self", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    expect(hitsOf(plan)).toEqual([["mira", 12, "magic", true]]);
    expect(ofKind(plan, "defeat")).toEqual([{ kind: "defeat", targetId: "self" }]);
    expect(prompts(plan, "move")).toHaveLength(1);
  });
});

describe("Cephilith Priest (HF p.90)", () => {
  it("Psychic Blast: a Fear, up to three PCs make a Knowledge reaction roll: 4d10+10 direct and Vulnerable, or 2d10+5 direct", () => {
    expect(attempt("cephilith-priest", "Psychic Blast", { targets: [mira, bram, cora, pc("dax")] })).toMatchObject({ ok: false, reason: "targets" });
    const plan = runUse("cephilith-priest", "Psychic Blast", [], { targets: [mira, bram, cora] });
    expect(plan.fearSpent).toBe(1);
    const step = saveStep(saves(plan)[0]!);
    expect(saves(plan)).toHaveLength(3);
    expect(step.trait).toBe("knowledge");
    expect(step.onFail).toMatchObject([{ kind: "damage", direct: true, type: "magic" }, { kind: "condition", condition: { condition: "vulnerable" }, endsWhen: "they are spotlighted" }]);
    expect(step.onSuccess).toMatchObject([{ kind: "damage", direct: true, roll: { dice: { count: { value: 2 }, sides: 10, plus: { value: 5 } } } }]);
  });

  it("Cerebral Incursion: a Fear, only a Vulnerable target: Strength reaction roll or mark 1d6 Stress, the Priest clears as many", () => {
    const vulnerable = pc("vee", { conditions: ["vulnerable"] });
    const plan = runUse("cephilith-priest", "Cerebral Incursion", [], { targets: [vulnerable] });
    expect(plan.fearSpent).toBe(1);
    expect(saveStep(saves(plan)[0]!)).toMatchObject({ trait: "strength", onFail: [{ kind: "markStress" }, { kind: "clear", to: "self", track: "stress" }] });
    expect(saves(runUse("cephilith-priest", "Cerebral Incursion", [], { targets: [mira] }))).toEqual([]);
  });

  it("Telekinetic Grasp: after a standard-attack hit, a Stress Restrains the target until they spend a Hope", () => {
    expect(fires("cephilith-priest", "Telekinetic Grasp", "main", { kind: "onHit", attack: "standard" })).toBe(true);
    expect(fires("cephilith-priest", "Telekinetic Grasp", "main", { kind: "onHit", attack: "feature" })).toBe(false);
    const plan = runUse("cephilith-priest", "Telekinetic Grasp", [], { spotlit: false, trigger: { subject: mira } });
    expect(plan).toMatchObject({ activation: "reaction", self: { after: { stress: 1 } } });
    expect(after(plan, "mira")!.conditions).toEqual(["restrained"]);
    expect(ofKind(plan, "condition")[0]!.endsWhen).toBe("they spend a Hope");
  });
});

describe("Cephilith Titan (HF p.91)", () => {
  it("Merely a Projection: immune to physical damage, resistant to magic", () => {
    expect(passiveSummary(effectsOf("cephilith-titan"), state()).resistance).toEqual({ physical: "immune", magic: "resistant" });
  });

  it("Psychic Scream: a Fear; PCs within Far roll Instinct (22): 4d12 direct magic or a Stress", () => {
    const plan = runUse("cephilith-titan", "Psychic Scream", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    const step = saveStep(saves(plan)[0]!);
    expect(step).toMatchObject({ trait: "instinct", difficulty: { kind: "fixed", value: 22 }, onSuccess: [{ kind: "markStress" }] });
    expect(step.onFail).toMatchObject([{ kind: "damage", direct: true, type: "magic" }]);
  });

  it("Summon Worshippers: a Fear, 1d4 Outer Realms Abominations within Far, one spotlighted", () => {
    const plan = runUse("cephilith-titan", "Summon Worshippers", [3]);
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "summon")).toEqual([{ kind: "summon", label: "Outer Realms Abominations", count: 3, adversaryId: "outer-realms-abomination", range: "far" }]);
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "picked", count: 1 });
  });

  it("“It’s Here…”: at half its HP (once per scene) it clears all HP; dropping Merely a Projection is manual", () => {
    expect(fires("cephilith-titan", "“It’s Here…”", "main", { kind: "onHpMarked", before: 4, after: 5, hpMax: 10 })).toBe(true);
    expect(fires("cephilith-titan", "“It’s Here…”", "main", { kind: "onHpMarked", before: 2, after: 4, hpMax: 10 })).toBe(false);
    const plan = runUse("cephilith-titan", "“It’s Here…”", [], { spotlit: false, self: selfOf("cephilith-titan", { hp: 5 }) });
    expect(plan.self.after.hp).toBe(0);
    expect(plan.limit).toMatchObject({ until: "session", consumed: true });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Merely a Projection/);
  });

  it("“It’s Here…”: in full form a creature who marks HP from its standard attack marks one more", () => {
    expect(fires("cephilith-titan", "“It’s Here…”", "full-form", { kind: "onTargetMarksHp", attack: "standard" })).toBe(true);
    expect(attempt("cephilith-titan", "“It’s Here…”", { useId: "full-form", trigger: { subject: mira } })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("cephilith-titan", "“It’s Here…”", [], { useId: "full-form", spotlit: false, trigger: { subject: mira }, situations: ["The Titan is in its full form"] });
    expect(after(plan, "mira")!.hp).toBe(1);
  });
});

describe("Cipactli (HF p.91)", () => {
  it("Many Mouths: a Stress, a standard attack (4d8+12) against everyone within Very Close; those hit also mark a Stress", () => {
    // d20 6 + 8 = 14: hits Mira (12), misses Bram (15). 4d8 1+1+1+1 + 12 = 16.
    const plan = runUse("cipactli", "Many Mouths", [6, 1, 1, 1, 1], { targets: [mira, bram] });
    expect(hitsOf(plan)).toEqual([["mira", 16, "physical", false]]);
    expect(after(plan, "mira")!.stress).toBe(1);
    expect(after(plan, "bram")).toBeUndefined();
  });

  it("Frenzied Feeding: a Fear; PCs within Close roll Instinct or take 4d6 direct physical; the HP clearing is manual", () => {
    const plan = runUse("cipactli", "Frenzied Feeding", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(saveStep(saves(plan)[0]!)).toMatchObject({ trait: "instinct", onFail: [{ kind: "damage", direct: true, type: "physical" }], onSuccess: [] });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Severe damage/);
  });

  it("Quaking Footfalls: a Stress; PCs within Far roll Agility: 2 Stress and Vulnerable, or a Stress", () => {
    const step = saveStep(saves(runUse("cipactli", "Quaking Footfalls", [], { targets: [mira] }))[0]!);
    expect(step).toMatchObject({
      trait: "agility",
      onFail: [{ kind: "markStress", amount: { value: 2 } }, { kind: "condition", endsWhen: "they take damage" }],
      onSuccess: [{ kind: "markStress", amount: { value: 1 } }],
    });
  });

  it("Lifeblooded: on Severe damage everyone within Close is temporarily Restrained", () => {
    expect(fires("cipactli", "Lifeblooded", "main", { kind: "onDamaged", stage: "did", severity: "severe" })).toBe(true);
    expect(fires("cipactli", "Lifeblooded", "main", { kind: "onDamaged", stage: "did", severity: "major" })).toBe(false);
    const plan = runUse("cipactli", "Lifeblooded", [], { spotlit: false, targets: [mira, ally("croc")] });
    expect(ofKind(plan, "condition").map((c) => [c.targetId, c.duration])).toEqual([
      ["mira", "temporary"],
      ["croc", "temporary"],
    ]);
  });

  it("Verdant Explosion: on its last HP, the landscape changes (a manual note)", () => {
    expect(fires("cipactli", "Verdant Explosion", "main", { kind: "onMarkHp", stage: "did", amount: 1, last: true })).toBe(true);
    expect(fires("cipactli", "Verdant Explosion", "main", { kind: "onMarkHp", stage: "did", amount: 1, last: false })).toBe(false);
    expect(prompts(runUse("cipactli", "Verdant Explosion", [], { spotlit: false }), "manual")).toHaveLength(1);
  });
});

describe("Cloud Titan (HF p.91)", () => {
  it("Lightning Strike: a Stress, 4d10+14 magic on a hit; on a 4+ it bounces (ATK +3) for 4d10+14 − 1d10", () => {
    // d20 9 + 3 = 12 hits Mira; 4d10 1+1+1+1 + 14 = 18; d6 5 bounces; follow-up d20 10 + 3 = 13 hits Lou (Evasion 10).
    const low = pc("lou", { evasion: 10 });
    const plan = runUse("cloud-titan", "Lightning Strike", [9, 1, 1, 1, 1, 5, 10, 2, 2, 2, 2, 3], { targets: [mira], followUp: [low] });
    expect(plan.self.after.stress).toBe(1);
    // Bounce: 4d10 2+2+2+2 + 14 = 22, minus 1d10 3 = 19.
    expect(hitsOf(plan)).toEqual([
      ["mira", 18, "magic", false],
      ["lou", 19, "magic", false],
    ]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/bounces again/);
    // A d6 of 3: no bounce.
    expect(hitsOf(runUse("cloud-titan", "Lightning Strike", [9, 1, 1, 1, 1, 3], { targets: [mira], followUp: [low] }))).toEqual([["mira", 18, "magic", false]]);
    // A miss: no damage, no d6.
    expect(runUse("cloud-titan", "Lightning Strike", [2], { targets: [mira], followUp: [low] }).incoming).toEqual([]);
  });

  it("Mist Weaver: a Fear; the Titan is Hidden until it marks HP; the advantage in the fog is manual", () => {
    const plan = runUse("cloud-titan", "Mist Weaver", []);
    expect(plan.fearSpent).toBe(1);
    expect(plan.self.after.conditions).toEqual(["hidden"]);
    expect(ofKind(plan, "condition")[0]!.endsWhen).toBe("the Titan marks HP (the fog lifts)");
    expect(prompts(plan, "manual")[0]!.text).toMatch(/advantage on attacks/);
  });

  it("Nebulous Transformation: a Stress for physical immunity; double magic damage while a misty cloud", () => {
    const plan = runUse("cloud-titan", "Nebulous Transformation", []);
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "effect")[0]).toMatchObject({ targetId: "self", label: "Misty cloud", endsWhen: "the Titan drops out of it or takes Severe damage" });
    expect(fires("cloud-titan", "Nebulous Transformation", "double-magic", { kind: "onDamaged", stage: "would", damageType: "magic" })).toBe(true);
    expect(fires("cloud-titan", "Nebulous Transformation", "double-magic", { kind: "onDamaged", stage: "would", damageType: "physical" })).toBe(false);
    expect(attempt("cloud-titan", "Nebulous Transformation", { useId: "double-magic" })).toMatchObject({ ok: false, reason: "requirement" });
    const doubled = runUse("cloud-titan", "Nebulous Transformation", [], { useId: "double-magic", spotlit: false, situations: ["While the Titan is a misty cloud"] });
    expect(ofKind(doubled, "fold")[0]!.step).toMatchObject({ kind: "modifyDamage", change: { kind: "multiply", factor: 2 } });
  });

  it("Unleash the Menagerie: once per scene, N Stress summons N Griffins", () => {
    const plan = runUse("cloud-titan", "Unleash the Menagerie", [], { options: { stress: ["3"] } });
    expect(plan.self.after.stress).toBe(3);
    expect(ofKind(plan, "summon")).toEqual([{ kind: "summon", label: "Griffins", count: 3, adversaryId: "griffin", range: "close" }]);
    expect(plan.limit).toMatchObject({ consumed: true });
    expect(attempt("cloud-titan", "Unleash the Menagerie", { featureUses: plan.self.featureUses, options: { stress: ["1"] } })).toMatchObject({ ok: false, reason: "exhausted" });
  });

  it("Wind Worker: a Fear, 4d6+8 physical (no roll) and pushed back to Far range", () => {
    const plan = runUse("cloud-titan", "Wind Worker", [1, 2, 3, 4], { targets: [mira] });
    expect(hitsOf(plan)).toEqual([["mira", 18, "physical", false]]);
    expect(prompts(plan, "move")[0]!.targetIds).toEqual(["mira"]);
  });

  it("Double or Nothing: on a PC's attack with Fear against the Titan, a d6: odd takes the Fear back, even adds one", () => {
    expect(fires("cloud-titan", "Double or Nothing", "main", { kind: "pcRolls", roll: pcRoll({ attack: true, success: true }), againstSelf: true })).toBe(true);
    expect(fires("cloud-titan", "Double or Nothing", "main", { kind: "pcRolls", roll: pcRoll({ attack: true, withFear: false, withHope: true }), againstSelf: true })).toBe(false);
    for (const [d6, delta] of [
      [1, -1],
      [2, 1],
      [3, -1],
      [4, 1],
      [5, -1],
      [6, 1],
    ] as const) {
      expect(runUse("cloud-titan", "Double or Nothing", [d6], { spotlit: false }).gmFearDelta, `d6 ${d6}`).toBe(delta);
    }
  });
});

describe("Demon Lord Berzug (HF p.92)", () => {
  it("Chaos Lash: a Stress; up to three PCs roll Agility: 4d20 physical, or half", () => {
    expect(attempt("demon-lord-berzug", "Chaos Lash", { targets: [mira, bram, cora, pc("dax")] })).toMatchObject({ ok: false, reason: "targets" });
    const step = saveStep(saves(runUse("demon-lord-berzug", "Chaos Lash", [], { targets: [mira, bram, cora] }))[0]!);
    expect(step).toMatchObject({ trait: "agility", onFail: [{ kind: "damage", type: "physical" }], onSuccess: [{ kind: "damage", scale: "half" }] });
  });

  it("Gaze into the Abyss: a Fear, a Presence roll; the failure's d6 picks Mesmerized, Confused or Enthralled", () => {
    const plan = runUse("demon-lord-berzug", "Gaze into the Abyss", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(1);
    const step = saveStep(saves(plan)[0]!);
    expect(step.trait).toBe("presence");
    const d6 = step.onFail[0] as Extract<AdversaryStep, { kind: "check" }>;
    expect(d6).toMatchObject({ kind: "check", test: { kind: "totalAtMost", value: 2 } });
    expect(d6.then[1]).toMatchObject({ condition: { tag: "Mesmerized", implies: ["vulnerable", "restrained"] } });
    const second = d6.otherwise[0] as Extract<AdversaryStep, { kind: "check" }>;
    expect(second).toMatchObject({ test: { kind: "totalAtMost", value: 4 }, then: [{ condition: { tag: "Confused" } }, { kind: "manual" }] });
    expect(second.otherwise[0]).toMatchObject({ condition: { tag: "Enthralled" } });
  });

  it("Crushing Strike: when a PC marks HP from its standard attack, a Stress makes them mark that many Stress; the GM gains a Fear", () => {
    expect(fires("demon-lord-berzug", "Crushing Strike", "main", { kind: "onTargetMarksHp", attack: "standard" })).toBe(true);
    expect(fires("demon-lord-berzug", "Crushing Strike", "main", { kind: "onTargetMarksHp", attack: "feature" })).toBe(false);
    const plan = runUse("demon-lord-berzug", "Crushing Strike", [], { spotlit: false, trigger: { subject: mira, amount: 3 } });
    expect(plan).toMatchObject({ gmFearDelta: 1, self: { after: { stress: 1 } } });
    expect(after(plan, "mira")!.stress).toBe(3);
  });

  it("Horrifying: a PC's failed attack against Berzug gains a Fear automatically", () => {
    expect(triggeredUses(effectsOf("demon-lord-berzug"), { kind: "onAttacked", stage: "failed" }, state()).map((t) => [t.effect.feature, t.mode])).toEqual([["Horrifying", "auto"]]);
    expect(runUse("demon-lord-berzug", "Horrifying", [], { spotlit: false }).gmFearDelta).toBe(1);
  });
});

describe("Dragon Mother Mitera (HF p.92)", () => {
  it("Diamond Hide: when she appears the countdown (7) starts and its value (tokens) is her Difficulty bonus", () => {
    expect(fires("dragon-mother-mitera", "Diamond Hide", "activate", { kind: "timing", at: "appears" })).toBe(true);
    const plan = runUse("dragon-mother-mitera", "Diamond Hide", [], { useId: "activate", spotlit: false });
    expect(ofKind(plan, "countdown")[0]).toMatchObject({ op: "start", label: "Diamond Hide", start: 7 });
    expect(plan.self.tokens).toEqual({ before: 0, after: 7 });
    expect(passiveSummary(effectsOf("dragon-mother-mitera"), state({ tokens: 7 })).difficulty).toBe(7);
    expect(passiveSummary(effectsOf("dragon-mother-mitera"), state({ tokens: 2 })).difficulty).toBe(2);
  });

  it("Diamond Hide: when it triggers she becomes Vulnerable and gains +2 to attack rolls", () => {
    const plan = runUse("dragon-mother-mitera", "Diamond Hide", [], { useId: "trigger", spotlit: false });
    expect(plan.self.after.conditions).toEqual(["vulnerable"]);
    expect(ofKind(plan, "effect")[0]!.mods).toEqual([{ kind: "stat", stat: "attack", delta: 2 }]);
  });

  it("Elemental Breath 1, Fire: 4d12 magic to the picked targets; Armor Slot or 2 HP is manual", () => {
    const plan = runUse("dragon-mother-mitera", "Elemental Breath", [1, 2, 3, 4], { options: { head: ["fire"] }, followUp: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    expect(hitsOf(plan)).toEqual([
      ["mira", 10, "magic", false],
      ["bram", 10, "magic", false],
    ]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Armor Slot or 2 additional HP/);
  });

  it("Elemental Breath 2, Lightning: 4d12 magic to up to 1d6 targets", () => {
    const u = getUse("dragon-mother-mitera", "Elemental Breath");
    const choose = u.steps[0] as Extract<AdversaryStep, { kind: "choose" }>;
    expect(choose.options.map((o) => o.id)).toEqual(["fire", "lightning", "acid", "poison", "ice", "darkness", "light"]);
    expect(hitsOf(runUse("dragon-mother-mitera", "Elemental Breath", [3, 3, 3, 3], { options: { head: ["lightning"] }, followUp: [mira] }))).toEqual([["mira", 12, "magic", false]]);
  });

  it("Elemental Breath 3, Acid: an Agility roll: 2 Armor Slots and 2 HP, or 1 and 1", () => {
    const step = saveStep(saves(runUse("dragon-mother-mitera", "Elemental Breath", [], { options: { head: ["acid"] }, followUp: [mira] }))[0]!);
    expect(step).toMatchObject({
      trait: "agility",
      onFail: [{ kind: "markArmor", amount: { value: 2 } }, { kind: "markHp", amount: { value: 2 } }],
      onSuccess: [{ kind: "markArmor", amount: { value: 1 } }, { kind: "markHp", amount: { value: 1 } }],
    });
  });

  it("Elemental Breath 4, Poison: Sickened (the disadvantage is manual)", () => {
    const plan = runUse("dragon-mother-mitera", "Elemental Breath", [], { options: { head: ["poison"] }, followUp: [mira] });
    expect(after(plan, "mira")!.tags).toEqual(["Sickened"]);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Elemental Breath 5, Ice: 4d8+8 magic and Restrained; the frozen area is manual", () => {
    const plan = runUse("dragon-mother-mitera", "Elemental Breath", [2, 2, 2, 2], { options: { head: ["ice"] }, followUp: [mira] });
    expect(hitsOf(plan)).toEqual([["mira", 16, "magic", false]]);
    expect(after(plan, "mira")!.conditions).toEqual(["restrained"]);
  });

  it("Elemental Breath 6, Darkness: creatures in the cloud are Vulnerable", () => {
    const plan = runUse("dragon-mother-mitera", "Elemental Breath", [], { options: { head: ["darkness"] }, followUp: [mira] });
    expect(after(plan, "mira")!.conditions).toEqual(["vulnerable"]);
  });

  it("Elemental Breath 7, Light: 28 direct magic damage to each creature in the line", () => {
    expect(hitsOf(runUse("dragon-mother-mitera", "Elemental Breath", [], { options: { head: ["light"] }, followUp: [mira, bram] }))).toEqual([
      ["mira", 28, "magic", true],
      ["bram", 28, "magic", true],
    ]);
  });

  it("Tail Swipe: a Fear; hits take 2d20+10 and are knocked back; misses mark a Stress", () => {
    // d20 6 + 8 = 14: hits Mira, misses Bram. 2d20 5 + 5 + 10 = 20.
    const plan = runUse("dragon-mother-mitera", "Tail Swipe", [6, 5, 5], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(hitsOf(plan)).toEqual([["mira", 20, "physical", false]]);
    expect(prompts(plan, "move")[0]!.targetIds).toEqual(["mira"]);
    expect(after(plan, "bram")!.stress).toBe(1);
    expect(prompts(plan, "manual")[0]!.targetIds).toEqual(["mira"]);
  });

  it("Fearsome: a hit on a PC, or a PC failing a roll within Far, gains a Fear", () => {
    expect(fires("dragon-mother-mitera", "Fearsome", "hit", { kind: "onHit", attack: "feature" })).toBe(true);
    expect(fires("dragon-mother-mitera", "Fearsome", "pc-fails", { kind: "pcRolls", roll: pcRoll({ withFear: false, withHope: true }), band: "far" })).toBe(true);
    expect(fires("dragon-mother-mitera", "Fearsome", "pc-fails", { kind: "pcRolls", roll: pcRoll({ success: true }), band: "far" })).toBe(false);
    expect(runUse("dragon-mother-mitera", "Fearsome", [], { useId: "pc-fails", spotlit: false }).gmFearDelta).toBe(1);
  });

  it("Seven-Headed: on damage a d8; an 8 (or a head already gone) ticks Diamond Hide, else a head is removed", () => {
    const eight = runUse("dragon-mother-mitera", "Seven-Headed", [8], { spotlit: false, tokens: 5 });
    expect(eight.self.tokens).toEqual({ before: 5, after: 4 });
    expect(ofKind(eight, "countdown")).toEqual([{ kind: "countdown", op: "tick", label: "Diamond Hide", amount: 1, loop: false }]);
    const remove = runUse("dragon-mother-mitera", "Seven-Headed", [3], { spotlit: false, tokens: 5, options: { head: ["remove"] } });
    expect(remove.self.tokens.after).toBe(5);
    expect(prompts(remove, "manual")[0]!.text).toMatch(/Permanently remove/);
    expect(runUse("dragon-mother-mitera", "Seven-Headed", [3], { spotlit: false, tokens: 5, options: { head: ["removed"] } }).self.tokens.after).toBe(4);
  });
});

describe("Fire Titan Warlord (HF p.93)", () => {
  it("Colossus Crafter: countdown (6) on entering, ticks on its spotlight, summons the War Machine", () => {
    expect(ofKind(runUse("fire-titan-warlord", "Colossus Crafter", [], { useId: "activate", spotlit: false }), "countdown")[0]).toMatchObject({ op: "start", start: 6 });
    expect(fires("fire-titan-warlord", "Colossus Crafter", "tick", { kind: "onSpotlight", tokens: 0 })).toBe(true);
    const plan = runUse("fire-titan-warlord", "Colossus Crafter", [], { useId: "trigger", spotlit: false });
    expect(ofKind(plan, "summon")[0]).toMatchObject({ count: 1, adversaryId: "gargantuan-war-machine" });
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "picked", name: "Gargantuan War Machine" });
  });

  it("Release the Hounds: a Fear, two Demonic Hound Packs that take the spotlight", () => {
    const plan = runUse("fire-titan-warlord", "Release the Hounds", []);
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "summon")[0]).toMatchObject({ count: 2, adversaryId: "demonic-hound-pack", range: "close" });
  });

  it("Spinning Strike: a Stress, a standard attack (4d10+10) against everyone within Very Close, and a Fear", () => {
    const plan = runUse("fire-titan-warlord", "Spinning Strike", [8, 1, 1, 1, 1], { targets: [mira, bram] });
    // d20 8 + 6 = 14: hits Mira only; 4 + 10 = 14.
    expect(hitsOf(plan)).toEqual([["mira", 14, "physical", false]]);
    expect(plan.gmFearDelta).toBe(1);
  });

  it("Ground-Breaking: a Fear, an attack on a group: 4d10+10 direct physical; the rough terrain is manual", () => {
    const plan = runUse("fire-titan-warlord", "Ground-Breaking", [10, 1, 1, 1, 1], { targets: [mira] });
    expect(hitsOf(plan)).toEqual([["mira", 14, "physical", true]]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/Agility Reaction Roll \(16\)/);
  });
});

describe("Forlorne Lykona, Dragon Form (HF p.143)", () => {
  it("Flying: +3 Difficulty while flying", () => {
    expect(passiveSummary(effectsOf("forlorne-lykona-dragon-form"), state()).difficulty).toBe(0);
    expect(passiveSummary(effectsOf("forlorne-lykona-dragon-form"), state({ situations: ["While flying"] })).difficulty).toBe(3);
  });

  it("Breath Weapon: 2 Fear; Presence roll; the failing PC marks 3 Stress or takes the Weredrake Curse", () => {
    expect(attempt("forlorne-lykona-dragon-form", "Breath Weapon", { targets: [mira], fearConfirmed: false })).toMatchObject({ reason: "confirmFear", detail: "2" });
    const plan = runUse("forlorne-lykona-dragon-form", "Breath Weapon", [], { targets: [mira] });
    expect(plan.fearSpent).toBe(2);
    const choose = saveStep(saves(plan)[0]!).onFail[0] as Extract<AdversaryStep, { kind: "choose" }>;
    expect(choose.options.map((o) => o.id)).toEqual(["stress", "curse"]);
    expect(choose.options[1]!.steps[0]).toMatchObject({ condition: { tag: "Weredrake Curse" } });
  });

  it("Tail Swipe: when it marks HP from an attack within Very Close, a Stress deals 2d10+10 to everyone in that range", () => {
    expect(fires("forlorne-lykona-dragon-form", "Tail Swipe", "main", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "veryClose" })).toBe(true);
    expect(fires("forlorne-lykona-dragon-form", "Tail Swipe", "main", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "far" })).toBe(false);
    const plan = runUse("forlorne-lykona-dragon-form", "Tail Swipe", [1, 2], { spotlit: false, targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    expect(hitsOf(plan)).toEqual([
      ["mira", 13, "physical", false],
      ["bram", 13, "physical", false],
    ]);
  });
});

describe("Forlorne Lykona, Faun Form (HF p.142)", () => {
  it("Battle Teleport: a Stress before or after its standard attack teleports her within Far range", () => {
    expect(fires("forlorne-lykona-faun-form", "Battle Teleport", "before", { kind: "onAttack", stage: "before", attack: "standard" })).toBe(true);
    expect(fires("forlorne-lykona-faun-form", "Battle Teleport", "after", { kind: "onAttack", stage: "after", attack: "standard" })).toBe(true);
    expect(fires("forlorne-lykona-faun-form", "Battle Teleport", "after", { kind: "onAttack", stage: "after", attack: "feature" })).toBe(false);
    const plan = runUse("forlorne-lykona-faun-form", "Battle Teleport", [], { useId: "before", spotlit: false });
    expect(plan.self.after.stress).toBe(1);
    expect(prompts(plan, "move")).toHaveLength(1);
  });

  it("Grasping Vines: a Fear; a group rolls Agility or takes 2d8+7 magic and is Restrained", () => {
    const step = saveStep(saves(runUse("forlorne-lykona-faun-form", "Grasping Vines", [], { targets: [mira, bram] }))[0]!);
    expect(step).toMatchObject({ trait: "agility", onFail: [{ kind: "damage", type: "magic" }, { kind: "condition", condition: { condition: "restrained" } }] });
  });

  it("Stone-Cold Gaze: 2 Fear when hit from within Close; the attacker rolls Instinct; 3 Hope or the Petrified Curse", () => {
    expect(fires("forlorne-lykona-faun-form", "Stone-Cold Gaze", "main", { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "close" })).toBe(true);
    expect(fires("forlorne-lykona-faun-form", "Stone-Cold Gaze", "main", { kind: "onDamaged", stage: "did", fromAttack: true, attackerBand: "far" })).toBe(false);
    const plan = runUse("forlorne-lykona-faun-form", "Stone-Cold Gaze", [], { spotlit: false, trigger: { source: mira } });
    expect(plan.fearSpent).toBe(2);
    expect(saves(plan)[0]!.targetIds).toEqual(["mira"]);
    const choose = saveStep(saves(plan)[0]!).onFail[0] as Extract<AdversaryStep, { kind: "choose" }>;
    expect(choose.options[0]!.steps).toEqual([{ kind: "hope", to: "targets", change: "lose", amount: { kind: "fixed", value: 3 } }]);
    expect(choose.options[1]!.steps[1]).toMatchObject({ kind: "effect", mods: [{ flag: "cannotAct" }, { stat: "majorThreshold" }, { stat: "severeThreshold" }] });
  });
});

describe("Gargantuan War Machine (HF p.93)", () => {
  it("Awesome Size: on entering, each PC loses a Hope or marks 1d4 Stress (their choice, manual)", () => {
    const plan = runUse("gargantuan-war-machine", "Awesome Size", [], { spotlit: false, picked: [mira, bram] });
    expect(plan.activation).toBe("auto");
    expect(prompts(plan, "manual")[0]!.targetIds).toEqual(["mira", "bram"]);
  });

  it("Rocket Punch: a Stress, 4d12+10 direct physical and 2 Armor Slots without their benefit", () => {
    const plan = runUse("gargantuan-war-machine", "Rocket Punch", [10, 1, 1, 1, 1], { targets: [mira] });
    expect(plan.incoming).toEqual([{ targetId: "mira", amount: 14, type: "physical", direct: true, forcedArmor: 2, critical: false, attackTotal: 17 }]);
  });

  it("Ground-Breaking Stomp: a Fear; 4d12 direct physical and Vulnerable until spotlighted; the rubble is manual", () => {
    const plan = runUse("gargantuan-war-machine", "Ground-Breaking Stomp", [6, 2, 2, 2, 2], { targets: [mira, bram] });
    expect(hitsOf(plan)).toEqual([["mira", 8, "physical", true]]);
    expect(after(plan, "mira")!.conditions).toEqual(["vulnerable"]);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Supercharged: countdown (Loop 2d6) on its first spotlight; a token when it triggers; lost on Severe damage", () => {
    expect(fires("gargantuan-war-machine", "Supercharged", "activate", { kind: "onSpotlight", first: { scene: true, ever: true }, tokens: 0 })).toBe(true);
    expect(fires("gargantuan-war-machine", "Supercharged", "activate", { kind: "onSpotlight", first: { scene: false, ever: false }, tokens: 0 })).toBe(false);
    expect(ofKind(runUse("gargantuan-war-machine", "Supercharged", [3, 4], { useId: "activate", spotlit: false }), "countdown")[0]).toMatchObject({ op: "start", start: 7, loop: true });
    expect(runUse("gargantuan-war-machine", "Supercharged", [], { useId: "trigger", spotlit: false, tokens: 1 }).self.tokens).toEqual({ before: 1, after: 2 });
    expect(runUse("gargantuan-war-machine", "Supercharged", [], { useId: "lose-token", spotlit: false, tokens: 2 }).self.tokens).toEqual({ before: 2, after: 1 });
    expect(attempt("gargantuan-war-machine", "Supercharged", { useId: "lose-token" })).toMatchObject({ ok: false, reason: "requirement" });
  });

  it("Supercharged: each token is +1 Difficulty, +1 attack and an extra 1d12 on its standard attack", () => {
    const summary = passiveSummary(effectsOf("gargantuan-war-machine"), state({ tokens: 2 }), 4, queueRng([5, 7]));
    expect(summary).toMatchObject({ difficulty: 2, attackBonus: 2, attackDamageAdd: 12 });
    expect(passiveSummary(effectsOf("gargantuan-war-machine"), state())).toMatchObject({ difficulty: 0, attackBonus: 0, attackDamageAdd: 0 });
  });
});

describe("Ghastly Legion (HF p.93)", () => {
  it("Necroplasmic: immune to physical damage; magic damage doubles before it is marked", () => {
    expect(passiveSummary(effectsOf("ghastly-legion"), state()).resistance).toEqual({ physical: "immune", magic: "none" });
    expect(fires("ghastly-legion", "Necroplasmic", "double-magic", { kind: "onDamaged", stage: "would", damageType: "magic" })).toBe(true);
    expect(fires("ghastly-legion", "Necroplasmic", "double-magic", { kind: "onDamaged", stage: "did", damageType: "magic" })).toBe(false);
    const plan = runUse("ghastly-legion", "Necroplasmic", [], { useId: "double-magic", spotlit: false });
    expect(ofKind(plan, "fold")[0]!.step).toMatchObject({ kind: "modifyDamage", change: { factor: 2 } });
  });

  it("Final Act: when defeated it makes a standard attack against everyone within Close (Horde damage once half marked)", () => {
    expect(fires("ghastly-legion", "Final Act", "main", { kind: "onDefeated" })).toBe(true);
    const passives = passiveSummary(effectsOf("ghastly-legion"), state({ hp: 8, hpMax: 8 }));
    // d20 12 + 2 = 14: hits Mira; Horde 2d6+5: 3 + 3 + 5 = 11.
    const plan = runUse("ghastly-legion", "Final Act", [12, 3, 3], { spotlit: false, self: selfOf("ghastly-legion", { hp: 8 }), passives, targets: [mira, bram] });
    expect(hitsOf(plan)).toEqual([["mira", 11, "magic", false]]);
  });
});

describe("Griffin (HF p.93)", () => {
  it("Treasure Hoarder: on each hit the PC may pay bags of gold instead of HP (manual)", () => {
    const plan = runUse("griffin", "Treasure Hoarder", [], { spotlit: false, trigger: { subject: mira } });
    expect(plan.activation).toBe("auto");
    expect(prompts(plan, "manual")[0]).toMatchObject({ targetIds: ["mira"] });
  });

  it("Swooping Slash: move up to Far and make a standard attack (4d8+4)", () => {
    const plan = runUse("griffin", "Swooping Slash", [8, 1, 1, 1, 1], { targets: [mira] });
    expect(plan.fearSpent).toBe(0);
    expect(hitsOf(plan)).toEqual([["mira", 8, "physical", false]]);
    expect(prompts(plan, "move")).toHaveLength(1);
  });
});

describe("Hallowed Choir (HF p.93)", () => {
  it("Celestial Coda: countdown (Loop 3) when it appears, ticks when a PC gains a Hope, a token when it triggers", () => {
    expect(ofKind(runUse("hallowed-choir", "Celestial Coda", [], { useId: "activate", spotlit: false }), "countdown")[0]).toMatchObject({ start: 3, loop: true });
    expect(fires("hallowed-choir", "Celestial Coda", "tick", { kind: "pcHope", change: "gain" })).toBe(true);
    expect(fires("hallowed-choir", "Celestial Coda", "tick", { kind: "pcHope", change: "spend" })).toBe(false);
    expect(runUse("hallowed-choir", "Celestial Coda", [], { useId: "trigger", spotlit: false, tokens: 2 }).self.tokens.after).toBe(3);
    expect(passiveSummary(effectsOf("hallowed-choir"), state({ tokens: 3 })).attackDamageAdd).toBe(3);
  });

  it("Aural Assault: clears every token; 1d12 direct magic per token to each enemy within Close", () => {
    const plan = runUse("hallowed-choir", "Aural Assault", [4, 5], { tokens: 2, targets: [mira, bram] });
    expect(hitsOf(plan)).toEqual([
      ["mira", 9, "magic", true],
      ["bram", 9, "magic", true],
    ]);
    expect(plan.self.tokens).toEqual({ before: 2, after: 0 });
  });
});

describe("Harbinger of Death (HF p.94)", () => {
  it("Fear the Reaper: an adversary defeated within Far gains a Fear automatically; a PC's defeat is a GM button", () => {
    expect(fires("harbinger-of-death", "Fear the Reaper", "adversary", { kind: "allyDefeated", band: "far" })).toBe(true);
    expect(fires("harbinger-of-death", "Fear the Reaper", "adversary", { kind: "allyDefeated", band: "veryFar" })).toBe(false);
    expect(runUse("harbinger-of-death", "Fear the Reaper", [], { useId: "adversary", spotlit: false }).gmFearDelta).toBe(1);
    expect(runUse("harbinger-of-death", "Fear the Reaper", [], { useId: "pc", spotlit: false }).gmFearDelta).toBe(1);
  });

  it("Decapitate: 2 Fear; on a hit a d6 of 6 means all HP and a death move (manual)", () => {
    expect(attempt("harbinger-of-death", "Decapitate", { targets: [mira], fearConfirmed: false })).toMatchObject({ reason: "confirmFear", detail: "2" });
    const plan = runUse("harbinger-of-death", "Decapitate", [10, 6], { targets: [mira] });
    expect(plan.fearSpent).toBe(2);
    expect(ofKind(plan, "check")[0]).toMatchObject({ dice: [6], passed: true });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/death move/);
    expect(prompts(runUse("harbinger-of-death", "Decapitate", [10, 5], { targets: [mira] }), "manual")).toEqual([]);
    expect(ofKind(runUse("harbinger-of-death", "Decapitate", [1], { targets: [mira] }), "check")).toEqual([]);
  });

  it("Wake the Fallen: a Fear and N Stress; the ally rises, clears N HP and is spotlighted", () => {
    const fallen = ally("ghoul", { hp: 6, defeated: true });
    expect(upfrontFear(getUse("harbinger-of-death", "Wake the Fallen").costs, { ...context("harbinger-of-death"), eitherCosts: [2] })).toBe(1);
    const plan = runUse("harbinger-of-death", "Wake the Fallen", [], { targets: [fallen], eitherCosts: [2] });
    expect(plan.fearSpent).toBe(1);
    expect(plan.self.after.stress).toBe(3);
    expect(after(plan, "ghoul")!.hp).toBe(3);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/rises again/);
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "picked", count: 1 });
  });

  it("Ashes to Ashes, Dust to Dust: when it would mark HP, a Stress sends the HP to an ally within Far", () => {
    expect(fires("harbinger-of-death", "Ashes to Ashes, Dust to Dust", "main", { kind: "onMarkHp", stage: "would", amount: 2, last: false })).toBe(true);
    expect(fires("harbinger-of-death", "Ashes to Ashes, Dust to Dust", "main", { kind: "onMarkHp", stage: "did", amount: 2, last: false })).toBe(false);
    const plan = runUse("harbinger-of-death", "Ashes to Ashes, Dust to Dust", [], { spotlit: false, picked: [ally("rider")] });
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "redirectDamage", target: "picked" }, targetIds: ["rider"] });
  });
});

describe("Harbinger of Famine (HF p.94)", () => {
  it("Hunger Pangs: countdown (6) when it appears, ticks on its spotlight; when it triggers PCs within Far mark a Stress and are Ravenous", () => {
    expect(ofKind(runUse("harbinger-of-famine", "Hunger Pangs", [], { useId: "activate", spotlit: false }), "countdown")[0]).toMatchObject({ start: 6, loop: true });
    const plan = runUse("harbinger-of-famine", "Hunger Pangs", [], { useId: "trigger", spotlit: false, targets: [mira, bram] });
    expect(after(plan, "mira")).toMatchObject({ stress: 1, tags: ["Ravenous"] });
    expect(prompts(plan, "manual").map((p) => p.text)).toEqual([expect.stringMatching(/can't spend Hope/), expect.stringMatching(/one lower/)]);
  });

  it("Drain Essence: a Fear, up to three PCs (any range) take 4d6 magic", () => {
    const plan = runUse("harbinger-of-famine", "Drain Essence", [1, 2, 3, 4], { targets: [mira, bram, cora] });
    expect(hitsOf(plan)).toEqual([
      ["mira", 10, "magic", false],
      ["bram", 10, "magic", false],
      ["cora", 10, "magic", false],
    ]);
  });

  it("Too Many Mouths: a Stress, an attack in Melee: 4d6 physical and Restrained", () => {
    const plan = runUse("harbinger-of-famine", "Too Many Mouths", [9, 1, 1, 1, 1], { targets: [mira] });
    expect(hitsOf(plan)).toEqual([["mira", 4, "physical", false]]);
    expect(after(plan, "mira")!.conditions).toEqual(["restrained"]);
  });

  it("Withering Touch: a Fear; a Restrained PC marks 2 Stress and loses a Hope or marks 1d4 HP (their choice)", () => {
    const held = pc("hal", { conditions: ["restrained"] });
    const plan = runUse("harbinger-of-famine", "Withering Touch", [3], { targets: [held], options: { wither: ["hp"] } });
    expect(after(plan, "hal")).toMatchObject({ stress: 2, hp: 3 });
    expect(runUse("harbinger-of-famine", "Withering Touch", [], { targets: [mira], options: { wither: ["hp"] } }).creatures).toEqual([]);
  });
});

describe("Harbinger of Pestilence (HF p.94)", () => {
  it("Halo of Contagion: a PC within Very Close who acts rolls a d6; on a 1 they are Contagious", () => {
    expect(fires("harbinger-of-pestilence", "Halo of Contagion", "main", { kind: "pcRolls", roll: pcRoll(), band: "veryClose" })).toBe(true);
    expect(fires("harbinger-of-pestilence", "Halo of Contagion", "main", { kind: "pcRolls", roll: pcRoll(), band: "close" })).toBe(false);
    const sick = runUse("harbinger-of-pestilence", "Halo of Contagion", [1], { spotlit: false, trigger: { subject: mira } });
    expect(after(sick, "mira")!.tags).toEqual(["Contagious"]);
    expect(runUse("harbinger-of-pestilence", "Halo of Contagion", [2], { spotlit: false, trigger: { subject: mira } }).creatures).toEqual([]);
  });

  it("Locust Swarm: 2 Fear; each PC near the point picks Armor Slot or 4d10 direct and a d6 (manual)", () => {
    const plan = runUse("harbinger-of-pestilence", "Locust Swarm", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(2);
    expect(prompts(plan, "manual")[0]!.targetIds).toEqual(["mira", "bram"]);
  });

  it("Frog Spawn: a Fear; up to three PCs roll Presence or take 4d12 magic and a d6 (1–3: Contagious)", () => {
    const step = saveStep(saves(runUse("harbinger-of-pestilence", "Frog Spawn", [], { targets: [mira] }))[0]!);
    expect(step).toMatchObject({ trait: "presence", onFail: [{ kind: "damage", type: "magic" }, { kind: "check", test: { value: 3 }, then: [{ condition: { tag: "Contagious" } }] }] });
  });

  it("Plague Bringer: N Stress summons N×1d4 Contagious Zombie Legions and spotlights one", () => {
    const plan = runUse("harbinger-of-pestilence", "Plague Bringer", [2, 3], { options: { stress: ["2"] } });
    expect(plan.self.after.stress).toBe(2);
    expect(ofKind(plan, "summon")[0]).toMatchObject({ count: 5, adversaryId: "zombie-legion", range: "far" });
    expect(ofKind(plan, "spotlight")[0]).toMatchObject({ who: "picked", count: 1 });
  });
});

describe("Harbinger of War (HF p.95)", () => {
  it("Iron Dice: a Stress, a standard attack with advantage (4d20); a hit adds a HP, a miss makes it Vulnerable", () => {
    // d20s 3 and 12 keep 12 + 5 = 17 hits; 4d20 5+5+5+5 = 20.
    const plan = runUse("harbinger-of-war", "Iron Dice", [3, 12, 5, 5, 5, 5], { targets: [mira] });
    expect(hitsOf(plan)).toEqual([["mira", 20, "physical", false]]);
    expect(after(plan, "mira")!.hp).toBe(1);
    expect(plan.self.after.conditions).toEqual([]);
    const missed = runUse("harbinger-of-war", "Iron Dice", [2, 3], { targets: [mira] });
    expect(missed.incoming).toEqual([]);
    expect(missed.self.after.conditions).toEqual(["vulnerable"]);
  });

  it("Supreme Commander: once per scene, a Fear for 1d6 Hallowed Soldiers, one spotlighted", () => {
    const plan = runUse("harbinger-of-war", "Supreme Commander", [4]);
    expect(ofKind(plan, "summon")[0]).toMatchObject({ count: 4, adversaryId: "hallowed-soldier" });
    expect(attempt("harbinger-of-war", "Supreme Commander", { featureUses: plan.self.featureUses })).toMatchObject({ reason: "exhausted" });
  });

  it("Battering Ram: when a PC within Close fails an action roll, a Fear for a standard attack with advantage", () => {
    expect(fires("harbinger-of-war", "Battering Ram", "main", { kind: "pcRolls", roll: pcRoll(), band: "close" })).toBe(true);
    expect(fires("harbinger-of-war", "Battering Ram", "main", { kind: "pcRolls", roll: pcRoll({ success: true }), band: "close" })).toBe(false);
    const plan = runUse("harbinger-of-war", "Battering Ram", [1, 9, 4, 4, 4, 4], { spotlit: false, trigger: { subject: mira } });
    expect(plan.fearSpent).toBe(1);
    expect(hitsOf(plan)).toEqual([["mira", 16, "physical", false]]);
    expect(after(plan, "mira")!.conditions).toEqual(["vulnerable"]);
  });
});

describe("Owl Witch (HF p.95)", () => {
  it("Ill Omen and Witch Barrier: the Fear Die bonus is a manual note; resistant to magic", () => {
    const plan = runUse("owl-witch", "Ill Omen", [], { spotlit: false, trigger: { subject: mira } });
    expect(prompts(plan, "manual")[0]!.targetIds).toEqual(["mira"]);
    expect(passiveSummary(effectsOf("owl-witch"), state()).resistance).toEqual({ physical: "none", magic: "resistant" });
  });

  it("Voice Mimicry: a Fear; Instinct roll or move up to Far toward the Witch", () => {
    const step = saveStep(saves(runUse("owl-witch", "Voice Mimicry", [], { targets: [mira] }))[0]!);
    expect(step).toMatchObject({ trait: "instinct", onFail: [{ kind: "move", range: "far" }] });
  });

  it("Nightmare Stare: a Fear; Knowledge roll or Afflicted (can't clear HP or Stress: manual)", () => {
    const step = saveStep(saves(runUse("owl-witch", "Nightmare Stare", [], { targets: [mira] }))[0]!);
    expect(step).toMatchObject({ trait: "knowledge", onFail: [{ condition: { tag: "Afflicted" } }, { kind: "manual" }] });
  });

  it("Visions of a Violent End: when targeted, a Fear: the attacker rolls Presence or marks 1d4 Stress", () => {
    expect(fires("owl-witch", "Visions of a Violent End", "main", { kind: "onAttacked", stage: "targeted" })).toBe(true);
    const plan = runUse("owl-witch", "Visions of a Violent End", [], { spotlit: false, trigger: { source: bram } });
    expect(plan.fearSpent).toBe(1);
    expect(saves(plan)[0]!.targetIds).toEqual(["bram"]);
  });
});

describe("Ruby Dragon (HF p.95)", () => {
  it("Fearsome: its hit on a PC, or a PC within Far failing an action roll, gains a Fear", () => {
    expect(fires("ruby-dragon", "Fearsome", "pc-fails", { kind: "pcRolls", roll: pcRoll(), band: "far" })).toBe(true);
    expect(fires("ruby-dragon", "Fearsome", "pc-fails", { kind: "pcRolls", roll: { ...pcRoll(), kind: "reaction" }, band: "far" })).toBe(false);
    expect(runUse("ruby-dragon", "Fearsome", [], { useId: "hit", spotlit: false }).gmFearDelta).toBe(1);
  });

  it("Melting Breath: a Stress; PCs in front roll Agility or take 4d12+10 magic and an Armor Slot without benefit", () => {
    const step = saveStep(saves(runUse("ruby-dragon", "Melting Breath", [], { targets: [mira] }))[0]!);
    expect(step).toMatchObject({ trait: "agility", onFail: [{ kind: "damage", type: "magic" }, { kind: "markArmor", noBenefit: true }] });
  });

  it("Volcanic Fissure: a Fear; Agility roll: 4d8+5 magic, or move out; the lasting lava is manual", () => {
    const plan = runUse("ruby-dragon", "Volcanic Fissure", [], { targets: [mira] });
    expect(saveStep(saves(plan)[0]!)).toMatchObject({ onFail: [{ kind: "damage" }], onSuccess: [{ kind: "move" }] });
    expect(prompts(plan, "manual")).toHaveLength(1);
  });

  it("Hot-Blooded: a successful attack from within Very Close forces the attacker to mark an Armor Slot", () => {
    expect(fires("ruby-dragon", "Hot-Blooded", "main", { kind: "onAttacked", stage: "succeeded", attackerBand: "veryClose" })).toBe(true);
    expect(fires("ruby-dragon", "Hot-Blooded", "main", { kind: "onAttacked", stage: "succeeded", attackerBand: "close" })).toBe(false);
    const plan = runUse("ruby-dragon", "Hot-Blooded", [], { spotlit: false, trigger: { source: mira } });
    expect(after(plan, "mira")!.armor).toBe(1);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/1d4 HP/);
  });
});

describe("Severed Shadow (HF p.95)", () => {
  it("Shadow Grapple: a Stress; on a hit Vulnerable until the Shadow is defeated (the Stress per action is manual)", () => {
    const plan = runUse("severed-shadow", "Shadow Grapple", [10], { targets: [mira] });
    expect(after(plan, "mira")).toMatchObject({ conditions: ["vulnerable"], tags: ["Shadow Grappled"] });
    expect(plan.incoming).toEqual([]);
    expect(runUse("severed-shadow", "Shadow Grapple", [2], { targets: [mira] }).creatures).toEqual([]);
  });
});

describe("Supreme Demiurge Adonix (HF p.96)", () => {
  it("Elemental Archon 1, Fire Beam: an Agility roll; Severe or Minor damage is manual", () => {
    const plan = runUse("supreme-demiurge-adonix", "Elemental Archon", [1], { followUp: [mira] });
    expect(plan.self.after.stress).toBe(1);
    const step = saveStep(saves(plan)[0]!);
    expect(step).toMatchObject({ trait: "agility", onFail: [{ kind: "manual", text: "The target takes Severe damage." }], onSuccess: [{ kind: "manual", text: "The target takes Minor damage." }] });
  });

  it("Elemental Archon 2, Thunderclap: everyone within Far marks a Stress and is Vulnerable", () => {
    const plan = runUse("supreme-demiurge-adonix", "Elemental Archon", [2], { followUp: [mira, ally("angel")] });
    expect(after(plan, "mira")).toMatchObject({ stress: 1, conditions: ["vulnerable"] });
    expect(after(plan, "angel")).toMatchObject({ stress: 2, conditions: ["vulnerable"] });
  });

  it("Elemental Archon 3, Lightning Bolt: an attack (ATK +8) for 4d8 magic; the even-dice chain is manual", () => {
    const plan = runUse("supreme-demiurge-adonix", "Elemental Archon", [3, 5, 2, 4, 6, 8], { followUp: [mira] });
    expect(hitsOf(plan)).toEqual([["mira", 20, "magic", false]]);
    expect(prompts(plan, "manual")[0]!.text).toMatch(/even/);
  });

  it("Elemental Archon 4, Ice Storm: PCs within Close roll Strength or mark 1d4 Stress and are Restrained", () => {
    const step = saveStep(saves(runUse("supreme-demiurge-adonix", "Elemental Archon", [4], { followUp: [mira] }))[0]!);
    expect(step).toMatchObject({ trait: "strength", onFail: [{ kind: "markStress" }, { kind: "condition", endsWhen: "they spend a Hope to escape" }] });
  });

  it("Alpha to Omega: when defeated (once per scene) it clears all HP and Stress; PCs roll Presence or lose a Hope (a Fear each)", () => {
    expect(fires("supreme-demiurge-adonix", "Alpha to Omega", "main", { kind: "onDefeated" })).toBe(true);
    const plan = runUse("supreme-demiurge-adonix", "Alpha to Omega", [], { spotlit: false, self: selfOf("supreme-demiurge-adonix", { hp: 12, stress: 7, defeated: true }), targets: [mira, bram] });
    expect(plan.self.after).toMatchObject({ hp: 0, stress: 0 });
    expect(plan.limit).toMatchObject({ consumed: true });
    expect(saveStep(saves(plan)[0]!)).toMatchObject({ trait: "presence", onFail: [{ kind: "hope", change: "lose" }, { kind: "fear", change: "gain" }] });
  });

  it("Forsaken: Omega form only; a Fear starts a 1d8 countdown on a PC; ticks on its spotlight; ends on Severe damage", () => {
    const omega = ["Adonix is in Omega form"];
    expect(attempt("supreme-demiurge-adonix", "Forsaken", { targets: [mira] })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("supreme-demiurge-adonix", "Forsaken", [5], { targets: [mira], situations: omega });
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "countdown")[0]).toMatchObject({ op: "start", label: "Forsaken", start: 5, onTrigger: "The PC must mark all their HP." });
    expect(after(plan, "mira")!.tags).toEqual(["Forsaken"]);
    expect(ofKind(runUse("supreme-demiurge-adonix", "Forsaken", [], { useId: "tick", spotlit: false, situations: omega }), "countdown")[0]!.op).toBe("tick");
    expect(fires("supreme-demiurge-adonix", "Forsaken", "end", { kind: "onDamaged", stage: "did", severity: "severe" })).toBe(true);
  });

  it("Armageddon: defeated again in Omega form, a d6 of 5–6 means every PC makes a death move (manual)", () => {
    const omega = ["Adonix is in Omega form"];
    expect(prompts(runUse("supreme-demiurge-adonix", "Armageddon", [5], { spotlit: false, situations: omega, picked: [mira, bram] }), "manual")[0]!.targetIds).toEqual(["mira", "bram"]);
    expect(prompts(runUse("supreme-demiurge-adonix", "Armageddon", [4], { spotlit: false, situations: omega, picked: [mira] }), "manual")).toEqual([]);
  });
});

describe("Temporal Enforcer (HF p.96)", () => {
  it("Time Looper: countdown (Loop 2d6) when it appears; when it triggers it clears all HP and Stress; rerolled on Severe damage", () => {
    expect(ofKind(runUse("temporal-enforcer", "Time Looper", [2, 5], { useId: "activate", spotlit: false }), "countdown")[0]).toMatchObject({ start: 7, loop: true });
    const plan = runUse("temporal-enforcer", "Time Looper", [], { useId: "trigger", spotlit: false, self: selfOf("temporal-enforcer", { hp: 5, stress: 3, conditions: ["vulnerable", "restrained"] }) });
    expect(plan.self.after).toMatchObject({ hp: 0, stress: 0, conditions: [] });
    expect(prompts(plan, "manual")[0]!.text).toMatch(/other condition/);
    expect(ofKind(runUse("temporal-enforcer", "Time Looper", [6, 6], { useId: "reroll", spotlit: false }), "countdown")[0]).toMatchObject({ op: "start", start: 12 });
  });

  it("Move Between Moments: a Stress, teleport within Very Far, spotlight again", () => {
    const plan = runUse("temporal-enforcer", "Move Between Moments", []);
    expect(plan.self.after.stress).toBe(1);
    expect(ofKind(plan, "spotlight")[0]!.who).toBe("self");
  });

  it("Instant Rewind and Invert Polarity: a Fear to reroll a missed attack; three times per scene a Fear flips a die", () => {
    expect(fires("temporal-enforcer", "Instant Rewind", "main", { kind: "onMiss", attack: "standard" })).toBe(true);
    expect(ofKind(runUse("temporal-enforcer", "Instant Rewind", [], { spotlit: false }), "fold")[0]!.step).toMatchObject({ kind: "modifyRoll", change: { kind: "reroll", dice: "all" } });
    let uses = runUse("temporal-enforcer", "Invert Polarity", [], { spotlit: false }).self.featureUses;
    uses = runUse("temporal-enforcer", "Invert Polarity", [], { spotlit: false, featureUses: uses }).self.featureUses;
    uses = runUse("temporal-enforcer", "Invert Polarity", [], { spotlit: false, featureUses: uses }).self.featureUses;
    expect(attempt("temporal-enforcer", "Invert Polarity", { spotlit: false, featureUses: uses })).toMatchObject({ reason: "exhausted" });
  });
});

describe("Water Mother (HF p.96)", () => {
  it("Segmented: an attack that damages her with the Head in range deals an extra 1d10 (the GM confirms the Head)", () => {
    expect(attempt("water-mother", "Segmented", { spotlit: false })).toMatchObject({ ok: false, reason: "requirement" });
    const plan = runUse("water-mother", "Segmented", [7], { spotlit: false, situations: ["The Water Mother's Head is within range of the attack"] });
    expect(ofKind(plan, "fold")[0]).toMatchObject({ step: { kind: "modifyDamage" }, amount: 7 });
  });

  it("Eat the World: a Fear; Strength roll or a Stress and pulled to the Head; then a standard attack on everyone in Melee", () => {
    const plan = runUse("water-mother", "Eat the World", [], { targets: [mira, bram] });
    expect(plan.fearSpent).toBe(1);
    expect(saveStep(saves(plan)[0]!)).toMatchObject({ trait: "strength", onFail: [{ kind: "markStress" }, { kind: "move", mode: "pull" }] });
    const attack = runUse("water-mother", "Eat the World", [4, 1, 1, 1, 1], { useId: "attack", targets: [mira, bram] });
    expect(attack.fearSpent).toBe(0);
    expect(hitsOf(attack)).toEqual([["mira", 9, "physical", false]]);
  });

  it("Constrict: a Stress, an attack in Melee of the Center: 4d8+8 and temporarily Restrained; a Stress each GM turn: Restrained PCs mark a HP", () => {
    const plan = runUse("water-mother", "Constrict", [4, 1, 1, 1, 1], { targets: [mira] });
    expect(hitsOf(plan)).toEqual([["mira", 12, "physical", false]]);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ condition: { condition: "restrained" }, duration: "temporary" });
    expect(fires("water-mother", "Constrict", "squeeze", { kind: "timing", at: "gmTurnStart" })).toBe(true);
    const squeeze = runUse("water-mother", "Constrict", [], { useId: "squeeze", spotlit: false, targets: [pc("rex", { conditions: ["restrained"] }), mira] });
    expect(squeeze.self.after.stress).toBe(1);
    expect(squeeze.creatures.map((c) => [c.id, c.after.hp])).toEqual([["rex", 1]]);
  });

  it("Venom Surge: after a standard-attack hit, a Fear makes the target Vulnerable for the scene", () => {
    const plan = runUse("water-mother", "Venom Surge", [], { spotlit: false, trigger: { subject: mira } });
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "condition")[0]).toMatchObject({ targetId: "mira", duration: "scene" });
  });
});

describe("Wyrmfiend (HF p.97)", () => {
  it("Venomous Bite: a Fear; 4d4+4 physical and Poisoned (the d6 before each action roll is manual)", () => {
    const plan = runUse("wyrmfiend", "Venomous Bite", [10, 1, 2, 3, 4], { targets: [mira] });
    expect(hitsOf(plan)).toEqual([["mira", 14, "physical", false]]);
    expect(after(plan, "mira")!.tags).toEqual(["Poisoned"]);
    expect(prompts(plan, "manual")).toHaveLength(1);
  });
});

describe("Wyrmlings (HF p.97)", () => {
  it("Ravenous: when a PC marks HP from its attack, a Fear spotlights the Wyrmlings again", () => {
    expect(fires("wyrmlings", "Ravenous", "main", { kind: "onTargetMarksHp", attack: "standard" })).toBe(true);
    const plan = runUse("wyrmlings", "Ravenous", [], { spotlit: false });
    expect(plan.fearSpent).toBe(1);
    expect(ofKind(plan, "spotlight")[0]!.who).toBe("self");
  });

  it("Overwhelm: Minor damage (1 HP) from an attack in Melee lets a Stress buy a standard attack with advantage on the attacker", () => {
    expect(fires("wyrmlings", "Overwhelm", "main", { kind: "onMarkHp", stage: "did", amount: 1, last: false, fromAttack: true, attackerBand: "melee" })).toBe(true);
    expect(fires("wyrmlings", "Overwhelm", "main", { kind: "onMarkHp", stage: "did", amount: 2, last: false, fromAttack: true, attackerBand: "melee" })).toBe(false);
    const plan = runUse("wyrmlings", "Overwhelm", [2, 11, 1, 1, 1, 1], { spotlit: false, trigger: { source: mira } });
    expect(hitsOf(plan)).toEqual([["mira", 14, "physical", false]]);
  });
});

describe("Xero the Castle Killer (HF p.97)", () => {
  it("Collateral Damage: can't be Restrained", () => {
    expect(passiveSummary(effectsOf("xero-the-castle-killer"), state()).flags).toEqual(["cannotBeRestrained"]);
  });

  it("Gigaton Stomp: a Fear; Melee PCs take 4d12 and are Restrained; creatures within Close roll Instinct or are knocked back", () => {
    const plan = runUse("xero-the-castle-killer", "Gigaton Stomp", [1, 2, 3, 4], { targets: [mira], followUp: [bram] });
    expect(hitsOf(plan)).toEqual([["mira", 10, "physical", false]]);
    expect(after(plan, "mira")!.conditions).toEqual(["restrained"]);
    expect(saves(plan)[0]!.targetIds).toEqual(["bram"]);
    const landing = saveStep(saves(plan)[0]!).onFail[1] as Extract<AdversaryStep, { kind: "choose" }>;
    expect(landing.options.map((o) => o.id)).toEqual(["armor", "damage"]);
  });

  it("Power Slide: a Stress, move up to Close; PCs moved through roll Strength or pick 2 Armor Slots or Severe damage", () => {
    const plan = runUse("xero-the-castle-killer", "Power Slide", [], { targets: [mira, bram] });
    expect(plan.self.after.stress).toBe(1);
    const choose = saveStep(saves(plan)[0]!).onFail[0] as Extract<AdversaryStep, { kind: "choose" }>;
    expect(choose.options[0]!.steps).toEqual([{ kind: "markArmor", to: "targets", amount: { kind: "fixed", value: 2 } }]);
    expect(choose.options[1]!.steps[0]).toMatchObject({ kind: "manual" });
  });

  it("Radioactive Breath: a Fear charges a token (once until Severe damage); the beam spends it", () => {
    const charge = runUse("xero-the-castle-killer", "Radioactive Breath", [], { useId: "charge" });
    expect(charge).toMatchObject({ fearSpent: 1, self: { tokens: { before: 0, after: 1 } } });
    expect(attempt("xero-the-castle-killer", "Radioactive Breath", { useId: "charge", featureUses: charge.self.featureUses })).toMatchObject({ reason: "exhausted" });
    expect(attempt("xero-the-castle-killer", "Radioactive Breath", { useId: "beam" })).toMatchObject({ reason: "requirement" });
    const beam = runUse("xero-the-castle-killer", "Radioactive Breath", [], { useId: "beam", tokens: 1, targets: [mira, bram] });
    expect(beam.self.tokens.after).toBe(0);
    expect(saveStep(saves(beam)[0]!)).toMatchObject({ trait: "agility", onFail: [{ direct: true }], onSuccess: [{ scale: "half" }] });
    const recharge = runUse("xero-the-castle-killer", "Radioactive Breath", [], { useId: "recharge", spotlit: false });
    expect(ofKind(recharge, "fold")[0]!.step.kind).toBe("refreshFeature");
  });

  it("Regeneration: up to three times per scene, N Fear clears N HP", () => {
    const hurt = selfOf("xero-the-castle-killer", { hp: 6 });
    expect(attempt("xero-the-castle-killer", "Regeneration", { self: hurt, eitherCosts: [3], fearConfirmed: false })).toMatchObject({ reason: "confirmFear", detail: "4" });
    const plan = runUse("xero-the-castle-killer", "Regeneration", [], { self: hurt, eitherCosts: [3] });
    expect(plan).toMatchObject({ fearSpent: 4, self: { after: { hp: 2 } } });
    expect(plan.limit).toMatchObject({ consumed: true });
  });
});
