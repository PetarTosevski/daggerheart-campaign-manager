import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { combatMapUrl, enableHud, hudScene } from "../hud/helpers";
import { gmAndPlayer } from "../live";

// Shots for docs/tasks/TASK-HUD-H9.3.md (E2E_VISUAL=1): the GM's top centre (scene title + Live chip only) at 1440 x 900
// and 1024 x 768 beside the GMDesktop / GMTablet `.scn`, the player's title row (Dice, Sheet, Your character, the map
// controls on their own row), and the GM's day-disc pop-over with Day / Dim / Night above the calendar (core campaign).

const OUT = "test-results/visual/HUD-H9.3";
const BOARDS = path.resolve("reference/designs/combat-hud/preview");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

/** The top of the HUD from x = 400 to the right edge: the scene title, the spotlight and day discs, the Fear banner. */
async function shootTop(page: Page, name: string) {
  const vw = page.viewportSize()!.width;
  const hud = (await page.getByTestId("combat-hud").boundingBox())!;
  const x = vw > 1180 ? 600 : 400;
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", clip: { x, y: hud.y, width: vw - x, height: 260 } });
}

test("H9.3 board renders: GMDesktop, GMTablet (.scn)", { tag: "@visual" }, async ({ page }) => {
  for (const [board, viewport] of [
    ["GMDesktop", VIEWPORTS[0]],
    ["GMTablet", VIEWPORTS[1]],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(path.join(BOARDS, `${board}.dc.html`)).href);
    await page.waitForTimeout(1500);
    await page.locator(".scn").first().screenshot({ path: `${OUT}/board-${board}-scn.png`, animations: "disabled" });
  }
});

test("H9.3 the GM's top centre and the player's title row on the seed", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await gm.goto(s.url);
      await expect(gm.getByTestId("hud-live")).toBeVisible({ timeout: 30_000 });
      await gm.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView());
      await shoot(gm, `gm-${viewport.width}`);
      await shootTop(gm, `gm-${viewport.width}-top`);
    }
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      await player.goto(s.url);
      const tools = player.getByRole("group", { name: "Your tools" });
      await expect(tools.getByRole("toolbar", { name: "Map controls" })).toBeVisible({ timeout: 30_000 });
      await expect(tools.getByRole("button", { name: "Sheet" })).toBeVisible();
      await player.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView());
      await shoot(player, `player-${viewport.width}`);
      await player.locator(".hud-scene").screenshot({ path: `${OUT}/player-${viewport.width}-title.png`, animations: "disabled" });
    }
  } finally {
    await s.close();
  }
});

test("H9.3 the GM's day-disc pop-over with Day / Dim / Night (core campaign)", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const { gm, client, campaignId, close } = await gmAndPlayer(browser, { frame: "custom" });
  try {
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Crossroads", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
    await enableHud(gm);
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await gm.goto(combatMapUrl(campaignId));
      await gm.getByTestId("hud-disc").getByRole("button").click();
      const pop = gm.getByRole("dialog", { name: "Campaign day" });
      await expect(pop.getByRole("group", { name: "Time of day" })).toBeVisible();
      await expect(pop.getByTestId("campaign-day-label")).toBeVisible();
      await shoot(gm, `gm-${viewport.width}-day-pop`);
      await pop.screenshot({ path: `${OUT}/gm-${viewport.width}-day-pop-close.png`, animations: "disabled" });
    }
  } finally {
    await close();
  }
});
