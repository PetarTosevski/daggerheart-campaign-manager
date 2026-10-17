import { describe, expect, it } from "vitest";

import {
  createObjectiveSchema,
  defaultPicks,
  formatRating,
  loadState,
  NATION_IDS,
  NATION_PAIRS,
  nationFromOwnerKey,
  nationSheetSchema,
  objectiveLimitError,
  pairKey,
  planWeekAdvance,
  relationshipLabel,
  seedState,
  setRelationship,
  setReveal,
  type WeekObjective,
} from "@/lib/frames/trackers/five-banners";

describe("Five Banners relationships", () => {
  it("labels every rating from Nemeses to Close Allies, with 0 as Neutral", () => {
    expect([-3, -2, -1, 0, 1, 2, 3].map(relationshipLabel)).toEqual([
      "Nemeses",
      "Enemies",
      "Unfriendly",
      "Neutral",
      "Friendly",
      "Allies",
      "Close Allies",
    ]);
    expect([-2, 0, 3].map(formatRating)).toEqual(["−2", "0", "+3"]);
  });

  it("keys pairs symmetrically and lists all ten", () => {
    expect(pairKey("voldaen", "armada")).toBe(pairKey("armada", "voldaen"));
    expect(() => pairKey("armada", "armada")).toThrow();
    expect(NATION_PAIRS).toHaveLength(10);
  });

  it("seeds the ratings printed on p.268", () => {
    const { relationships } = seedState();
    expect(relationships[pairKey("armada", "jesthaen")]).toBe(2);
    expect(relationships[pairKey("hilltop", "armada")]).toBe(-2);
    expect(relationships[pairKey("polaris", "hilltop")]).toBe(-3);
    expect(relationships[pairKey("voldaen", "jesthaen")]).toBe(-3);
    expect(relationships[pairKey("voldaen", "polaris")]).toBe(-2);
    expect(Object.keys(relationships)).toHaveLength(10);
  });

  it("sets a rating within −3..+3 only", () => {
    const next = setRelationship(seedState(), "polaris", "armada", -1);
    expect(next.relationships[pairKey("armada", "polaris")]).toBe(-1);
    expect(() => setRelationship(seedState(), "armada", "polaris", 4)).toThrow();
    expect(() => setRelationship(seedState(), "armada", "polaris", 1.5)).toThrow();
  });
});

describe("Five Banners state", () => {
  it("seeds every nation's assets and problems, all hidden", () => {
    const state = seedState();
    expect(state.week).toBe(1);
    for (const n of NATION_IDS) {
      expect(state.sheets[n].assets.length).toBeGreaterThan(0);
      expect(state.sheets[n].problems.length).toBeGreaterThan(0);
    }
    expect(state.sheets.armada.assets).toContain("Large and powerful navy");
    expect(state.revealedPairs).toEqual([]);
    expect(state.revealedSheets).toEqual([]);
  });

  it("loads stored state, seeds a campaign that never saved, and refuses malformed data", () => {
    expect(loadState(null)).toEqual(seedState());
    expect(() => loadState({ week: "x" })).toThrow("TRACKER_CORRUPT");
    const stored = { ...seedState(), week: 4, revealedSheets: ["hilltop"] };
    expect(loadState(stored)).toMatchObject({ week: 4, revealedSheets: ["hilltop"] });
  });

  it("toggles reveal flags without duplicates", () => {
    expect(setReveal(["a", "b"], "a", true)).toEqual(["b", "a"]);
    expect(setReveal(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("trims sheet items and drops blanks", () => {
    expect(nationSheetSchema.parse({ assets: [" Navy ", ""], problems: [] })).toEqual({ assets: ["Navy"], problems: [] });
    expect(nationSheetSchema.safeParse({ assets: Array(13).fill("x"), problems: [] }).success).toBe(false);
  });

  it("reads the nation from an owner key", () => {
    expect(nationFromOwnerKey("nation:polaris")).toBe("polaris");
    expect(nationFromOwnerKey("nation:atlantis")).toBeNull();
    expect(nationFromOwnerKey("character:1")).toBeNull();
    expect(nationFromOwnerKey(undefined)).toBeNull();
  });
});

describe("Five Banners objectives", () => {
  const base = { nation: "armada" as const, name: "Acquire airships", notes: "" };

  it("makes majors 10 steps and minors 4 to 6", () => {
    expect(createObjectiveSchema.safeParse({ ...base, kind: "objective-major", steps: 10 }).success).toBe(true);
    expect(createObjectiveSchema.safeParse({ ...base, kind: "objective-major", steps: 6 }).success).toBe(false);
    for (const steps of [4, 5, 6]) {
      expect(createObjectiveSchema.safeParse({ ...base, kind: "objective-minor", steps }).success).toBe(true);
    }
    for (const steps of [3, 7, 10]) {
      expect(createObjectiveSchema.safeParse({ ...base, kind: "objective-minor", steps }).success).toBe(false);
    }
    expect(createObjectiveSchema.safeParse({ ...base, name: " ", kind: "objective-minor", steps: 4 }).success).toBe(false);
  });

  it("allows one major and two minors at a time; completed ones free the slot", () => {
    expect(objectiveLimitError([], "objective-major")).toBeNull();
    expect(objectiveLimitError([{ kind: "objective-major", status: "active" }], "objective-major")).toMatch(/major/);
    expect(objectiveLimitError([{ kind: "objective-major", status: "completed" }], "objective-major")).toBeNull();
    const twoMinors = [
      { kind: "objective-minor" as const, status: "active" as const },
      { kind: "objective-minor" as const, status: "paused" as const },
    ];
    expect(objectiveLimitError(twoMinors, "objective-minor")).toMatch(/two minor/);
    expect(objectiveLimitError(twoMinors, "objective-major")).toBeNull();
    expect(objectiveLimitError([twoMinors[0]!, { kind: "objective-minor", status: "cancelled" }], "objective-minor")).toBeNull();
  });
});

describe("Five Banners week advance", () => {
  const o = (id: string, nation: WeekObjective["nation"], currentValue: number, status: WeekObjective["status"] = "active") => ({
    id,
    nation,
    name: id,
    currentValue,
    status,
  });
  const objectives = [o("a1", "armada", 3), o("a2", "armada", 1), o("h1", "hilltop", 1), o("j1", "jesthaen", 1), o("p1", "polaris", 2, "paused")];

  it("advances one pick per nation and reports completions", () => {
    const plan = planWeekAdvance(objectives, [
      { nation: "armada", objectiveId: "a1" },
      { nation: "hilltop", objectiveId: "h1" },
    ]);
    expect(plan.advance.map((x) => x.id)).toEqual(["a1", "h1"]);
    expect(plan.completing.map((x) => x.id)).toEqual(["h1"]);
    expect(plan.warning).toBeNull();
  });

  it("rejects two picks for one nation, another nation's objective, or one not running", () => {
    expect(() =>
      planWeekAdvance(objectives, [
        { nation: "armada", objectiveId: "a1" },
        { nation: "armada", objectiveId: "a2" },
      ]),
    ).toThrow(/only one/);
    expect(() => planWeekAdvance(objectives, [{ nation: "hilltop", objectiveId: "a1" }])).toThrow(/not one of/);
    expect(() => planWeekAdvance(objectives, [{ nation: "polaris", objectiveId: "p1" }])).toThrow(/not running/);
  });

  it("warns when more than two nations complete in the same week", () => {
    const plan = planWeekAdvance(objectives, [
      { nation: "armada", objectiveId: "a2" },
      { nation: "hilltop", objectiveId: "h1" },
      { nation: "jesthaen", objectiveId: "j1" },
    ]);
    expect(plan.completing).toHaveLength(3);
    expect(plan.warning).toMatch(/stagger/);
  });

  it("defaults to each nation's running objective closest to completion", () => {
    expect(defaultPicks(objectives)).toEqual([
      { nation: "armada", objectiveId: "a2" },
      { nation: "hilltop", objectiveId: "h1" },
      { nation: "jesthaen", objectiveId: "j1" },
    ]);
  });
});
