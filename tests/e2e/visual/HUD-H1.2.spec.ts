import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H1.2.md (E2E_VISUAL=1): the Fear banner, the day / time disc and the title with the
// toolbar on the real seed (GM and player, 1440 x 900 and 1024 x 768; the GM's time arc open; the banner close up for
// CmpTokens 'GM Fear · players' / 'GM Fear · GM'), beside the board renders they match (Main, GMDesktop, CmpTokens).

const OUT = "test-results/visual/HUD-H1.2";
const BOARDS = path.resolve("reference/designs/combat-hud/preview");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

test("H1.2 board renders: Main, GMDesktop, CmpTokens", { tag: "@visual" }, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const board of ["Main", "GMDesktop"]) {
    await page.goto(pathToFileURL(path.join(BOARDS, `${board}.dc.html`)).href);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/board-${board}.png`, animations: "disabled" });
  }
  await page.goto(pathToFileURL(path.join(BOARDS, "CmpTokens.dc.html")).href);
  await page.waitForTimeout(1500);
  const fear = page.locator(".fbbox").first().locator("xpath=../..");
  await fear.screenshot({ path: `${OUT}/board-CmpTokens-fear.png`, animations: "disabled" });
  await page.locator(".discs").screenshot({ path: `${OUT}/board-CmpTokens-light.png`, animations: "disabled" });
});

test("H1.2 Fear banner, disc, title and toolbar on the seed", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId } = s;
  try {
    await client.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: crypto.randomUUID() });
    for (const [who, page] of [
      ["gm", gm],
      ["player", player],
    ] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(s.url);
        await expect(page.locator('[data-hud-region="fear"]').getByTestId("hud-fear")).toBeVisible();
        await shoot(page, `${who}-${viewport.width}`);
      }
      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(s.url);
      await expect(page.getByTestId("hud-fear")).toBeVisible();
      await page.locator(".hud-fear").screenshot({ path: `${OUT}/${who}-fear-close.png`, animations: "disabled" });
    }
    await gm.getByTestId("hud-disc").getByRole("button").click();
    await expect(gm.getByRole("dialog", { name: "Time of the long cycle" })).toBeVisible();
    await shoot(gm, "gm-time-arc-1440");
    await gm.keyboard.press("Escape");
    await gm.getByRole("toolbar", { name: "Map controls" }).getByRole("button", { name: "Fog", exact: true }).click();
    await shoot(gm, "gm-fog-1440");
    await player.getByRole("group", { name: "Your tools" }).getByRole("button", { name: "Dice" }).click();
    await expect(player.getByTestId("hud-dice-box")).toBeVisible({ timeout: 30_000 });
    await shoot(player, "player-dice-1440");
  } finally {
    await s.close();
  }
});
