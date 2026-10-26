import { describe, expect, it } from "vitest";

import { encounterRoll, travelDays } from "@/lib/domain/frames/horizon";

const fixed = (face: number) => () => face;
const noRoll = () => {
  throw new Error("should not roll");
};

describe("Horizon travel", () => {
  it("takes the terrain rating in days over land", () => {
    expect([1, 2, 3, 4].map((t) => travelDays(t, "land", noRoll).days)).toEqual([1, 2, 3, 4]);
  });

  it("downstream is one day less, never under 1; upstream one more", () => {
    expect(travelDays(3, "riverDown", noRoll).days).toBe(2);
    expect(travelDays(1, "riverDown", noRoll).days).toBe(1);
    expect(travelDays(2, "riverUp", noRoll).days).toBe(3);
  });

  it("rolls a d4 for ocean weather, which is the days", () => {
    const sides: number[] = [];
    expect(travelDays(1, "ocean", (s) => (sides.push(s), 3))).toEqual({ days: 3, weatherRoll: 3 });
    expect(sides).toEqual([4]);
  });

  it("rejects a terrain rating outside 1–4", () => {
    expect(() => travelDays(5, "land", noRoll)).toThrow(RangeError);
  });

  it("rolls terrain-rating d6s; any 1 is an encounter", () => {
    const sides: number[] = [];
    const faces = [4, 1];
    expect(encounterRoll(2, (s) => (sides.push(s), faces.shift()!))).toEqual({ dice: [4, 1], encounter: true });
    expect(sides).toEqual([6, 6]);
    expect(encounterRoll(3, fixed(5))).toEqual({ dice: [5, 5, 5], encounter: false });
  });

  it("can use d4 or d8 instead", () => {
    const sides: number[] = [];
    encounterRoll(1, (s) => (sides.push(s), 2), 4);
    encounterRoll(1, (s) => (sides.push(s), 2), 8);
    expect(sides).toEqual([4, 8]);
  });
});
