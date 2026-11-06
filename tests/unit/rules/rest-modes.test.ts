// Plan rule-switches RR: the pure rest rules under each mode (F2, T2, T4). The defaults are the Book behaviour.
import { describe, expect, it } from "vitest";

import {
  canStartExtended,
  extendedDowntimeFear,
  interruptedMoves,
  MAX_SHORT_RESTS,
  mustLongRest,
  overShortRestLimit,
  restFearPrompt,
  restFearRule,
  type ChosenMove,
} from "@/lib/domain/rest";

describe("F2 Fear from rests", () => {
  it("Book by default; an extended flag counts only on a long rest in the Extended downtime mode", () => {
    expect(restFearRule("long")).toBe("book");
    expect(restFearRule("long", true)).toBe("book");
    expect(restFearRule("long", true, "extendedDowntime")).toBe("extended");
    expect(restFearRule("long", false, "extendedDowntime")).toBe("book");
    // An interrupted extended rest runs as a short rest.
    expect(restFearRule("short", true, "extendedDowntime")).toBe("book");
    expect(restFearRule("short", false, "manual")).toBe("manual");
    expect(restFearRule("long", true, "manual")).toBe("manual");
  });

  it("the extended choice is a long rest in its own mode", () => {
    expect(canStartExtended("extendedDowntime", "long")).toBe(true);
    expect(canStartExtended("extendedDowntime", "short")).toBe(false);
    expect(canStartExtended("book", "long")).toBe(false);
    expect(canStartExtended("manual", "long")).toBe(false);
  });

  it("1d6 per PC, summed (CB 181)", () => {
    expect(extendedDowntimeFear([3, 6, 1, 2])).toBe(12);
    expect(extendedDowntimeFear([])).toBe(0);
  });

  it("Manual says the book's Fear (CB 105)", () => {
    expect(restFearPrompt("short", 4)).toBe("Gain 1d4 Fear");
    expect(restFearPrompt("long", 4)).toBe("Gain 1d4 + 4 Fear");
  });
});

describe("T2 Short-rest limit", () => {
  it("Book refuses a fourth short rest; Manual allows it but it is still over the limit", () => {
    expect(mustLongRest("short", MAX_SHORT_RESTS)).toBe(true);
    expect(mustLongRest("short", MAX_SHORT_RESTS, "book")).toBe(true);
    expect(mustLongRest("short", MAX_SHORT_RESTS, "manual")).toBe(false);
    expect(overShortRestLimit("short", MAX_SHORT_RESTS)).toBe(true);
    expect(overShortRestLimit("short", MAX_SHORT_RESTS - 1)).toBe(false);
    expect(overShortRestLimit("long", MAX_SHORT_RESTS + 2)).toBe(false);
  });
});

describe("T4 Interrupted rest", () => {
  const moves: ChosenMove[] = [{ move: "clearAllStress" }, { move: "tendToAllWounds", targetId: "b" }];
  it("Book: a long rest's moves become short-rest moves", () => {
    expect(interruptedMoves("long", moves)).toEqual([{ move: "clearStress" }, { move: "tendToWounds", targetId: "b" }]);
  });
  it("Manual: nothing is applied", () => {
    expect(interruptedMoves("long", moves, false, "manual")).toEqual([]);
    expect(interruptedMoves("long", moves, true, "manual")).toEqual([]);
  });
});
