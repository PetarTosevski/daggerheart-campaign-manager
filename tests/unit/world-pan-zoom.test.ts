import { describe, expect, it } from "vitest";

import { MAX_ZOOM, MIN_ZOOM, ZOOM_LADDER, rescaleView, zoomStep } from "@/app/(gm)/campaigns/[campaignId]/world/use-pan-zoom";
import { TERRAIN_OVERLAY_FILLS } from "@/lib/world/terrain-overlay";
import { terrainPaths } from "@/lib/world/terrain";

describe("terrain overlay fills", () => {
  it("has a visible fill for every terrain path, Water (x) included", () => {
    for (const k of Object.keys(terrainPaths(""))) {
      expect(TERRAIN_OVERLAY_FILLS[k as keyof typeof TERRAIN_OVERLAY_FILLS]).toMatch(/^rgba\(/);
    }
    expect(TERRAIN_OVERLAY_FILLS.x).not.toBe("transparent");
    // Blue like TERRAIN_COLOURS["."] (#3f86e0 = 63, 134, 224).
    expect(TERRAIN_OVERLAY_FILLS.x).toContain("63, 134, 224");
  });
});

describe("rescaleView", () => {
  it("keeps the zoom and the map point in view when the width changes slightly", () => {
    expect(rescaleView({ z: 2, x: -300, y: -150 }, 1000, 985)).toEqual({ z: 2, x: -295.5, y: -147.75 });
    expect(rescaleView({ z: 1, x: 5, y: 5 }, 0, 800)).toEqual({ z: 1, x: 5, y: 5 });
  });
});

describe("zoomStep (dcm-yzxx)", () => {
  it("is the user's ladder of round percentages", () => {
    expect(ZOOM_LADDER.map((z) => Math.round(z * 100))).toEqual([25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600]);
  });

  it("steps along the ladder from a ladder value", () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1.25, 1)).toBe(1.5);
    expect(zoomStep(1.5, 1)).toBe(2);
    expect(zoomStep(2, 1)).toBe(2.5);
    expect(zoomStep(3, 1)).toBe(4);
    expect(zoomStep(5, 1)).toBe(6);
    expect(zoomStep(1, -1)).toBe(0.75);
    expect(zoomStep(0.75, -1)).toBe(0.5);
    expect(zoomStep(4, -1)).toBe(3);
  });

  it("goes from an in-between zoom (the fit zoom) to the next round value above or below", () => {
    expect(zoomStep(1.02, 1)).toBe(1.25);
    expect(zoomStep(1.02, -1)).toBe(1);
    expect(zoomStep(0.62, 1)).toBe(0.75);
    expect(zoomStep(0.62, -1)).toBe(0.5);
    expect(zoomStep(3.4, 1)).toBe(4);
    expect(zoomStep(3.4, -1)).toBe(3);
  });

  it("compares the shown whole percent, so the label always changes", () => {
    // 0.997 shows as 100%: + goes to 125%, not to 100% again.
    expect(zoomStep(0.997, 1)).toBe(1.25);
    expect(zoomStep(1.004, -1)).toBe(0.75);
  });

  it("clamps to MIN_ZOOM and MAX_ZOOM", () => {
    expect(zoomStep(0.5, -1)).toBe(MIN_ZOOM);
    expect(zoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(zoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(zoomStep(5.8, 1)).toBe(MAX_ZOOM);
    expect(zoomStep(MIN_ZOOM, 1)).toBe(0.5);
  });
});
