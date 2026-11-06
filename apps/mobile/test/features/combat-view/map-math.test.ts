import { describe, expect, test } from "@jest/globals";

import { combatMapEnabled } from "../../../src/features/combat-map/flag";
import { imageMapRect } from "../../../src/features/combat-map/map-canvas-math";
import { BASE_MAX_PX, baseCell, paintKey } from "../../../src/features/combat-map/paint-layout";
import { absoluteSpriteUrl } from "../../../src/features/combat-map/sprite-art";
import { clampView, fitView, screenToSquare, zoomAbout, zoomLimits, type MapView } from "../../../src/features/combat-map/view-math";
import { liveLayout } from "./fixtures";

const viewport = { w: 360, h: 600 };
const bounds = { w: 22, h: 15, pad: 24 };
const limits = zoomLimits(viewport, bounds);

describe("pinch zoom (dcm-gdzi.13)", () => {
  test("per-frame factors compose to the gesture's scale: no compounding", () => {
    // useMapGesture (world/gestures.ts) zooms by scale / previous scale each frame.
    const start = fitView(viewport, bounds);
    const scales = [1.05, 1.1, 1.2, 1.35, 1.5, 1.6, 1.8, 2];
    let view: MapView = start;
    let previous = 1;
    for (const scale of scales) {
      view = zoomAbout(view, scale / previous, { x: 180, y: 300 }, limits);
      previous = scale;
    }
    expect(view.s).toBeCloseTo(start.s * 2, 6);
    // The old code multiplied the live zoom by the cumulative scale each frame: about 70x here.
    expect(view.s).toBeLessThan(start.s * 2.01);
  });

  test("the square under the fingers stays under the fingers", () => {
    const start = fitView(viewport, bounds);
    const focal = { x: 120, y: 420 };
    const before = screenToSquare(start, focal.x, focal.y);
    const after = screenToSquare(zoomAbout(start, 2.5, focal, limits), focal.x, focal.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  test("zoom stays within its limits and the map cannot be dragged off screen", () => {
    const start = fitView(viewport, bounds);
    expect(zoomAbout(start, 1000, { x: 0, y: 0 }, limits).s).toBe(limits.max);
    expect(zoomAbout(start, 0.0001, { x: 0, y: 0 }, limits).s).toBe(limits.min);
    const far = clampView({ s: start.s, x: 1e6, y: -1e6 }, viewport, bounds);
    // The fog margin may fill the screen, but its far edge stays on it.
    expect(far.x - bounds.pad * far.s).toBeLessThan(viewport.w);
    expect(far.y + (bounds.h + bounds.pad) * far.s).toBeGreaterThan(0);
  });

  test("Fit frames the map itself, not the fog margin", () => {
    const view = fitView(viewport, bounds);
    expect(view.s).toBeCloseTo(360 / 22, 6);
    expect(view.x).toBeCloseTo(0, 6);
  });
});

describe("paint budget inputs (dcm-gdzi.14)", () => {
  test("the base map never passes BASE_MAX_PX on its long side, and keeps 48 px a square when it fits", () => {
    expect(baseCell(22, 15)).toBe(48);
    expect(baseCell(40, 27)).toBe(48);
    expect(44 * baseCell(44, 32)).toBeLessThanOrEqual(BASE_MAX_PX);
  });

  test("tokens, the name, updatedAt and the GM's fog marks do not change the paint key", () => {
    const a = liveLayout();
    const b = liveLayout({ name: "Renamed", updatedAt: 99, cells: [{ layer: "fog", tile: 0, cells: "r" }] as never });
    expect(paintKey(b)).toBe(paintKey(a));
    expect(paintKey(liveLayout({ seed: 10 }))).not.toBe(paintKey(a));
    expect(paintKey(liveLayout({ source: "image" }))).toBeNull();
  });
});

describe("image maps (dcm-gdzi.11)", () => {
  test("the image sits inside the map rectangle, one grid square per map square, shifted by the grid offset", () => {
    expect(imageMapRect({ cell: 50, offsetX: 25, offsetY: 10 }, { width: 1000, height: 800 })).toEqual({ x: -0.5, y: -0.2, w: 20, h: 16 });
  });
});

describe("sprites and the flag (dcm-gdzi.18)", () => {
  test("built-in sprite files come from the deployment's site", () => {
    expect(absoluteSpriteUrl("/sprite-packs/a.png", "https://preview.example")).toBe("https://preview.example/sprite-packs/a.png");
    expect(absoluteSpriteUrl("https://cdn.example/a.png", "https://preview.example")).toBe("https://cdn.example/a.png");
  });

  test("the combat map flag: on in development, off in a release build unless set", () => {
    expect(combatMapEnabled(undefined, true)).toBe(true);
    expect(combatMapEnabled(undefined, false)).toBe(false);
    expect(combatMapEnabled("1", false)).toBe(true);
    expect(combatMapEnabled("0", true)).toBe(false);
  });
});
