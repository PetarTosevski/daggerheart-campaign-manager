/**
 * Plan rule-switches RFC (docs/tasks/TASK-RULES-RFC.md): the card engine's damage modes (`RunContext.damageRules`), the
 * pure C1 / D4 helpers (src/lib/domain/card-effects/rule-notes.ts), the HUD picker under M1 Manual and the result's
 * "The GM picks N more Minions" line.
 */
import { describe, expect, it, vi } from "vitest";

import { buildRows, canToggle, keepPicks, rowLabel, togglePick, type PickCreature } from "@/components/combat-map/hud/pick/model";
import type { PickRule } from "@/components/combat-map/hud/pick/types";
import { attackResultView, cardResultView, minionNotes } from "@/components/combat-map/hud/result/model";
import type { TargetHint } from "@/components/combat-map/actions/targets";
import { conditionDice, conditionDiceNotes, stressOverflowNotes, targetsConditionDice } from "@/lib/domain/card-effects/rule-notes";
import { run, type ActorState, type PlanStep, type RunContext } from "@/lib/domain/card-effects/run";
import type { CardEffect } from "@/lib/domain/card-effects/types";
import type { Combatant } from "@/lib/domain/combat-actions";
import { queueRng } from "@/lib/domain/dice";

import type { Id } from "../../../convex/_generated/dataModel";

vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => async () => null }));

const actor: ActorState = {
  id: "pc",
  side: "pc",
  evasion: 10,
  thresholds: { major: 7, severe: 14 },
  hp: 0,
  hpMax: 6,
  stress: 0,
  stressMax: 6,
  armor: 0,
  armorMax: 3,
  defeated: false,
  conditions: [],
  hope: 2,
  hopeMax: 6,
  traits: { agility: 1, strength: 0, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
  spellcast: 3,
  proficiency: 1,
  level: 1,
  tier: 1,
  loadoutDomains: ["blade"],
  vaultDomains: [],
  armorWorn: true,
  activeCardEffects: [],
  cardTokens: 0,
  featureUses: [],
  weapons: { primary: { damage: "d8 phy", trait: "agility", damageType: "physical", range: "melee" } },
};

const bandit = (over: Partial<Combatant> = {}): Combatant => ({
  id: "bandit",
  side: "adversary",
  difficulty: 1,
  thresholds: { major: 6, severe: 100 },
  hp: 0,
  hpMax: 1,
  stress: 0,
  stressMax: 1,
  defeated: false,
  conditions: [],
  ...over,
});

const n = (value: number) => ({ kind: "fixed" as const, value });
/** No roll: 8 physical damage, then 2 Stress, on the target. */
const CARD: CardEffect = {
  cardId: "test-card",
  uses: [
    {
      id: "hit",
      name: "Hit",
      activation: { kind: "action" },
      targets: { side: "enemy", range: "far", count: { kind: "one" } },
      steps: [{ kind: "damage", to: "targets", roll: { kind: "flat", amount: n(8) }, type: "physical" }],
    },
    { id: "drain", name: "Drain", activation: { kind: "action" }, targets: { side: "enemy", range: "far", count: { kind: "one" } }, steps: [{ kind: "markStress", to: "targets", amount: n(2) }] },
  ],
};

function plan(useId: string, target: Combatant, damageRules?: RunContext["damageRules"]) {
  const result = run(CARD, { actor, gmFear: 0, useId, targets: [target], rng: queueRng([8, 8, 8, 8]), ...(damageRules ? { damageRules } : {}) });
  if (!result.ok) throw new Error(result.detail);
  return result.plan;
}

const damageStep = (steps: readonly PlanStep[]) => steps.find((s): s is Extract<PlanStep, { kind: "damage" }> => s.kind === "damage")!;
const markStep = (steps: readonly PlanStep[]) => steps.find((s): s is Extract<PlanStep, { kind: "mark" }> => s.kind === "mark")!;

describe("RunContext.damageRules (D2, D4, D8, Massive Damage)", () => {
  it("D2: unset halves a resistant target's damage; Manual takes it in full with resistanceApplied false", () => {
    const resistant = bandit({ hpMax: 10, resistance: { physical: "resistant", magic: "none" } });
    const book = damageStep(plan("hit", resistant).steps).result;
    expect(book).toMatchObject({ taken: 4, hpMarked: 1 });
    expect(book.resistanceApplied).toBeUndefined();
    const manual = damageStep(plan("hit", resistant, { resistance: "manual" }).steps).result;
    expect(manual).toMatchObject({ taken: 8, hpMarked: 2, resistanceApplied: false });
  });

  it("D8: unset defeats at the last HP; Manual leaves it up with lastHp", () => {
    expect(damageStep(plan("hit", bandit()).steps).result).toMatchObject({ defeated: true });
    expect(damageStep(plan("hit", bandit(), { adversaryDefeated: "manual" }).steps).result).toMatchObject({ defeated: false, lastHp: true });
  });

  it("Massive Damage: on, twice the Severe threshold marks 4 HP", () => {
    const tough = bandit({ hpMax: 10, thresholds: { major: 2, severe: 4 } });
    expect(damageStep(plan("hit", tough).steps).result.hpMarked).toBe(3);
    expect(damageStep(plan("hit", tough, { massiveDamage: true }).steps).result).toMatchObject({ hpMarked: 4, massive: true });
  });

  it("D4: unset marks 1 HP past a full Stress track; Manual marks none (overflow stays true)", () => {
    expect(markStep(plan("drain", bandit({ hpMax: 3 })).steps)).toMatchObject({ track: "stress", hpMarked: 1, overflow: true });
    const manual = plan("drain", bandit({ hpMax: 3 }), { stressOverflow: "manual" });
    expect(markStep(manual.steps)).toMatchObject({ track: "stress", hpMarked: 0, overflow: true });
    expect(stressOverflowNotes(manual.steps, "manual", (id) => (id === "bandit" ? "Bandit" : null))).toEqual(["Bandit: Stress full, mark 1 HP?"]);
    expect(stressOverflowNotes(manual.steps, "book", () => "Bandit")).toEqual([]);
  });
});

describe("C1 helpers", () => {
  it("conditionDice: Vulnerable advantage, Hidden / Cloaked disadvantage; Manual none", () => {
    expect(conditionDice(["vulnerable"])).toEqual({ advantage: 1, disadvantage: 0 });
    expect(conditionDice(["cloaked"])).toEqual({ advantage: 0, disadvantage: 1 });
    expect(conditionDice(["vulnerable", "hidden"], "manual")).toEqual({ advantage: 0, disadvantage: 0 });
  });

  it("targetsConditionDice: only what every target gives", () => {
    expect(targetsConditionDice([["vulnerable"], ["vulnerable", "hidden"]])).toEqual({ advantage: 1, disadvantage: 0 });
    expect(targetsConditionDice([])).toEqual({ advantage: 0, disadvantage: 0 });
  });

  it("conditionDiceNotes: Manual words, Book none", () => {
    expect(conditionDiceNotes("Bandit", ["vulnerable", "cloaked"], "manual")).toEqual(["Bandit is Vulnerable: add advantage?", "Bandit is Cloaked: disadvantage?"]);
    expect(conditionDiceNotes("Bandit", ["vulnerable"])).toEqual([]);
  });
});

describe("HUD picker under M1 (pick/model.ts buildRows)", () => {
  const tok = (s: string) => s as Id<"combatTokens">;
  const creatures: PickCreature[] = [
    { tokenId: tok("me"), name: "Ash", side: "self", at: { x: 5, y: 10, size: 1 } },
    { tokenId: tok("walled"), name: "Bandit", side: "enemy", at: { x: 8, y: 10, size: 1 } },
  ];
  const hints: TargetHint[] = [{ tokenId: tok("walled"), band: "close", inRange: true, lineOfSight: false, cover: false }];
  const rule: PickRule = { side: "enemy", max: 1, range: "far" };

  it("Book (and before the modes load): no line of sight is `los`, never pickable", () => {
    const [row] = buildRows({ creatures, rule, hints, picked: [] });
    expect(row).toMatchObject({ reach: "los" });
    expect(row!.noLineOfSight).toBeUndefined();
    expect(canToggle(row!, rule)).toBe(false);
  });

  it("Manual: the row keeps its range reach, says the GM decides and can be picked and kept", () => {
    const [row] = buildRows({ creatures, rule, hints, picked: [], sightMode: "manual" });
    expect(row).toMatchObject({ reach: "in", noLineOfSight: true });
    expect(canToggle(row!, rule)).toBe(true);
    expect(togglePick([], tok("walled"), rule, row)).toEqual([tok("walled")]);
    expect(keepPicks([tok("walled")], [row!])).toEqual([tok("walled")]);
    expect(rowLabel(row!, "in")).toBe("Bandit, Close, no line of sight: the GM decides");
  });
});

describe("result: who picks the extra Minions (result/model.ts)", () => {
  it("minionNotes: the offer, the GM's count, or nothing", () => {
    expect(minionNotes({ minionOffer: { extra: 2 } })).toEqual(["Your damage can defeat more Minions: pick them in the prompt."]);
    expect(minionNotes({ minionOffer: null, minionsForGm: 2 })).toEqual(["The GM picks 2 more Minions."]);
    expect(minionNotes({ minionOffer: null, minionsForGm: 1 })).toEqual(["The GM picks 1 more Minion."]);
    expect(minionNotes({ minionOffer: null })).toEqual([]);
  });

  it("a card's and an attack's result carry the GM line", () => {
    const card = cardResultView({
      characterId: "c",
      actorName: "Ash",
      cardName: "Strike",
      result: { entryId: "e", cardId: "deft-maneuvers", useId: "strike", roll: null, damage: [], success: true, targets: [], prompts: [], minionOffer: null, minionsForGm: 3 },
      names: new Map(),
    });
    expect(card.notes).toEqual(["The GM picks 3 more Minions."]);
    const roll = { kind: "action", dice: [], modifier: 0, total: 12, outcome: "successHope" } as never;
    const attack = attackResultView({
      characterId: "c",
      actorName: "Ash",
      weaponName: "Longsword",
      damageType: "physical",
      result: { entryId: "e", roll, damage: null, targets: [], minionOffer: null, minionsForGm: 2 } as never,
      names: new Map(),
    });
    expect(attack.notes).toContain("The GM picks 2 more Minions.");
  });
});
