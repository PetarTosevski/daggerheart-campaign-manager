// D12 H18 (.omc/plans/d12-hardening.yaml): live updates of the world, GM and player side by side.
// Both pages are open on the same section before each change and never reload. The visibility rules have their own
// specs (codex, world); these prove only that the GM's change reaches the player's open screen.

import { expect, test, type Page } from "@playwright/test";

import { gmAndPlayer } from "./live";

// Two signed-in browsers plus a join make setup alone take 10-20 s on a loaded machine (analysis section 4: under 60 s).
test.describe.configure({ timeout: 60_000 });

test("a Codex entry the GM shows and hides appears in and leaves the player's open list", async ({ browser }) => {
  const { gm, player, campaignId, close } = await gmAndPlayer(browser);
  try {
    const codex = `/campaigns/${campaignId}/codex`;
    for (const page of [gm, player]) {
      await page.goto(codex);
      await expect(page.getByRole("heading", { level: 1, name: "Characters & Locations" })).toBeVisible();
    }
    const name = `Vessa ${crypto.randomUUID().slice(0, 6)}`;
    const playerEntry = player.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: new RegExp(name) });

    await gm.getByRole("button", { name: "+ New character" }).click();
    const detail = gm.getByRole("region", { name: "Entry detail" });
    const nameInput = detail.getByLabel("Name", { exact: true });
    await expect(nameInput).toHaveValue("");
    await nameInput.fill(name);
    await nameInput.press("Tab");
    const gmEntry = gm.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: new RegExp(name) });
    await expect(gmEntry).toContainText("Secret");
    await expect(playerEntry).toHaveCount(0);

    await detail.getByRole("button", { name: "🔒 Secret from players" }).click();
    await expect(gmEntry).toContainText("Known");
    await expect(playerEntry).toBeVisible();

    await detail.getByRole("button", { name: "👁 Known to players" }).click();
    await expect(gmEntry).toContainText("Secret");
    await expect(playerEntry).toHaveCount(0);
  } finally {
    await close();
  }
});

async function openWorld(page: Page, campaignId: string) {
  await page.goto(`/campaigns/${campaignId}/world`);
  const map = page.getByRole("application", { name: /^Map of/ });
  await expect(map).toBeVisible();
  return map;
}

test("a world map token the GM places, and the party the GM moves, show on the player's open map", async ({ browser }) => {
  const { gm, player, campaignId, close } = await gmAndPlayer(browser);
  try {
    const gmMap = await openWorld(gm, campaignId);
    const playerMap = await openWorld(player, campaignId);

    // Place a marker.
    await gm.getByRole("complementary", { name: "Map tokens" }).getByRole("button", { name: "Village", exact: true }).click();
    await gmMap.click({ position: { x: 160, y: 160 } });
    const field = gm.getByRole("complementary", { name: "Selected token" }).getByLabel("Name", { exact: true });
    await expect(field).toHaveValue("Village");
    await field.fill("Oakhollow");
    await field.press("Enter");
    await expect(gmMap.getByRole("button", { name: /^Oakhollow, Village/ })).toBeVisible();
    await expect(playerMap.getByRole("button", { name: /^Oakhollow, Village/ })).toBeVisible();

    // Move the party (Shift+Arrow moves the banner 2% of the map).
    const gmParty = gmMap.getByRole("button", { name: /^Party token/ });
    const playerParty = playerMap.getByRole("button", { name: "Party token", exact: true });
    const left = async (token: typeof gmParty) => (await token.evaluate((el) => (el as HTMLElement).style.left)) || "";
    const start = await left(playerParty);
    expect(start).toMatch(/%$/);
    await gmParty.focus();
    await gmParty.press("Shift+ArrowRight");
    const moved = `${parseFloat(start) + 2}%`;
    await expect.poll(() => left(gmParty)).toBe(moved);
    await expect.poll(() => left(playerParty)).toBe(moved);
  } finally {
    await close();
  }
});
