import { describe, expect, it } from "vitest";

import { generateFallbackLayout, withAreaIds } from "../../src/lib/combat-map/fallback-layout";

type Area = { id?: string; terrain?: string };

/** Map editor ME3 (dcm-5rhs.3): area ids, "a" + a counter, unique within a map. */

describe("withAreaIds", () => {
  it("numbers areas without ids from a1", () => {
    expect(withAreaIds<Area>([{ terrain: "water" }, { terrain: "dirt" }]).map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("keeps unique ids and numbers the rest above the highest counter", () => {
    const areas: Area[] = [{ id: "a4" }, {}, { id: "pond" }, { id: "a4" }, { id: "" }, { id: "a2" }];
    expect(withAreaIds(areas).map((a) => a.id)).toEqual(["a4", "a5", "pond", "a6", "a7", "a2"]);
  });

  it("returns the same objects when every id is set and unique, and never mutates its input", () => {
    const areas: Area[] = [{ id: "a1", terrain: "water" }, { id: "a3", terrain: "dirt" }];
    const out = withAreaIds(areas);
    expect(out[0]).toBe(areas[0]);
    expect(out[1]).toBe(areas[1]);
    const bare: Area[] = [{ terrain: "water" }];
    withAreaIds(bare);
    expect(bare).toEqual([{ terrain: "water" }]);
  });

  it("ignores ids that only look like counters", () => {
    expect(withAreaIds([{ id: "a0" }, { id: "a01" }, {}]).map((a) => a.id)).toEqual(["a0", "a01", "a1"]);
  });
});

describe("generateFallbackLayout area ids", () => {
  it.each([
    "A bandit camp in a forest clearing with tents and a campfire",
    "A dungeon crypt with a treasure vault",
    "underground cavern with a lake and lava",
    "a misty swamp with a road",
    "rocky coast with a river and a bridge",
  ])("gives every area of %s a unique short id", (prompt) => {
    const { areas } = generateFallbackLayout(prompt, { seed: 9, w: 30, h: 20 });
    expect(areas.length).toBeGreaterThan(0);
    expect(areas.map((a) => a.id)).toEqual(areas.map((_, i) => `a${i + 1}`));
  });
});
