// Lane M (plan lanes, wave 5; dcm-bxp.54): the campaign's time of day outside the Witherwild. The GM advances Day → Dim
// → Night on the dashboard's day card (TASK-CORE-CALENDAR) and sets it on the Combat Map header (one shared value);
// the player sees it read-only, live: on the HUD's day disc and, with the dim-light rule, on the light pill in their
// "Your character" drawer (plan combat-hud H8.1: players always get the HUD).

import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { gmAndPlayer } from "./live";

test.describe.configure({ timeout: 90_000 });

test("the GM's time of day reaches the player's dashboard and map header, read-only", async ({ browser }) => {
  const { gm, player, client, campaignId, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    const gmCycle = gm.getByTestId("time-of-day-cycle");
    const playerValue = player.getByTestId("time-of-day-value");
    await expect(gmCycle).toHaveAccessibleName("Advance the time of day: now Day");
    await expect(playerValue).toContainText("Day");
    await expect(player.getByTestId("time-of-day-cycle")).toHaveCount(0);

    await gmCycle.click();
    await expect(gmCycle).toHaveAccessibleName("Advance the time of day: now Dim");
    await gmCycle.click();
    await expect(gmCycle).toHaveAccessibleName("Advance the time of day: now Night");
    await expect(playerValue).toContainText("Night");

    // The Combat Map header: a dropdown for the GM, the same value; read-only for the player.
    await gm.goto(`/campaigns/${campaignId}/combat-map`);
    await player.goto(`/campaigns/${campaignId}/combat-map`);
    const select = gm.getByRole("combobox", { name: "Time of day" });
    await expect(select).toHaveValue("night");
    // The HUD's day disc: a read-only image for a player, named after the light.
    await expect(player.getByTestId("hud-disc")).toHaveAttribute("aria-label", /Night light$/);
    await player.getByRole("button", { name: "Your character", exact: true }).click();
    const playerPill = player.getByRole("complementary", { name: "Your character" }).getByTestId("combat-light-pill");
    await expect(playerPill).toContainText("Night");
    await expect(player.getByRole("combobox", { name: "Time of day" })).toHaveCount(0);

    await select.selectOption("dim");
    await expect(player.getByTestId("hud-disc")).toHaveAttribute("aria-label", /Dim light$/);
    await expect(playerPill).toContainText("Dim");
    await expect(playerPill).toContainText("ranged attacks at disadvantage");

    // H9.3 (user answer Q6a): the GM sets the light from the day disc. Its pop-over has Day / Dim / Night above the
    // calendar; the GM's title row has no switch any more. The HUD shows once a map is live.
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Crossroads", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
    await gm.goto(`/campaigns/${campaignId}/combat-map`);
    await expect(gm.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
    await expect(gm.getByTestId("hud-title").getByRole("group", { name: "Time of day" })).toHaveCount(0);
    const disc = gm.getByTestId("hud-disc").getByRole("button", { name: /Dim light: open End day$/ });
    await disc.click();
    const pop = gm.getByRole("dialog", { name: "Campaign day" });
    const seg = pop.getByRole("group", { name: "Time of day" });
    await expect(seg.getByRole("button", { name: "Dim" })).toHaveAttribute("aria-pressed", "true");
    await seg.getByRole("button", { name: "Day" }).click();
    await expect(seg.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
    await expect(player.getByTestId("hud-disc")).toHaveAttribute("aria-label", /Day light$/);
    await expect(playerPill).toContainText("Day");
    // The calendar and End day are still below it.
    await expect(pop.getByTestId("campaign-day-label")).toBeVisible();
    await expect(pop.getByRole("button", { name: "End day" })).toBeVisible();
    // The player's disc stays read only.
    await expect(player.getByTestId("hud-disc").getByRole("button")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("in the Witherwild the time phase sets the light, read-only with a link to the time arc", async ({ browser }) => {
  const { gm, campaignId, close } = await gmAndPlayer(browser, { frame: "witherwild" });
  try {
    await expect(gm.getByTestId("time-light")).toContainText("Dim");
    await gm.goto(`/campaigns/${campaignId}/combat-map`);
    const pill = gm.getByTestId("combat-light-pill");
    await expect(pill.getByRole("link", { name: "Dawn" })).toHaveAttribute("href", `/campaigns/${campaignId}#time-arc`);
    await expect(gm.getByRole("combobox", { name: "Time of day" })).toHaveCount(0);
  } finally {
    await close();
  }
});
