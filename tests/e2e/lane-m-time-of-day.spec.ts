// Lane M (plan lanes, wave 5; dcm-bxp.54): the campaign's time of day outside the Witherwild. The GM sets Day / Dim /
// Night on the dashboard and on the Combat Map header (one shared value); the player sees it read-only, live.

import { expect, test } from "@playwright/test";

import { gmAndPlayer } from "./live";

test.describe.configure({ timeout: 90_000 });

test("the GM's time of day reaches the player's dashboard and map header, read-only", async ({ browser }) => {
  const { gm, player, campaignId, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    const gmControl = gm.getByRole("group", { name: "Set the time of day" });
    const playerValue = player.getByTestId("time-of-day-value");
    await expect(gmControl.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
    await expect(playerValue).toContainText("Day");
    await expect(player.getByRole("group", { name: "Set the time of day" })).toHaveCount(0);

    await gmControl.getByRole("button", { name: "Night" }).click();
    await expect(gmControl.getByRole("button", { name: "Night" })).toHaveAttribute("aria-pressed", "true");
    await expect(playerValue).toContainText("Night");

    // The Combat Map header: a dropdown for the GM, the same value; read-only for the player.
    await gm.goto(`/campaigns/${campaignId}/combat-map`);
    await player.goto(`/campaigns/${campaignId}/combat-map`);
    const select = gm.getByRole("combobox", { name: "Time of day" });
    await expect(select).toHaveValue("night");
    const playerPill = player.getByTestId("combat-light-pill");
    await expect(playerPill).toContainText("Night");
    await expect(player.getByRole("combobox", { name: "Time of day" })).toHaveCount(0);

    await select.selectOption("dim");
    await expect(playerPill).toContainText("Dim");
    await expect(playerPill).toContainText("ranged attacks at disadvantage");
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
