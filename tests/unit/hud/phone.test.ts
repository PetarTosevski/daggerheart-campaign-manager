import { describe, expect, it } from "vitest";

import { edgePlace, edgeText, edgeTone, miniBars, resourceItems, stackChips } from "@/components/combat-map/hud/phone/model";

// Plan combat-hud H7.2 (docs/tasks/TASK-HUD-H7.2.md): the phone shell's pure pieces (board PlayerPhone).

const member = { hp: { marked: 2, max: 6 }, stress: { marked: 3, max: 6 }, hope: { value: 1, max: 6 }, armor: { marked: 1, max: 3 } };

describe("mini banner bars", () => {
  it("shows HP left and Stress marked as shares", () => {
    expect(miniBars(member)).toEqual({ hp: 4 / 6, stress: 0.5 });
  });
  it("is empty, not NaN, without a track", () => {
    expect(miniBars({ hp: { marked: 0, max: 0 }, stress: { marked: 0, max: 0 } })).toEqual({ hp: 0, stress: 0 });
  });
});

describe("resource line", () => {
  it("reads HP, Stress and Armor as marked and Hope as its value (answer 2)", () => {
    expect(resourceItems(member)).toEqual([
      { kind: "hp", text: "2/6", label: "2 of 6 Hit Points marked" },
      { kind: "stress", text: "3/6", label: "3 of 6 Stress marked" },
      { kind: "hope", text: "1/6", label: "Hope 1 of 6" },
      { kind: "armor", text: "1/3", label: "1 of 3 Armor Slots marked" },
    ]);
  });
  it("leaves Armor out without an armor score", () => {
    expect(resourceItems({ ...member, armor: { marked: 0, max: 0 } }).map((i) => i.kind)).toEqual(["hp", "stress", "hope"]);
  });
});

describe("edge chips", () => {
  const view = { left: 0, top: 104, right: 390, bottom: 500 };
  it("places nothing for a ring on screen", () => {
    expect(edgePlace({ x: 200, y: 300 }, view)).toBeNull();
  });
  it("hangs on the side the ring is on, at its height, pointing at it", () => {
    expect(edgePlace({ x: 520, y: 300 }, view)).toEqual({ side: "right", arrow: "→", y: 286 });
    expect(edgePlace({ x: -40, y: 200 }, view)).toEqual({ side: "left", arrow: "←", y: 186 });
  });
  it("clamps the height into the visible map and points up or down when the ring is only above or below", () => {
    expect(edgePlace({ x: 300, y: 700 }, view)).toEqual({ side: "right", arrow: "↓", y: 468 });
    expect(edgePlace({ x: 100, y: 20 }, view)).toEqual({ side: "left", arrow: "↑", y: 108 });
  });
  it("stacks chips on one edge without overlap", () => {
    const out = stackChips([
      { side: "right" as const, y: 200 },
      { side: "right" as const, y: 210 },
      { side: "left" as const, y: 205 },
    ]);
    expect(out.map((c) => c.y)).toEqual([200, 232, 205]);
  });
  it("says the band, GM for out of range, can't see without sight; never a number", () => {
    expect(edgeText({ name: "Sniper", band: "Very Far", reach: "out" }, "out", "→")).toBe("Sniper · Very Far · GM →");
    expect(edgeText({ name: "Bandit", band: "Very Far", reach: "los" }, "los", "→")).toBe("Bandit · can’t see →");
    expect(edgeText({ name: "Lieutenant", band: "Far", reach: "in" }, "picked", "←")).toBe("Lieutenant · Far ←");
    expect(edgeTone({ reach: "out" }, "picked")).toBe("out");
    expect(edgeTone({ reach: "los" }, "los")).toBe("los");
    expect(edgeTone({ reach: "in" }, "in")).toBe("in");
  });
});
