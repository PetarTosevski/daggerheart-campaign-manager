import { describe, expect, it } from "vitest";

import { PAGE_FIRST, openCount, sortAdversaries } from "@/lib/adversaries/catalogue";
import {
  NO_ENVIRONMENT_FILTERS,
  environmentCountLine,
  environmentTierLine,
  environmentsFor,
  filterEnvironments,
  groupEnvironmentsByTier,
  potentialAdversariesText,
} from "@/lib/domain/environments";
import { ENVIRONMENTS } from "@/lib/srd/environments";
import type { EnvironmentDef } from "@/lib/srd/types";

// EV1: the Environment tab's pure helpers (the adversary catalogue's grouping, paging and order are reused).

const core = environmentsFor(ENVIRONMENTS, { hopeAndFear: false, frameId: "witherwild" });
const all = environmentsFor(ENVIRONMENTS, { hopeAndFear: true, frameId: "witherwild" });
const names = (list: readonly Pick<EnvironmentDef, "name">[]) => list.map((e) => e.name);

describe("environment catalogue helpers (EV1)", () => {
  it("shows Core environments always and Hope & Fear ones only with the switch on", () => {
    expect(core).toHaveLength(19);
    expect(core.every((e) => e.source === "core")).toBe(true);
    expect(all).toHaveLength(47);
    expect(environmentsFor(ENVIRONMENTS, { hopeAndFear: true, frameId: "reign-of-the-weredragon" })).toHaveLength(47);
  });

  it("searches name, impulses, potential adversaries, feature text and questions, folding case and apostrophes", () => {
    const find = (query: string) => names(filterEnvironments(all, { ...NO_ENVIRONMENT_FILTERS, query }));
    expect(find("raging")).toEqual(["Raging River"]);
    expect(find("RIVER")).toContain("Raging River");
    // Straight apostrophe finds the book's curly one.
    expect(find("necromancer's")).toEqual(["Necromancer’s Ossuary"]);
    expect(find("witch’s hut")).toEqual(["Witch’s Hut"]);
    expect(find("glass snake")).toContain("Raging River"); // potential adversaries
    expect(find("undertow")).toContain("Raging River"); // feature name
    expect(find("trinkets and baubles")).toEqual(["Raging River"]); // feature question
    expect(find("divide the land")).toEqual(["Raging River"]); // impulses
    expect(find("   ")).toHaveLength(47);
    expect(find("zzzz")).toEqual([]);
  });

  it("filters by tier, type and book, together", () => {
    const tier2 = filterEnvironments(all, { ...NO_ENVIRONMENT_FILTERS, tier: 2 });
    expect(tier2).toHaveLength(12);
    const socials = filterEnvironments(all, { ...NO_ENVIRONMENT_FILTERS, type: "Social" });
    expect(socials.every((e) => e.type === "Social")).toBe(true);
    expect(names(filterEnvironments(all, { ...NO_ENVIRONMENT_FILTERS, tier: 4, type: "Social", book: "core" }))).toEqual(["Imperial Court"]);
    expect(filterEnvironments(all, { ...NO_ENVIRONMENT_FILTERS, book: "hope-and-fear" })).toHaveLength(28);
  });

  it("groups by tier with environment counts, and collapsed tiers don't use up the page", () => {
    const sorted = sortAdversaries(all, "name");
    const groups = groupEnvironmentsByTier(sorted, PAGE_FIRST);
    expect(groups.map((g) => [g.title, g.sub])).toEqual([
      ["Tier 1", "Level 1 · 16 environments"],
      ["Tier 2", "Levels 2–4 · 12 environments"],
      ["Tier 3", "Levels 5–7 · 11 environments"],
      ["Tier 4", "Levels 8–10 · 8 environments"],
    ]);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(40);
    const collapsed = new Set([1]);
    const folded = groupEnvironmentsByTier(sorted, PAGE_FIRST, collapsed);
    expect(folded[0]!.entries).toEqual([]);
    expect(folded.reduce((n, g) => n + g.entries.length, 0)).toBe(31);
    expect(openCount(sorted, collapsed)).toBe(31);
    const one = groupEnvironmentsByTier(filterEnvironments(all, { ...NO_ENVIRONMENT_FILTERS, query: "raging" }), PAGE_FIRST);
    expect(one[0]!.sub).toBe("Level 1 · 1 environment");
  });

  it("orders A–Z or in book order (Core first, by page) inside each tier", () => {
    const tier1 = (sort: "name" | "book") => names(sortAdversaries(all, sort).filter((e) => e.tier === 1));
    expect(tier1("name").slice(0, 3)).toEqual(["Abandoned Grove", "Abandoned Mine", "Alchemist’s Abandoned Workshop"]);
    expect(tier1("book").slice(0, 4)).toEqual(["Abandoned Grove", "Ambushed", "Ambushers", "Bustling Marketplace"]);
    expect(tier1("book").at(-1)).toBe("Raiding Party");
  });

  it("writes the count line, the tier line and the potential adversaries line", () => {
    expect(environmentCountLine(core, core.length)).toBe("19 environments");
    expect(environmentCountLine(all, all.length)).toBe("47 environments · 19 core, 28 Hope & Fear");
    expect(environmentCountLine(all, 3)).toBe("3 of 47 shown");
    expect(environmentTierLine({ tier: 3, type: "Event" })).toBe("Tier 3 Event");
    expect(potentialAdversariesText([{ name: "Beasts", members: [{ name: "Bear" }, { name: "Glass Snake" }] }, { name: "Merchant" }])).toBe(
      "Beasts (Bear, Glass Snake), Merchant",
    );
  });
});
