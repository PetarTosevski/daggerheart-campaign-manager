import { describe, expect, it } from "vitest";
import { PUBLISHED_FRAME_IDS } from "@/lib/frames";
import { KEY_FIGURES, TOMES } from "@/lib/frames/tomes";

describe("frame tomes", () => {
  for (const id of PUBLISHED_FRAME_IDS) {
    it(`${id} has a complete tome`, () => {
      const tome = TOMES[id];
      expect(tome.overview.paragraphs.length).toBeGreaterThanOrEqual(1);
      expect(tome.mechanics.rules.length).toBeGreaterThanOrEqual(1);
      tome.mechanics.rules.forEach((rule, i) => {
        expect(rule.n).toBe(i + 1);
        expect(rule.head.trim()).not.toBe("");
        expect(rule.text.trim()).not.toBe("");
      });
      expect(KEY_FIGURES[id].length).toBeGreaterThanOrEqual(2);
    });
  }

  it("Witherwild's incident mentions the Fanewraith", () => {
    expect(TOMES.witherwild.incident.paragraphs.join(" ")).toContain("Fanewraith");
  });
});
