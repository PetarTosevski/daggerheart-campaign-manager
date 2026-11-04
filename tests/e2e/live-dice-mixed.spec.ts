// Mixed dice and the Revealed tag (user 2026-11-04), GM and player side by side without reloads: the player builds
// 3d6 + 1d8 from buttons in the feed's "Roll dice" and both screens show every die with its size; the GM's secret roll
// shows Hidden for the GM only, then Revealed (Hope colours) on both screens after Reveal.

import { expect, test, type Page } from "@playwright/test";

import { gmAndPlayer } from "./live";

test.describe.configure({ timeout: 90_000 });

const feedOf = (page: Page) => page.getByRole("list", { name: "Rolls" });

test("a player's 3d6 + 1d8 reaches both feeds; a hidden GM roll turns Revealed for GM and player", async ({ browser }, testInfo) => {
  const { gm, player, close } = await gmAndPlayer(browser, { frame: "beast-feast" });
  try {
    // ---- The player builds 3d6 + 1d8 with buttons only and rolls it.
    await player.getByRole("button", { name: "Roll dice" }).click();
    const form = player.getByRole("form", { name: "Free roll" });
    for (let i = 0; i < 3; i++) await form.getByRole("button", { name: "Add a d6" }).click();
    await form.getByRole("button", { name: "Add a d8" }).click();
    await expect(form.getByTestId("free-roll-preview")).toHaveText("3d6 + 1d8");
    await form.screenshot({ path: testInfo.outputPath("free-roller.png") });
    await form.getByRole("button", { name: "Roll", exact: true }).click();

    for (const page of [player, gm]) {
      const row = feedOf(page).getByRole("listitem", { name: /: 3d6 \+ 1d8 = \d+$/ });
      await expect(row).toHaveCount(1, { timeout: 30_000 });
      const dice = row.getByRole("list", { name: "Dice" }).getByRole("listitem");
      await expect(dice).toHaveCount(4);
      await expect(dice.nth(0)).toHaveAccessibleName(/^Extra d6: [1-6]$/);
      await expect(dice.nth(3)).toHaveAccessibleName(/^Extra d8: [1-8]$/);
      await expect(row.getByText("hidden")).toHaveCount(0);
      await expect(row.getByText("revealed")).toHaveCount(0);
    }

    // ---- The GM rolls in secret: Hidden for the GM, nothing for the player.
    const label = `Ambush ${crypto.randomUUID().slice(0, 6)}`;
    const secretForm = gm.getByRole("form", { name: "GM roll" });
    await secretForm.getByLabel("Type a roll").fill("1d12");
    await secretForm.getByLabel("For").fill(label);
    await secretForm.getByRole("button", { name: "Roll in secret" }).click();
    const gmRow = feedOf(gm).getByRole("listitem").filter({ hasText: label });
    await expect(gmRow.getByText("hidden", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(gmRow.getByText("revealed", { exact: true })).toHaveCount(0);
    await expect(feedOf(player).getByRole("listitem").filter({ hasText: label })).toHaveCount(0);
    await gmRow.screenshot({ path: testInfo.outputPath("hidden-gm.png") });

    // ---- Reveal: both screens tag it Revealed.
    await gmRow.getByRole("button", { name: "Reveal" }).click();
    await expect(gmRow.getByText("revealed", { exact: true })).toBeVisible();
    await expect(gmRow.getByText("hidden", { exact: true })).toHaveCount(0);
    const playerRow = feedOf(player).getByRole("listitem").filter({ hasText: label });
    await expect(playerRow.getByText("revealed", { exact: true })).toBeVisible({ timeout: 30_000 });
    await gmRow.screenshot({ path: testInfo.outputPath("revealed-gm.png") });
    await playerRow.screenshot({ path: testInfo.outputPath("revealed-player.png") });
  } finally {
    await close();
  }
});
