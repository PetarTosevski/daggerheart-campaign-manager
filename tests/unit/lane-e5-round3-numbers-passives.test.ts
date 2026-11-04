import { describe, expect, it } from "vitest";

import { resolveNumber, type MapCreature, type NumberEnv } from "@/lib/domain/combat-actions/numbers";
import {
  CAMPAIGN_UNTIL,
  RESET_LABEL,
  USED_ON_EVER,
  clearBlocked,
  hopeBlocked,
  optionIsRemoved,
  recordUsedOn,
  removedOptions,
  stateCheckMet,
  unaffordable,
  usedOnKey,
  type PayerState,
  type RequirementState,
  type StateFacts,
} from "@/lib/domain/card-effects/availability";
import type { CardUse, FeatureOptionRef, Mod } from "@/lib/domain/card-effects/types";
import { gateHolds, passiveMods } from "@/lib/domain/feature-effects/passives";
import { queueRng } from "@/lib/domain/dice";
import { formFor, needsDialog } from "@/components/combat-map/actions/hand/model";

// Plan lanes-2, tracer E5 (label w1-e5-checks-limits-numbers): the numbers, checks and passives tracer V2 widened
// (docs/tasks/TASK-LN-V2.md) and the round-2 E5 beads (docs/tasks/TASK-LN2-E5.md). Squares per range: Melee 1, Very
// Close 3, Close 6, Far 12 (combat-map/ranges.ts).

const rng = queueRng([]);
const env = (over: Partial<NumberEnv> = {}): NumberEnv => ({
  traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
  spellcast: 0,
  proficiency: 1,
  level: 1,
  tier: 1,
  spent: {},
  choices: {},
  cardTokens: 0,
  gmFear: 0,
  self: { hp: 0, stress: 0 },
  markedThisMove: { self: {}, byTarget: {} },
  targetCount: { picked: 3, hit: 3, failedSave: 0 },
  loadoutDomains: [],
  vaultDomains: [],
  ...over,
});

describe("targetCount markedHp (dcm-nsqo, dcm-k4x5)", () => {
  // Suppressing Blast (CB p.217): "You gain a Fear for each target who marked HP from this attack." Three hit, one
  // marked no HP after armor.
  const results = [
    { id: "a", hpMarked: 2, severity: "major" as const },
    { id: "b", hpMarked: 0 },
    { id: "c", hpMarked: 3, severity: "severe" as const },
  ];
  it("counts the targets that marked 1+ HP after the window", () => {
    expect(resolveNumber({ kind: "targetCount", which: "markedHp" }, env({ targetResults: results }), rng)).toBe(2);
    expect(resolveNumber({ kind: "targetCount", which: "markedHp" }, env(), rng)).toBe(0);
    expect(resolveNumber({ kind: "targetCount", which: "hit" }, env({ targetResults: results }), rng)).toBe(3);
  });
  it("with severity, only those whose damage reached it (Frenzied Feeding, HF p.91: 'each creature who took Severe damage')", () => {
    expect(resolveNumber({ kind: "targetCount", which: "markedHp", severity: "severe" }, env({ targetResults: results }), rng)).toBe(1);
    expect(resolveNumber({ kind: "targetCount", which: "markedHp", severity: "major" }, env({ targetResults: results }), rng)).toBe(2);
  });
});

describe("recorded (dcm-b77)", () => {
  it("reads the number the condition recorded (Banish, CB p.333: the return roll starts at the highest d20)", () => {
    expect(resolveNumber({ kind: "recorded" }, env({ recorded: 17 }), rng)).toBe(17);
    expect(resolveNumber({ kind: "calc", of: { kind: "recorded" }, plus: -1 }, env({ recorded: 17 }), rng)).toBe(16);
    expect(resolveNumber({ kind: "recorded" }, env(), rng)).toBe(0);
  });
});

describe("creatureCount chain (dcm-346, Shield Wall, CB p.212)", () => {
  // "If additional Bladed Guards are standing in a line alongside the first, and each is within Melee range of another
  // guard in the line, the Difficulty increases by the total number of guards in that line."
  const guard = (id: string, x: number, y: number, side: MapCreature["side"] = "ally"): MapCreature => ({ id, side, pc: false, name: "Bladed Guard", at: { x, y } });
  const line = { kind: "creatureCount", side: "allies", name: "Bladed Guard", chain: "melee" } as const;

  it("counts every guard linked to the first through Melee steps, the first included", () => {
    const creatures = [guard("g1", 0, 0, "self"), guard("g2", 1, 0), guard("g3", 2, 1), guard("g4", 6, 0), { id: "pc", side: "enemy", pc: true, at: { x: 3, y: 1 } } as MapCreature];
    expect(resolveNumber(line, env({ creatures }), rng)).toBe(3);
  });
  it("a guard alone is no line: 0", () => {
    expect(resolveNumber(line, env({ creatures: [guard("g1", 0, 0, "self"), guard("g4", 6, 0)] }), rng)).toBe(0);
  });
  it("a creature without a footprint links to nothing; the chain can start at the target", () => {
    const creatures = [guard("g1", 0, 0, "self"), { id: "g2", side: "ally", pc: false, name: "Bladed Guard" } as MapCreature];
    expect(resolveNumber(line, env({ creatures }), rng)).toBe(0);
    const swarm = [guard("t", 5, 5, "enemy"), guard("u", 6, 5, "enemy"), guard("me", 0, 0, "self")];
    expect(resolveNumber({ kind: "creatureCount", side: "enemies", of: "target", chain: "melee" }, env({ creatures: swarm, target: { id: "t", hp: 0, stress: 0 } }), rng)).toBe(2);
  });
});

describe("optionRemoved (dcm-qw4f, Seven-Headed, HF p.92)", () => {
  // "Permanently remove the Elemental Breath option that corresponds to the result. On a result of 8, or if the
  // corresponding option has already been removed, tick down the Diamond Hide countdown."
  const fire: FeatureOptionRef = { feature: "Elemental Breath", choose: "element", option: "fire" };
  const ice: FeatureOptionRef = { feature: "Elemental Breath", choose: "element", option: "ice" };
  const mods: Mod[] = [{ kind: "features", removeOptions: [fire] }, { kind: "stat", stat: "evasion", delta: { kind: "fixed", value: 1 } }];
  const s = (facts: StateFacts): RequirementState => ({ hp: 0, hpMax: 6, stress: 0, stressMax: 6, armor: 0, hope: 0, armorWorn: false, loadoutDomains: [], activeCardEffects: [], situations: [], facts });

  it("reads the removed options from the mods", () => {
    expect(removedOptions(mods)).toEqual([fire]);
    expect(optionIsRemoved(fire, removedOptions(mods))).toBe(true);
    expect(optionIsRemoved(ice, removedOptions(mods))).toBe(false);
  });
  it("decides the check when the fact is known, else leaves it to the table", () => {
    expect(stateCheckMet({ kind: "optionRemoved", option: fire }, s({ removedOptions: [fire] }))).toBe(true);
    expect(stateCheckMet({ kind: "optionRemoved", option: ice }, s({ removedOptions: [fire] }))).toBe(false);
    expect(stateCheckMet({ kind: "optionRemoved", option: ice }, s({}))).toBeUndefined();
  });
});

describe("cannotSpendHope / cannotClear (dcm-5kxg)", () => {
  const payer: PayerState = { hope: 4, stress: 0, stressMax: 6, hp: 0, hpMax: 6, armor: 0, armorMax: 3, cardTokens: 0 };
  it("Ravenous (HF p.94: 'a PC can't spend Hope') refuses every Hope cost", () => {
    expect(unaffordable([{ resource: "hope", amount: 1 }], payer)).toEqual([]);
    expect(unaffordable([{ resource: "hope", amount: 1 }], { ...payer, flags: ["cannotSpendHope"] })).toEqual(["hope"]);
    expect(unaffordable([{ resource: "stress", amount: 1 }], { ...payer, flags: ["cannotSpendHope"] })).toEqual([]);
    expect(hopeBlocked(undefined)).toBe(false);
  });
  it("Afflicted (HF p.95: 'can't clear HP or Stress') blocks each track by its flag", () => {
    expect(clearBlocked("hp", ["cannotClearHp", "cannotClearStress"])).toBe(true);
    expect(clearBlocked("stress", ["cannotClearHp"])).toBe(false);
    expect(clearBlocked("stress", ["cannotClearStress"])).toBe(true);
    expect(clearBlocked("hp", undefined)).toBe(false);
  });
});

describe("Words of Discord remembers for the whole campaign (dcm-c75, user answer 2026-10-31)", () => {
  it("records without `since` under USED_ON_EVER, and a campaign entry has a label", () => {
    const key = "card:words-of-discord";
    expect(recordUsedOn([], key, "adv-1")).toEqual([{ key: usedOnKey(key, "adv-1"), until: USED_ON_EVER }]);
    expect(RESET_LABEL[CAMPAIGN_UNTIL]).toBe("Not again this campaign");
  });
});

describe("gated disadvantage against the bearer (dcm-eut, Defensive stance, HF p.12)", () => {
  // "Attack rolls targeting you from within Melee range have disadvantage unless the attacker marks a Stress to negate
  // the disadvantage."
  const defensive = { featureId: "stance:martial-artist:defensive", from: "melee" as const, buyOff: [{ kind: "stress" as const, amount: { kind: "fixed" as const, value: 1 } }] };
  it("holds for a Melee attacker who has not paid", () => {
    expect(gateHolds(defensive, { distance: 1 })).toBe(true);
    expect(gateHolds(defensive, { distance: 1, paidOff: [defensive.featureId] })).toBe(false);
  });
  it("not from beyond Melee, and not when the distance is unknown", () => {
    expect(gateHolds(defensive, { distance: 4 })).toBe(false);
    expect(gateHolds(defensive, {})).toBe(false);
    expect(gateHolds({ featureId: "x", from: "beyondMelee" }, { distance: 4 })).toBe(true);
  });
  it("a situation gate holds once the GM confirms it", () => {
    expect(gateHolds({ featureId: "x", situation: "In its true form" }, {})).toBe(false);
    expect(gateHolds({ featureId: "x", situation: "In its true form" }, { situations: ["In its true form"] })).toBe(true);
  });
  it("a sheet without gated mods has no guarded entries", () => {
    expect(passiveMods({ level: 1 }).guarded).toEqual([]);
  });
});

describe("Feed's passive use is read on a combat feature (dcm-cqwm, HF p.39)", () => {
  // "While there are no tokens on this card, you make action and reaction rolls with disadvantage."
  const vampire = { level: 1, transformationId: "vampire" } as const;
  it("no tokens: the disadvantage flags are on; a token turns them off", () => {
    expect(passiveMods(vampire).flags).toEqual(expect.arrayContaining(["actionDisadvantage", "reactionDisadvantage"]));
    const fed = passiveMods({ ...vampire, cardTokens: [{ cardId: "feat:transformation:vampire:feed", count: 2 }] });
    expect(fed.flags).not.toContain("actionDisadvantage");
  });
  it("combat features' riders are still not roll options", () => {
    expect(passiveMods(vampire).rollOptions.map((o) => o.featureId)).not.toContain("transformation:vampire:feed");
  });
});

describe("Hand asks which vault card to swap in (dcm-u4pq, Codex-Touched, CB p.333)", () => {
  it("a swapWithVault step opens the dialog", () => {
    const use = {
      id: "main",
      name: "Swap",
      activation: { kind: "action" },
      steps: [{ kind: "loadout", to: "self", op: "swapWithVault", note: "Replace this card with any card from your vault." }],
    } as unknown as CardUse;
    const form = formFor(use);
    expect(form.swapWithVault).toBe(true);
    expect(needsDialog(form, { spells: 1, pickedEnemies: 0, gm: false })).toBe(true);
    expect(formFor({ ...use, steps: [] }).swapWithVault).toBeUndefined();
  });
});
