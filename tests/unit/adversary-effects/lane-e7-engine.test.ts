import { describe, expect, it } from "vitest";

import { adversaryRequirementMet, adversaryStateCheck, matchesTrigger, passiveSummary, type AdversaryState } from "@/lib/domain/adversary-actions";
import { run, type AdversaryPlan, type AdversaryRunContext } from "@/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect, AdversaryFeatureUse, AdversaryStep } from "@/lib/domain/adversary-effects/types";
import type { NumberSource, RollSpec } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

// Plan lanes, tracer E7 (docs/tasks/TASK-LN-E7.md): the adversary engine reads the vocabulary tracer V widened. Fixture
// entries only (wave 5 switches the SRD entries over). RNG order as in the AE tables: d20s, damage dice in step order,
// then prompt numbers.

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const ATTACK: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" } };

const self = (over: Partial<Combatant> = {}): Combatant => ({
  id: "adv-1",
  side: "adversary",
  difficulty: 14,
  thresholds: { major: 8, severe: 15 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
  ...over,
});

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

const effect = (...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({ adversaryId: "fixture", feature: "Fixture", uses });
const reaction = (steps: AdversaryStep[], over: Partial<AdversaryFeatureUse> = {}): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "reaction", trigger: { kind: "situation", text: "now" } },
  needsSpotlight: false,
  steps,
  ...over,
});
const action = (steps: AdversaryStep[], over: Partial<AdversaryFeatureUse> = {}): AdversaryFeatureUse => ({
  id: "main",
  activation: { kind: "action" },
  needsSpotlight: true,
  steps,
  ...over,
});

const ctx = (dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunContext => ({
  adversaryId: "fixture",
  self: self(),
  attack: { name: "Claws", modifier: 3, range: "Melee", damage: "1d6+2 phy" },
  tier: 1,
  gmFear: 5,
  spotlit: true,
  fearConfirmed: true,
  targets: [],
  rng: queueRng(dice),
  ...over,
});

const ok = (e: AdversaryFeatureEffect, dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryPlan => {
  const r = run(e, ctx(dice, over));
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.detail}`);
  return r.plan;
};

const hit3: AdversaryStep = { kind: "damage", to: "targets", when: ["hit"], roll: { kind: "flat", amount: fixed(3) }, type: "physical" };

describe("dcm-vv2 (1): a follow-up attack gets the stat block's ATK", () => {
  const followUp = (roll: RollSpec): AdversaryFeatureEffect => effect(reaction([{ kind: "followUp", roll, targets: { side: "enemy", range: "melee", count: { kind: "one" } }, steps: [hit3] }]));

  it("a reaction with no roll of its own adds ATK +3 to the follow-up's d20 (9 + 3 = 12 hits Evasion 12)", () => {
    const plan = ok(followUp(ATTACK), [9], { followUp: [mira] });
    expect(plan.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 3 })]);
  });

  it("without the ATK the same d20 would miss: an 8 + 3 = 11 misses", () => {
    expect(ok(followUp(ATTACK), [8], { followUp: [mira] }).incoming).toEqual([]);
  });

  it("passive and instance attack bonuses ride with it", () => {
    const plan = ok(followUp(ATTACK), [7], { followUp: [mira], instance: { attack: 1 }, passives: { ...passiveSummary([], state()), attackBonus: 1 } });
    expect(plan.incoming).toHaveLength(1); // 7 + 3 + 1 + 1 = 12
  });

  it("an entry that wrote the ATK into its own modifier keeps it as written (no double count)", () => {
    expect(ok(followUp({ ...ATTACK, modifier: fixed(3) }), [8], { followUp: [mira] }).incoming).toEqual([]);
  });

  it("a use whose own roll attacks still adds ATK once to its follow-up", () => {
    const e = effect(action([hit3, { kind: "followUp", roll: ATTACK, targets: { side: "enemy", range: "melee", count: { kind: "one" } }, steps: [hit3] }], { roll: ATTACK, targets: { side: "enemy", range: "melee", count: { kind: "one" } } }));
    // first d20 20 (crit, hits), the follow-up's 9 + 3 = 12 hits; 12 + 3 + 3 would also hit, so test the miss edge: 8 + 3.
    const plan = ok(e, [20, 8], { targets: [mira], followUp: [bram] });
    expect(plan.incoming.map((h) => h.targetId)).toEqual(["mira"]);
  });
});

describe("dcm-xyw: attack riders keyed to the target, halved Evasion", () => {
  const attack = (roll: RollSpec = ATTACK) => effect(action([hit3], { roll, targets: { side: "enemy", range: "melee", count: { kind: "upTo", n: fixed(2) } } }));

  it("halveEvasion: Evasion 16 becomes 8 (a d20 of 5 + 3 hits)", () => {
    expect(ok(attack({ ...ATTACK, halveEvasion: true }), [5], { targets: [bram] }).incoming).toHaveLength(1);
    expect(ok(attack(), [5], { targets: [bram] }).incoming).toHaveLength(0);
  });

  it("an odd Evasion halves rounded up (13 → 7)", () => {
    expect(ok(attack({ ...ATTACK, halveEvasion: true }), [3], { targets: [pc("x", { evasion: 13 })] }).incoming).toHaveLength(0); // 6 < 7
    expect(ok(attack({ ...ATTACK, halveEvasion: true }), [4], { targets: [pc("x", { evasion: 13 })] }).incoming).toHaveLength(1);
  });

  it("a rider halves only its bearer's Evasion", () => {
    const plan = ok(attack(), [5], { targets: [bram, pc("cid", { evasion: 16 })], attackedRiders: { bram: [{ by: "caster", halveEvasion: true }] } });
    expect(plan.incoming.map((h) => h.targetId)).toEqual(["bram"]);
  });

  it("direct damage and a damage change against the bearer only (Deathlock, I've Got 'Em)", () => {
    const plan = ok(attack(), [15], { targets: [mira, bram], attackedRiders: { mira: [{ by: "caster", direct: true }], bram: [{ by: "others", damage: { kind: "multiply", factor: 2 } }] } });
    expect(plan.incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 3, direct: true }), expect.objectContaining({ targetId: "bram", amount: 6, direct: false })]);
  });

  it("an added damage of another type makes the hit both types (Tag Team, +1d12 magic)", () => {
    const plan = ok(attack(), [15, 5], { targets: [mira], attackedRiders: { mira: [{ by: "caster", damage: { kind: "add", amount: { kind: "dice", dice: { count: fixed(1), sides: 12 } }, type: "magic" } }] } });
    expect(plan.incoming).toEqual([expect.objectContaining({ amount: 8, type: "both" })]);
  });

  it("advantage when every target carries it: two d20s, the higher counts", () => {
    expect(ok(attack(), [2, 9], { targets: [mira], attackedRiders: { mira: [{ by: "anyone", advantage: true }] } }).incoming).toHaveLength(1);
    expect(ok(attack(), [2, 9], { targets: [mira, bram], attackedRiders: { mira: [{ by: "anyone", advantage: true }] } }).incoming).toHaveLength(0);
  });
});

describe("dcm-1ch: a group attack with advantage", () => {
  it("rolls two d20s and keeps the higher", () => {
    const e = effect(action([hit3], { roll: ATTACK, targets: { side: "enemy", range: "far", count: { kind: "one" } }, groupAttack: { within: "far", advantage: true } }));
    expect(ok(e, [2, 9], { targets: [mira] }).incoming).toHaveLength(1);
  });
});

describe("dcm-702, dcm-145, dcm-icd: death moves, revival, fleeing", () => {
  it("a deathMove step names the PC for a death move and leaves no manual prompt", () => {
    const plan = ok(effect(reaction([{ kind: "deathMove", to: "targets" }], { targets: { side: "enemy", range: "melee", count: { kind: "one" } } })), [], { targets: [mira] });
    expect(plan.deathMoves).toEqual(["mira"]);
    expect(plan.steps.some((s) => s.kind === "prompt")).toBe(false);
  });

  it("revive clears all HP of the defeated instance: it is no longer defeated (Won't Stay Dead)", () => {
    const plan = ok(effect(reaction([{ kind: "revive", to: "self", clearHp: "all" }])), [], { self: self({ hp: 6, defeated: true }) });
    expect(plan.self.after).toMatchObject({ hp: 0, defeated: false });
    expect(plan.revived).toEqual(["adv-1"]);
  });

  it("revive with half its HP cleared brings back an ally (Corpse Whisperer: 6 marked, clears 3)", () => {
    const ally = self({ id: "ally-1", hp: 6, defeated: true });
    const plan = ok(effect(reaction([{ kind: "revive", to: "picked", clearHp: "half", clearStress: true }])), [], { picked: [ally] });
    const entry = plan.creatures.find((c) => c.id === "ally-1");
    expect(entry?.after).toMatchObject({ hp: 3, stress: 0, defeated: false });
  });

  it("leaveScene names who fled and keeps the move prompt for the GM", () => {
    const plan = ok(effect(reaction([{ kind: "move", to: "self", mode: "leaveScene" }])), []);
    expect(plan.fled).toEqual(["adv-1"]);
    expect(plan.steps.some((s) => s.kind === "prompt" && s.prompt === "move")).toBe(true);
  });
});

describe("dcm-145, dcm-m5s: summon HP and countdown direction pass through resolved", () => {
  it("a summon's HP from a number and a decreasing countdown with its event at 0", () => {
    const plan = ok(
      effect(
        reaction([
          { kind: "summon", label: "Horde", count: fixed(1), hp: fixed(4) },
          { kind: "countdown", op: "start", label: "All-Consuming Rage", start: fixed(8), loop: true, direction: "decreasing", onZero: "Unleashed", tickOn: "actionRoll" },
        ]),
      ),
      [],
    );
    expect(plan.steps).toContainEqual(expect.objectContaining({ kind: "summon", count: 1, hp: 4 }));
    expect(plan.steps).toContainEqual(expect.objectContaining({ kind: "countdown", start: 8, direction: "decreasing", onZero: "Unleashed", tickOn: "actionRoll" }));
  });
});

describe("dcm-tal (covered): a Fear gain counted from dice at or above 4", () => {
  it("Cracked Scales: 3d6 rolling 4, 2, 6 gain 2 Fear", () => {
    const plan = ok(effect(reaction([{ kind: "fear", to: "self", change: "gain", amount: { kind: "dice", dice: { count: fixed(3), sides: 6 }, keep: "countAtLeast", atLeast: 4 } }])), [4, 2, 6]);
    expect(plan.gmFearDelta).toBe(2);
  });
});

// ---------------------------------------------------------------- features.ts

function state(over: Partial<AdversaryState> = {}): AdversaryState {
  return { hp: 0, hpMax: 6, stress: 0, stressMax: 3, conditions: [], tags: [], tokens: 0, ...over };
}

describe("dcm-2f3 (adversary side), dcm-cdz: requirements and state checks", () => {
  it("hasCondition lacks: Regeneration only while not Dazed", () => {
    const req = { kind: "hasCondition", condition: { kind: "tag", tag: "Dazed" }, lacks: true } as const;
    expect(adversaryRequirementMet(req, state())).toBe(true);
    expect(adversaryRequirementMet(req, state({ tags: ["Dazed"] }))).toBe(false);
  });

  it("a situation with a check the engine reads decides by itself; an unreadable one waits for the GM", () => {
    const tokens = { kind: "situation", text: "While it has a token", check: { kind: "tokens", atLeast: 1 } } as const;
    expect(adversaryRequirementMet(tokens, state({ tokens: 2 }))).toBe(true);
    expect(adversaryRequirementMet(tokens, state())).toBe(false);
    const map = { kind: "situation", text: "Near water", check: { kind: "within", range: "close", who: "target" } } as const;
    expect(adversaryRequirementMet(map, state())).toBe(false);
    expect(adversaryRequirementMet(map, state({ situations: ["Near water"] }))).toBe(true);
  });

  it("track, not and anyOf on itself", () => {
    expect(adversaryStateCheck({ kind: "track", who: "self", track: "hp", measure: "free", atMost: 2 }, state({ hp: 4 }))).toBe(true);
    expect(adversaryStateCheck({ kind: "not", check: { kind: "hasCondition", condition: { kind: "standard", condition: "hidden" } } }, state())).toBe(true);
    expect(adversaryStateCheck({ kind: "anyOf", checks: [{ kind: "flying" }, { kind: "tokens", atLeast: 1 }] }, state({ tokens: 1 }))).toBe(true);
    expect(adversaryStateCheck({ kind: "anyOf", checks: [{ kind: "flying" }, { kind: "tokens", atLeast: 1 }] }, state())).toBeUndefined();
  });

  it("selfCondition: Hand of Glory is Hidden while its stat block has a token", () => {
    const glory: AdversaryFeatureEffect = effect({
      id: "main",
      activation: { kind: "passive" },
      needsSpotlight: false,
      requires: [{ kind: "tokens", atLeast: 1 }],
      modifiers: [{ kind: "selfCondition", condition: { kind: "standard", condition: "hidden" } }],
      steps: [],
    });
    expect(passiveSummary([glory], state({ tokens: 5 })).selfConditions).toEqual([{ kind: "standard", condition: "hidden" }]);
    expect(passiveSummary([glory], state()).selfConditions).toBeUndefined();
  });

  it("a passive's self condition counts for its own requirements ('While Hidden')", () => {
    const sneak = effect(action([], { requires: [{ kind: "hasCondition", condition: { kind: "standard", condition: "hidden" } }] }));
    const passives = { ...passiveSummary([], state()), selfConditions: [{ kind: "standard" as const, condition: "hidden" as const }] };
    expect(run(sneak, ctx([], { passives })).ok).toBe(true);
    expect(run(sneak, ctx([])).ok).toBe(false);
  });

  it("weakness mods are summed (Made of Straw: fire)", () => {
    const straw = effect({ id: "main", activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "mod", mod: { kind: "weakness", keyword: "fire" } }], steps: [] });
    expect(passiveSummary([straw], state()).weaknesses).toEqual([{ keyword: "fire" }]);
  });
});

describe("dcm-gx1: Relentless (X) from the heads on its stat block", () => {
  it("reads its tokens; at least 1", () => {
    const hydra = effect({ id: "main", activation: { kind: "passive" }, needsSpotlight: false, modifiers: [{ kind: "relentless", times: 5, timesFrom: { kind: "cardTokens" } }], steps: [] });
    expect(passiveSummary([hydra], state({ tokens: 3 })).relentless).toBe(3);
    expect(passiveSummary([hydra], state({ tokens: 0 })).relentless).toBe(1);
  });
});

describe("dcm-2gn: trigger narrowings", () => {
  const roll = { kind: "action" as const, success: true, withHope: false, withFear: true };

  it("pcRolls: success with Fear, failure with Hope, critical, not critical", () => {
    expect(matchesTrigger({ kind: "pcRolls", result: "successWithFear" }, { kind: "pcRolls", roll })).toBe(true);
    expect(matchesTrigger({ kind: "pcRolls", result: "successWithHope" }, { kind: "pcRolls", roll })).toBe(false);
    expect(matchesTrigger({ kind: "pcRolls", result: "failureWithHope" }, { kind: "pcRolls", roll: { ...roll, success: false, withHope: true, withFear: false } })).toBe(true);
    const crit = { ...roll, withHope: true, withFear: false, critical: true };
    expect(matchesTrigger({ kind: "pcRolls", result: "critical" }, { kind: "pcRolls", roll: crit })).toBe(true);
    expect(matchesTrigger({ kind: "pcRolls", notCritical: true }, { kind: "pcRolls", roll: crit })).toBe(false);
    expect(matchesTrigger({ kind: "pcRolls", notCritical: true }, { kind: "pcRolls", roll })).toBe(true);
  });

  it("onDamaged: weapon attacks only; fire only", () => {
    expect(matchesTrigger({ kind: "onDamaged", stage: "would", weaponAttack: true }, { kind: "onDamaged", stage: "would", weaponAttack: true })).toBe(true);
    expect(matchesTrigger({ kind: "onDamaged", stage: "would", weaponAttack: true }, { kind: "onDamaged", stage: "would" })).toBe(false);
    expect(matchesTrigger({ kind: "onDamaged", keyword: "fire" }, { kind: "onDamaged", stage: "did", keywords: ["fire"] })).toBe(true);
    expect(matchesTrigger({ kind: "onDamaged", keyword: "fire" }, { kind: "onDamaged", stage: "did" })).toBe(false);
  });

  it("allyDefeated by type (an allied Leader)", () => {
    expect(matchesTrigger({ kind: "allyDefeated", allyType: "Leader" }, { kind: "allyDefeated", allyType: "leader" })).toBe(true);
    expect(matchesTrigger({ kind: "allyDefeated", allyType: "Leader" }, { kind: "allyDefeated", allyType: "Minion" })).toBe(false);
    expect(matchesTrigger({ kind: "allyDefeated", allyType: "Leader" }, { kind: "allyDefeated" })).toBe(false);
  });

  it("onMarkStress stage, onMarkHp includeZero, onSpotlight byFear", () => {
    expect(matchesTrigger({ kind: "onMarkStress", stage: "would" }, { kind: "onMarkStress", last: false, stage: "would" })).toBe(true);
    expect(matchesTrigger({ kind: "onMarkStress" }, { kind: "onMarkStress", last: false, stage: "would" })).toBe(false);
    expect(matchesTrigger({ kind: "onMarkStress" }, { kind: "onMarkStress", last: false })).toBe(true);
    expect(matchesTrigger({ kind: "onMarkHp", atMost: 1, fromAttack: true, includeZero: true }, { kind: "onMarkHp", stage: "did", amount: 0, last: false, fromAttack: true })).toBe(true);
    expect(matchesTrigger({ kind: "onMarkHp", atMost: 1, fromAttack: true }, { kind: "onMarkHp", stage: "did", amount: 0, last: false, fromAttack: true })).toBe(false);
    expect(matchesTrigger({ kind: "onSpotlight", byFear: true }, { kind: "onSpotlight", tokens: 0, byFear: true })).toBe(true);
    expect(matchesTrigger({ kind: "onSpotlight", byFear: true }, { kind: "onSpotlight", tokens: 0 })).toBe(false);
  });

  it("the V trigger kinds: pcSpotlit, allyAttacks, pcDealsDamage, pcsRest", () => {
    expect(matchesTrigger({ kind: "pcSpotlit", within: "veryClose" }, { kind: "pcSpotlit", band: "melee" })).toBe(true);
    expect(matchesTrigger({ kind: "pcSpotlit", within: "veryClose" }, { kind: "pcSpotlit", band: "far" })).toBe(false);
    expect(matchesTrigger({ kind: "allyAttacks" }, { kind: "allyAttacks", stage: "failed" })).toBe(true);
    expect(matchesTrigger({ kind: "allyAttacks", stage: "failed" }, { kind: "allyAttacks", stage: "succeeded" })).toBe(false);
    expect(matchesTrigger({ kind: "pcDealsDamage", stage: "would" }, { kind: "pcDealsDamage", stage: "would" })).toBe(true);
    expect(matchesTrigger({ kind: "pcDealsDamage" }, { kind: "pcDealsDamage", stage: "would" })).toBe(false);
    expect(matchesTrigger({ kind: "pcsRest", rest: "long" }, { kind: "pcsRest", rest: "short" })).toBe(false);
    expect(matchesTrigger({ kind: "pcsRest" }, { kind: "pcsRest", rest: "short" })).toBe(true);
  });
});
