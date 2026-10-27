import { describe, expect, it } from "vitest";

import { rescaleView } from "@/app/(gm)/campaigns/[campaignId]/world/use-pan-zoom";
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
