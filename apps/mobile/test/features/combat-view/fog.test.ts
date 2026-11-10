import { expect, test } from "@jest/globals";

import { decodeExplored } from "../../../../../src/lib/domain/combat-map/vision";
import { fogImage } from "../../../src/features/combat-map/fog-paint";

test("decodeExplored masks become a fog image with unseen padding", () => {
  const sw = 4;
  const sh = 4;
  const scale = 2;
  const length = sw * sh;
  const seen = decodeExplored("", length);
  seen[0] = 1;
  const clear = new Uint8Array(length);
  const masks = { sw, sh, scale, seen, clear, explored: seen };
  const pad = 1;
  const image = fogImage(masks, pad);
  expect(image.width).toBeGreaterThan(sw);
  expect(image.height).toBeGreaterThan(sh);
  expect(image.data.length).toBe(image.width * image.height * 4);
  const last = image.data.length - 1;
  expect(image.data[last]).toBe(255);
});
