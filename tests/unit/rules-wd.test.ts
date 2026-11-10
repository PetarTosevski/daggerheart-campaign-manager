// Plan rule-switches wave 3, tracer WD: the pure parts of T1, T3, C4 and W3 Tier 1 (docs/tasks/TASK-RULES-WD.md).
import { describe, expect, it } from "vitest";

import {
  hpClearedWakeNote,
  isUntargetableUnconscious,
  keepUnconscious,
  longRestWakeNote,
  objectPronoun,
  unconsciousBlocksActing,
} from "@/lib/domain/characters";
import { NO_REST_FEATURES, restMoveSlots, validateFeatureChoice } from "@/lib/domain/rest/feature-moves";
import { higherOfTwo, isCoreMove, moveCountNote, picksText, splitManualMoves, validateChoice } from "@/lib/domain/rest";
import { RuleError } from "@/lib/errors/app-error";

const prepare = { move: "prepare" as const };

describe("T1 Two moves per rest", () => {
  it("Book: two moves (plus feature extras); Manual: 0 to 4, or more when features give more", () => {
    expect(restMoveSlots(NO_REST_FEATURES)).toEqual({ min: 2, max: 2 });
    expect(restMoveSlots(NO_REST_FEATURES, 0, "manual")).toEqual({ min: 0, max: 4 });
    expect(restMoveSlots({ ...NO_REST_FEATURES, trance: true }, 2, "manual")).toEqual({ min: 0, max: 5 });
  });

  it("validateFeatureChoice and validateChoice follow the mode", () => {
    const allowed = ["prepare", "clearStress"] as const;
    expect(() => validateFeatureChoice("a", [], allowed, NO_REST_FEATURES)).toThrow(RuleError);
    expect(() => validateFeatureChoice("a", [], allowed, NO_REST_FEATURES, [], 0, "manual")).not.toThrow();
    expect(() => validateFeatureChoice("a", [prepare, prepare, prepare, prepare], allowed, NO_REST_FEATURES, [], 0, "manual")).not.toThrow();
    expect(() => validateFeatureChoice("a", Array(5).fill(prepare), allowed, NO_REST_FEATURES, [], 0, "manual")).toThrow(RuleError);
    expect(() => validateChoice("short", "a", [prepare])).toThrow(RuleError);
    expect(() => validateChoice("short", "a", [prepare], [], [], "manual")).not.toThrow();
    expect(() => validateChoice("short", "a", Array(5).fill(prepare), [], [], "manual")).toThrow(RuleError);
  });

  it("the GM's note", () => {
    expect(moveCountNote("Mira", 3)).toBe("Mira picked 3 moves");
    expect(moveCountNote("Mira", 1)).toBe("Mira picked 1 move");
  });
});

describe("T3 What each move does", () => {
  const choices = [
    { characterId: "m", moves: [{ move: "tendToWounds" as const, targetId: "t" }, prepare] },
    { characterId: "t", moves: [{ move: "tribute" as const }, { move: "clearStress" as const }] },
    { characterId: "x", moves: [{ move: "martialPreparation" as const }] },
  ];

  it("Book applies everything", () => {
    expect(splitManualMoves(choices)).toEqual({ applied: choices, byHand: [] });
  });

  it("Manual keeps only the core moves by hand; class and frame moves still apply", () => {
    const { applied, byHand } = splitManualMoves(choices, "manual");
    expect(applied.map((c) => c.moves.map((m) => m.move))).toEqual([[], ["tribute"], ["martialPreparation"]]);
    expect(byHand).toEqual([
      { characterId: "m", moves: [{ move: "tendToWounds", targetId: "t" }, prepare] },
      { characterId: "t", moves: [{ move: "clearStress" }] },
    ]);
    expect(isCoreMove("workOnProject")).toBe(true);
    expect(isCoreMove("makeAFeast")).toBe(false);
  });

  it("lists the picks in words", () => {
    expect(picksText(choices[0]!.moves, (id) => (id === "t" ? "Theo" : "?"))).toBe("Tend to Wounds on Theo, Prepare");
  });
});

describe("C4 Unconscious", () => {
  const down = { hp: 6, conditions: ["unconscious" as const] };

  it("Book blocks acting and targeting; Manual does neither", () => {
    expect(unconsciousBlocksActing(down)).toBe(true);
    expect(unconsciousBlocksActing(down, "manual")).toBe(false);
    expect(unconsciousBlocksActing({ conditions: [] })).toBe(false);
    expect(isUntargetableUnconscious(down)).toBe(true);
    expect(isUntargetableUnconscious(down, "manual")).toBe(false);
  });

  it("keepUnconscious: Manual undoes a wake by an HP clear; Book and a hand-cleared condition are kept", () => {
    const woken = { hp: 5, conditions: [] };
    expect(keepUnconscious(down, woken, "book")).toEqual({ sheet: woken, woke: false });
    expect(keepUnconscious(down, woken, "manual")).toEqual({ sheet: { hp: 5, conditions: ["unconscious"] }, woke: true });
    // The GM toggles the condition off without clearing HP: kept off.
    expect(keepUnconscious(down, { hp: 6, conditions: [] }, "manual").woke).toBe(false);
  });

  it("the GM's notes", () => {
    expect(hpClearedWakeNote("Mira", "she/her")).toBe("Mira had a Hit Point cleared: wake her?");
    expect(hpClearedWakeNote("Theo", "")).toBe("Theo had a Hit Point cleared: wake them?");
    expect(longRestWakeNote("Mira")).toBe("Long rest: wake Mira?");
    expect(objectPronoun("he/him")).toBe("him");
    expect(objectPronoun("Female")).toBe("them");
  });
});

describe("W3 Doom Track Tier 1", () => {
  it("keeps the higher of the two rolls", () => {
    expect(higherOfTwo(1, 4)).toBe(4);
    expect(higherOfTwo(3, 2)).toBe(3);
  });
});
