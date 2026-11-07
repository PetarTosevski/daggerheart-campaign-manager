import { expect, test, type Page } from "@playwright/test";

import { gmJoinCode } from "./config/helpers";
import { signInAsTestGm } from "./fixtures";

/**
 * World journey MJ1 (dcm-zod8.2): the party walks a drawn route, a day passes per travel day, the GM stops, resumes
 * and cancels; a player sees the walk and the line without the buttons. Beast Feast's map is blank (all Wilds), so any
 * route can be walked; a 4000 km wide map makes the route long enough (dozens of days) to stop it mid-way.
 */

const PLAYER = "e2e-player@example.test";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = unique("Walked");
  await page.goto("/frames/beast-feast");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function openWorld(page: Page) {
  await page.getByRole("navigation", { name: "Campaign sections" }).getByRole("link", { name: "World Map" }).click();
  const map = page.getByRole("application", { name: /^Map of/ });
  await expect(map).toBeVisible();
  return map;
}

/** The party token's drawn position (its left / top style, in percent of the map). */
const partyAt = (page: Page) =>
  page
    .locator("[data-party-token]")
    .first()
    .evaluate((el) => `${(el as HTMLElement).style.left} ${(el as HTMLElement).style.top}`);

const daysPassed = async (page: Page) => Number(/(\d+) days? passed/.exec((await page.getByTestId("journey-status").textContent()) ?? "")?.[1] ?? NaN);

test("the party walks a drawn route on Fast; Stop freezes it, Resume walks on, Cancel clears the line", async ({ page, browser }) => {
  await gmCreatesCampaign(page);
  const code = await gmJoinCode(page);
  const map = await openWorld(page);

  const width = page.getByLabel("Map width in kilometres", { exact: true });
  await width.fill("4000");
  await width.press("Enter");
  await expect(width).toHaveValue("4000");

  // A waypoint route across the map.
  await page.getByRole("button", { name: /Measure/ }).click();
  const route = page.getByRole("region", { name: "Measure and plan a route" });
  await route.getByRole("button", { name: "Waypoints" }).click();
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.15, y: box.height * 0.5 } });
  await map.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
  await map.click({ position: { x: box.width * 0.85, y: box.height * 0.55 } });
  await expect(route.getByTestId("route-total")).toHaveText(/days/);

  const speeds = route.getByRole("group", { name: "Walking speed" });
  await speeds.getByRole("button", { name: "Fast" }).click();
  await expect(speeds.getByRole("button", { name: "Fast" })).toHaveAttribute("aria-pressed", "true");
  await route.getByRole("button", { name: "Move party along route" }).click();

  // The trip's bar and line take over; the token walks and days pass (1 s per travel day on Fast).
  const bar = page.getByRole("region", { name: "The party's journey" });
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("journey-line")).toBeVisible();
  const first = await partyAt(page);
  await expect.poll(() => partyAt(page)).not.toBe(first);
  await expect.poll(() => daysPassed(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);

  // Stop freezes the token at once; no more days pass.
  await bar.getByRole("button", { name: /Stop/ }).click();
  await expect(bar.getByRole("button", { name: /Resume/ })).toBeVisible();
  await expect(bar).toContainText("Stopped on the road");
  // The token froze where it was drawn (optimistic); the server's stop point, a few ms further on, then replaces it.
  await page.waitForTimeout(1000);
  const frozen = await partyAt(page);
  const passed = await daysPassed(page);
  await page.waitForTimeout(2500);
  expect(await partyAt(page)).toBe(frozen);
  expect(await daysPassed(page)).toBe(passed);
  await expect(page.getByTestId("journey-line")).toBeVisible();
  // The calendar above the map (MC1) moved by exactly the days the trip passed (the campaign began on Week 1 · Day 1).
  await expect(page.getByTestId("map-calendar").getByTestId("campaign-day-label")).toHaveText(
    `Week ${1 + Math.floor(passed / 7)} · Day ${1 + (passed % 7)}`,
  );

  // A player sees the stopped trip, its line and the count, without the buttons.
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await openWorld(player);
  const playerBar = player.getByRole("region", { name: "The party's journey" });
  await expect(playerBar).toContainText(`${passed} days passed`);
  await expect(player.getByTestId("journey-line")).toBeVisible();
  await expect(playerBar.getByRole("button")).toHaveCount(0);

  // Resume walks on from the same point; the player's token moves too.
  await bar.getByRole("button", { name: /Resume/ }).click();
  await expect.poll(() => partyAt(page)).not.toBe(frozen);
  await expect.poll(() => partyAt(player)).not.toBe(frozen);

  // Cancel removes the line and the bar for everyone; the party stays where it stopped.
  await bar.getByRole("button", { name: "Cancel trip" }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId("journey-line")).toHaveCount(0);
  await expect(playerBar).toHaveCount(0);
  await expect(player.getByTestId("journey-line")).toHaveCount(0);
  const stayed = await partyAt(page);
  await page.waitForTimeout(1500);
  expect(await partyAt(page)).toBe(stayed);
  await context.close();
});
