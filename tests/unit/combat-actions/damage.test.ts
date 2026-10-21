import { describe, expect, it } from "vitest";

import { applyDamageTo, applyHpTo, applyStressTo, clearTrack, resistanceAgainst, resolveHits, type Combatant } from "@/lib/domain/combat-actions";
import { alwaysOnResistance } from "@/lib/srd/adversary-resistance";

// Plan combat-actions, tracer CA1: R1 hits (CB p.96, p.90), R3 thresholds (CB p.91, p.193), R5 Stress overflow (CB p.92),
// R10 resistance (CB p.99), Minion (CB p.201). Bandit thresholds 8/14, 5 HP, 3 Stress (CB p.193 example).

const bandit: Combatant = {
  id: "bandit",
  side: "adversary",
  difficulty: 12,
  thresholds: { major: 8, severe: 14 },
  hp: 0,
  hpMax: 5,
  stress: 0,
  stressMax: 3,
  defeated: false,
  conditions: [],
};

describe("resolveHits (R1, R9)", () => {
  it("one roll against every target: hit when the total meets or beats its Difficulty", () => {
    expect(resolveHits(14, false, [{ id: "a", difficulty: 12 }, { id: "b", difficulty: 14 }, { id: "c", difficulty: 15 }])).toEqual([
      { id: "a", hit: true },
      { id: "b", hit: true },
      { id: "c", hit: false },
    ]);
  });
  it("a critical hits every target even below the Difficulty (CB p.90)", () => {
    expect(resolveHits(5, true, [{ id: "c", difficulty: 15 }])).toEqual([{ id: "c", hit: true }]);
  });
});

describe("applyDamageTo: thresholds (R3, CB p.91)", () => {
  it("Minor 1, Major 2, Severe 3 HP; none at 0", () => {
    expect(applyDamageTo(bandit, 7, "physical")).toMatchObject({ severity: "minor", hpMarked: 1 });
    expect(applyDamageTo(bandit, 8, "physical")).toMatchObject({ severity: "major", hpMarked: 2 });
    expect(applyDamageTo(bandit, 20, "physical")).toMatchObject({ severity: "severe", hpMarked: 3, taken: 20 });
    expect(applyDamageTo(bandit, 0, "physical")).toMatchObject({ severity: "none", hpMarked: 0 });
  });
  it("no Massive damage for adversaries: double Severe still marks 3", () => {
    expect(applyDamageTo(bandit, 28, "physical")).toMatchObject({ severity: "severe", hpMarked: 3 });
  });
  it("the last HP defeats (CB p.208), never past the track", () => {
    const hurt = { ...bandit, hp: 4 };
    const r = applyDamageTo(hurt, 20, "physical");
    expect(r).toMatchObject({ hpMarked: 1, defeated: true });
    expect(r.after).toMatchObject({ hp: 5, defeated: true });
  });
  it("a minimum severity raises Minor to Major (Onslaught)", () => {
    expect(applyDamageTo(bandit, 3, "physical", { minimumSeverity: "major" })).toMatchObject({ severity: "major", hpMarked: 2 });
    expect(applyDamageTo(bandit, 0, "physical", { minimumSeverity: "major" })).toMatchObject({ severity: "none", hpMarked: 0 });
  });
});

describe("applyDamageTo: resistance and immunity (R10, CB p.99)", () => {
  const warrior = { ...bandit, resistance: { physical: "resistant" as const, magic: "none" as const } };
  it("the book's example: 26 physical against physical resistance is 13", () => {
    expect(applyDamageTo(warrior, 26, "physical")).toMatchObject({ resisted: "resistant", taken: 13, severity: "major", hpMarked: 2 });
  });
  it("halving rounds down (plan acceptance)", () => {
    expect(applyDamageTo(warrior, 27, "physical").taken).toBe(13);
  });
  it("resistance to the other type does nothing", () => {
    expect(applyDamageTo(warrior, 26, "magic")).toMatchObject({ resisted: "none", taken: 26 });
  });
  it("immunity: no damage at all", () => {
    const legion = { ...bandit, resistance: { physical: "immune" as const, magic: "none" as const } };
    expect(applyDamageTo(legion, 40, "physical")).toMatchObject({ resisted: "immune", taken: 0, hpMarked: 0 });
  });
  it("physical and magic together: only resistance to both counts", () => {
    expect(resistanceAgainst(warrior, "both")).toBe("none");
    const titan = { ...bandit, resistance: { physical: "immune" as const, magic: "resistant" as const } };
    expect(resistanceAgainst(titan, "both")).toBe("resistant");
    expect(applyDamageTo(titan, 20, "both").taken).toBe(10);
  });
  it("reads CA2's always-on table", () => {
    const skeleton = { ...bandit, resistance: alwaysOnResistance("skeleton-warrior") };
    expect(applyDamageTo(skeleton, 26, "physical").taken).toBe(13);
  });
});

describe("Minions (CB p.201)", () => {
  const lackey: Combatant = { ...bandit, id: "lackey", thresholds: { major: null, severe: null }, hpMax: 1, stressMax: 1, minionX: 3 };
  it("any damage defeats; one extra Minion per X damage", () => {
    expect(applyDamageTo(lackey, 7, "physical")).toMatchObject({ severity: "defeat", defeated: true, minionExtra: 2 });
    expect(applyDamageTo(lackey, 2, "physical")).toMatchObject({ defeated: true, minionExtra: 0 });
  });
  it("no damage leaves it standing", () => {
    expect(applyDamageTo({ ...lackey, resistance: { physical: "immune", magic: "none" } }, 7, "physical")).toMatchObject({ defeated: false, minionExtra: 0 });
  });
});

describe("Stress and forced marks (R5, CB p.92)", () => {
  it("marks Stress; past a full track marks 1 HP instead", () => {
    expect(applyStressTo(bandit, 2)).toMatchObject({ stressMarked: 2, hpMarked: 0, overflow: false });
    expect(applyStressTo({ ...bandit, stress: 2 }, 2)).toMatchObject({ stressMarked: 1, hpMarked: 1, overflow: true });
    expect(applyStressTo({ ...bandit, stress: 3, hp: 4 }, 1)).toMatchObject({ hpMarked: 1, defeated: true });
  });
  it("forced HP ignores thresholds (Reaper's Strike)", () => {
    expect(applyHpTo(bandit, 5)).toMatchObject({ hpMarked: 5, defeated: true });
  });
  it("clears within the track and stands a creature back up", () => {
    const r = clearTrack({ ...bandit, hp: 5, defeated: true }, "hp", 2);
    expect(r.cleared).toBe(2);
    expect(r.after).toMatchObject({ hp: 3, defeated: false });
    expect(clearTrack(bandit, "stress", 3).cleared).toBe(0);
  });
});
