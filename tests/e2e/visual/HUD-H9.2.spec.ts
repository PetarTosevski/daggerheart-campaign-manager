import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H9.2.md (E2E_VISUAL=1): the GM's "Waiting on you" button (closed, with its count and the
// arrival toast), the queue open above it, Log's Resolutions and the Areas panel, on the seed at 1440 x 900 and
// 1024 x 768, beside the board renders (GMDesktop / GMTablet: the waiting chip and the queue above it).

const OUT = "test-results/visual/HUD-H9.2";
const BOARDS = path.resolve("reference/designs/combat-hud/preview");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

test("H9.2 board renders: GMDesktop, GMTablet (waiting chip, queue)", { tag: "@visual" }, async ({ page }) => {
  for (const [board, viewport] of [
    ["GMDesktop", VIEWPORTS[0]],
    ["GMTablet", VIEWPORTS[1]],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(path.join(BOARDS, `${board}.dc.html`)).href);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/board-${board}.png`, animations: "disabled" });
    const chip = page.locator(".wchip").first();
    if ((await chip.count()) > 0) {
      await chip.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/board-${board}-queue.png`, animations: "disabled" });
    }
  }
});

test("H9.2 Waiting on you, Log and Areas on the seed", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, playerClient, campaignId, mapId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await gm.goto(s.url);
      await expect(gm.getByRole("list", { name: "The party" }).getByRole("button").first()).toBeVisible({ timeout: 30_000 });
      const button = gm.getByRole("button", { name: /^Waiting on you/ });
      await expect(button).toBeVisible();
      // At 1440 a new out-of-range attack: the count pulses and the toast names it (at 1024 it is already waiting).
      if (viewport.width === 1440) {
        await expect(gm.getByTestId("hud-wait-count")).toHaveText("0");
        await playerClient.mutation(api.combatActions.attack, {
          campaignId,
          characterId: moss.characterId,
          mapId,
          targetTokenIds: [enemies.sniper.tokenId],
          slot: "primary",
          modifier: 0,
          experienceIds: [],
          advantage: 0,
          disadvantage: 0,
          help: 0,
          options: [],
          idempotencyKey: crypto.randomUUID(),
        });
        await expect(gm.getByTestId("hud-wait-count")).toHaveText("1", { timeout: 30_000 });
        await expect(gm.getByRole("status", { name: "Notices" })).toContainText("Moss: out of range");
      }
      await shoot(gm, `gm-${viewport.width}-closed`);
      await button.screenshot({ path: `${OUT}/gm-${viewport.width}-button.png`, animations: "disabled" });
      await button.click();
      await expect(gm.getByTestId("hud-queue")).toBeVisible();
      await shoot(gm, `gm-${viewport.width}-queue`);
      const dock = gm.getByRole("toolbar", { name: "Map controls" });
      await dock.getByRole("button", { name: "Log" }).click();
      await expect(gm.getByTestId("hud-resolutions")).toBeVisible();
      await shoot(gm, `gm-${viewport.width}-log`);
      await dock.getByRole("button", { name: "Areas" }).click();
      await expect(gm.getByRole("dialog", { name: "Areas" })).toBeVisible();
      await shoot(gm, `gm-${viewport.width}-areas`);
    }
  } finally {
    await s.close();
  }
});
