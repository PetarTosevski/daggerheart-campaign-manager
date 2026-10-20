import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { D9_VIEWPORTS, expectNoHorizontalScroll, openCombatMap, visual } from "./visual/helpers";

// D9 C0: the Combat Map page shell (.omc/plans/d9-combat-map.yaml). The GM gets the board's header with GM Fear,
// the maps card, the Play / Edit switch and the empty map area; a player opens the same tab (it is not GM-only)
// and gets the player layout: no maps card, no Fear, no edit tools.

const PLAYER = "e2e-player@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Combat ${crypto.randomUUID().slice(0, 8)}`;
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

test("the GM opens Combat Map from the nav: header with Fear, maps card, mode switch and the empty map", async ({ page }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  await nav.getByRole("link", { name: "Combat Map" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/combat-map`);
  await expect(page).toHaveTitle(`Combat Map · ${name}`);
  await expect(page.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Combat Map" })).toHaveAttribute("aria-current", "page");

  const tools = page.getByRole("complementary", { name: "Map tools" });
  await expect(tools.getByRole("heading", { name: "Maps" })).toBeVisible();
  const board = page.getByRole("region", { name: "Battle map" });
  await expect(board.getByText("No battlefield yet")).toBeVisible();

  // As on the board, a campaign without maps opens in Edit with the Scene card (Play needs a map).
  const mode = tools.getByRole("group", { name: "Map mode" });
  await expect(mode.getByRole("button", { name: /Edit map/ })).toHaveAttribute("aria-pressed", "true");
  await expect(mode.getByRole("button", { name: /Play/ })).toHaveAttribute("aria-pressed", "false");
  await expect(tools.getByRole("heading", { name: "Scene" })).toBeVisible();

  // GM Fear in the header is the campaign's Fear.
  const fear = page.getByRole("group", { name: "GM Fear" });
  await expect(fear.getByTestId("combat-fear")).toHaveText("0");
  await expect(fear.getByRole("button", { name: "Spend a Fear" })).toBeDisabled();
  await fear.getByRole("button", { name: "Gain a Fear" }).click();
  await expect(fear.getByTestId("combat-fear")).toHaveText("1");
  await fear.getByRole("button", { name: "Spend a Fear" }).click();
  await expect(fear.getByTestId("combat-fear")).toHaveText("0");
});

test("a player opens Combat Map and gets the player layout without GM tools", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  try {
    const nav = player.getByRole("navigation", { name: "Campaign sections" });
    await nav.getByRole("link", { name: "Combat Map" }).click();
    await expect(player).toHaveURL(`/campaigns/${campaignId}/combat-map`);
    await expect(player.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
    await expect(player.getByRole("region", { name: "Battle map" }).getByText("No battle yet")).toBeVisible();
    await expect(player.getByText("The GM hasn’t put a map live yet.")).toBeVisible();
    await expect(player.getByRole("heading", { name: "Maps" })).toHaveCount(0);
    await expect(player.getByRole("group", { name: "GM Fear" })).toHaveCount(0);
    await expect(player.getByRole("group", { name: "Map mode" })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the shell fits a phone: no horizontal scroll at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCombatMap(page);
  await expect(page.getByRole("region", { name: "Battle map" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

// Shots for the C0 task doc (E2E_VISUAL=1); board counterparts: `node scripts/board-shots.mjs combat:gm-empty`.
test("C0 combat map shell at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  await openCombatMap(page);
  const { shoot } = visual(page, "C0", D9_VIEWPORTS);
  await shoot(page.locator(".cm-root"), "gm-empty");
});
