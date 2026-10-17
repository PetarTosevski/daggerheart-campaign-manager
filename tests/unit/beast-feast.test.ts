import { describe, expect, it } from "vitest";

import { bloomFlavor, flavorPool, harvestCount, makeFeast, rollBloom } from "@/lib/domain/frames/beast-feast";

/** A scripted roller: returns the given faces in order. */
function script(...faces: number[]) {
  const queue = [...faces];
  return (sides: number) => {
    const face = queue.shift();
    if (face === undefined) throw new Error("ran out of scripted rolls");
    if (face < 1 || face > sides) throw new Error(`face ${face} impossible on d${sides}`);
    return face;
  };
}

describe("Beast Feast", () => {
  it("builds the flavor dice from ingredient strengths (the book's steak dinner)", () => {
    const pool = flavorPool([
      { flavors: [{ flavor: "savory", strength: 3 }] },
      { flavors: [{ flavor: "bitter", strength: 1 }, { flavor: "savory", strength: 2 }] },
      { flavors: [{ flavor: "sweet", strength: 1 }, { flavor: "bitter", strength: 2 }] },
    ]);
    expect([...pool].sort((a, b) => a - b)).toEqual([4, 8, 8, 8, 12, 12, 12, 12, 12]);
  });

  it("sets aside matched sets, rerolls the rest and sums each set's value", () => {
    // d6, d8, d10, d12, d20: roll 1 matches 3s (d6+d8); roll 2 matches 4s (d10+d12); d20 left.
    const result = makeFeast([6, 8, 10, 12, 20], 0, script(3, 3, 5, 7, 9, 4, 4, 11));
    expect(result.sets.map((s) => s.value)).toEqual([3, 4]);
    expect(result.mealRating).toBe(7);
    expect(result.lastDie).toBe(20);
    expect(result.rounds).toHaveLength(2);
  });

  it("counts a set of three dice once, at its face value", () => {
    const result = makeFeast([6, 6, 6, 8], 0, script(2, 2, 2, 5));
    expect(result.mealRating).toBe(2);
    expect(result.sets[0].dice).toHaveLength(3);
    expect(result.lastDie).toBe(8);
  });

  it("with no match, discards one die (the largest by default) and rolls again", () => {
    const result = makeFeast([4, 6, 20], 0, script(1, 2, 3, 3, 3));
    expect(result.rounds[0].discarded).toEqual({ sides: 20, value: 3 });
    expect(result.mealRating).toBe(3);
    expect(result.lastDie).toBeNull();
  });

  it("lets the players choose the discarded die", () => {
    const result = makeFeast([4, 6, 20], 0, script(1, 2, 3, 2, 2), () => 0);
    expect(result.rounds[0].discarded).toEqual({ sides: 4, value: 1 });
    expect(result.mealRating).toBe(2);
  });

  it("discards a cookbook token instead of a die while tokens remain", () => {
    const result = makeFeast([4, 6], 2, script(1, 2, 3, 4, 1, 2));
    expect(result.rounds.map((r) => r.discarded)).toEqual(["token", "token", { sides: 6, value: 2 }]);
    expect(result.tokensLeft).toBe(0);
    expect(result.mealRating).toBe(0);
    expect(result.lastDie).toBe(4);
  });

  it("a single die is already done", () => {
    expect(makeFeast([12], 0, script())).toMatchObject({ mealRating: 0, lastDie: 12, rounds: [] });
  });

  it("maps the Hope Die to a bloom flavor", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(bloomFlavor)).toEqual([
      "sweet", "sweet", "salty", "salty", "bitter", "bitter", "sour", "sour", "savory", "savory", "weird", "weird",
    ]);
    expect(rollBloom(script(9))).toEqual({ hopeDie: 9, flavor: "savory", strength: 1 });
    expect(() => bloomFlavor(13)).toThrow(RangeError);
  });

  it("harvests ingredients by the beast's max HP (11 → 3)", () => {
    expect([1, 4, 5, 7, 8, 10, 11, 12, 20].map(harvestCount)).toEqual([1, 1, 2, 2, 3, 3, 3, 4, 4]);
  });
});
