// D12 H18 (.omc/plans/d12-hardening.yaml): live updates on the campaign dashboard, GM and player side by side.
// Both pages are on the dashboard before each change and never reload; the change must reach the other screen.
// The rules behind each feature have their own specs (dashboard, players, countdowns-*); these prove only the live path.

import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { openPlayers } from "./config/helpers";
import { gmAndPlayer } from "./live";

/** The e2e player account's display name (its roster row: `settings-member-<name>`). */
const PLAYER_NAME = "e2e-player";

// Two signed-in browsers plus a join make setup alone take 10-20 s on a loaded machine (analysis section 4: under 60 s).
test.describe.configure({ timeout: 60_000 });

test("Fear set by the GM reaches the player's dashboard", async ({ browser }) => {
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    const fear = player.getByTestId("fear-value");
    await expect(fear).toHaveText("—");
    await gm.getByRole("button", { name: "Fear 5 of 12" }).click();
    await expect(fear).toHaveText("V");
    await gm.getByRole("button", { name: "Fear 5 of 12" }).click();
    await expect(fear).toHaveText("IV");
    await expect(player.getByRole("button", { name: "Fear 4 of 12" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await close();
  }
});

test("a countdown revealed, ticked and hidden by the GM appears, moves and disappears for the player", async ({ browser }) => {
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    await gm.getByRole("button", { name: "+ New countdown" }).click();
    const dialog = gm.getByRole("dialog", { name: "New countdown" });
    await dialog.getByLabel("Countdown name").fill("The dam breaks");
    await dialog.getByLabel("What happens at zero").fill("The valley floods.");
    await dialog.getByRole("radio", { name: "Private", exact: true }).check();
    await dialog.getByRole("radio", { name: "4", exact: true }).click();
    await dialog.getByRole("button", { name: "Start at 4" }).click();
    await expect(dialog).toBeHidden();

    const grid = gm.getByRole("region", { name: "Countdowns" });
    const gmCard = grid.getByRole("article", { name: "The dam breaks" });
    await expect(gmCard.getByTestId("countdown-value")).toHaveText("4/4");
    const seen = player.getByRole("region", { name: "Countdowns" });
    const playerCard = seen.getByRole("article", { name: "The dam breaks" });
    await expect(playerCard).toHaveCount(0);

    const visibility = gm.getByRole("dialog", { name: "Who can see this" });
    // Reveal.
    await grid.getByRole("button", { name: "Who can see The dam breaks: Private" }).click();
    await visibility.getByRole("radio", { name: "Public", exact: true }).check();
    await visibility.getByRole("button", { name: "Save" }).click();
    await expect(playerCard.getByTestId("countdown-value")).toHaveText("4/4");

    // Tick.
    await gmCard.getByRole("button", { name: "Tick −1" }).click();
    await expect(gmCard.getByTestId("countdown-value")).toHaveText("3/4");
    await expect(playerCard.getByTestId("countdown-value")).toHaveText("3/4");

    // Hide.
    await grid.getByRole("button", { name: "Who can see The dam breaks: Public" }).click();
    await visibility.getByRole("radio", { name: "Private", exact: true }).check();
    await visibility.getByRole("button", { name: "Save" }).click();
    await expect(playerCard).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the Witherwild time arc moved by the GM moves on the player's dashboard", async ({ browser }) => {
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "witherwild" });
  try {
    await expect(player.getByTestId("time-label")).toContainText("Month 1 · Week 1 · Day 1");
    await expect(player.getByTestId("time-stage")).toHaveText("Dawn");

    await gm.getByRole("button", { name: "Day 4: High Noon" }).click();
    await expect(player.getByTestId("time-stage")).toHaveText("High Noon");

    await gm.getByRole("button", { name: "Day 7: Nautical Twilight" }).click();
    await expect(player.getByTestId("time-stage")).toHaveText("Nautical Twilight");
    await gm.getByRole("button", { name: /Bring the Night/ }).click();
    await expect(player.getByTestId("time-label")).toContainText("Month 1 · Week 2 · Day 1");
    await expect(player.getByTestId("time-stage")).toHaveText("Nightfall");
  } finally {
    await close();
  }
});

test("the GM removes the player (the player loses the campaign) and sees them join again", async ({ browser }) => {
  const { gm, player, client, campaignId, campaignName, close } = await gmAndPlayer(browser);
  try {
    // The Players button opens Campaign settings at Players (config SX, Q10 b).
    const dialog = await openPlayers(gm);
    const row = dialog.getByTestId(`settings-member-${PLAYER_NAME}`);
    await expect(row).toBeVisible();

    // Removal (row menu, then confirm): the player's open dashboard turns into the not-found screen.
    await row.getByRole("button", { name: `Options for ${PLAYER_NAME}` }).click();
    await dialog.getByRole("button", { name: "Remove from campaign" }).click();
    await dialog.getByRole("group", { name: `Remove ${PLAYER_NAME}?` }).getByRole("button", { name: "Remove", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(dialog.getByText("No players yet.")).toBeVisible();
    await expect(player.getByRole("heading", { level: 1, name: "Campaign not found" })).toBeVisible();
    await expect(player.getByRole("heading", { level: 1, name: campaignName })).toHaveCount(0);

    // Joining: the GM's open Players section lists the player as soon as they join.
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId, replace: true });
    // The section shows the new link without reopening.
    await expect(dialog.getByTestId("settings-join-link")).toHaveText(new RegExp(`/join/${code}$`));
    await player.goto(`/join/${code}`);
    await player.getByRole("button", { name: "Join campaign" }).click();
    await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
    await expect(row).toBeVisible();
    await expect(dialog.getByText("No players yet.")).toHaveCount(0);
  } finally {
    await close();
  }
});
