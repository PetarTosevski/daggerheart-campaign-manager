import { expect, test } from "@jest/globals";

import { CAMPAIGN_SECTIONS, visibleToPlayers } from "../../../../src/lib/campaign-sections";
import { activeTab, moreItems, sectionHref, sectionLabel, tabItems } from "../../src/shell/sections";

const PLAYER_MORE = [
  "Codex",
  "World Map",
  "Lorekeeper",
  "Players",
  "Tome",
  "Settings",
  "Switch campaign",
];

test("tabs are Dashboard, Party, Combat Map, and Journal (where Sessions was)", () => {
  expect(tabItems().map((item) => item.label)).toEqual(["Dashboard", "Party", "Combat Map", "Journal"]);
  expect(tabItems().map((item) => item.slug)).toEqual(["", "party", "combat-map", "journal"]);
});

test("Sessions and Notes are no longer phone destinations, and the Journal labels them", () => {
  const slugs = [...tabItems(), ...moreItems(true)].map((item) => item.slug);
  expect(slugs).not.toContain("sessions");
  expect(slugs).not.toContain("notes");
  expect(sectionLabel("journal")).toBe("Journal");
  expect(() => sectionLabel("sessions")).toThrow();
  expect(() => sectionLabel("notes")).toThrow();
});

test("More lists the shared destinations, and Adversaries only for the GM", () => {
  expect(moreItems(false).map((item) => item.label)).toEqual(PLAYER_MORE);
  expect(moreItems(true).map((item) => item.label)).toEqual([
    "Codex",
    "World Map",
    "Adversaries",
    "Lorekeeper",
    "Players",
    "Tome",
    "Settings",
    "Switch campaign",
  ]);
});

test("a section hidden by visibleToPlayers stays out of the player More list and the tabs", () => {
  const playerLabels = new Set([...tabItems(), ...moreItems(false)].map((item) => item.label));
  const gmLabels = new Set([...tabItems(), ...moreItems(true)].map((item) => item.label));
  for (const section of CAMPAIGN_SECTIONS) {
    if (visibleToPlayers(section)) {
      expect(gmLabels.has(section.label)).toBe(true);
    } else {
      expect(playerLabels.has(section.label)).toBe(false);
      expect(gmLabels.has(section.label)).toBe(true);
    }
  }
});

test("every campaign section is placed on a tab or in More", () => {
  const placed = new Set([...tabItems(), ...moreItems(true)].map((item) => item.slug));
  for (const section of CAMPAIGN_SECTIONS) {
    expect(placed.has(section.slug)).toBe(true);
  }
});

test("section paths stay under the campaign, and Switch campaign leaves it", () => {
  expect(sectionHref("c1", "")).toBe("/campaign/c1");
  expect(sectionHref("c1", "world")).toBe("/campaign/c1/world");
  expect(sectionHref("c1", "adversaries")).toBe("/campaign/c1/adversaries");
  expect(sectionHref("c1", "switch-campaign")).toBe("/campaign");
  expect(activeTab("/campaign/c1", "c1")).toBe("");
  expect(activeTab("/campaign/c1/", "c1")).toBe("");
  expect(activeTab("/campaign/c1/combat-map", "c1")).toBe("combat-map");
  expect(activeTab("/campaign/c1/journal", "c1")).toBe("journal");
  expect(activeTab("/campaign/c1/sessions", "c1")).toBe("journal");
  expect(activeTab("/campaign/c1/sessions/s1", "c1")).toBe("journal");
  expect(activeTab("/campaign/c1/notes/p1", "c1")).toBe("journal");
  expect(activeTab("/campaign/c1/notesy", "c1")).toBeNull();
  expect(activeTab("/campaign/c1/adversaries", "c1")).toBeNull();
  expect(activeTab("/campaign/c1/settings", "c1")).toBeNull();
});
