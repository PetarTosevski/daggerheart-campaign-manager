import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { expectNoHorizontalScroll } from "./visual/helpers";

// D13 L0: the Lorekeeper page shell (.omc/plans/d13-lorekeeper.yaml). The GM and a player each open Lorekeeper from
// the nav and get the board's layout: the sidebar (stub cards) and the chat panel with the sigil, 'The Lorekeeper'
// and 'Keeper of your rulebooks · answers rule questions'. An outsider gets the campaign not-found page. L0 has no
// Lorekeeper functions yet: the slots are stubs.

const PLAYER = "e2e-player@example.test";
// An allowlisted account (scripts/e2e-setup.mjs) that is not in the campaign.
const OUTSIDER = "e2e-password@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Lore ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2]! };
}

async function signedInContext(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  return { page, close: () => context.close() };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  const { page: player, close } = await signedInContext(browser, PLAYER);
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close };
}

/** The shell every member sees: the chat panel with its header and the sidebar's three cards. */
async function expectShell(page: Page) {
  const chat = page.getByRole("region", { name: "The Lorekeeper" });
  await expect(chat.getByRole("heading", { level: 1, name: "The Lorekeeper" })).toBeVisible();
  await expect(chat.getByText("Keeper of your rulebooks · answers rule questions")).toBeVisible();
  await expect(chat.getByRole("log", { name: "Conversation" })).toBeVisible();
  const side = page.getByRole("complementary", { name: "Library and rulings" });
  await expect(side.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(side.getByRole("heading", { name: "How I answer" })).toBeVisible();
  await expect(side.getByRole("heading", { name: "Table rulings" })).toBeVisible();
}

test("the GM and a player open the Lorekeeper from the nav; an outsider gets not found", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  await nav.getByRole("link", { name: "Lorekeeper" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/lorekeeper`);
  await expect(page).toHaveTitle(`Lorekeeper · ${name}`);
  await expect(nav.getByRole("link", { name: "Lorekeeper" })).toHaveAttribute("aria-current", "page");
  await expectShell(page);
  // 1440: the 300 px sidebar beside the fluid chat panel.
  await page.setViewportSize({ width: 1440, height: 900 });
  const side = (await page.getByRole("complementary", { name: "Library and rulings" }).boundingBox())!;
  const chat = (await page.getByRole("region", { name: "The Lorekeeper" }).boundingBox())!;
  expect(Math.round(side.width)).toBe(300);
  expect(chat.x).toBeGreaterThan(side.x + side.width);
  expect(chat.width).toBeGreaterThan(800);

  const { player, close } = await playerJoins(page, browser, name);
  try {
    await player.getByRole("navigation", { name: "Campaign sections" }).getByRole("link", { name: "Lorekeeper" }).click();
    await expect(player).toHaveURL(`/campaigns/${campaignId}/lorekeeper`);
    await expect(player).toHaveTitle(`Lorekeeper · ${name}`);
    await expectShell(player);
  } finally {
    await close();
  }

  const outsider = await signedInContext(browser, OUTSIDER);
  try {
    await outsider.page.goto(`/campaigns/${campaignId}/lorekeeper`);
    await expect(outsider.page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();
    await expect(outsider.page.getByRole("region", { name: "The Lorekeeper" })).toHaveCount(0);
  } finally {
    await outsider.close();
  }
});

test("the shell fits a phone: one column, the sidebar above the chat, no horizontal scroll at 390 px", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/lorekeeper`);
  await expectShell(page);
  await expectNoHorizontalScroll(page);
  const side = (await page.getByRole("complementary", { name: "Library and rulings" }).boundingBox())!;
  const chat = (await page.getByRole("region", { name: "The Lorekeeper" }).boundingBox())!;
  expect(chat.y).toBeGreaterThan(side.y + side.height - 1);
  expect(chat.width).toBeLessThanOrEqual(390);
});
