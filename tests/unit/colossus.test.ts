import { describe, expect, it } from "vitest";

import {
  applyCorrection,
  colossusCorrectionSchema,
  defeatColossus,
  hasEmerged,
  INITIAL_COLOSSUS,
  kudamatThresholds,
  markRest,
  resolveSiphon,
  SIPHON_LOG_SIZE,
  type ColossusState,
} from "../../src/lib/frames/trackers/colossus";

/** Dice that always come up with the given faces (repeating the last). */
const fixed =
  (...faces: number[]) =>
  (count: number) =>
    Array.from({ length: count }, (_, i) => faces[Math.min(i, faces.length - 1)]!);
const noRoll = () => {
  throw new Error("should not roll");
};
const at = 1000;
const state = (patch: Partial<ColossusState> = {}): ColossusState => ({ ...INITIAL_COLOSSUS, ...patch });

describe("Colossus Siphoning Track (Core p.327)", () => {
  it("starts with one slot marked, Power 0, in the hunt", () => {
    expect(INITIAL_COLOSSUS).toMatchObject({ siphonMarked: 1, kudamatPower: 0, colossiDefeated: 0, phase: "hunt" });
  });

  it("marks once for a short rest and twice for a long rest during the hunt", () => {
    expect(markRest(state(), "short", noRoll, at).state.siphonMarked).toBe(2);
    expect(markRest(state(), "long", noRoll, at).state.siphonMarked).toBe(3);
  });

  it("does not mark during an interlude", () => {
    expect(() => markRest(state({ phase: "interlude" }), "short", noRoll, at)).toThrow(/hunt phase/);
  });

  it("rolls as many d12 as marked slots when the track fills, adds the highest and resets to 1", () => {
    const rolled: number[] = [];
    const roll = (count: number) => {
      rolled.push(count);
      return fixed(3, 9, 4)(count);
    };
    const { state: next, rolls } = markRest(state({ siphonMarked: 9, kudamatPower: 20 }), "short", roll, at);
    expect(rolled).toEqual([10]);
    expect(next).toMatchObject({ siphonMarked: 1, kudamatPower: 29 });
    expect(rolls).toEqual([{ reason: "full", dice: [3, 9, 4, 4, 4, 4, 4, 4, 4, 4], gained: 9, powerAfter: 29, at }]);
  });

  it("a long rest at 9 fills the track, resolves, and lands its second mark on the reset track", () => {
    const { state: next, rolls } = markRest(state({ siphonMarked: 9 }), "long", fixed(5), at);
    expect(rolls).toHaveLength(1);
    expect(next).toMatchObject({ siphonMarked: 2, kudamatPower: 5 });
  });

  it("a long rest at 8 fills the track on its second mark", () => {
    const { state: next } = markRest(state({ siphonMarked: 8 }), "long", fixed(7), at);
    expect(next).toMatchObject({ siphonMarked: 1, kudamatPower: 7 });
  });

  it("rejects dice that do not match the marked slots", () => {
    expect(() => resolveSiphon(state({ siphonMarked: 3 }), "full", () => [4, 4], at)).toThrow();
    expect(() => resolveSiphon(state({ siphonMarked: 1 }), "full", () => [13], at)).toThrow();
  });

  it("keeps only the last few rolls, newest first", () => {
    let s = state();
    for (let i = 1; i <= SIPHON_LOG_SIZE + 2; i++) s = resolveSiphon(s, "full", fixed(i), i).state;
    expect(s.log).toHaveLength(SIPHON_LOG_SIZE);
    expect(s.log[0]?.gained).toBe(SIPHON_LOG_SIZE + 2);
  });
});

describe("defeating a colossus", () => {
  it("rolls the shard, counts the colossus, resets the track and starts the interlude with a level-up notice", () => {
    const result = defeatColossus(state({ siphonMarked: 4, kudamatPower: 10 }), fixed(2, 11, 6, 1), at);
    expect(result.roll).toMatchObject({ reason: "defeat", dice: [2, 11, 6, 1], gained: 11, powerAfter: 21 });
    expect(result.state).toMatchObject({ colossiDefeated: 1, siphonMarked: 1, kudamatPower: 21, phase: "interlude" });
    expect(result.notice).toMatch(/levels up/);
  });

  it("the ninth colossus brings level 10 and Kudamat's emergence; no tenth", () => {
    const result = defeatColossus(state({ colossiDefeated: 8 }), fixed(1), at);
    expect(result.notice).toMatch(/level 10/);
    expect(hasEmerged(result.state)).toBe(true);
    expect(() => defeatColossus(result.state, fixed(1), at)).toThrow(/nine/);
  });
});

describe("Kudamat", () => {
  it("emerges at 9 colossi or Power 100", () => {
    expect(hasEmerged({ kudamatPower: 99, colossiDefeated: 8 })).toBe(false);
    expect(hasEmerged({ kudamatPower: 100, colossiDefeated: 0 })).toBe(true);
    expect(hasEmerged({ kudamatPower: 0, colossiDefeated: 9 })).toBe(true);
  });

  it("has Severe = Power and Major = half, rounded up", () => {
    expect(kudamatThresholds(57)).toEqual({ major: 29, severe: 57 });
    expect(kudamatThresholds(0)).toEqual({ major: 0, severe: 0 });
  });
});

describe("corrections", () => {
  it("validate ranges and require a field", () => {
    expect(colossusCorrectionSchema.safeParse({}).success).toBe(false);
    expect(colossusCorrectionSchema.safeParse({ siphonMarked: 0 }).success).toBe(false);
    expect(colossusCorrectionSchema.safeParse({ siphonMarked: 11 }).success).toBe(false);
    expect(colossusCorrectionSchema.safeParse({ colossiDefeated: 10 }).success).toBe(false);
    expect(colossusCorrectionSchema.safeParse({ kudamatPower: -1 }).success).toBe(false);
    expect(colossusCorrectionSchema.safeParse({ kudamatPower: 2.5 }).success).toBe(false);
  });

  it("apply only the given fields", () => {
    expect(applyCorrection(state({ siphonMarked: 3 }), { kudamatPower: 42 })).toMatchObject({ siphonMarked: 3, kudamatPower: 42 });
  });
});
