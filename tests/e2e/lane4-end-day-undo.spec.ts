// Plan lanes-2 CT2 (dcm-jq4b): undoing the GM's End day moves the campaign day back with the uses (user answer
// 2026-10-31 Q4); the player sees the day go back live. Undo of an older End day (uses only) is covered by
// tests/convex/lane4-ct2-end-day-undo.test.ts.

import { expect, test } from "@playwright/test";

import { gmAndPlayer } from "./live";

test.describe.configure({ timeout: 120_000 });

test("the GM undoes End day and the day goes back for everyone", async ({ browser }) => {
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    const gmLabel = gm.getByTestId("campaign-day-label");
    const playerLabel = player.getByTestId("campaign-day-label");
    const day = gm.getByTestId("campaign-day");
    await day.getByRole("button", { name: "End day" }).click();
    await expect(gmLabel).toHaveText("Week 1 · Day 2");
    await expect(playerLabel).toHaveText("Week 1 · Day 2");
    await expect(player.getByTestId("undo-end-day")).toHaveCount(0);

    await day.getByRole("button", { name: "Undo the day's end" }).click();
    await expect(gmLabel).toHaveText("Week 1 · Day 1");
    await expect(playerLabel).toHaveText("Week 1 · Day 1");
    await expect(gm.getByTestId("end-day-notice")).toHaveText("End day undone.");
    await expect(day.getByRole("button", { name: "Undo the day's end" })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("in the Witherwild undoing End day moves the arc back", async ({ browser }) => {
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "witherwild" });
  try {
    const arc = gm.locator("#time-arc");
    await arc.getByRole("button", { name: "End day" }).click();
    await expect(gm.getByTestId("time-stage")).toHaveText("Sunrise");
    await arc.getByRole("button", { name: "Undo the day's end" }).click();
    await expect(gm.getByTestId("time-stage")).toHaveText("Dawn");
    await expect(player.getByTestId("time-stage")).toHaveText("Dawn");
  } finally {
    await close();
  }
});
