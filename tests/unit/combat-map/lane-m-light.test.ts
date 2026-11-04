/**
 * Lane M: `lightOf` (dcm-p40, dcm-bxp.54) and the sprite painter's setting for a pack map (dcm-bxp.86).
 * dcm-p40 (user 2026-10-30): dim = days 1 and 7 of each cycle; other days bright, other nights dark.
 */
import { describe, expect, it } from "vitest";

import { getPhaseName } from "@/lib/domain/campaign-time";
import { isLightLevel, lightOf } from "@/lib/domain/combat-map/light";

import { hasPackSetting, paintSetting } from "../../../src/components/combat-map/map-view/paint-spec";

describe("lightOf (dcm-p40)", () => {
  it("dim on the boundary days, day and night elsewhere", () => {
    const day = [1, 2, 3, 4, 5, 6, 7].map((d) => lightOf(getPhaseName("DAY", d)));
    const night = [1, 2, 3, 4, 5, 6, 7].map((d) => lightOf(getPhaseName("NIGHT", d)));
    expect(day).toEqual(["dim", "day", "day", "day", "day", "day", "dim"]);
    expect(night).toEqual(["dim", "night", "night", "night", "night", "night", "dim"]);
  });

  it("reads a light level as itself (a campaign's time of day, dcm-bxp.54); unknown names are day", () => {
    expect(lightOf("night")).toBe("night");
    expect(lightOf("dim")).toBe("dim");
    expect(lightOf("day")).toBe("day");
    expect(lightOf("")).toBe("day");
    expect(isLightLevel("dusk")).toBe(false);
  });
});

describe("paintSetting for a pack map (dcm-bxp.86)", () => {
  const pack = { setting: { pack: "p1" }, name: "Map 1" };
  it("uses the built-in setting the pack extends, else common only", () => {
    expect(hasPackSetting(pack)).toBe(true);
    expect(paintSetting(pack, "forest")).toBe("forest");
    expect(paintSetting(pack, null)).toBe("");
    expect(paintSetting(pack, "not-a-setting")).toBe("");
    expect(paintSetting({ setting: { builtin: "cave" }, name: "Map 1" }, "forest")).toBe("cave");
    expect(hasPackSetting({ setting: { builtin: "cave" } })).toBe(false);
  });
});
