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

  // Entering and leaving Paint mode keeps the map's zoom and position.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  const view = async () => ({ transform: await page.locator("[data-map]").first().evaluate((el) => (el as HTMLElement).style.transform + (el as HTMLElement).style.width), zoom: await page.getByLabel("Zoom level").textContent() });
  const before = await view();
  await page.getByRole("button", { name: /Paint/ }).click();
  await expect(page.getByRole("toolbar", { name: "Terrain brushes" })).toBeVisible();
  expect(await view()).toEqual(before);
  await page.getByRole("toolbar", { name: "Terrain brushes" }).getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("toolbar", { name: "Terrain brushes" })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await view()).toEqual(before);

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
  // Players see the travel speeds but can't edit them.
  const playerLegend = player.getByRole("region", { name: "Travel speeds" });
  await expect(playerLegend.getByRole("listitem").filter({ hasText: "Road" })).toContainText("60 km/day");
  await expect(playerLegend.getByRole("button", { name: "Edit speeds…" })).toHaveCount(0);

  // Unhiding the marker reaches the player live.
  await map.getByRole("button", { name: /^Wyrm lair, Cave/ }).click();
  await expect(hidden).toBeChecked();
  await hidden.click();
  await expect(hidden).not.toBeChecked();
  await expect(playerMap.getByRole("button", { name: /^Wyrm lair, Cave/ })).toBeVisible();
  await context.close();
});

test("the travel-speed legend follows the travel method, the pace and the GM's speeds", async ({ page }) => {
  await gmCreatesCampaign(page, "witherwild");
  await openWorld(page);
  const legend = page.getByRole("region", { name: "Travel speeds" });
  const row = (terrain: string) => legend.getByRole("listitem").filter({ hasText: terrain });
  await expect(legend.getByTestId("legend-method")).toHaveText("On foot · Normal · km/day");
  await expect(row("Deep wilds")).toContainText("20 km/day");
  await expect(row("Hills")).toContainText("20 km/day");
  await expect(row("Plains")).toContainText("50 km/day");
  await expect(row("Impassable")).toContainText("can’t cross");

  // The pace offers only the travel methods, by terrain.
  const pace = page.getByLabel("Travel pace");
  await expect(pace.locator("option")).toHaveText(["On foot · by terrain", "Mounted · by terrain", "Wagon / cart · by terrain", "Boat · by terrain", "Flying · by terrain"]);
  await pace.selectOption({ label: "Boat · by terrain" });
  await expect(legend.getByTestId("legend-method")).toHaveText("Boat · Normal · km/day");
  await expect(row("Water")).toContainText("100 km/day");
  await page.getByLabel("March pace").selectOption("slow");
  await expect(row("Water")).toContainText("75 km/day");
  await page.getByLabel("March pace").selectOption("normal");

  // The GM edits Boat on Water; the legend follows.
  await legend.getByRole("button", { name: "Edit speeds…" }).click();
  const dialog = page.getByRole("dialog", { name: "Travel speeds" });
  await dialog.getByLabel("Boat, Water, km per day").fill("90");
  await dialog.getByRole("button", { name: "Save speeds" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row("Water")).toContainText("90 km/day");

  // Collapsible.
  await legend.getByRole("button", { name: "Travel speeds" }).click();
  await expect(legend.getByRole("listitem")).toHaveCount(0);
  await legend.getByRole("button", { name: "Travel speeds" }).click();
  await expect(legend.getByRole("listitem")).toHaveCount(9);
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
