import { expect, test } from "@jest/globals";

import { paintClassicFixtureFrame } from "../../../src/features/combat-map/paint-classic-frame";

function countTerrain(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] ?? 0;
    if (a < 200) continue;
    count += 1;
  }
  return count;
}

test("paints a Classic fixture frame through the Skia adapter", async () => {
  const frame = await paintClassicFixtureFrame();
  expect(frame.width).toBe(4 * 48);
  expect(frame.height).toBe(4 * 48);
  expect(frame.pixels.length).toBe(frame.width * frame.height * 4);
  expect(countTerrain(frame.pixels)).toBeGreaterThan(0);
});
