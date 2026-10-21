// Runs every D12 H1 helper once (tests/e2e/a11y.ts and tests/e2e/live.ts), so H18-H22 start from helpers that work.

import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import {
  expectFitsViewport,
  expectNoSeriousA11yViolations,
  expectTouchTargets,
  summarizeViolations,
  TABLET_VIEWPORTS,
} from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { gmAndPlayer } from "./live";

test("the sign-in page has no serious axe violations", async ({ page }) => {
  await page.goto("/signin");
  await expect(page.getByRole("form", { name: "Sign in with email" })).toBeVisible();
  const minor = await expectNoSeriousA11yViolations(page);
  test.info().annotations.push(...summarizeViolations(minor).map((description) => ({ type: "axe (moderate/minor)", description })));
  // An exclude without a written reason is refused before scanning.
  await expect(expectNoSeriousA11yViolations(page, { exclude: "canvas" })).rejects.toThrow(/needs a written reason/);
  await expect(expectNoSeriousA11yViolations(page, { exclude: "canvas", reason: " " })).rejects.toThrow(/needs a written reason/);
});

for (const viewport of TABLET_VIEWPORTS) {
  test(`the title menu fits a ${viewport.width}x${viewport.height} tablet`, async ({ page }) => {
    await signInAsTestGm(page);
    await expect(page).toHaveURL("/");
    await page.setViewportSize(viewport);
    const menu = page.getByRole("navigation", { name: "Main menu" });
    await expect(menu.getByRole("link", { name: /Create New Campaign/ })).toBeVisible();
    await expectFitsViewport(page);
    await expectTouchTargets(menu.locator("a, button"), 44);
    // Scoped to the menu: the footer's --faint text fails color-contrast (dcm-o95), which H20 fixes in globals.css.
    await expectNoSeriousA11yViolations(page, { include: 'nav[aria-label="Main menu"]' });
  });
}

test("gmAndPlayer opens the GM's and the player's dashboards on one campaign", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  try {
    for (const page of [table.gm, table.player]) {
      await expect(page).toHaveURL(`/campaigns/${table.campaignId}`);
      await expect(page.getByRole("heading", { level: 1, name: table.campaignName })).toBeVisible();
    }
    await expect(table.gm.getByRole("button", { name: "Players" })).toBeVisible();
    await expect(table.player.getByRole("button", { name: "Players" })).toHaveCount(0);
    // characterA belongs to the player now: the player's client reads it as its owner.
    const character = await table.playerClient.query(api.characters.get, { characterId: table.characterId });
    expect(character?.sheet.name).toBe(table.characterName);
  } finally {
    await table.close();
  }
});
