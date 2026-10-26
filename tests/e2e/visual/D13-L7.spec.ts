import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect as baseExpect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { gmAndPlayer } from "../live";

// D13 L7: the sidebar (1440) and the drawer (1440 and 390), next to the board's page and drawer variants
// (reference/designs/project/Lorekeeper.dc.html). The board file only renders its `page` layout, so its drawer is shot
// from a copy with the board's own config switched to `"layout": "drawer"` (written under test-results, never into
// reference/). Shots land in test-results/visual/D13-L7/: app side-1440, drawer-1440, drawer-390, fold-390;
// board board-side-1440, board-drawer-1440, board-drawer-390. Verdicts in docs/tasks/TASK-D13-L7.md.
// `pnpm e2e:setup` (scripts/e2e-setup.mjs) turns the fake model on and ingests the invented mini-book as the core
// book; rerun it once per checkout after pulling (dcm-bxp.82.8).

test.describe.configure({ timeout: 240_000 });
// `configure` returns a new expect; it does not change the imported one (dcm-bxp.82.8).
const expect = baseExpect.configure({ timeout: 20_000 });

const OUT = "test-results/visual/D13-L7";
const BOARD_FILE = join(process.cwd(), "reference/designs/project/Lorekeeper.dc.html");

/** A copy of the board with its CFG switched to the drawer layout (the template string is JSON-escaped in the bundle). */
function boardDrawerUrl(): string {
  const source = readFileSync(BOARD_FILE, "utf8");
  const drawer = source.replace('\\"layout\\": \\"page\\"', '\\"layout\\": \\"drawer\\"');
  if (drawer === source) throw new Error("The board's layout switch was not found");
  mkdirSync(OUT, { recursive: true });
  const file = join(process.cwd(), OUT, "board-drawer.html");
  writeFileSync(file, drawer);
  return pathToFileURL(file).href;
}

test("D13-L7 sidebar and drawer, with the board's", { tag: "@visual" }, async ({ browser, page }) => {
  // The board: sidebar (page variant, 1440) and the drawer variant at 1440 and 390.
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(pathToFileURL(BOARD_FILE).href);
  await expect(page.locator(".lk-side").getByText("Hexes don’t stack")).toBeVisible();
  await page.locator(".lk-side").screenshot({ path: `${OUT}/board-side-1440.png`, animations: "disabled" });
  const drawerUrl = boardDrawerUrl();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(drawerUrl);
    await expect(page.locator(".lk-drawer")).toBeVisible();
    await page.screenshot({ path: `${OUT}/board-drawer-${viewport.width}.png`, animations: "disabled" });
  }

  const table = await gmAndPlayer(browser);
  try {
    const { gm, player, campaignId, client } = table;
    // Seed what the board shows: two pinned rulings and an open request from the player.
    await client.mutation(api.lorekeeperRulings.pin, { campaignId, title: "Swimming in heavy armour", text: "Agility rolls to swim are made with disadvantage." });
    await client.mutation(api.lorekeeperRulings.pin, { campaignId, title: "Hexes don’t stack", text: "Only the biggest Hex penalty applies to a target." });

    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    const playerColumn = player.getByRole("region", { name: "The Lorekeeper" });
    await playerColumn.getByRole("group", { name: "Ask the Lorekeeper" }).getByRole("button", { name: "Do Hexes stack?" }).click();
    const hex = playerColumn.getByRole("article", { name: "The Lorekeeper's answer" }).filter({ hasText: "Rules unclear" });
    await hex.getByRole("button", { name: "Ask the GM" }).click({ timeout: 60_000 });
    await expect(hex.getByRole("button", { name: "Sent to the GM" })).toBeVisible();

    // The GM's sidebar at 1440 (with the open request).
    await gm.setViewportSize({ width: 1440, height: 1100 });
    await gm.goto(`/campaigns/${campaignId}/lorekeeper`);
    const aside = gm.getByRole("complementary", { name: "Library and rulings" });
    await expect(aside.getByText(/^Asked by/)).toBeVisible();
    await expect(aside.getByText("2 pinned")).toBeVisible();
    await aside.screenshot({ path: `${OUT}/side-1440.png`, animations: "disabled" });

    // The drawer over the Party page at 1440 and 390, after a chip question.
    await player.goto(`/campaigns/${campaignId}/party`);
    await player.getByRole("button", { name: "Ask the Lorekeeper" }).click();
    const drawer = player.getByRole("dialog", { name: "The Lorekeeper" });
    await drawer.getByRole("group", { name: "Ask the Lorekeeper" }).getByRole("button", { name: "Critical hits" }).click();
    await expect(drawer.getByRole("article", { name: "The Lorekeeper's answer" }).filter({ hasText: "From the rules" }).getByRole("button", { name: "Copy" })).toBeVisible({
      timeout: 60_000,
    });
    await player.screenshot({ path: `${OUT}/drawer-1440.png`, animations: "disabled" });
    await player.setViewportSize({ width: 390, height: 844 });
    await expect(drawer.locator(".lk-drawerpanel")).toBeVisible();
    await player.screenshot({ path: `${OUT}/drawer-390.png`, animations: "disabled" });
    await drawer.getByRole("button", { name: "Close the Lorekeeper" }).click();

    // The phones' fold on the Lorekeeper page, opened.
    await player.goto(`/campaigns/${campaignId}/lorekeeper`);
    await player.getByRole("button", { name: "Library & rulings" }).click();
    await expect(player.getByRole("region", { name: "Table rulings" }).getByText("Hexes don’t stack")).toBeVisible();
    await player.screenshot({ path: `${OUT}/fold-390.png`, animations: "disabled", fullPage: true });
  } finally {
    await table.close();
  }
});
