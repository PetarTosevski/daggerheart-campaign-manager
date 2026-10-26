// Session features F0 (plan session-features): holders, Luckbringer, Slayer Dice, Know the Tide, Lunar Phases,
// the session transforms and the dice-box hooks. Book rules K1-K7, user decisions U1-U8, Q1.
import { describe, expect, it } from "vitest";

import { readSheet } from "../../convex/lib/characterSheet";
import { expire } from "@/lib/domain/characters/expiry";
import { afterDualityRoll, rollOptions } from "@/lib/domain/class-features/hooks";
import type { FeatureScope } from "@/lib/domain/class-features/types";
import { applyRollOptions } from "@/lib/domain/dice/index";
import type { RollKind, RollOutcome, RollRecord } from "@/lib/domain/duality";
import {
  applyLuckbringer,
  bumpMoonDie,
  bumpUsed,
  canNegateMinor,
  canStore,
  clearSlayerAtEnd,
  clearTideAtEnd,
  currentPhase,
  endMoon,
  featuresOf,
  holdsLuckbringer,
  holdsLunarPhases,
  holdsSlayer,
  holdsTide,
  LUNAR_BUMP_KEY,
  lunarBonuses,
  MOON_PHASES,
  moonDie,
  moonDieLabel,
  negateMinor,
  partyHope,
  phaseOf,
  placeTideToken,
  rollGaveHope,
  rollMoonDie,
  sessionEndFeatures,
  sessionStartFeatures,
  slayerCapacity,
  slayerDice,
  spendSlayerDice,
  spendTideTokens,
  storeSlayerDie,
  tideCapacity,
  tideTokens,
  withFeatures,
} from "@/lib/domain/session-features";
import { RuleError } from "@/lib/errors/app-error";
import type { CharacterSheet } from "@/lib/validation/characters";

function sheetOf(patch: Partial<CharacterSheet> = {}): CharacterSheet {
  const sheet = readSheet({
    schemaVersion: 2,
    name: "Vex",
    pronouns: "",
    description: "",
    level: 3,
    classId: "warrior",
    subclassId: "call-of-the-brave",
    ancestry: { kind: "single", id: "elf" },
    communityId: "wildborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    traitMarks: {},
    evasion: 10,
    hpMax: 6,
    hp: 0,
    stressMax: 6,
    stress: 2,
    hope: 2,
    scars: 0,
    armorMarked: 0,
    proficiency: 2,
    primaryWeaponId: "broadsword",
    inventory: [],
    gold: { handfuls: 1, bags: 0, chest: false },
    experiences: [],
    domainCards: { owned: [], loadout: [] },
    background: [],
    connections: [],
    notes: "",
  });
  return { ...sheet, ...patch };
}

const halfling = (name: string, patch: Partial<CharacterSheet> = {}) => sheetOf({ name, ancestry: { kind: "single", id: "halfling" }, ...patch });
const slayer = (patch: Partial<CharacterSheet> = {}) => sheetOf({ name: "Bryn", subclassId: "call-of-the-slayer", ...patch });
const seaborne = (patch: Partial<CharacterSheet> = {}) => sheetOf({ name: "Kai", communityId: "seaborne", ...patch });
const moonWitch = (patch: Partial<CharacterSheet> = {}) =>
  sheetOf({ name: "Mira", classId: "witch", subclassId: "moon", subclassRank: "mastery", ...patch });
const withDie = (die: number, patch: Partial<CharacterSheet> = {}) => moonWitch({ sessionFeatures: { moonDie: die }, ...patch });

const NO_HF: FeatureScope = { hopeAndFear: false, ikonis: false };
const HF: FeatureScope = { hopeAndFear: true, ikonis: false };

/** A fixed die sequence: each call returns the next value. */
const dice = (...values: number[]) => {
  const queue = [...values];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("rng exhausted");
    return next;
  };
};

function codeOf(f: () => unknown): string | undefined {
  try {
    f();
    return undefined;
  } catch (e) {
    if (e instanceof RuleError) return e.code;
    throw e;
  }
}

const roll = (kind: RollKind, outcome: RollOutcome, hope = 8, fear = 4): RollRecord => ({
  kind,
  dice: [
    { sides: 12, value: hope, role: "hope" },
    { sides: 12, value: fear, role: "fear" },
  ],
  modifier: 0,
  total: hope + fear,
  outcome,
  manual: false,
});

describe("state: sessionFeatures", () => {
  it("an old sheet without it reads as no pool, no tokens, no die", () => {
    const s = sheetOf();
    expect(s.sessionFeatures).toBeUndefined();
    expect(featuresOf(s)).toEqual({});
    expect([slayerDice(s), tideTokens(s), moonDie(s)]).toEqual([0, 0, undefined]);
  });

  it("withFeatures merges, drops undefined members and empty pools, and drops an empty object", () => {
    const s = withFeatures(sheetOf(), { slayerDice: 2, moonDie: 4 });
    expect(s.sessionFeatures).toEqual({ slayerDice: 2, moonDie: 4 });
    const t = withFeatures(s, { slayerDice: 0, moonDie: undefined });
    expect(t.sessionFeatures).toBeUndefined();
    expect("sessionFeatures" in t).toBe(false);
  });
});

describe("holders (K7)", () => {
  it("Luckbringer: single Halfling, mixed with Halfling first, Shapeshifter in Halfling form keeping Luckbringer", () => {
    expect(holdsLuckbringer(halfling("Pip"))).toBe(true);
    expect(holdsLuckbringer(sheetOf({ ancestry: { kind: "mixed", first: "halfling", second: "elf", name: "Halfelf" } }))).toBe(true);
    expect(holdsLuckbringer(sheetOf({ ancestry: { kind: "mixed", first: "elf", second: "halfling", name: "Elfling" } }))).toBe(false);
    expect(holdsLuckbringer(sheetOf({ ancestry: { kind: "shapeshifter", form: "halfling", feature: "Luckbringer" } }))).toBe(true);
    expect(holdsLuckbringer(sheetOf({ ancestry: { kind: "shapeshifter", form: "halfling", feature: "Internal Compass" } }))).toBe(false);
    expect(holdsLuckbringer(sheetOf({ ancestry: { kind: "shapeshifter", form: "elf", feature: "Luckbringer" } }))).toBe(false);
    expect(holdsLuckbringer(sheetOf())).toBe(false);
  });

  it("Slayer: Call of the Slayer at any rank or as a multiclass foundation", () => {
    expect(holdsSlayer(slayer())).toBe(true);
    expect(holdsSlayer(slayer({ subclassRank: "mastery" }))).toBe(true);
    expect(holdsSlayer(sheetOf({ classId: "wizard", subclassId: "school-of-war", multiclass: { classId: "warrior", domainId: "blade", subclassId: "call-of-the-slayer" } }))).toBe(true);
    expect(holdsSlayer(sheetOf())).toBe(false);
  });

  it("Know the Tide: the Seaborne community", () => {
    expect(holdsTide(seaborne())).toBe(true);
    expect(holdsTide(sheetOf())).toBe(false);
  });

  it("Lunar Phases: a Moon Witch at mastery, only with hopeAndFear, never by multiclass or below mastery", () => {
    expect(holdsLunarPhases(moonWitch())).toBe(true);
    expect(holdsLunarPhases(moonWitch(), HF)).toBe(true);
    expect(holdsLunarPhases(moonWitch(), NO_HF)).toBe(false);
    expect(holdsLunarPhases(moonWitch({ subclassRank: "specialization" }))).toBe(false);
    expect(holdsLunarPhases(moonWitch({ subclassRank: "foundation" }))).toBe(false);
    expect(holdsLunarPhases(sheetOf({ subclassRank: "mastery", multiclass: { classId: "witch", domainId: "dread", subclassId: "moon" } }))).toBe(false);
    expect(holdsLunarPhases(sheetOf())).toBe(false);
  });
});

describe("Luckbringer (K1, U1)", () => {
  it("partyHope counts the Halflings among the sheets passed", () => {
    expect(partyHope([halfling("Pip"), halfling("Rosa"), sheetOf()])).toBe(2);
    expect(partyHope([sheetOf()])).toBe(0);
  });

  it("two Halflings give every PC 2 Hope, never above the Hope maximum (K6)", () => {
    const atMax = sheetOf({ name: "Ash", hope: 6 });
    const nearMax = sheetOf({ name: "Cy", hope: 5 });
    const scarred = sheetOf({ name: "Dee", hope: 3, scars: 2 }); // max 4
    const { sheets, hope, notes } = applyLuckbringer([halfling("Pip"), halfling("Rosa"), atMax, nearMax, scarred]);
    expect(hope).toBe(2);
    expect(sheets.map((s) => s.hope)).toEqual([4, 4, 6, 6, 4]);
    expect(notes).toEqual(["Luckbringer (Pip, Rosa): everyone gains 2 Hope"]);
  });

  it("no Halfling: nothing changes and there is no note", () => {
    const party = [sheetOf(), slayer()];
    const { sheets, hope, notes } = applyLuckbringer(party);
    expect(hope).toBe(0);
    expect(notes).toEqual([]);
    expect(sheets[0]).toBe(party[0]);
  });
});

describe("Slayer Dice (K2, K5, U2, U3, U8)", () => {
  it("capacity is Proficiency", () => {
    expect(slayerCapacity(slayer({ proficiency: 3 }))).toBe(3);
  });

  it("canStore: action rolls with Hope (critical included), never reaction, Fear, damage, non-holders or a full pool", () => {
    const s = slayer();
    expect(canStore(s, "successHope", "action")).toBe(true);
    expect(canStore(s, "failHope", "action")).toBe(true);
    expect(canStore(s, "critical", "action")).toBe(true);
    expect(canStore(s, "successHope", "reaction")).toBe(false);
    expect(canStore(s, "critical", "reaction")).toBe(false);
    expect(canStore(s, "successFear", "action")).toBe(false);
    expect(canStore(s, "none", "damage")).toBe(false);
    expect(canStore(sheetOf(), "successHope", "action")).toBe(false);
    expect(canStore(slayer({ sessionFeatures: { slayerDice: 2 } }), "successHope", "action")).toBe(false);
  });

  it("rollGaveHope: only an action roll with Hope below the Hope maximum", () => {
    expect(rollGaveHope(slayer({ hope: 2 }), "successHope", "action")).toBe(true);
    expect(rollGaveHope(slayer({ hope: 6 }), "successHope", "action")).toBe(false);
    expect(rollGaveHope(slayer({ hope: 2 }), "successHope", "reaction")).toBe(false);
    expect(rollGaveHope(slayer({ hope: 2 }), "failFear", "action")).toBe(false);
  });

  it("storing replaces the Hope the roll gave, adds a die and claims the roll", () => {
    const after = slayer({ hope: 3 }); // the roll raised 2 -> 3
    const stored = storeSlayerDie(after, { hopeGained: true, entryId: "entry1" });
    expect(stored.hope).toBe(2);
    expect(stored.sessionFeatures).toEqual({ slayerDice: 1, slayerClaim: "entry1" });
  });

  it("a critical stored as a Slayer Die keeps its cleared Stress", () => {
    // Before the critical: Hope 2, Stress 2; the critical gave +1 Hope and cleared a Stress.
    const afterCrit = slayer({ hope: 3, stress: 1 });
    const stored = storeSlayerDie(afterCrit, { hopeGained: true, entryId: "crit" });
    expect([stored.hope, stored.stress, slayerDice(stored)]).toEqual([2, 1, 1]);
  });

  it("a store when Hope was already full takes no Hope back", () => {
    const full = slayer({ hope: 6 });
    expect(rollGaveHope(full, "successHope", "action")).toBe(false);
    const stored = storeSlayerDie(full, { hopeGained: false, entryId: "e" });
    expect([stored.hope, slayerDice(stored)]).toEqual([6, 1]);
  });

  it("refuses past capacity, for an already claimed roll, or without Slayer (CLASS_FEATURE_RULE)", () => {
    const full = slayer({ sessionFeatures: { slayerDice: 2 } });
    expect(codeOf(() => storeSlayerDie(full, { hopeGained: true, entryId: "x" }))).toBe("CLASS_FEATURE_RULE");
    const claimed = storeSlayerDie(slayer(), { hopeGained: true, entryId: "same" });
    expect(codeOf(() => storeSlayerDie(claimed, { hopeGained: true, entryId: "same" }))).toBe("CLASS_FEATURE_RULE");
    expect(storeSlayerDie(claimed, { hopeGained: false, entryId: "next" }).sessionFeatures).toEqual({ slayerDice: 2, slayerClaim: "next" });
    expect(codeOf(() => storeSlayerDie(sheetOf(), { hopeGained: true, entryId: "x" }))).toBe("CLASS_FEATURE_RULE");
  });

  it("a lowered Proficiency trims nothing already held", () => {
    const s = slayer({ proficiency: 1, sessionFeatures: { slayerDice: 2 } });
    expect(slayerDice(s)).toBe(2);
    expect(canStore(s, "successHope", "action")).toBe(false);
  });

  it("spendSlayerDice takes dice from the pool; more than held or a bad count is DICE_RULE", () => {
    const s = slayer({ sessionFeatures: { slayerDice: 2, slayerClaim: "e" } });
    expect(spendSlayerDice(s, 0)).toBe(s);
    expect(spendSlayerDice(s, 1).sessionFeatures).toEqual({ slayerDice: 1, slayerClaim: "e" });
    expect(spendSlayerDice(s, 2).sessionFeatures).toEqual({ slayerClaim: "e" });
    expect(codeOf(() => spendSlayerDice(s, 3))).toBe("DICE_RULE");
    expect(codeOf(() => spendSlayerDice(s, -1))).toBe("DICE_RULE");
    expect(codeOf(() => spendSlayerDice(s, 1.5))).toBe("DICE_RULE");
    expect(codeOf(() => spendSlayerDice(slayer(), 1))).toBe("DICE_RULE");
  });

  it("clearSlayerAtEnd empties the pool for a Hope per die, capped", () => {
    expect(clearSlayerAtEnd(slayer({ hope: 2, sessionFeatures: { slayerDice: 2 } }))).toMatchObject({ cleared: 2, hopeGained: 2, sheet: { hope: 4 } });
    const capped = clearSlayerAtEnd(slayer({ hope: 5, sessionFeatures: { slayerDice: 3 } }));
    expect([capped.cleared, capped.hopeGained, capped.sheet.hope, slayerDice(capped.sheet)]).toEqual([3, 1, 6, 0]);
    const none = slayer();
    expect(clearSlayerAtEnd(none)).toEqual({ sheet: none, cleared: 0, hopeGained: 0 });
  });
});

describe("Know the Tide (K3, U4, U5, U8, Q1)", () => {
  it("capacity is the level", () => {
    expect(tideCapacity(seaborne({ level: 4 }))).toBe(4);
  });

  it("places a token on an action roll with Fear only: never a critical, Hope, a reaction roll or a non-holder", () => {
    const s = seaborne();
    expect(placeTideToken(s, "successFear", "action")).toMatchObject({ placed: true, sheet: { sessionFeatures: { tideTokens: 1 } } });
    expect(placeTideToken(s, "failFear", "action").placed).toBe(true);
    expect(placeTideToken(s, "critical", "action")).toEqual({ sheet: s, placed: false });
    expect(placeTideToken(s, "successHope", "action").placed).toBe(false);
    expect(placeTideToken(s, "failFear", "reaction").placed).toBe(false);
    expect(placeTideToken(s, "none", "damage").placed).toBe(false);
    expect(placeTideToken(sheetOf(), "failFear", "action").placed).toBe(false);
  });

  it("Tide tokens stop at the level cap", () => {
    let s = seaborne({ level: 2 });
    for (let i = 0; i < 3; i++) s = placeTideToken(s, "failFear", "action").sheet;
    expect(tideTokens(s)).toBe(2);
    expect(placeTideToken(s, "failFear", "action").placed).toBe(false);
    // A lowered level trims nothing.
    const lowered: CharacterSheet = { ...s, level: 1 };
    expect(tideTokens(lowered)).toBe(2);
  });

  it("spendTideTokens gives +n; above the held tokens is DICE_RULE; a non-holder is CLASS_FEATURE_RULE", () => {
    const s = seaborne({ sessionFeatures: { tideTokens: 3 } });
    const spent = spendTideTokens(s, 2);
    expect(spent.modifier).toBe(2);
    expect(tideTokens(spent.sheet)).toBe(1);
    expect(spendTideTokens(s, 0)).toEqual({ sheet: s, modifier: 0 });
    expect(codeOf(() => spendTideTokens(s, 4))).toBe("DICE_RULE");
    expect(codeOf(() => spendTideTokens(s, -1))).toBe("DICE_RULE");
    expect(codeOf(() => spendTideTokens(sheetOf(), 1))).toBe("CLASS_FEATURE_RULE");
    expect(spendTideTokens(sheetOf(), 0).modifier).toBe(0);
  });

  it("clearTideAtEnd clears every unspent token", () => {
    const cleared = clearTideAtEnd(seaborne({ sessionFeatures: { tideTokens: 3 } }));
    expect([cleared.cleared, tideTokens(cleared.sheet), cleared.sheet.sessionFeatures]).toEqual([3, 0, undefined]);
    const none = seaborne();
    expect(clearTideAtEnd(none)).toEqual({ sheet: none, cleared: 0 });
  });
});

describe("Lunar Phases (K4, U6)", () => {
  it("phaseOf: 1 New, 2-3 Waxing, 4 Full, 5-6 Waning, with names and effects", () => {
    expect([1, 2, 3, 4, 5, 6].map((d) => phaseOf(d).key)).toEqual(["new", "waxing", "waxing", "full", "waning", "waning"]);
    expect(MOON_PHASES.map((p) => p.name)).toEqual(["New", "Waxing", "Full", "Waning"]);
    expect(phaseOf(4).effect).toBe("+3 to damage thresholds");
    expect(moonDieLabel(4)).toBe("4 (Full: +3 to damage thresholds)");
    expect(() => phaseOf(0)).toThrow();
    expect(() => phaseOf(7)).toThrow();
  });

  it("lunarBonuses read only the die and the holder, per phase", () => {
    expect(lunarBonuses(withDie(1))).toEqual({ damage: 0, thresholds: 0, evasion: 0 });
    expect(lunarBonuses(withDie(2))).toEqual({ damage: 2, thresholds: 0, evasion: 0 });
    expect(lunarBonuses(withDie(4))).toEqual({ damage: 0, thresholds: 3, evasion: 0 });
    expect(lunarBonuses(withDie(6))).toEqual({ damage: 0, thresholds: 0, evasion: 1 });
    expect(lunarBonuses(moonWitch())).toEqual({ damage: 0, thresholds: 0, evasion: 0 });
    expect(lunarBonuses(withDie(4), NO_HF)).toEqual({ damage: 0, thresholds: 0, evasion: 0 });
    expect(lunarBonuses(withDie(4, { subclassRank: "specialization" }))).toEqual({ damage: 0, thresholds: 0, evasion: 0 });
    expect(currentPhase(withDie(3))?.name).toBe("Waxing");
  });

  it("rollMoonDie places a d6; endMoon removes it", () => {
    const rolled = rollMoonDie(moonWitch(), dice(5));
    expect(moonDie(rolled)).toBe(5);
    expect(endMoon(rolled).sessionFeatures).toBeUndefined();
    const none = moonWitch();
    expect(endMoon(none)).toBe(none);
  });

  it("bumpMoonDie spends a Hope, +1, marks the use until a rest", () => {
    const { sheet, from, to } = bumpMoonDie(withDie(3, { hope: 2 }));
    expect([from, to, moonDie(sheet), sheet.hope]).toEqual([3, 4, 4, 1]);
    expect(sheet.featureUses).toContainEqual({ key: LUNAR_BUMP_KEY, until: "rest" });
    expect(bumpUsed(sheet)).toBe(true);
  });

  it("the 6 -> 1 bump", () => {
    const { sheet, from, to } = bumpMoonDie(withDie(6));
    expect([from, to, moonDie(sheet)]).toEqual([6, 1, 1]);
  });

  it("a second bump in the same rest is refused; a short rest allows it again", () => {
    const once = bumpMoonDie(withDie(2, { hope: 3 })).sheet;
    expect(codeOf(() => bumpMoonDie(once))).toBe("CLASS_FEATURE_RULE");
    const rested = expire(once, "shortRest");
    expect(bumpMoonDie(rested).to).toBe(4);
  });

  it("bump refusals: no die or not a holder (CLASS_FEATURE_RULE), no Hope (NOT_ENOUGH_HOPE)", () => {
    expect(codeOf(() => bumpMoonDie(moonWitch()))).toBe("CLASS_FEATURE_RULE");
    expect(codeOf(() => bumpMoonDie(withDie(3), NO_HF))).toBe("CLASS_FEATURE_RULE");
    expect(codeOf(() => bumpMoonDie(sheetOf({ sessionFeatures: { moonDie: 3 } })))).toBe("CLASS_FEATURE_RULE");
    expect(codeOf(() => bumpMoonDie(withDie(3, { hope: 0 })))).toBe("NOT_ENOUGH_HOPE");
  });

  it("canNegateMinor: New phase, Minor severity, at least 1 Hope; negateMinor spends it or refuses", () => {
    expect(canNegateMinor(withDie(1), "minor")).toBe(true);
    expect(canNegateMinor(withDie(1), "major")).toBe(false);
    expect(canNegateMinor(withDie(1), "none")).toBe(false);
    expect(canNegateMinor(withDie(2), "minor")).toBe(false);
    expect(canNegateMinor(withDie(1, { hope: 0 }), "minor")).toBe(false);
    expect(canNegateMinor(withDie(1), "minor", NO_HF)).toBe(false);
    expect(negateMinor(withDie(1, { hope: 2 }), "minor").hope).toBe(1);
    expect(codeOf(() => negateMinor(withDie(2), "minor"))).toBe("CLASS_FEATURE_RULE");
    expect(codeOf(() => negateMinor(withDie(1), "severe"))).toBe("CLASS_FEATURE_RULE");
  });
});

describe("session transforms (U1, U6, U8)", () => {
  it("start: Luckbringer for the party, then a moon die for each Lunar Phases holder, deterministic with a fixed rng", () => {
    const party = [halfling("Pip"), withDie(2, { name: "Mira", sessionFeatures: undefined, hope: 6 }), sheetOf({ name: "Ash" })];
    const { sheets, notes } = sessionStartFeatures(party, dice(4), HF);
    expect(sheets.map((s) => s.hope)).toEqual([3, 6, 3]);
    expect(moonDie(sheets[1])).toBe(4);
    expect(moonDie(sheets[0])).toBeUndefined();
    expect(notes).toEqual(["Luckbringer (Pip): everyone gains 1 Hope", "Mira's moon die: 4 (Full: +3 to damage thresholds)"]);
    expect(sessionStartFeatures(party, dice(4), HF)).toEqual({ sheets, notes });
  });

  it("start without hopeAndFear rolls no moon die; with nothing to do, every sheet comes back as it came", () => {
    const party = [moonWitch(), sheetOf()];
    const out = sessionStartFeatures(party, dice(), NO_HF);
    expect(out.notes).toEqual([]);
    expect(out.sheets[0]).toBe(party[0]);
    expect(out.sheets[1]).toBe(party[1]);
  });

  it("end: Slayer Dice clear for Hope, Tide tokens clear, the moon die ends, with notes", () => {
    const bryn = slayer({ hope: 2, sessionFeatures: { slayerDice: 2, slayerClaim: "e" } });
    const end = sessionEndFeatures(bryn);
    expect([end.sheet.hope, slayerDice(end.sheet)]).toEqual([4, 0]);
    expect(end.notes).toEqual(["Bryn cleared 2 Slayer Dice: +2 Hope"]);

    expect(sessionEndFeatures(seaborne({ sessionFeatures: { tideTokens: 3 } })).notes).toEqual(["Kai cleared 3 Tide tokens"]);
    expect(sessionEndFeatures(seaborne({ sessionFeatures: { tideTokens: 1 } })).notes).toEqual(["Kai cleared 1 Tide token"]);
    const mira = sessionEndFeatures(withDie(4));
    expect(mira.notes).toEqual(["Mira's moon die ends"]);
    expect(mira.sheet.sessionFeatures).toBeUndefined();

    const plain = sheetOf();
    expect(sessionEndFeatures(plain)).toEqual({ sheet: plain, notes: [] });
  });
});

describe("dice hooks (U2, U6)", () => {
  it("rollOptions adds an auto 'Waxing Moon +2' damage option for a Waxing die, only in a hopeAndFear scope", () => {
    const waxing = withDie(3);
    const option = rollOptions(waxing, "damage", undefined, HF).find((o) => o.key === "waxingMoon");
    expect(option).toEqual({ key: "waxingMoon", label: "Waxing Moon +2", effect: { kind: "modifier", value: 2 }, auto: true });
    expect(applyRollOptions(waxing, rollOptions(waxing, "damage", undefined, HF), []).modifier).toBeGreaterThanOrEqual(2);
    expect(rollOptions(waxing, "damage", undefined, NO_HF).some((o) => o.key === "waxingMoon")).toBe(false);
    expect(rollOptions(waxing, "action", undefined, HF).some((o) => o.key === "waxingMoon")).toBe(false);
    expect(rollOptions(withDie(4), "damage", undefined, HF).some((o) => o.key === "waxingMoon")).toBe(false);
  });

  it("afterDualityRoll offers the Slayer choice after an action roll with Hope while the pool is not full", () => {
    const prompt = {
      key: "slayerStore",
      featureKey: "slayerStore",
      text: "Take the Hope or store a Slayer Die?",
      choices: [
        { key: "hope", label: "Take the Hope" },
        { key: "store", label: "Store a Slayer Die" },
      ],
    };
    const hopeRoll = { hope: 8, fear: 4, roll: roll("action", "successHope") };
    expect(afterDualityRoll(slayer(), hopeRoll)).toContainEqual(prompt);
    expect(afterDualityRoll(slayer(), { hope: 7, fear: 7, roll: roll("action", "critical", 7, 7) })).toContainEqual(prompt);
    expect(afterDualityRoll(slayer(), { hope: 8, fear: 4, roll: roll("reaction", "successHope") }).some((p) => p.key === "slayerStore")).toBe(false);
    expect(afterDualityRoll(slayer(), { hope: 3, fear: 9, roll: roll("action", "failFear", 3, 9) }).some((p) => p.key === "slayerStore")).toBe(false);
    expect(afterDualityRoll(slayer({ sessionFeatures: { slayerDice: 2 } }), hopeRoll).some((p) => p.key === "slayerStore")).toBe(false);
    expect(afterDualityRoll(sheetOf(), hopeRoll).some((p) => p.key === "slayerStore")).toBe(false);
  });
});
