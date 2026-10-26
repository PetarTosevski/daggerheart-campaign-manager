import { describe, expect, it } from "vitest";

import { encounterAdversaryFields } from "../../../convex/lib/validators/encounters";
import {
  activePassives,
  matchesTrigger,
  passiveSummary,
  spotlightCost,
  triggeredUses,
  unmetAdversaryRequirements,
  type AdversaryState,
} from "@/lib/domain/adversary-actions";
import type { AdversaryFeatureEffect } from "@/lib/domain/adversary-effects/types";

// Plan combat-actions, tracer AA1: requirements, passives, triggers (AR8, CB p.195) and spotlight costs (AR6, CB p.153).

const fixed = (value: number) => ({ kind: "fixed" as const, value });

const state = (over: Partial<AdversaryState> = {}): AdversaryState => ({ hp: 0, hpMax: 6, stress: 0, stressMax: 3, conditions: [], tokens: 0, ...over });

const effects: AdversaryFeatureEffect[] = [
  {
    adversaryId: "x",
    feature: "Momentum",
    uses: [{ id: "main", activation: { kind: "auto", trigger: { kind: "onHit", attack: "any" } }, needsSpotlight: false, steps: [{ kind: "fear", to: "self", change: "gain", amount: fixed(1) }] }],
  },
  {
    adversaryId: "x",
    feature: "Retaliate",
    uses: [
      {
        id: "main",
        activation: { kind: "reaction", trigger: { kind: "onDamaged", minSeverity: "major", attackerWithin: "melee" } },
        needsSpotlight: false,
        steps: [{ kind: "manual", to: "self", text: "Strike back." }],
      },
    ],
  },
  {
    adversaryId: "x",
    feature: "Pool",
    uses: [
      {
        id: "main",
        activation: { kind: "passive" },
        needsSpotlight: false,
        modifiers: [
          { kind: "mod", mod: { kind: "stat", stat: "attack", delta: { kind: "cardTokens" } } },
          { kind: "mod", mod: { kind: "resistance", type: "physical", level: "resistant" } },
          { kind: "mod", mod: { kind: "flag", flag: "flying" } },
          { kind: "relentless", times: 2 },
          { kind: "directAttacks" },
          { kind: "attackDamage", add: fixed(2), type: "magic" },
          { kind: "conditionAura", condition: { kind: "standard", condition: "vulnerable" }, to: "pcs", within: "close" },
        ],
        steps: [],
      },
    ],
  },
  {
    adversaryId: "x",
    feature: "Frenzy",
    uses: [{ id: "main", activation: { kind: "passive" }, needsSpotlight: false, requires: [{ kind: "hpMarkedAtLeast", value: "half" }], modifiers: [{ kind: "horde", damage: { kind: "dice", dice: { count: fixed(2), sides: 6, plus: fixed(1) } } }, { kind: "spotlightCostsFear" }], steps: [] }],
  },
];

describe("requirements", () => {
  it("checks HP and Stress marks, conditions, tokens, situations and allies nearby (no map: holds, Q18)", () => {
    expect(unmetAdversaryRequirements([{ kind: "hpMarkedAtLeast", value: 3 }], state({ hp: 2 }))).toHaveLength(1);
    expect(unmetAdversaryRequirements([{ kind: "hpMarkedAtLeast", value: "half" }], state({ hp: 3 }))).toEqual([]);
    expect(unmetAdversaryRequirements([{ kind: "hpMarkedAtMost", value: 0 }, { kind: "stressMarkedAtMost", value: 0 }], state({ stress: 1 }))).toHaveLength(1);
    expect(unmetAdversaryRequirements([{ kind: "hasCondition", condition: { kind: "tag", tag: "On Fire" } }], state({ tags: ["On Fire"] }))).toEqual([]);
    expect(unmetAdversaryRequirements([{ kind: "tokens", atMost: 0 }], state({ tokens: 1 }))).toHaveLength(1);
    expect(unmetAdversaryRequirements([{ kind: "situation", text: "While flying" }], state())).toHaveLength(1);
    const ally = { kind: "allyWithin" as const, range: "melee" as const, of: "target" as const, name: "Dire Wolf" };
    expect(unmetAdversaryRequirements([ally], state())).toEqual([]);
    expect(unmetAdversaryRequirements([ally], state({ allyWithin: () => false }))).toHaveLength(1);
  });
});

describe("passives", () => {
  it("sums the passives in force; Pool's bonus reads the stat-block tokens; gated passives wait for their requirement", () => {
    const s = passiveSummary(effects, state({ tokens: 3 }));
    expect(s).toMatchObject({
      attackBonus: 3,
      resistance: { physical: "resistant", magic: "none" },
      flags: ["flying"],
      relentless: 2,
      directAttacks: true,
      attackDamageAdd: 2,
      attackDamageType: "magic",
      horde: null,
      spotlightCostsFear: false,
    });
    expect(s.auras).toHaveLength(1);
    expect(activePassives(effects, state())).toHaveLength(1);
    expect(passiveSummary(effects, state({ hp: 3 }))).toMatchObject({ horde: "2d6+1", spotlightCostsFear: true });
  });
});

describe("triggers (AR8)", () => {
  it("Momentum fires on any hit (auto); Retaliate on Major or worse from Melee (a one-tap prompt, Q19)", () => {
    expect(triggeredUses(effects, { kind: "onHit", attack: "standard" }, state()).map((t) => [t.effect.feature, t.mode])).toEqual([["Momentum", "auto"]]);
    const big = triggeredUses(effects, { kind: "onDamaged", stage: "did", severity: "severe", attackerBand: "melee" }, state());
    expect(big.map((t) => [t.effect.feature, t.mode])).toEqual([["Retaliate", "reaction"]]);
    expect(triggeredUses(effects, { kind: "onDamaged", stage: "did", severity: "minor" }, state())).toEqual([]);
    expect(triggeredUses(effects, { kind: "onDamaged", stage: "did", severity: "major", attackerBand: "far" }, state())).toEqual([]);
    // No map: the attacker's band is unknown, so the range narrowing holds (Q18).
    expect(triggeredUses(effects, { kind: "onDamaged", stage: "did", severity: "major" }, state())).toHaveLength(1);
  });

  it("matches the narrowings of the other trigger kinds", () => {
    expect(matchesTrigger({ kind: "onHit", attack: "standard" }, { kind: "onHit", attack: "feature" })).toBe(false);
    expect(matchesTrigger({ kind: "onHit", targetHas: { kind: "standard", condition: "vulnerable" } }, { kind: "onHit", attack: "standard", target: { conditions: ["vulnerable"] } })).toBe(true);
    expect(matchesTrigger({ kind: "onHit", withAdvantage: true }, { kind: "onHit", attack: "standard" })).toBe(false);
    expect(matchesTrigger({ kind: "onHit", beyond: "melee" }, { kind: "onHit", attack: "standard", band: "melee" })).toBe(false);
    expect(matchesTrigger({ kind: "onAttack", stage: "beforeDamage" }, { kind: "onAttack", stage: "before", attack: "standard" })).toBe(false);
    expect(matchesTrigger({ kind: "onDealDamage", minSeverity: "severe", toPc: true }, { kind: "onDealDamage", severity: "severe", toPc: true })).toBe(true);
    expect(matchesTrigger({ kind: "onDamaged", stage: "would", damageType: "magic" }, { kind: "onDamaged", stage: "would", damageType: "physical" })).toBe(false);
    expect(matchesTrigger({ kind: "onDamaged", first: "scene" }, { kind: "onDamaged", stage: "did", first: { scene: true, ever: false } })).toBe(true);
    expect(matchesTrigger({ kind: "onMarkHp", atLeast: 2 }, { kind: "onMarkHp", stage: "did", amount: 1, last: false })).toBe(false);
    expect(matchesTrigger({ kind: "onMarkHp", last: true }, { kind: "onMarkHp", stage: "did", amount: 2, last: true })).toBe(true);
    expect(matchesTrigger({ kind: "onHpMarkedAtLeast", value: "half" }, { kind: "onHpMarked", before: 2, after: 3, hpMax: 6 })).toBe(true);
    expect(matchesTrigger({ kind: "onHpMarkedAtLeast", value: "half" }, { kind: "onHpMarked", before: 3, after: 4, hpMax: 6 })).toBe(false);
    expect(matchesTrigger({ kind: "onMarkStress", last: true }, { kind: "onMarkStress", last: false })).toBe(false);
    expect(matchesTrigger({ kind: "onDefeated", damageType: "physical" }, { kind: "onDefeated", damageType: "both" })).toBe(true);
    expect(matchesTrigger({ kind: "allyDefeated", allyName: "Leader" }, { kind: "allyDefeated", allyName: "Lackey" })).toBe(false);
    expect(matchesTrigger({ kind: "allyDealtDamage", range: "close" }, { kind: "allyDealtDamage", band: "close" })).toBe(true);
    expect(matchesTrigger({ kind: "onAttacked", stage: "failed", weapon: true }, { kind: "onAttacked", stage: "failed", weapon: true })).toBe(true);
    const roll = { kind: "action" as const, trait: "presence" as const, success: false, withHope: false, withFear: true, total: 12 };
    expect(matchesTrigger({ kind: "pcRolls", roll: "presence", result: "failureWithFear", within: "close" }, { kind: "pcRolls", roll, band: "veryClose" })).toBe(true);
    expect(matchesTrigger({ kind: "pcRolls", roll: "spellcast" }, { kind: "pcRolls", roll })).toBe(false);
    expect(matchesTrigger({ kind: "pcRolls", totalAtMost: 14, againstSelf: true }, { kind: "pcRolls", roll, againstSelf: true })).toBe(true);
    expect(matchesTrigger({ kind: "pcMoves", outOf: "melee" }, { kind: "pcMoves", outOf: "melee" })).toBe(true);
    expect(matchesTrigger({ kind: "pcMarksHp", minSeverity: "severe" }, { kind: "pcMarksHp", severity: "major" })).toBe(false);
    expect(matchesTrigger({ kind: "pcHope", change: "gain" }, { kind: "pcHope", change: "spend" })).toBe(false);
    expect(matchesTrigger({ kind: "onSpotlight", noTokens: true }, { kind: "onSpotlight", tokens: 0 })).toBe(true);
    expect(matchesTrigger({ kind: "allySpotlit", range: "far" }, { kind: "allySpotlit", band: "veryFar" })).toBe(false);
    expect(matchesTrigger({ kind: "wouldGainCondition", condition: { kind: "standard", condition: "restrained" } }, { kind: "wouldGainCondition", condition: { kind: "standard", condition: "restrained" } })).toBe(true);
    expect(matchesTrigger({ kind: "timing", at: "appears" }, { kind: "timing", at: "combatStart" })).toBe(false);
    expect(matchesTrigger({ kind: "situation", text: "Eggs threatened" }, { kind: "situation", text: "Eggs threatened" })).toBe(true);
    expect(matchesTrigger({ kind: "onDefeatPc" }, { kind: "onMiss", attack: "standard" })).toBe(false);
  });
});

describe("spotlight (AR6; CB p.153, p.195)", () => {
  it("the first spotlight of a GM turn is free; each further one costs 1 Fear; Relentless raises the limit", () => {
    expect(spotlightCost({ spotlightsThisTurn: 0, instanceSpotlights: 0, relentless: null })).toEqual({ fear: 0, overLimit: false });
    expect(spotlightCost({ spotlightsThisTurn: 1, instanceSpotlights: 0, relentless: null })).toEqual({ fear: 1, overLimit: false });
    expect(spotlightCost({ spotlightsThisTurn: 1, instanceSpotlights: 1, relentless: null })).toEqual({ fear: 1, overLimit: true });
    expect(spotlightCost({ spotlightsThisTurn: 2, instanceSpotlights: 1, relentless: 3 }).overLimit).toBe(false);
    expect(spotlightCost({ spotlightsThisTurn: 9, instanceSpotlights: 9, relentless: "X" }).overLimit).toBe(false);
    expect(spotlightCost({ spotlightsThisTurn: 0, instanceSpotlights: 0, relentless: null, costsFear: true }).fear).toBe(1);
  });
});

describe("encounter instances carry stat-block tokens (widen only, rule 7)", () => {
  it("`tokens` is an optional number, so existing rows still validate", () => {
    expect(encounterAdversaryFields.tokens.isOptional).toBe("optional");
    expect(encounterAdversaryFields.tokens.kind).toBe("float64");
  });
});
