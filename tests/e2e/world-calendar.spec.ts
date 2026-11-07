// Plan world-journey MC1 (dcm-zod8.1): the World map shows the campaign calendar above the map - the Witherwild's time
// arc, the day card for every other frame. The GM ends the day there; players read it without End day.

import { expect, test, type Page } from "@playwright/test";

import { gmAndPlayer } from "./live";

test.describe.configure({ timeout: 120_000 });

async function openWorld(page: Page, campaignId: string) {
  await page.goto(`/campaigns/${campaignId}/world`);
  await expect(page.getByRole("application", { name: /^Map of/ })).toBeVisible();
  return page.getByTestId("map-calendar");
}

test("the Witherwild arc sits above the map; the GM's End day advances it, the player has no End day", async ({ browser }) => {
  const { gm, player, campaignId, close } = await gmAndPlayer(browser, { frame: "witherwild" });
  try {
    const gmCal = await openWorld(gm, campaignId);
    const playerCal = await openWorld(player, campaignId);
    await expect(gmCal.getByTestId("time-stage")).toHaveText("Dawn");
    await expect(gmCal.getByTestId("time-label")).toBeVisible();
    await expect(playerCal.getByTestId("time-stage")).toHaveText("Dawn");
    await expect(player.getByTestId("end-day")).toHaveCount(0);

    // The calendar is above the map.
    const calBox = await gmCal.boundingBox();
    const mapBox = await gm.getByRole("application", { name: /^Map of/ }).boundingBox();
    expect(calBox!.y + calBox!.height).toBeLessThanOrEqual(mapBox!.y);

    await gmCal.getByRole("button", { name: "End day" }).click();
    await expect(gmCal.getByTestId("time-stage")).toHaveText("Sunrise");
    await expect(playerCal.getByTestId("time-stage")).toHaveText("Sunrise");
  } finally {
    await close();
  }
});

test("another frame shows the day card; no sideways scroll at tablet width", async ({ browser }) => {
  const { gm, player, campaignId, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    await gm.setViewportSize({ width: 768, height: 1024 });
    const gmCal = await openWorld(gm, campaignId);
    const playerCal = await openWorld(player, campaignId);
    await expect(gmCal.getByTestId("time-stage")).toHaveCount(0);
    await expect(gmCal.getByTestId("campaign-day-label")).toHaveText("Week 1 · Day 1");
    await expect(playerCal.getByTestId("campaign-day-label")).toHaveText("Week 1 · Day 1");
    await expect(player.getByTestId("end-day")).toHaveCount(0);

    await gmCal.getByRole("button", { name: "End the day" }).click();
    await expect(gmCal.getByTestId("campaign-day-label")).toHaveText("Week 1 · Day 2");
    await expect(playerCal.getByTestId("campaign-day-label")).toHaveText("Week 1 · Day 2");

    const overflow = await gm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await close();
  }
});
