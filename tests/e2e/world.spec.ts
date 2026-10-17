import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesCampaign(page: Page, frame: string) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Mapped");
  await page.goto(`/frames/${frame}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return name;
}

async function openWorld(page: Page) {
  await page.getByRole("navigation", { name: "Campaign sections" }).getByRole("link", { name: "World" }).click();
  const map = page.getByRole("application", { name: /^Map of/ });
  await expect(map).toBeVisible();
  return map;
}

/** Picks a palette token, clicks the map at a viewport position and names the new marker. */
async function placeToken(page: Page, map: ReturnType<Page["getByRole"]>, type: string, name: string, position: { x: number; y: number }) {
  await page.getByRole("complementary", { name: "Map tokens" }).getByRole("button", { name: type, exact: true }).click();
  await map.click({ position });
  const editor = page.getByRole("complementary", { name: "Selected token" });
  const field = editor.getByLabel("Name", { exact: true });
  await expect(field).toHaveValue(type);
  await field.fill(name);
  await field.press("Enter");
  await expect(map.getByRole("button", { name: new RegExp(`^${name}, ${type}`) })).toBeVisible();
  return editor;
}

test("the GM places markers and measures; players see only visible markers", async ({ page, browser }) => {
  await gmCreatesCampaign(page, "witherwild");
  const map = await openWorld(page);

  await placeToken(page, map, "Village", "Oakhollow", { x: 160, y: 160 });
  const editor = await placeToken(page, map, "Cave", "Wyrm lair", { x: 420, y: 140 });
  const hidden = editor.getByLabel("Hidden from players");
  await hidden.click();
  await expect(hidden).toBeChecked();
  await expect(map.getByRole("button", { name: /^Wyrm lair, Cave \(hidden from players\)/ })).toBeVisible();
  const list = page.getByRole("region", { name: "On the map" });
  await expect(list.getByText("2 markers")).toBeVisible();

  // Measure a straight line between two points.
  await page.getByRole("button", { name: /Measure/ }).click();
  const route = page.getByRole("region", { name: "Measure and plan a route" });
  await route.getByRole("button", { name: "Straight line" }).click();
  await map.click({ position: { x: 120, y: 300 } });
  await map.click({ position: { x: 460, y: 320 } });
  await expect(route.getByTestId("route-total")).toHaveText(/^\d+(\.\d)? km · /);
  await route.getByRole("button", { name: "Kilometres" }).click();
  await expect(route.getByTestId("route-total")).toHaveText(/^\d+(\.\d)? mi · /);
  await route.getByRole("button", { name: "Done" }).click();

  // A player joins and sees the visible marker only.
  await page.getByRole("button", { name: "Players", exact: true }).click();
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

  const playerMap = await openWorld(player);
  await expect(playerMap.getByRole("button", { name: /^Oakhollow, Village/ })).toBeVisible();
  await expect(player.getByText("Wyrm lair")).toHaveCount(0);
  await expect(player.getByRole("complementary", { name: "Map tokens" })).toHaveCount(0);
  await expect(player.getByRole("button", { name: /Paint/ })).toHaveCount(0);

  // Unhiding the marker reaches the player live.
  await map.getByRole("button", { name: /^Wyrm lair, Cave/ }).click();
  await expect(hidden).toBeChecked();
  await hidden.click();
  await expect(hidden).not.toBeChecked();
  await expect(playerMap.getByRole("button", { name: /^Wyrm lair, Cave/ })).toBeVisible();
  await context.close();
});

test("a custom campaign's GM sees the map upload control", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Saltmap");
  await page.goto("/new");
  await page.getByRole("radio", { name: /Custom/ }).click();
  const form = page.getByRole("region", { name: "Custom frame" });
  await form.getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await openWorld(page);
  await expect(page.getByRole("note")).toContainText("blank parchment");
  const control = page.getByRole("region", { name: "Map image" });
  await expect(control.getByRole("button", { name: "Upload map image" })).toBeVisible();
  await expect(control.getByLabel("Uploaded map width in kilometres")).toBeVisible();
});
