import { describe, expect, it } from "vitest";

import { adversaryAttack, keptDie, ownDisadvantage, splitTargetDisadvantage } from "@/lib/domain/adversary-actions";
import { queueRng } from "@/lib/domain/dice";

// Plan drawer-answers, tracer DA1 (bead dcm-bxp.99.19.45 (3), user 2026-10-30): on an adversary attack against several
// targets, a target's own disadvantage counts only against that target. One roll (CB p.161: "you make one attack roll
// and ask if it hits any of the targets"), one pair of d20s; each target keeps its own die (CB p.161: "If an NPC has
// advantage, roll an extra d20 and take the highest result. Similarly, if an NPC has disadvantage, roll an extra d20 and
// use the lowest result."). Sturdy, CB p.68: "When you have 1 Hit Point remaining, attacks against you have
// disadvantage." Expected values are worked out by hand from those passages.

describe("keptDie (CB p.161)", () => {
  it("keeps the higher with advantage, the lower with disadvantage, the first otherwise", () => {
    expect(keptDie(15, 4, 0)).toBe(15);
    expect(keptDie(15, 4, -1)).toBe(4);
    expect(keptDie(4, 15, 1)).toBe(15);
    expect(keptDie(4, 15, -2)).toBe(4);
    expect(keptDie(9, null, -1)).toBe(9);
  });
});

describe("splitTargetDisadvantage", () => {
  it("what every target carries counts for the whole roll; the rest per target", () => {
    expect(splitTargetDisadvantage([{ id: "orc", disadvantage: 1 }])).toEqual({ common: 1, residual: new Map() });
    expect(
      splitTargetDisadvantage([
        { id: "orc", disadvantage: 1 },
        { id: "orc2", disadvantage: 1 },
      ]),
    ).toEqual({ common: 1, residual: new Map() });
    expect(
      splitTargetDisadvantage([
        { id: "mira", disadvantage: 0 },
        { id: "orc", disadvantage: 1 },
        { id: "warded", disadvantage: 2 },
      ]),
    ).toEqual({
      common: 0,
      residual: new Map([
        ["orc", 1],
        // DA17: Sturdy and Harrowing on the same target count once.
        ["warded", 1],
      ]),
    });
    expect(splitTargetDisadvantage([])).toEqual({ common: 0, residual: new Map() });
  });
});

describe("adversaryAttack: per-target disadvantage (DA1)", () => {
  const mira = { id: "mira", evasion: 12 };
  const orc = { id: "orc", evasion: 10, disadvantage: 1 };

  it("one roll: the Sturdy orc keeps the 4 (6, a miss), Mira keeps the 15 (17, a hit)", () => {
    const r = adversaryAttack(2, {}, 0, [mira, orc], queueRng([15, 4]));
    expect(r.targets).toEqual([
      { id: "mira", natural: 15, total: 17, critical: false, hit: true },
      { id: "orc", natural: 4, total: 6, critical: false, hit: false },
    ]);
    expect(r.hits).toEqual([
      { id: "mira", hit: true },
      { id: "orc", hit: false },
    ]);
    // Both d20s are in the record, one roll.
    expect(r.record.dice.filter((d) => d.sides === 20).map((d) => d.value)).toEqual([15, 4]);
  });

  it("the same dice the other way round: the orc's low die is its own; Mira still keeps the first", () => {
    const r = adversaryAttack(2, {}, 0, [mira, orc], queueRng([9, 18]));
    // Mira: 9 + 2 = 11 against 12, a miss. Orc: min(9, 18) = 9 + 2 = 11 against 10, a hit.
    expect(r.hits).toEqual([
      { id: "mira", hit: false },
      { id: "orc", hit: true },
    ]);
  });

  it("the adversary's advantage: Mira keeps the higher, the Sturdy orc's disadvantage cancels it (the first die)", () => {
    const r = adversaryAttack(0, { advantage: 1 }, 0, [mira, orc], queueRng([5, 14]));
    expect(r.targets.map((t) => [t.id, t.natural, t.hit])).toEqual([
      ["mira", 14, true],
      ["orc", 5, false],
    ]);
  });

  it("a natural 20 is a critical only for the targets that keep it (CB p.148)", () => {
    const r = adversaryAttack(2, {}, 0, [mira, orc], queueRng([20, 3]));
    expect(r.targets).toEqual([
      { id: "mira", natural: 20, total: 22, critical: true, hit: true },
      // The orc keeps the 3: 5 against 10, a miss although the other die shows a 20.
      { id: "orc", natural: 3, total: 5, critical: false, hit: false },
    ]);
  });

  it("modifier dice roll after both d20s and count for every target", () => {
    const r = adversaryAttack("+2d4", {}, 0, [mira, orc], queueRng([15, 4, 3, 4]));
    expect(r.targets.map((t) => t.total)).toEqual([22, 11]);
  });

  it("no target with its own disadvantage: one die, as before", () => {
    const r = adversaryAttack(2, {}, 0, [mira, { id: "bram", evasion: 18 }], queueRng([15]));
    expect(r.record.dice).toHaveLength(1);
    expect(r.targets.map((t) => t.total)).toEqual([17, 17]);
  });

  it("a single Sturdy target: the whole roll has disadvantage (as SD2 built)", () => {
    const r = adversaryAttack(2, {}, 0, [orc], queueRng([15, 4]));
    expect(r.total).toBe(6);
    expect(r.targets[0]).toMatchObject({ natural: 4, hit: false });
  });
});

// Plan drawer-answers, tracer DA17 (bead dcm-bxp.99.19.53, user 2026-10-30): several disadvantage sources on the same
// target (Sturdy, CB p.68, plus Harrowing Invocation, HF p.14: "give them disadvantage on the roll") count once, on or
// off; one advantage source cancels it. CB "Advantage and Disadvantage": "Advantage and disadvantage always cancel each
// other out when applied to the same roll"; "if you have two sources of advantage and one of disadvantage, one of the
// advantage dice and the disadvantage die cancel each other out, so you would have advantage on the roll."
describe("several disadvantage sources on one target count once (DA17)", () => {
  const mira = { id: "mira", evasion: 12 };
  // Sturdy and Harrowing on the orc: two sources, one disadvantage.
  const orc = { id: "orc", evasion: 10, disadvantage: 2 };

  it("ownDisadvantage is on or off", () => {
    expect([0, 1, 2, 3].map(ownDisadvantage)).toEqual([0, 1, 1, 1]);
    expect(ownDisadvantage(undefined)).toBe(0);
  });

  it("two sources on the orc against Mira with none: the orc keeps the lower die once, as with one source", () => {
    const r = adversaryAttack(2, {}, 0, [mira, orc], queueRng([15, 4]));
    expect(r.targets.map((t) => [t.id, t.natural])).toEqual([
      ["mira", 15],
      ["orc", 4],
    ]);
  });

  it("one advantage source cancels the orc's two sources: the orc keeps the first die, Mira the higher", () => {
    const r = adversaryAttack(2, { advantage: 1 }, 0, [mira, orc], queueRng([5, 14]));
    // Orc: net 1 - 1 = 0, the first die 5 + 2 = 7 against 10, a miss (per source it would be -1: still 5).
    // Mira: advantage, 14 + 2 = 16, a hit.
    expect(r.targets.map((t) => [t.id, t.natural, t.hit])).toEqual([
      ["mira", 14, true],
      ["orc", 5, false],
    ]);
  });

  it("one advantage source against the orc alone: one die, no disadvantage left (per source it kept the lower)", () => {
    const r = adversaryAttack(2, { advantage: 1 }, 0, [orc], queueRng([15, 4]));
    expect(r.targets[0]).toMatchObject({ natural: 15, total: 17, hit: true });
  });

  it("two advantage sources against the orc alone: advantage, it keeps the higher (per source the two cancelled)", () => {
    const r = adversaryAttack(2, { advantage: 2 }, 0, [orc], queueRng([4, 15]));
    expect(r.targets[0]).toMatchObject({ natural: 15, total: 17, hit: true });
  });
});
