// TASK-CORE-CALENDAR (user decision 2026-11-02): a core campaign (no published frame) has the frames' campaign calendar.
// The dashboard's day card shows "Week 1 · Day 1" and the light (the GM's click cycles Day → Dim → Night → Day without
// changing the date); on the Combat HUD the disc reads "Week n · Day n" and the light, the GM's disc opens End day (and
// its Undo), and the player's read-only disc follows live.

import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { combatMapUrl, enableHud } from "./hud/helpers";
import { gmAndPlayer } from "./live";

test.describe.configure({ timeout: 180_000 });

test("a core campaign counts days: the HUD disc shows the day, the GM ends it and undoes it, the player follows", async ({ browser }) => {
  const { gm, player, client, campaignId, close } = await gmAndPlayer(browser, { frame: "custom" });
  try {
    // The dashboard's day card, as in the frames: the cycle wraps Night → Day and leaves the date alone.
    await expect(gm.getByTestId("campaign-day-label")).toHaveText("Week 1 · Day 1");
    await expect(player.getByTestId("campaign-day-label")).toHaveText("Week 1 · Day 1");
    const cycle = gm.getByTestId("time-of-day-cycle");
    for (const now of ["Dim", "Night", "Day", "Dim"]) {
      await cycle.click();
      await expect(cycle).toHaveAccessibleName(`Advance the time of day: now ${now}`);
    }
    await expect(player.getByTestId("time-of-day-value")).toContainText("Dim");
    await expect(gm.getByTestId("campaign-day-label")).toHaveText("Week 1 · Day 1");
    await expectNoSeriousA11yViolations(gm);

    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Crossroads", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
    for (const page of [gm, player]) {
      await enableHud(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(combatMapUrl(campaignId));
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }

    const playerDisc = player.getByTestId("hud-disc");
    await expect(playerDisc).toContainText("Week 1 · Day 1");
    await expect(playerDisc.getByRole("button")).toHaveCount(0);
    await expect(player.getByRole("img", { name: "Week 1, Day 1, Dim light" })).toBeVisible();

    const discButton = gm.getByTestId("hud-disc").getByRole("button", { name: "Week 1, Day 1, Dim light: open End day" });
    await discButton.click();
    const pop = gm.getByRole("dialog", { name: "Campaign day" });
    await expect(pop.getByTestId("campaign-day-label")).toHaveText("Week 1 · Day 1");
    await expectNoSeriousA11yViolations(gm);

    await pop.getByRole("button", { name: "End day" }).click();
    await expect(pop.getByTestId("end-day-notice")).toHaveText("Day 2 begins.");
    await expect(gm.getByTestId("hud-disc")).toContainText("Week 1 · Day 2");
    await expect(playerDisc).toContainText("Week 1 · Day 2");
    await expect(player.getByRole("img", { name: "Week 1, Day 2, Day light" })).toBeVisible();

    await pop.getByRole("button", { name: "Undo the day's end" }).click();
    await expect(pop.getByTestId("end-day-notice")).toHaveText("End day undone.");
    await expect(gm.getByTestId("hud-disc")).toContainText("Week 1 · Day 1");
    await expect(playerDisc).toContainText("Week 1 · Day 1");
    await expect(player.getByRole("img", { name: "Week 1, Day 1, Dim light" })).toBeVisible();
    await expect.poll(() => client.query(api.campaignTime.calendar, { campaignId })).toEqual({ week: 1, day: 1, cycles: false });

    await pop.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(gm.getByTestId("hud-disc").getByRole("button")).toBeFocused();
  } finally {
    await close();
  }
});
