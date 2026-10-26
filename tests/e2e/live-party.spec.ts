// D12 H18 (.omc/plans/d12-hardening.yaml): live updates of the party, GM and player side by side.
// Both pages are open on their screens before each change and never reload. characterA (the fixture's Bard) belongs
// to the player. The sheet rules have their own specs (character-sheet, party-roster, dice); these prove the live path.

import { expect, test } from "@playwright/test";

import { gmAndPlayer } from "./live";

// Two signed-in browsers plus a join make setup alone take 10-20 s on a loaded machine (analysis section 4: under 60 s).
test.describe.configure({ timeout: 60_000 });

test("the player marks HP and Hope on their sheet; the GM's roster card and open sheet follow", async ({ browser }) => {
  const { gm, player, campaignId, characterId, characterName: hero, close } = await gmAndPlayer(browser);
  const sheetUrl = `/campaigns/${campaignId}/party/${characterId}`;
  const gmSheet = await gm.context().newPage();
  try {
    await gmSheet.goto(sheetUrl);
    await expect(gmSheet.getByRole("heading", { level: 1, name: hero })).toBeVisible();
    await player.goto(sheetUrl);
    await expect(player.getByRole("heading", { level: 1, name: hero })).toBeVisible();
    // gm stays on the dashboard with the roster card.
    const card = gm.getByRole("article", { name: hero });
    await expect(card.getByRole("img", { name: `${hero} HP 0 of 5` })).toBeVisible();

    await player.getByRole("button", { name: "Hit Point 2 of 5" }).click();
    await expect(player.getByRole("group", { name: "Hit Point: 2 of 5 marked" })).toBeVisible();
    await expect(card.getByRole("img", { name: `${hero} HP 2 of 5` })).toBeVisible();
    await expect(gmSheet.getByRole("group", { name: "Hit Point: 2 of 5 marked" })).toBeVisible();

    await player.getByRole("button", { name: "Hope 4 of 6" }).click();
    await expect(player.getByRole("group", { name: "Hope: 4 of 6 marked" })).toBeVisible();
    await expect(card.getByRole("img", { name: `${hero} Hope 4 of 6` })).toBeVisible();
    await expect(gmSheet.getByRole("group", { name: "Hope: 4 of 6 marked" })).toBeVisible();
  } finally {
    await gmSheet.close();
    await close();
  }
});

test("the GM edits the player's sheet (Stress to Vulnerable, gold); the player's open sheet follows", async ({ browser }) => {
  const { gm, player, campaignId, characterId, characterName: hero, close } = await gmAndPlayer(browser);
  try {
    const sheetUrl = `/campaigns/${campaignId}/party/${characterId}`;
    for (const page of [gm, player]) {
      await page.goto(sheetUrl);
      await expect(page.getByRole("heading", { level: 1, name: hero })).toBeVisible();
    }

    // A condition: all Stress marked makes the character Vulnerable.
    const vulnerable = player.getByText("All Stress marked: Vulnerable.");
    await expect(vulnerable).toHaveCount(0);
    await gm.getByRole("button", { name: "Stress 6 of 6" }).click();
    await expect(gm.getByRole("group", { name: "Stress: 6 of 6 marked" })).toBeVisible();
    await expect(player.getByRole("group", { name: "Stress: 6 of 6 marked" })).toBeVisible();
    await expect(vulnerable).toBeVisible();

    // Gold, on the Story & Advancement page.
    for (const page of [gm, player]) await page.getByRole("tab", { name: "Story & Advancement" }).click();
    const gmGold = gm.getByRole("group", { name: "Handfuls of gold" });
    const playerGold = player.getByRole("group", { name: "Handfuls of gold" }).locator("strong");
    const before = Number(await gmGold.locator("strong").textContent());
    await expect(playerGold).toHaveText(String(before));
    await gmGold.getByRole("button", { name: "Increase Handfuls of gold" }).click();
    await expect(gmGold.locator("strong")).toHaveText(String(before + 1));
    await expect(playerGold).toHaveText(String(before + 1));
  } finally {
    await close();
  }
});

test("a roll from the player's sheet lands in the GM's open roll feed", async ({ browser }) => {
  const { gm, player, campaignId, characterId, characterName: hero, close } = await gmAndPlayer(browser);
  try {
    const feed = gm.getByRole("list", { name: "Rolls" });
    const line = feed.getByRole("listitem").filter({ hasText: `${hero}: Presence action roll` });
    await expect(line).toHaveCount(0);

    // Reduced motion turns the 3D dice off by default (dice-3d.spec), so the result shows at once on a loaded machine.
    await player.emulateMedia({ reducedMotion: "reduce" });
    await player.goto(`/campaigns/${campaignId}/party/${characterId}`);
    const box = player.getByRole("region", { name: "Dice", exact: true });
    await box.getByLabel("Trait").selectOption("presence");
    await box.getByLabel("Difficulty").fill("12");
    await box.getByRole("button", { name: "Roll", exact: true }).click();
    await expect(box.getByTestId("last-roll")).toContainText("Presence +2 action roll vs 12");
    await expect(line).toHaveCount(1);

    await box.getByRole("button", { name: "Roll", exact: true }).click();
    await expect(box.getByRole("list", { name: "Earlier" }).getByRole("listitem")).toHaveCount(1);
    await expect(line).toHaveCount(2);
  } finally {
    await close();
  }
});
