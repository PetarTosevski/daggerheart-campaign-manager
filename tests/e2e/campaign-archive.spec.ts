import { expect as baseExpect, test, type Page } from "@playwright/test";
import { ConvexError } from "convex/values";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { gotoSettings, settingsPanel } from "./config/helpers";
import { gmAndPlayer } from "./live";

// Plan config S3 (Q9 a, Q7 a): the creator archives the campaign from Campaign settings › Sessions. Every campaign page
// shows "This campaign is archived · read-only" to everyone, live; a player's write is refused with CAMPAIGN_ARCHIVED;
// Load Campaign lists it under "Archived"; the creator restores it (banner, or Load Campaign) and writes work again.
// Shots: test-results/config-s3/.

test.describe.configure({ timeout: 300_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/config-s3/${name}.png`, animations: "disabled" });
const BANNER = "This campaign is archived · read-only";

test("archive: read-only for everyone with a banner, a player's write fails, Archived in Load Campaign, restore", async ({ browser }) => {
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, campaignName, playerClient } = table;
  const dashboard = `/campaigns/${campaignId}`;
  // A player's free roll: a campaign mutation any member may make.
  const roll = () =>
    playerClient.mutation(api.rolls.freeRoll, { campaignId, dice: [{ count: 1, sides: 6 }], modifier: 0, idempotencyKey: crypto.randomUUID() });
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gotoSettings(gm, dashboard, "sessions");
    const row = settingsPanel(gm).getByTestId("settings-archive");
    await expect(row).toContainText("Keeps everything read-only. You can restore it later.");

    // 'Archive…' asks first; Cancel backs out.
    await row.getByRole("button", { name: "Archive…" }).click();
    const confirm = row.getByRole("group", { name: `Archive ${campaignName}?` });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await row.getByRole("button", { name: "Archive…" }).click();
    await shot(gm, "confirm-1440");
    await row.getByRole("group", { name: `Archive ${campaignName}?` }).getByRole("button", { name: "Archive", exact: true }).click();
    await expect(row.getByRole("button", { name: "Restore" })).toBeVisible();

    // The banner reaches the player live; the player gets no Restore.
    const playerBanner = player.getByTestId("archived-banner");
    await expect(playerBanner).toHaveText(BANNER);
    await expect(playerBanner.getByRole("button")).toHaveCount(0);
    await shot(player, "player-banner-1440");

    // A player's write is refused.
    const error = await roll().then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<{ code: string }>).data.code).toBe("CAMPAIGN_ARCHIVED");

    // Load Campaign: under "Archived" for both; Restore only for the creator.
    for (const page of [gm, player]) {
      await page.goto("/campaigns");
      const archived = page.getByRole("region", { name: "Archived" });
      await expect(archived.getByRole("listitem").filter({ hasText: campaignName })).toBeVisible();
    }
    await expect(player.getByRole("button", { name: `Restore ${campaignName} from the archive` })).toHaveCount(0);
    await expectNoSeriousA11yViolations(gm);
    await shot(gm, "load-campaign-archived-1440");

    // Another campaign page shows the banner too; the creator restores from it.
    await gm.goto(`${dashboard}/party`);
    const gmBanner = gm.getByTestId("archived-banner");
    await expect(gmBanner).toContainText(BANNER);
    await gmBanner.getByRole("button", { name: "Restore" }).click();
    await expect(gmBanner).toHaveCount(0);

    // Writes work again, and Load Campaign lists it with the saved campaigns.
    await roll();
    await player.reload();
    await expect(player.getByRole("region", { name: "Archived" }).getByText(campaignName)).toHaveCount(0);
    await expect(player.getByText(campaignName).first()).toBeVisible();
  } finally {
    await table.close();
  }
});
