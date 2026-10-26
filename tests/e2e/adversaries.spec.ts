import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

// D8 A0: the GM-only Adversaries page shell (tabs Catalogue / Encounters / Environment (EV1) with their slots); players see no nav item
// and a GM-only panel, and their page asks the server for no adversary or party data.

const PLAYER = "e2e-player@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Adversaries ${crypto.randomUUID().slice(0, 8)}`;
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

test("the GM opens Adversaries from the nav and switches tabs with the mouse and the arrow keys", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  await nav.getByRole("link", { name: "Adversaries" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/adversaries`);
  await expect(page).toHaveTitle("Adversaries");
  await expect(page.getByRole("heading", { level: 1, name: "Adversaries" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Adversaries" })).toHaveAttribute("aria-current", "page");

  const tabs = page.getByRole("tablist", { name: "Adversary views" });
  const catalogue = tabs.getByRole("tab", { name: "Catalogue" });
  const encounters = tabs.getByRole("tab", { name: "Encounters" });
  await expect(catalogue).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "Catalogue" });
  await expect(panel.getByRole("region", { name: "Adversary list" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Custom adversaries" }).getByRole("button", { name: "New adversary" })).toBeVisible();

  await encounters.click();
  await expect(encounters).toHaveAttribute("aria-selected", "true");
  const encountersPanel = page.getByRole("tabpanel", { name: "Encounters" });
  await expect(encountersPanel.getByRole("button", { name: "+ New encounter" })).toBeVisible();
  await expect(encountersPanel.getByRole("heading", { name: "Encounter tracker" })).toBeVisible();

  // Arrow keys move the selection and the focus (WAI-ARIA tabs), wrapping at the ends.
  const environment = tabs.getByRole("tab", { name: "Environment" });
  await encounters.press("ArrowRight");
  await expect(environment).toHaveAttribute("aria-selected", "true");
  await expect(environment).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Environment" }).getByRole("region", { name: "Environment list" })).toBeVisible();
  await environment.press("ArrowRight");
  await expect(catalogue).toHaveAttribute("aria-selected", "true");
  await expect(catalogue).toBeFocused();
  await catalogue.press("ArrowLeft");
  await expect(environment).toHaveAttribute("aria-selected", "true");
  await environment.press("ArrowLeft");
  await expect(encounters).toHaveAttribute("aria-selected", "true");
  await expect(encounters).toBeFocused();
  await encounters.press("Home");
  await expect(catalogue).toHaveAttribute("aria-selected", "true");
  await catalogue.press("End");
  await expect(environment).toHaveAttribute("aria-selected", "true");
});

test("a joined player has no Adversaries nav item and sees the GM-only panel at the URL, with no data request", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  await expect(page.getByRole("navigation", { name: "Campaign sections" }).getByRole("link", { name: "Adversaries" })).toBeVisible();
  const { player, close } = await playerJoins(page, browser, name);

  const nav = player.getByRole("navigation", { name: "Campaign sections" });
  await expect(nav.getByRole("link", { name: "Characters & Locations" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Adversaries" })).toHaveCount(0);

  // Every Convex function the player's page asks for, from a fresh load of the URL.
  const requested: string[] = [];
  player.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      for (const match of String(payload).matchAll(/"udfPath":"([^"]+)"/g)) requested.push(match[1]!);
    });
  });
  await player.goto(`/campaigns/${campaignId}/adversaries`);
  await expect(player.getByText("Only the GM can see adversaries and encounters.")).toBeVisible();
  await expect(player.getByRole("tablist", { name: "Adversary views" })).toHaveCount(0);
  await expect.poll(() => requested.includes("campaigns:get")).toBe(true);
  expect(requested.filter((path) => /^(encounters|characters):/.test(path))).toEqual([]);
  await close();
});
