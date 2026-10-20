import { expect, test } from "@playwright/test";

import { openCombatMap } from "./visual/helpers";

// D9 C4: the GM describes a battlefield and gets a layout (.omc/plans/d9-combat-map.yaml). The e2e backend has no
// ANTHROPIC_API_KEY, so every layout here is the keyword fallback, and the card says so.

test("the GM generates a map from a description, asks for another version, and keeps it after a reload", async ({ page }) => {
  const { url } = await openCombatMap(page);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  const scene = tools.getByRole("region", { name: "Scene" });
  const maps = tools.getByRole("list", { name: "Campaign maps" });
  const headline = page.locator(".cm-headline");

  // No description yet: the board's hint, and no map is made.
  await scene.getByRole("button", { name: "✦ Generate map" }).click();
  await expect(scene.getByRole("status")).toHaveText("Describe the scene first: where the fight happens and what is there.");
  await expect(maps).toHaveCount(0);

  // First map: Small, drawn from keywords.
  await scene.getByLabel("Describe the battlefield").fill("A bandit camp in a pine forest clearing with a campfire and tents");
  const sizes = scene.getByRole("group", { name: "Map size" });
  await expect(sizes.getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
  await sizes.getByRole("button", { name: "Small" }).click();
  await expect(sizes.getByRole("button", { name: "Small" })).toHaveAttribute("aria-pressed", "true");
  await scene.getByRole("button", { name: "✦ Generate map" }).click();
  await expect(headline).toContainText("22 × 15 squares");
  await expect(maps.getByRole("listitem")).toHaveCount(1);
  await expect(maps.getByRole("listitem")).toContainText("Generated");
  await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
  // The page (C0) leaves Edit once the first map exists, so the Scene card closes; back to Edit.
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  await expect(scene.getByLabel("Describe the battlefield")).toHaveValue("A bandit camp in a pine forest clearing with a campfire and tents");

  // Another version at Large replaces this map's layout (still one map).
  await sizes.getByRole("button", { name: "Large" }).click();
  await scene.getByRole("button", { name: "↻ Another version" }).click();
  await expect(scene.getByRole("status")).toHaveText(/^Drawn from keywords in your description\./);
  await expect(headline).toContainText("40 × 27 squares");
  await expect(maps.getByRole("listitem")).toHaveCount(1);

  // A reload keeps the layout and the description.
  await page.goto(url);
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  await expect(scene.getByLabel("Describe the battlefield")).toHaveValue("A bandit camp in a pine forest clearing with a campfire and tents");
  await expect(scene.getByRole("group", { name: "Map size" }).getByRole("button", { name: "Large" })).toHaveAttribute("aria-pressed", "true");
  await expect(headline).toContainText("40 × 27 squares");

  // "Generate new map" keeps this map and makes a second one, which is then on screen.
  await scene.getByLabel("Describe the battlefield").fill("A dungeon hall with pillars and wall torches");
  await scene.getByRole("button", { name: "＋ Generate new map" }).click();
  await expect(maps.getByRole("listitem")).toHaveCount(2);
  await expect(scene.getByText(/^Drawn from keywords in your description\./)).toBeVisible();
  await expect(scene.getByLabel("Describe the battlefield")).toHaveValue("A dungeon hall with pillars and wall torches");
  await expect(headline).toContainText("40 × 27 squares");
});

test("a blank map on screen is filled by Generate instead of making another map", async ({ page }) => {
  await openCombatMap(page);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  const scene = tools.getByRole("region", { name: "Scene" });
  const maps = tools.getByRole("list", { name: "Campaign maps" });

  await tools.getByRole("button", { name: "＋ New map" }).click();
  await tools.getByRole("group", { name: "New map" }).getByRole("button", { name: "Medium 30×20" }).click();
  await expect(maps.getByRole("listitem")).toHaveCount(1);
  await expect(maps.getByRole("listitem")).toContainText("Blank");
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();

  await scene.getByLabel("Describe the battlefield").fill("A misty swamp with dead trees");
  await scene.getByRole("button", { name: "✦ Generate map" }).click();
  await expect(scene.getByRole("button", { name: "✦ Regenerate map" })).toBeVisible();
  await expect(maps.getByRole("listitem")).toHaveCount(1);
  await expect(maps.getByRole("listitem")).toContainText("Generated");
  await expect(page.locator(".cm-headline")).toContainText("30 × 20 squares");
});
