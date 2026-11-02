import { expect, test } from "@jest/globals";

import { paintFixtureFrame, SPRITE_MARK } from "../../../src/features/combat-map/canvas/paint-frame";

function countSprite(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const a = pixels[i + 3] ?? 0;
    if (a > 200 && r > 180 && b > 180 && g < 100) count += 1;
  }
  return count;
}

function countTerrain(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const a = pixels[i + 3] ?? 0;
    if (a < 200) continue;
    const sprite = r > 180 && b > 180 && g < 100;
    if (!sprite) count += 1;
  }
  return count;
}

test("paints one fixture frame with terrain and one sprite", async () => {
  const frame = await paintFixtureFrame();
  expect(frame.spriteRequests).toBeGreaterThan(0);
  expect(frame.width).toBeGreaterThan(0);
  expect(frame.height).toBeGreaterThan(0);
  expect(frame.pixels.length).toBe(frame.width * frame.height * 4);
  expect(countTerrain(frame.pixels)).toBeGreaterThan(0);
  expect(countSprite(frame.pixels)).toBeGreaterThan(0);
  expect(SPRITE_MARK).toEqual({ r: 255, g: 0, b: 255 });
});
