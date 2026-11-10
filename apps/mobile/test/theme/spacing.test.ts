import { expect, test } from "@jest/globals";

import { hit, space } from "../../src/theme/spacing";

test("spacing is a 4-point scale and buttons clear 44 points", () => {
  expect(Object.values(space)).toEqual([0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64]);
  for (const value of Object.values(space)) {
    expect(value % 4).toBe(0);
  }
  expect(hit.minHeight).toBeGreaterThanOrEqual(44);
  expect(hit.minHeight % 4).toBe(0);
  expect(hit.lg).toBeGreaterThanOrEqual(44);
  expect(hit.lg % 4).toBe(0);
});
