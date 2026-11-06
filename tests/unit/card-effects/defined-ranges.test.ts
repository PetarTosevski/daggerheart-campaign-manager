import { describe, expect, it } from "vitest";

import { outOfRange } from "@/components/combat-map/actions/hand/model";
import { rangeRows } from "@/components/combat-map/actions/adversary/model";
import { chainRows } from "@/components/combat-map/hud/pick-area/chain";
import { outside, placementProblem, previewRadius, summaryText, type AreaAsk } from "@/components/combat-map/hud/pick-area/model";
import { buildRows } from "@/components/combat-map/hud/pick/model";
import { rangeGate } from "@/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect } from "@/lib/domain/adversary-effects/types";
import { stateCheckMet, unmetRequirements, type RequirementState } from "@/lib/domain/card-effects/availability";
import { rangeAsk, rangeAskNotes, rangeCounts } from "@/lib/domain/card-effects/rule-notes";
import { rangeBlind, run, type ActorState, type PlanStep, type RunContext, type RunPlan } from "@/lib/domain/card-effects/run";
import type { CardEffect, CardUse, NumberSource } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import type { MapCreature } from "@/lib/domain/combat-actions/numbers";
import { queueRng } from "@/lib/domain/dice";

// Plan rule-switches ODR2 (docs/tasks/TASK-RULES-ODR2.md; user 2026-11-06 on dcm-bxp.134): with the optional rule
// Defined Ranges (CB p.103) off, effects that pick or count creatures by range don't apply on their own and the GM is
// asked who is in range; the client's range marks, previews and bands follow the switch. On: unchanged.



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
  level: 3,
  tier: 2,
  loadoutDomains: ["arcana"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8+1 phy", trait: "finesse", damageType: "physical", range: "melee" } },
  ...over,
});

const adv = (id: string): Combatant => ({ id, side: "adversary", difficulty: 12, thresholds: { major: 8, severe: 14 }, hp: 0, hpMax: 5, stress: 0, stressMax: 3, defeated: false, conditions: [] });

const card = (use: Partial<CardUse>): CardEffect => ({ cardId: "odr2-card", uses: [{ id: "main", name: "Test", activation: { kind: "action" }, steps: [], ...use }] });
const ctx = (over: Partial<RunContext> = {}): RunContext => ({ actor: actor(), gmFear: 2, rng: queueRng([]), ...over });
const ok = (r: ReturnType<typeof run>): RunPlan => {
  if (!r.ok) throw new Error(`refused: ${r.reason} ${r.detail}`);
  return r.plan;
};
const incoming = (plan: RunPlan) => plan.steps.filter((s): s is Extract<PlanStep, { kind: "damage" }> => s.kind === "damage").map((s) => s.result.incoming);

const oneEnemy = { side: "enemy" as const, range: "far" as const, count: { kind: "one" as const } };
const HIVE: NumberSource = { kind: "creatureCount", side: "enemies", within: "close" };
const hive = card({ targets: oneEnemy, steps: [{ kind: "damage", to: "targets", roll: { kind: "flat", amount: HIVE }, type: "physical" }] });
const map: MapCreature[] = [
  { id: "self", side: "self", pc: true, fromSelf: 0 },
  { id: "a", side: "enemy", pc: false, fromSelf: 2 },
  { id: "b", side: "enemy", pc: false, fromSelf: 20 },
];

describe("ODR2: the card runner with Defined Ranges off", () => {
  it("a creatureCount within a range counts by squares when on, counts no one when off", () => {
    expect(incoming(ok(run(hive, ctx({ targets: [adv("a")], creatures: map }))))).toEqual([1]);
    expect(incoming(ok(run(hive, ctx({ targets: [adv("a")], creatures: map, definedRanges: false }))))).toEqual([0]);
  });

  it("a count with no range still counts (Stolen Armor: 'the number of PCs')", () => {
    const all = card({ targets: oneEnemy, steps: [{ kind: "damage", to: "targets", roll: { kind: "flat", amount: { kind: "creatureCount", side: "enemies" } }, type: "physical" }] });
    expect(incoming(ok(run(all, ctx({ targets: [adv("a")], creatures: map, definedRanges: false }))))).toEqual([2]);
  });

  it("rangeBlind drops squares and footprints only when off", () => {
    expect(rangeBlind(map, undefined)).toBe(map);
    expect(rangeBlind([{ id: "a", side: "enemy", pc: false, fromSelf: 2, fromTarget: 3, at: { x: 1, y: 1 } }], false)).toEqual([{ id: "a", side: "enemy", pc: false }]);
  });
});

describe("ODR2: requirement and situation checks", () => {
  const base: RequirementState = { hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, hope: 2, armorWorn: true, loadoutDomains: [], activeCardEffects: [], situations: [], nearestEnemy: 1, facts: { nearestAlly: 1, target: { conditions: [], hp: 0, hpMax: 5, distance: 1 } } as RequirementState["facts"] };

  it("within / allyNear / isolated are decided by squares when on and left to the player when off", () => {
    expect(stateCheckMet({ kind: "within", who: "target", range: "melee" }, base)).toBe(true);
    expect(stateCheckMet({ kind: "within", who: "target", range: "melee" }, { ...base, definedRanges: false })).toBeUndefined();
    expect(stateCheckMet({ kind: "allyNear", of: "self", range: "melee" }, base)).toBe(true);
    expect(stateCheckMet({ kind: "allyNear", of: "self", range: "melee" }, { ...base, definedRanges: false })).toBeUndefined();
    expect(stateCheckMet({ kind: "isolated", who: "self", range: "close" } as never, { ...base, definedRanges: false })).toBeUndefined();
  });

  it("noEnemyWithin holds when off (Arcane Door: the GM judges)", () => {
    expect(unmetRequirements([{ kind: "noEnemyWithin", range: "melee" }], base).length).toBe(1);
    expect(unmetRequirements([{ kind: "noEnemyWithin", range: "melee" }], { ...base, definedRanges: false })).toEqual([]);
  });
});

describe("ODR2: the GM's notes (rule-notes.ts)", () => {
  it("rangeAsk names the effect and the range", () => {
    expect(rangeAsk("Ill Omen", "close")).toBe("Ill Omen: who is within Close range?");
    expect(rangeAsk("Elemental Incarnation", "veryClose")).toBe("Elemental Incarnation: who is within Very Close range?");
  });

  it("rangeAskNotes: one note for a use counting creatures by range, only when off", () => {
    const use = hive.uses[0]!;
    expect(rangeCounts(use)).toEqual(["close"]);
    expect(rangeAskNotes("Hive Mind", use, true)).toEqual([]);
    expect(rangeAskNotes("Hive Mind", use, undefined)).toEqual([]);
    expect(rangeAskNotes("Hive Mind", use, false)).toEqual(["Hive Mind: who is within Close range?"]);
    expect(rangeAskNotes("Plain", card({ steps: [] }).uses[0]!, false)).toEqual([]);
  });
});

describe("ODR2: the adversary runner's range gate", () => {
  it("Ill Omen's 'a PC within Close range' trigger is gated by Close; an action is not gated", () => {
    const illOmen = { feature: "Ill Omen", uses: [{ id: "main", activation: { kind: "auto", trigger: { kind: "pcRolls", roll: "action", within: "close" } }, steps: [] }] } as unknown as AdversaryFeatureEffect;
    const action = { feature: "Bite", uses: [{ id: "main", activation: { kind: "action" }, steps: [] }] } as unknown as AdversaryFeatureEffect;
    expect(rangeGate(illOmen)).toBe("close");
    expect(rangeGate(action)).toBeNull();
  });
});

describe("ODR2: client range marks follow the switch", () => {
  const self = { tokenId: "s", name: "Ash", side: "self" as const, at: { x: 0, y: 0 } };
  const far = { tokenId: "f", name: "Bear", side: "enemy" as const, at: { x: 30, y: 0 } };
  const ask = { side: "enemy" as const, range: "close" as const, count: { kind: "one" as const } };

  it("hand model: a Very Far creature is out of a Close card's range only when on", () => {
    expect(outOfRange(ask as never, [self, far] as never, [], far as never)).toBe(true);
    expect(outOfRange(ask as never, [self, far] as never, [], far as never, false)).toBe(false);
  });

  it("pick rows: no out-of-range row and no band when off", () => {
    const rule = { side: "enemy", range: "close", max: 1, locked: false, slot: "primary" } as never;
    const on = buildRows({ creatures: [self, far] as never, rule, hints: undefined, picked: [] });
    const off = buildRows({ creatures: [self, far] as never, rule, hints: undefined, picked: [], definedRanges: false });
    expect(on.find((r) => r.tokenId === "f")).toMatchObject({ reach: "out", band: "veryFar" });
    expect(off.find((r) => r.tokenId === "f")).toMatchObject({ reach: "in", band: null });
  });

  it("adversary range rows: every PC in attack range when off", () => {
    const pcs = [{ x: 30, y: 0, characterId: "c", name: "Mira" }];
    expect(rangeRows({ x: 0, y: 0 }, pcs, null, "Melee")[0]!.inAttackRange).toBe(false);
    expect(rangeRows({ x: 0, y: 0 }, pcs, null, "Melee", false)[0]!.inAttackRange).toBe(true);
  });

  it("area pick: no preview circle, no amber square, no placement problem and no squares in the summary when off", () => {
    const area: AreaAsk = { name: "Dark Cloud", label: "Dark Cloud", shape: "circle", count: 1, radius: "close", within: "close", origin: { x: 0, y: 0, size: 1 } };
    const off = { ...area, definedRanges: false };
    expect(previewRadius(area)).toBe(6.5);
    expect(previewRadius(off)).toBeNull();
    expect(outside(area, { x: 30, y: 0 })).toBe(true);
    expect(outside(off, { x: 30, y: 0 })).toBe(false);
    expect(placementProblem(area, [{ x: 30, y: 0 }])).not.toBeNull();
    expect(placementProblem(off, [{ x: 30, y: 0 }])).toBeNull();
    expect(summaryText(area, [])).toBe("Radius: Close (6 squares)");
    expect(summaryText(off, [])).toBe("Radius: Close");
  });

  it("chain rows: no band when off", () => {
    const creatures = [
      { tokenId: "a", name: "A", side: "enemy", at: { x: 0, y: 0 } },
      { tokenId: "b", name: "B", side: "enemy", at: { x: 2, y: 0 } },
    ] as never;
    expect(chainRows(["b"], creatures, ["a"])[0]!.band).toBe("veryClose");
    expect(chainRows(["b"], creatures, ["a"], false)[0]!.band).toBeNull();
  });
});

