import { describe, expect, it } from "vitest";

import {
  addPyre,
  adjustBranches,
  assertCanRollLurking,
  BRANCH_HOPE_REMINDER,
  igniteBranch,
  INITIAL_UMBRA,
  logLurking,
  LURKING_FEAR,
  LURKING_LOG_SIZE,
  lurkingOutcome,
  removePyre,
  renamePyre,
  resolveLurking,
  setPyreLit,
  settlementSchema,
  watchersSchema,
  type UmbraState,
} from "../../src/lib/frames/trackers/age-of-umbra";

const withPyres = (): UmbraState => {
  const a = addPyre(INITIAL_UMBRA, "Brightmoor", true).state;
  return addPyre(a, "Ashfall", false).state;
};

describe("Sacred Pyres (Core p.288)", () => {
  it("adds pyres with stable ids, renames, lights and removes them", () => {
    const s = withPyres();
    expect(s.pyres).toEqual([
      { id: "p1", settlement: "Brightmoor", lit: true },
      { id: "p2", settlement: "Ashfall", lit: false },
    ]);
    expect(renamePyre(s, "p2", "Emberfall").pyres[1]?.settlement).toBe("Emberfall");
    expect(setPyreLit(s, "p1", false).pyres[0]?.lit).toBe(false);
    const removed = removePyre(s, "p1");
    expect(removed.pyres.map((p) => p.id)).toEqual(["p2"]);
    // Ids are never reused.
    expect(addPyre(removed, "New", true).pyreId).toBe("p3");
    expect(() => renamePyre(s, "p9", "x")).toThrow(/gone/);
  });

  it("validates settlement names", () => {
    expect(settlementSchema.safeParse("  Brightmoor ").data).toBe("Brightmoor");
    expect(settlementSchema.safeParse("  ").success).toBe(false);
    expect(settlementSchema.safeParse("x".repeat(61)).success).toBe(false);
  });
});

describe("Blessed Branches (Core p.288)", () => {
  it("are counted and never go below zero", () => {
    expect(adjustBranches(INITIAL_UMBRA, 1).blessedBranches).toBe(1);
    expect(() => adjustBranches(INITIAL_UMBRA, -1)).toThrow();
  });

  it("relight an extinguished pyre, spending the branch, with the 3 Hope reminder", () => {
    const s = adjustBranches(withPyres(), 1);
    const result = igniteBranch(s, { mode: "relight", pyreId: "p2" });
    expect(result.state.pyres[1]?.lit).toBe(true);
    expect(result.state.blessedBranches).toBe(0);
    expect(result.reminder).toBe(BRANCH_HOPE_REMINDER);
    expect(BRANCH_HOPE_REMINDER).toMatch(/3 Hope/);
  });

  it("found a new, burning pyre", () => {
    const result = igniteBranch(adjustBranches(INITIAL_UMBRA, 1), { mode: "found", settlement: "Lastlight" });
    expect(result.state.pyres).toEqual([{ id: "p1", settlement: "Lastlight", lit: true }]);
    expect(result.pyreId).toBe("p1");
  });

  it("need a branch, and a pyre that is out", () => {
    expect(() => igniteBranch(withPyres(), { mode: "relight", pyreId: "p2" })).toThrow(/no Blessed Branch/);
    expect(() => igniteBranch(adjustBranches(withPyres(), 1), { mode: "relight", pyreId: "p1" })).toThrow(/already/);
  });
});

describe("Lurking Darkness (Core p.289)", () => {
  it("follows the d12 list", () => {
    const table = Array.from({ length: 12 }, (_, i) => lurkingOutcome(i + 1));
    expect(table).toEqual([
      "conflict", "conflict",
      "fear2", "fear2", "fear2",
      "fear1", "fear1", "fear1", "fear1",
      "none", "none",
      "hope",
    ]);
    expect(LURKING_FEAR).toMatchObject({ fear2: 2, fear1: 1, conflict: 0, none: 0, hope: 0 });
    expect(() => lurkingOutcome(0)).toThrow();
    expect(() => lurkingOutcome(13)).toThrow();
  });

  it("uses the GM roll when nobody keeps watch", () => {
    expect(resolveLurking(4, [])).toEqual({ gmRoll: 4, watchRoll: null, result: 4, outcome: "fear2" });
  });

  it("Keep Watch: the highest watcher's Hope Die replaces a lower GM roll", () => {
    expect(resolveLurking(2, [7, 11, 3])).toEqual({ gmRoll: 2, watchRoll: 11, result: 11, outcome: "none" });
  });

  it("Keep Watch: the party keeps a GM roll that is already as good", () => {
    expect(resolveLurking(10, [6])).toMatchObject({ watchRoll: 6, result: 10, outcome: "none" });
  });

  it("rejects watcher results outside a d12", () => {
    expect(watchersSchema.safeParse([0]).success).toBe(false);
    expect(watchersSchema.safeParse([12, 1]).success).toBe(true);
    expect(watchersSchema.safeParse(Array(9).fill(5)).success).toBe(false);
  });

  it("is not rolled at a Sacred Pyre", () => {
    expect(() => assertCanRollLurking({ ...INITIAL_UMBRA, atPyre: true })).toThrow(/Sacred Pyre/);
    expect(() => assertCanRollLurking(INITIAL_UMBRA)).not.toThrow();
  });

  it("keeps only the last few rolls", () => {
    let s = INITIAL_UMBRA;
    for (let i = 1; i <= LURKING_LOG_SIZE + 1; i++) {
      s = logLurking(s, { gmRoll: i, watchRoll: null, result: i, outcome: lurkingOutcome(i), fearGained: 0, at: i });
    }
    expect(s.log).toHaveLength(LURKING_LOG_SIZE);
    expect(s.log[0]?.gmRoll).toBe(LURKING_LOG_SIZE + 1);
  });
});
