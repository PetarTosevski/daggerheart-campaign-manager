import { describe, expect, it } from "vitest";

import { gmControlledWeaponAttack, passiveSummary } from "@/lib/domain/adversary-actions";
import { conditionStepsOf, lastingModsOf, run, type AdversaryPlan, type AdversaryRunContext } from "@/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect, AdversaryFeatureUse, AdversaryStep } from "@/lib/domain/adversary-effects/types";
import type { NumberSource, RollSpec } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

import { evolvedBlock, mapCreatures, type Block } from "../../../convex/lib/adversaryFeatures";

// Plan lanes-2, tracer E7 (docs/tasks/TASK-LN2-E7.md): round 2 of the adversary engine. Fixture entries only.

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });
const ATTACK: RollSpec = { kind: "adversaryAttack", difficulty: { kind: "evasion" } };

const combatant = (id: string, over: Partial<Combatant> = {}): Combatant => ({
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
const self = combatant("adv-1", { side: "adversary", difficulty: 14, evasion: undefined, stressMax: 3 });
const mira = combatant("mira");

const effect = (...uses: AdversaryFeatureUse[]): AdversaryFeatureEffect => ({ adversaryId: "fixture", feature: "Fixture", uses });
const reaction = (steps: AdversaryStep[]): AdversaryFeatureUse => ({ id: "main", activation: { kind: "reaction", trigger: { kind: "situation", text: "now" } }, needsSpotlight: false, steps });
const action = (steps: AdversaryStep[], over: Partial<AdversaryFeatureUse> = {}): AdversaryFeatureUse => ({ id: "main", activation: { kind: "action" }, needsSpotlight: true, steps, ...over });

const ctx = (dice: number[], over: Partial<AdversaryRunContext> = {}): AdversaryRunContext => ({
  adversaryId: "fixture",
  self,
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

describe("dcm-b3bb: check-table rows are translated like then / otherwise", () => {
  // Broken Magic (HF p.68): a d6 table; a row's follow-up attack gets the stat block's ATK (dcm-vv2 1).
  const table = effect(
    reaction([
      {
        kind: "check",
        dice: { count: fixed(1), sides: 6 },
        test: { kind: "totalAtLeast", value: 7 },
        then: [],
        otherwise: [],
        table: [{ atLeast: 1, atMost: 6, steps: [{ kind: "followUp", roll: ATTACK, targets: { side: "enemy", range: "melee", count: { kind: "one" } }, steps: [hit3] }] }],
      } as AdversaryStep,
    ]),
  );

  it("a follow-up attack in a table row adds ATK +3 (d20 9 + 3 = 12 hits Evasion 12)", () => {
    // the d6, then the follow-up's d20
    expect(ok(table, [4, 9], { followUp: [mira] }).incoming).toEqual([expect.objectContaining({ targetId: "mira", amount: 3 })]);
  });

  it("an 8 + 3 = 11 misses, so the ATK is counted once", () => {
    expect(ok(table, [4, 8], { followUp: [mira] }).incoming).toEqual([]);
  });
});

describe("dcm-e16o: creatureCount reads the map creatures the server passes", () => {
  // Drain and Multiply's Horde HP (CB p.218) style: a summon's HP counted from the creatures.
  const summon = effect(action([{ kind: "summon", label: "Minion", count: fixed(1), hp: { kind: "creatureCount", side: "allies" } } as AdversaryStep]));

  it("counts itself and its allies (2), none without the list", () => {
    const creatures = [
      { id: "adv-1", side: "self" as const, pc: false },
      { id: "adv-2", side: "ally" as const, pc: false },
      { id: "mira", side: "enemy" as const, pc: true },
    ];
    const hp = (plan: AdversaryPlan) => plan.steps.flatMap((s) => (s.kind === "summon" ? [s.hp] : []))[0];
    expect(hp(ok(summon, [], { creatures }))).toBe(2);
    expect(hp(ok(summon, []))).toBe(0);
  });
});

describe("dcm-iedr: a condition keeps its mods and ends in the plan", () => {
  const envelop = effect(
    action(
      [
        {
          kind: "condition",
          to: "targets",
          when: ["hit"],
          condition: { kind: "standard", condition: "restrained" },
          duration: "temporary",
          endsOnCaster: ["takeSevere"],
          mods: [{ kind: "attackedRider", rider: { by: "caster", advantage: true } }],
        } as AdversaryStep,
      ],
      { roll: ATTACK, targets: { side: "enemy", range: "melee", count: { kind: "one" } } },
    ),
  );

  it("lists the condition's endsOnCaster and mods for its target", () => {
    const plan = ok(envelop, [15], { targets: [mira] });
    expect(plan.conditionDetails).toEqual([
      expect.objectContaining({ targetId: "mira", condition: { kind: "standard", condition: "restrained" }, endsOnCaster: ["takeSevere"], mods: [{ kind: "attackedRider", rider: { by: "caster", advantage: true } }] }),
    ]);
  });

  it("a miss gives nothing to list", () => {
    expect(ok(envelop, [2], { targets: [mira] }).conditionDetails).toEqual([]);
  });

  it("conditionStepsOf and lastingModsOf find steps nested in flows by name or label", () => {
    const steps = [{ kind: "optional", steps: [{ kind: "condition", condition: { kind: "tag", tag: "Marked" }, duration: "scene", mods: [{ kind: "flag", flag: "x" }] }] }, { kind: "effect", label: "Enraged", mods: [{ kind: "stat", stat: "difficulty", delta: fixed(1) }] }];
    expect([...conditionStepsOf(steps).keys()]).toEqual(["Marked"]);
    expect(lastingModsOf(steps, "Marked")).toEqual([{ kind: "flag", flag: "x" }]);
    expect(lastingModsOf(steps, "Enraged")).toHaveLength(1);
    expect(lastingModsOf(steps, "Nothing")).toEqual([]);
  });
});

describe("dcm-gx3: Evolution on the instance changes the block", () => {
  const block: Block = {
    adversaryId: "mountain-troll",
    tier: 1,
    attack: { name: "Skull Flail", modifier: 1, range: "Very Close", damage: "1d10+2 phy" },
    experiences: [],
    features: [
      { name: "Stolen Armor", kind: "passive", text: "" },
      { name: "Flail Swipe", kind: "action", text: "" },
      { name: "Double Swipe", kind: "action", text: "" },
    ],
    effects: [{ adversaryId: "mountain-troll", feature: "Flail Swipe", uses: [] }],
    resistance: undefined,
    hordeX: null,
    relentless: null,
  };

  it("no Evolution: the printed block", () => {
    expect(evolvedBlock(block, { effects: [] })).toBe(block);
  });

  it("Enraged (HF p.65): Claw Swipe replaces the standard attack (ATK kept), two features gone", () => {
    const evolved = evolvedBlock(block, {
      effects: [{ id: "adv:mountain-troll/Enraged Mountain Troll:1", source: "Enraged Mountain Troll", label: "Enraged", until: "permanent", difficulty: 1, standardAttack: { name: "Claw Swipe", range: "veryClose", damage: "1d10+3 phy" }, featuresRemoved: ["Stolen Armor", "Flail Swipe"], featuresAdded: ["Double Swipe"] }],
    });
    expect(evolved.attack).toEqual({ name: "Claw Swipe", modifier: 1, range: "veryClose", damage: "1d10+3 phy" });
    expect(evolved.features.map((f) => f.name)).toEqual(["Double Swipe"]);
    expect(evolved.effects).toEqual([]);
  });
});

describe("dcm-e16o: mapCreatures", () => {
  const instances = [
    { _id: "adv-1", defeated: false, source: { kind: "srd" as const, adversaryId: "nope" }, label: "Wolf 1" },
    { _id: "adv-2", defeated: false, source: { kind: "srd" as const, adversaryId: "nope" }, label: "Wolf 2" },
    { _id: "adv-3", defeated: true, source: { kind: "srd" as const, adversaryId: "nope" }, label: "Wolf 3" },
  ];

  it("without a map: the party as enemies, undefeated instances as self / allies", () => {
    const out = mapCreatures("adv-1", instances as never, [{ character: { _id: "mira" } }], null);
    expect(out.map((c) => [c.id, c.side, c.pc])).toEqual([
      ["mira", "enemy", true],
      ["adv-1", "self", false],
      ["adv-2", "ally", false],
    ]);
  });
});

describe("dcm-idz: a GM-controlled PC attacks with a d20 + the weapon's trait", () => {
  it("d20 + 2 against Evasion 12; the damage counts Proficiency dice", () => {
    const r = gmControlledWeaponAttack(2, "d8+1 phy", 2, [{ id: "bram", evasion: 12 }], queueRng([10]));
    expect(r.attack.total).toBe(12);
    expect(r.attack.hits).toEqual([{ id: "bram", hit: true }]);
    expect(r.damage).toBe("2d8+1 phy");
  });

  it("a miss below the Evasion; a 1d-prefixed weapon is rewritten too", () => {
    const r = gmControlledWeaponAttack(0, "1d10 mag", 3, [{ id: "bram", evasion: 12 }], queueRng([11]));
    expect(r.attack.hits).toEqual([{ id: "bram", hit: false }]);
    expect(r.damage).toBe("3d10 mag");
  });
});

describe("dcm-4c9m: Never Misses halves Evasion on every attack", () => {
  const strike = effect(action([hit3], { roll: ATTACK, targets: { side: "enemy", range: "melee", count: { kind: "one" } } }));
  const bram = combatant("bram", { evasion: 16 });
  const state = { hp: 0, hpMax: 6, stress: 0, stressMax: 3, conditions: [], tags: [], tokens: 0 };

  it("Evasion 16 meets a d20 of 5 + 3 only with the flag", () => {
    const passives = { ...passiveSummary([], state), flags: ["attacksHalveEvasion"] };
    expect(ok(strike, [5], { targets: [bram], passives }).incoming).toHaveLength(1);
    expect(ok(strike, [5], { targets: [bram], passives: passiveSummary([], state) }).incoming).toHaveLength(0);
  });
});
