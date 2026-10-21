import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { expectNoHorizontalScroll } from "./visual/helpers";

// Sprite packs P0 (.omc/plans/sprite-packs.yaml): the GM opens /campaigns/<id>/combat-map/packs from the Combat
// Map's "Sprite packs" link (PacksLink stub) and gets the route shell (title, back link, PacksScreen stub); a
// player has no link and is sent back to the Combat Map when they open the URL.

const PLAYER = "e2e-player@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Packs ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2]! };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

test("the GM opens Sprite packs from the Combat Map and comes back", async ({ page }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  await page.goto(`/campaigns/${campaignId}/combat-map`);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  await tools.getByRole("link", { name: "Sprite packs" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/combat-map/packs`);
  await expect(page).toHaveTitle(`Sprite packs · ${name}`);
  await expect(page.getByRole("heading", { level: 1, name: "Sprite packs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your packs" })).toBeVisible();

  await page.getByRole("link", { name: /Combat Map/ }).filter({ hasText: "←" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/combat-map`);
  await expect(page.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
});

test("the packs shell fits a phone: no horizontal scroll at 390 px", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/combat-map/packs`);
  await expect(page.getByRole("heading", { level: 1, name: "Sprite packs" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("a player has no Sprite packs link and is sent back to the Combat Map from the packs URL", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  try {
    await player.goto(`/campaigns/${campaignId}/combat-map`);
    await expect(player.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
    await expect(player.getByRole("link", { name: "Sprite packs" })).toHaveCount(0);

    await player.goto(`/campaigns/${campaignId}/combat-map/packs`);
    await expect(player).toHaveURL(`/campaigns/${campaignId}/combat-map`);
    await expect(player.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
    await expect(player.getByRole("heading", { level: 1, name: "Sprite packs" })).toHaveCount(0);
  } finally {
    await close();
  }
});
