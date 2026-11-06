// The World Map's linked Width / Height fields (user 2026-11-06): only the width is stored; the height follows the
// image's aspect ratio, and typing either side gives the stored width.
import { describe, expect, it } from "vitest";

import { heightKmOf, MIN_MAP_WIDTH_KM, widthKmFromInput } from "@/lib/domain/travel";

describe("map size fields", () => {
  // Witherwild's art: 1553 x 1193 px.
  const [w, h] = [1553, 1193];

  it("shows the height from the width and the image's shape", () => {
    expect(heightKmOf(400, w, h)).toBe(307);
  });

  it("a typed width is stored as is (whole km); a typed height becomes the matching width", () => {
    expect(widthKmFromInput("width", 500, w, h)).toBe(500);
    expect(widthKmFromInput("height", 307, w, h)).toBe(400);
    expect(heightKmOf(widthKmFromInput("height", 600, w, h)!, w, h)).toBe(600);
  });

  it("a tall map: the height is the long side", () => {
    // Beast Feast's art is portrait: 2418 x 3169 px.
    expect(heightKmOf(300, 2418, 3169)).toBe(393);
    expect(widthKmFromInput("height", 393, 2418, 3169)).toBe(300);
  });

  it("empty or non-positive input saves nothing; tiny input is raised to the minimum", () => {
    expect(widthKmFromInput("width", Number(""), w, h)).toBeNull();
    expect(widthKmFromInput("height", -5, w, h)).toBeNull();
    expect(widthKmFromInput("width", 2, w, h)).toBe(MIN_MAP_WIDTH_KM);
  });
});
