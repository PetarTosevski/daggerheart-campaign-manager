import { describe, expect, it } from "vitest";

import { COUNTDOWN_DICE_SIDES } from "@/lib/domain/countdowns/advanced";
import {
  restTickAmount,
  restTickAmountLabel,
  restTickFeedAudience,
  restTickRestFor,
  restTickRollText,
  restTicksOf,
  restTickText,
} from "@/lib/domain/countdowns/rest-ticks";

/** Plan rest-ticks RT1 (dcm-674k): the pure rest-tick maths. */

const never = () => {
  throw new Error("no die expected");
};

describe("restTicksOf", () => {
  it("returns the new fields when set, for any mode", () => {
    const long = { amount: { kind: "die" as const, sides: 6 as const }, mode: "remind" as const };
    const short = { amount: { kind: "pcs" as const }, mode: "auto" as const };
    expect(restTicksOf({ mode: "standard", onLongRest: long, onShortRest: short })).toEqual({ long, short });
    expect(restTicksOf({})).toEqual({ long: null, short: null });
    // The new field wins over the legacy long-term flags.
    expect(restTicksOf({ mode: "longTerm", armed: true, restMode: "auto", onLongRest: long }).long).toEqual(long);
  });

  it("maps a legacy long-term row: armed + restMode absent / auto / remind -> fixed 1; unarmed -> none", () => {
    const fixed1 = { kind: "fixed", n: 1 };
    expect(restTicksOf({ mode: "longTerm", armed: true })).toEqual({ long: { amount: fixed1, mode: "auto" }, short: null });
    expect(restTicksOf({ mode: "longTerm", armed: true, restMode: "auto" }).long).toEqual({ amount: fixed1, mode: "auto" });
    expect(restTicksOf({ mode: "longTerm", armed: true, restMode: "remind" }).long).toEqual({ amount: fixed1, mode: "remind" });
    expect(restTicksOf({ mode: "longTerm", armed: false, restMode: "remind" }).long).toBeNull();
    expect(restTicksOf({ mode: "longTerm" }).long).toBeNull();
    // `armed` on any other type means "ticks on rolls", never rests.
    expect(restTicksOf({ mode: "standard", armed: true }).long).toBeNull();
    expect(restTicksOf({ armed: true }).long).toBeNull();
  });
});

describe("restTickRestFor", () => {
  it("finished long -> long; finished short and interrupted long -> short (Q1); interrupted short and open -> none", () => {
    expect(restTickRestFor({ kind: "long", status: "finished" })).toBe("long");
    expect(restTickRestFor({ kind: "short", status: "finished" })).toBe("short");
    expect(restTickRestFor({ kind: "long", status: "interrupted" })).toBe("short");
    expect(restTickRestFor({ kind: "short", status: "interrupted" })).toBeNull();
    expect(restTickRestFor({ kind: "long", status: "open" })).toBeNull();
  });
});

describe("restTickAmount", () => {
  it("fixed: the number, no die", () => {
    expect(restTickAmount({ kind: "fixed", n: 3 }, 4, never)).toEqual({ amount: 3 });
  });

  it("pcs: the resting PCs; 0 PCs give 0", () => {
    expect(restTickAmount({ kind: "pcs" }, 4, never)).toEqual({ amount: 4, pcs: 4 });
    expect(restTickAmount({ kind: "pcs" }, 0, never)).toEqual({ amount: 0, pcs: 0 });
  });

  it("die: rolls the die once, over every allowed size", () => {
    for (const sides of COUNTDOWN_DICE_SIDES) {
      const asked: number[] = [];
      const rng = (n: number) => {
        asked.push(n);
        return n; // the highest face
      };
      expect(restTickAmount({ kind: "die", sides }, 3, rng)).toEqual({ amount: sides, die: { sides, rolled: sides } });
      expect(asked).toEqual([sides]);
    }
  });

  it("die + PCs: the roll plus the PCs; 0 PCs give the die alone", () => {
    expect(restTickAmount({ kind: "diePlusPcs", sides: 6 }, 2, () => 3)).toEqual({ amount: 5, pcs: 2, die: { sides: 6, rolled: 3 } });
    expect(restTickAmount({ kind: "diePlusPcs", sides: 20 }, 0, () => 17)).toEqual({ amount: 17, pcs: 0, die: { sides: 20, rolled: 17 } });
  });
});

describe("texts", () => {
  it("restTickText and restTickRollText for the feed", () => {
    expect(restTickText({ amount: 5, pcs: 2, die: { sides: 6, rolled: 3 } })).toBe("5 (1d6 3 + 2 PCs)");
    expect(restTickText({ amount: 3, die: { sides: 8, rolled: 3 } })).toBe("3 (1d8 3)");
    expect(restTickText({ amount: 1, pcs: 1 })).toBe("1 (1 PC)");
    expect(restTickText({ amount: 2 })).toBe("2");
    expect(restTickRollText({ amount: 2 })).toBeNull();
    expect(restTickRollText({ amount: 4, pcs: 4 })).toBe("4 PCs");
  });

  it("restTickAmountLabel", () => {
    expect(restTickAmountLabel({ kind: "fixed", n: 2 })).toBe("Fixed 2");
    expect(restTickAmountLabel({ kind: "pcs" })).toBe("PCs who rested");
    expect(restTickAmountLabel({ kind: "die", sides: 4 })).toBe("d4");
    expect(restTickAmountLabel({ kind: "diePlusPcs", sides: 12 })).toBe("d12 + PCs who rested");
  });
});

describe("restTickFeedAudience", () => {
  it("public only for Public (no hidden field, or no visibility stored); gm for Private and Partly hidden", () => {
    expect(restTickFeedAudience(undefined)).toBe("public");
    expect(restTickFeedAudience({ mode: "public", hidden: [] })).toBe("public");
    expect(restTickFeedAudience({ mode: "public", hidden: ["name"] })).toBe("gm");
    expect(restTickFeedAudience({ mode: "public", hidden: ["progress"] })).toBe("gm");
    expect(restTickFeedAudience({ mode: "private" })).toBe("gm");
  });
});
