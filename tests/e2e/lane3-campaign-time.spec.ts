// Plan lanes-2 CT (dcm-ztb8): every campaign counts days and weeks. Outside the Witherwild the dashboard header shows
// "Week N · Day D" beside the time of day; the GM's End day moves it on (a week passes after day 7) and the player sees
// it live, without the button. In the Witherwild the time arc gets the same End day.

import { expect, test } from "@playwright/test";

import { gmAndPlayer } from "./live";

test.describe.configure({ timeout: 120_000 });

test("the GM ends days and a week passes; the player sees the day, read-only", async ({ browser }) => {
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    const gmLabel = gm.getByTestId("campaign-day-label");
    const playerLabel = player.getByTestId("campaign-day-label");
    await expect(gmLabel).toHaveText("Week 1 · Day 1");
    await expect(playerLabel).toHaveText("Week 1 · Day 1");
    await expect(player.getByTestId("end-day")).toHaveCount(0);

    const endDay = gm.getByTestId("campaign-day").getByRole("button", { name: "End the day" });
    await endDay.click();
    await expect(gmLabel).toHaveText("Week 1 · Day 2");
    await expect(gm.getByTestId("end-day-notice")).toHaveText("Day 2 begins.");
    await expect(playerLabel).toHaveText("Week 1 · Day 2");

    for (let day = 3; day <= 7; day++) {
      await endDay.click();
      await expect(gmLabel).toHaveText(`Week 1 · Day ${day}`);
    }
    await endDay.click();
    await expect(gmLabel).toHaveText("Week 2 · Day 1");
    await expect(gm.getByTestId("end-day-notice")).toHaveText("Week 2 begins.");
    await expect(playerLabel).toHaveText("Week 2 · Day 1");
  } finally {
    await close();
  }
});

test("in the Witherwild the time arc's End day moves to the next phase", async ({ browser }) => {
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "witherwild" });
  try {
    await expect(gm.getByTestId("time-stage")).toHaveText("Dawn");
    await expect(player.getByTestId("end-day")).toHaveCount(0);
    await gm.locator("#time-arc").getByRole("button", { name: "End day" }).click();
    await expect(gm.getByTestId("time-stage")).toHaveText("Sunrise");
    await expect(player.getByTestId("time-stage")).toHaveText("Sunrise");
    await expect(gm.getByTestId("campaign-day")).toHaveCount(0);
  } finally {
    await close();
  }
});
