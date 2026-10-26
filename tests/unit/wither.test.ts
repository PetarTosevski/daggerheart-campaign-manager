import { describe, expect, it } from "vitest";

import { applyResourceDelta } from "../../src/lib/domain/characters";
import { addScar, adjustWither, fearDieScars, gainWither } from "../../src/lib/domain/wither";

const sheet = (over: Partial<{ wither: number; scars: number; hope: number; hopeSlotBonus: number; journeyEnds: boolean }> = {}) => ({
  wither: 0,
  scars: 0,
  hope: 2,
  hopeSlotBonus: 0,
  journeyEnds: false,
  ...over,
});

describe("Wither tokens (CB 261)", () => {
  it("scars when the Fear Die is equal to or below the tokens", () => {
    expect(fearDieScars(3, 3)).toBe(true);
    expect(fearDieScars(2, 3)).toBe(true);
    expect(fearDieScars(4, 3)).toBe(false);
  });

  it("adds a token and keeps it when the Fear Die rolls above the new count", () => {
    const g = gainWither(sheet({ wither: 1 }), 3);
    expect(g).toMatchObject({ tokens: 2, fearDie: 3, scarred: false });
    expect(g.sheet).toMatchObject({ wither: 2, scars: 0 });
  });

  it("compares with the count after the gain: 1 token then a Fear Die of 2 scars", () => {
    const g = gainWither(sheet({ wither: 1 }), 2);
    expect(g).toMatchObject({ tokens: 2, scarred: true });
    expect(g.sheet).toMatchObject({ wither: 0, scars: 1 });
  });

  it("a scar clears every token and cuts Hope to the slots left", () => {
    const g = gainWither(sheet({ wither: 5, scars: 1, hope: 5 }), 1);
    expect(g.sheet).toMatchObject({ wither: 0, scars: 2, hope: 4, journeyEnds: false });
  });

  it("has no per-PC cap: at 12 tokens any Fear Die scars", () => {
    expect(gainWither(sheet({ wither: 10 }), 12).sheet.wither).toBe(11);
    expect(gainWither(sheet({ wither: 11 }), 12)).toMatchObject({ tokens: 12, scarred: true });
  });

  it("scarring the last Hope slot ends the journey (CB 106)", () => {
    const g = gainWither(sheet({ wither: 0, scars: 5, hope: 1 }), 1);
    expect(g.sheet).toMatchObject({ scars: 6, hope: 0, journeyEnds: true });
  });

  it("a seventh Hope slot (Light in the Dark) keeps the journey going at five scars", () => {
    expect(addScar(sheet({ scars: 5, hope: 2, hopeSlotBonus: 1 }))).toMatchObject({ scars: 6, hope: 1, journeyEnds: false });
  });

  it("with Light in the Dark the seventh scar is stored and ends the journey; without it scars stop at 6", () => {
    expect(addScar(sheet({ scars: 6, hope: 1, hopeSlotBonus: 1 }))).toMatchObject({ scars: 7, hope: 0, journeyEnds: true });
    expect(gainWither(sheet({ wither: 0, scars: 6, hope: 1, hopeSlotBonus: 1 }), 1).sheet).toMatchObject({ scars: 7, journeyEnds: true });
    expect(addScar(sheet({ scars: 6, hope: 0, journeyEnds: true })).scars).toBe(6);
  });

  it("applyResourceDelta's scar clamp is 6 + hopeSlotBonus", () => {
    const tracks = { hp: 0, hpMax: 6, stress: 0, stressMax: 6, hope: 1, scars: 6 };
    expect(applyResourceDelta({ ...tracks, hopeSlotBonus: 1 }, "scars", 3).scars).toBe(7);
    expect(applyResourceDelta(tracks, "scars", 3).scars).toBe(6);
  });

  it("the GM's correction stays within 0..99", () => {
    expect(adjustWither(sheet({ wither: 1 }), -3).wither).toBe(0);
    expect(adjustWither(sheet({ wither: 98 }), 5).wither).toBe(99);
    expect(adjustWither(sheet({ wither: 2 }), 1).wither).toBe(3);
  });
});
