import { expect, test } from "@jest/globals";

import { CAMPAIGN_SECTIONS, visibleToPlayers } from "../../../../src/lib/campaign-sections";
import { activeTab, moreItems, sectionHref, tabItems } from "../../src/shell/sections";

const PLAYER_MORE = [
  "World",
  "Characters & Locations",
  "Notes",
  "Lorekeeper",
  "Players",
  "Tome",
  "Settings",
  "Switch campaign",
];

test("tabs are Dashboard, Party, Combat Map, and Sessions", () => {
  expect(tabItems().map((item) => item.label)).toEqual(["Dashboard", "Party", "Combat Map", "Sessions"]);
  expect(tabItems().map((item) => item.slug)).toEqual(["", "party", "combat-map", "sessions"]);
});

test("More lists the shared destinations, and Adversaries only for the GM", () => {
  expect(moreItems(false).map((item) => item.label)).toEqual(PLAYER_MORE);
  expect(moreItems(true).map((item) => item.label)).toEqual([
    "World",
    "Characters & Locations",
    "Adversaries",
    "Notes",
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
  expect(activeTab("/campaign/c1/adversaries", "c1")).toBeNull();
  expect(activeTab("/campaign/c1/settings", "c1")).toBeNull();
});
