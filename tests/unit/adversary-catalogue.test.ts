import { describe, expect, it } from "vitest";

import {
  NO_FILTERS,
  PAGE_FIRST,
  attackLabel,
  countLine,
  experienceLabel,
  filterAdversaries,
  groupByTier,
  moreLabel,
  normalizeSearch,
  textBlocks,
  thresholdsLabel,
  toggleChip,
  typeLabel,
  type CatalogueFilters,
} from "@/lib/adversaries/catalogue";
import { adversariesFor } from "@/lib/domain/adversaries";
import { ADVERSARIES } from "@/lib/srd/adversaries";
import type { AdversaryDef } from "@/lib/srd/types";

const byName = (name: string): AdversaryDef => {
  const def = ADVERSARIES.find((a) => a.name === name);
  if (!def) throw new Error(`no adversary ${name}`);
  return def;
};
const names = (list: readonly AdversaryDef[]) => list.map((a) => a.name);
const search = (query: string, extra: Partial<CatalogueFilters> = {}) => filterAdversaries(ADVERSARIES, { ...NO_FILTERS, query, ...extra });

describe("catalogue search", () => {
  it("finds by name, case-insensitively", () => {
    expect(names(search("BURROWER"))).toEqual(["Acid Burrower"]);
  });

  it("finds by type, motives, description, feature name and feature text", () => {
    expect(search("Solo").length).toBeGreaterThanOrEqual(20);
    expect(names(search("drag away, feed"))).toContain("Acid Burrower");
    expect(names(search("insect with digging claws"))).toEqual(["Acid Burrower"]);
    expect(names(search("earth eruption"))).toContain("Acid Burrower");
    expect(names(search("splash covers the ground"))).toEqual(["Acid Burrower"]);
  });

  it("folds accents and straight / curly apostrophes", () => {
    expect(normalizeSearch("Café  “Ünder”  Get ’em — off")).toBe('cafe "under" get \'em - off');
    // Hope & Fear text uses a curly apostrophe ("Get ’em Off!", HF p.63); a typed straight one finds it.
    const curly = ADVERSARIES.find((a) => a.features.some((f) => f.name.includes("’em")));
    expect(curly).toBeDefined();
    expect(names(search("get 'em off"))).toContain(curly!.name);
    // Core text uses straight apostrophes; a curly one in the query finds it.
    expect(names(search("can’t mark an armor slot"))).toContain("Acid Burrower");
    expect(names(search("cafè burrower"))).toEqual([]);
    expect(names(search("burrówer"))).toEqual(["Acid Burrower"]);
  });

  it("an empty or blank query matches everything", () => {
    expect(search("   ")).toHaveLength(ADVERSARIES.length);
  });
});

describe("catalogue filters", () => {
  it("tier filter", () => {
    const tier2 = search("", { tier: 2 });
    expect(tier2.length).toBe(78);
    expect(tier2.every((a) => a.tier === 2)).toBe(true);
  });

  it("type filter: Horde (N/HP) entries count as Horde", () => {
    const hordes = search("", { type: "Horde" });
    expect(hordes.every((a) => a.type === "Horde")).toBe(true);
    expect(names(hordes)).toContain("Swarm of Rats");
    expect(typeLabel(byName("Swarm of Rats"))).toBe("Horde (10/HP)");
    expect(typeLabel(byName("Acid Burrower"))).toBe("Solo");
  });

  it("book filter: Hope & Fear includes the frame entries", () => {
    expect(search("", { book: "core" })).toHaveLength(129);
    expect(search("", { book: "hope-and-fear" })).toHaveLength(138);
  });

  it("filters combine (Tier 2 + Horde)", () => {
    const both = search("", { tier: 2, type: "Horde" });
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((a) => a.tier === 2 && a.type === "Horde")).toBe(true);
  });

  it("clicking the active chip clears it, another chip selects", () => {
    expect(toggleChip(2, 2)).toBeNull();
    expect(toggleChip(2, 3)).toBe(3);
    expect(toggleChip<string>(null, "Horde")).toBe("Horde");
  });
});

describe("tier groups, paging and the count line", () => {
  it("groups the shown entries by tier with the level range and the tier's full count", () => {
    const visible = adversariesFor(ADVERSARIES, { hopeAndFear: false, frameId: "witherwild" });
    const groups = groupByTier(visible, PAGE_FIRST);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe("Tier 1");
    expect(groups[0]!.sub).toBe("Level 1 · 52 adversaries");
    expect(groups[0]!.entries).toHaveLength(PAGE_FIRST);

    const all = groupByTier(visible, Infinity);
    expect(all.map((g) => g.sub)).toEqual([
      "Level 1 · 52 adversaries",
      "Levels 2–4 · 36 adversaries",
      "Levels 5–7 · 23 adversaries",
      "Levels 8–10 · 18 adversaries",
    ]);
    expect(groupByTier([byName("Acid Burrower")], 40)[0]!.sub).toBe("Level 1 · 1 adversary");
  });

  it("pages 40, then 60 more", () => {
    expect(moreLabel(267, 40)).toBe("Show 60 more · 227 left");
    expect(moreLabel(267, 220)).toBe("Show 47 more · 47 left");
    expect(moreLabel(267, 280)).toBeNull();
    expect(moreLabel(40, 40)).toBeNull();
  });

  it("counts the campaign's visible set, or N of M shown", () => {
    expect(countLine(ADVERSARIES, ADVERSARIES.length)).toBe("267 adversaries · 129 core, 138 Hope & Fear");
    const castle = adversariesFor(ADVERSARIES, { hopeAndFear: true, frameId: "castle-high" });
    expect(countLine(castle, castle.length)).toBe("264 adversaries · 129 core, 135 Hope & Fear");
    const core = adversariesFor(ADVERSARIES, { hopeAndFear: false, frameId: "witherwild" });
    expect(countLine(core, core.length)).toBe("129 adversaries");
    expect(countLine(core, 3)).toBe("3 of 129 shown");
  });
});

describe("stat block labels", () => {
  it("thresholds, attack and experience", () => {
    expect(thresholdsLabel(byName("Acid Burrower").thresholds)).toBe("8/15");
    expect(thresholdsLabel({ major: null, severe: null })).toBe("None");
    expect(thresholdsLabel({ major: 5, severe: null })).toBe("5/None");
    expect(attackLabel(3)).toBe("+3");
    expect(attackLabel(0)).toBe("+0");
    expect(attackLabel(-2)).toBe("-2");
    expect(attackLabel("+2d4")).toBe("+2d4");
    expect(experienceLabel(byName("Acid Burrower").experiences)).toBe("Tremor Sense +2");
    expect(experienceLabel([])).toBe("");
  });

  it("splits feature text into paragraphs and list items", () => {
    expect(textBlocks("One.\n\n- a\n\n- b\nTwo.")).toEqual([
      { kind: "p", text: "One." },
      { kind: "list", items: ["a", "b"] },
      { kind: "p", text: "Two." },
    ]);
    const moves = ADVERSARIES.flatMap((a) => a.features).find((f) => f.text.includes("\n- 1. Mana Beam"));
    expect(moves).toBeDefined();
    const blocks = textBlocks(moves!.text);
    expect(blocks[1]).toMatchObject({ kind: "list" });
    expect(blocks[1]!.kind === "list" && blocks[1]!.items).toHaveLength(6);
  });
});
