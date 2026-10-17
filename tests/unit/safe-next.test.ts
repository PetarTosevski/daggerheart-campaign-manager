import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/join/ABCD2345")).toBe("/join/ABCD2345");
    expect(safeNextPath("/campaigns/x?y=1")).toBe("/campaigns/x?y=1");
  });

  it("falls back to / for anything that could leave the site", () => {
    for (const bad of [null, undefined, "", "https://evil.test", "//evil.test", "/\\evil.test", "join"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
