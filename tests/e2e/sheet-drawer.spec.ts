import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan sheet-drawer SD6 (bead dcm-bxp.99.19): the Sheet button opens the drawer over the live map. The GM selects a PC
// token after zooming and panning: the drawer is greyed until "Play for this character", then a tracker marks a Stress;
// Esc closes it, the focus is back on the Sheet button and the map keeps its zoom, scroll and selection (no remount).
// DA6 (user answer 2026-10-30): the switch is the one the map Hand shows too, and it stays on across closing and opening
// until the GM turns it off.
// A player at 390 px opens their own sheet from the bar under the map: the drawer fills the screen, Hope goes up, the
// close button returns to the map. Axe on the open drawer; 44 px touch targets at 390 px.

const PLAYER = "e2e-player@example.test";

/** The map's zoom label, scroll position and the selected token: what a remount would reset. */
async function mapView(page: Page) {
  const zoom = await page.getByTestId("combat-zoom").textContent();
  const scroll = await page.getByTestId("combat-viewport").evaluate((vp) => ({ left: vp.scrollLeft, top: vp.scrollTop }));
  const selected = await page.locator('[data-testid="combat-token"][aria-pressed="true"]').getAttribute("aria-label");
  return { zoom, scroll, selected };
}

async function sheetOf(client: Awaited<ReturnType<typeof convexAs>>, characterId: Id<"characters">) {
  const view = await client.query(api.characters.get, { characterId });
  return view!.sheet;
}

test("the GM opens a PC's sheet drawer, plays for them, and closes back to the same map view", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { client, campaignId, url } = await openCombatMap(page);
  const { characterId } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "large", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  const mira = (await client.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t.characterId === characterId)!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: mira._id, x: 6, y: 6 });

  await page.goto(url);
  const board = page.getByRole("region", { name: "Battle map" });
  await board.getByRole("button", { name: "Zoom in" }).click();
  await board.getByRole("button", { name: /^Mira, / }).click();
  await page.getByTestId("combat-viewport").evaluate((vp) => vp.scrollTo(120, 90));
  const before = await mapView(page);
  expect(before.selected).toMatch(/^Mira, /);

  const sheetButton = page.getByTestId("sheet-button-top");
  await sheetButton.click();
  const drawer = page.getByRole("dialog", { name: "Character sheet" });
  await expect(drawer.getByTestId("sheet-drawer-name")).toHaveText("Mira");
  await expect(drawer.getByRole("heading", { name: "Hope feature" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Full sheet" })).toHaveAttribute("href", `/campaigns/${campaignId}/party/${characterId}`);

  // Greyed until the GM plays for Mira.
  const stress = drawer.getByRole("group", { name: "Stress" });
  await expect(stress.getByRole("button", { name: "Mark 1 Stress" })).toBeDisabled();
  await drawer.getByRole("switch", { name: "Play for this character" }).check();
  await stress.getByRole("button", { name: "Mark 1 Stress" }).click();
  await expect(stress.locator("output")).toHaveText("1 / 6 marked");
  await expect.poll(async () => (await sheetOf(client, characterId)).stress).toBe(1);
  await expectNoSeriousA11yViolations(page);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(sheetButton).toBeFocused();
  expect(await mapView(page)).toEqual(before);

  // One switch per PC for the drawer and the map Hand (DA6, user answer 2026-10-30): Mira's Hand shows it on too.
  const hand = page.getByRole("region", { name: "Hand of Mira" });
  await expect(hand.getByRole("switch", { name: "Play for this character" })).toBeChecked();

  // Opening it again shows the server's state; the switch stays on until the GM turns it off.
  await sheetButton.click();
  await expect(drawer.getByRole("group", { name: "Stress" }).locator("output")).toHaveText("1 / 6 marked");
  await expect(drawer.getByRole("switch", { name: "Play for this character" })).toBeChecked();
  await expect(drawer.getByRole("group", { name: "Stress" }).getByRole("button", { name: "Mark 1 Stress" })).toBeEnabled();
  await drawer.getByRole("switch", { name: "Play for this character" }).uncheck();
  await expect(drawer.getByRole("group", { name: "Stress" }).getByRole("button", { name: "Mark 1 Stress" })).toBeDisabled();
  await drawer.getByRole("button", { name: "Close character sheet" }).click();
  await expect(drawer).toBeHidden();
  expect(await mapView(page)).toEqual(before);
  await expect(hand.getByRole("switch", { name: "Play for this character" })).not.toBeChecked();
});

test("a player opens their own sheet full screen at 390 px and gains a Hope", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    const hopeBefore = (await sheetOf(playerClient, characterId)).hope;

    await player.goto(url);
    await expect(player.getByTestId("sheet-button-top")).toBeHidden();
    const sheetButton = player.getByTestId("sheet-button-bottom");
    await sheetButton.click();
    const drawer = player.getByRole("dialog", { name: "Character sheet" });
    await expect(drawer.getByTestId("sheet-drawer-name")).toHaveText("Ash");
    const box = await drawer.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(390);
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(drawer.getByRole("switch")).toHaveCount(0);

    await drawer.getByRole("group", { name: "Hope" }).getByRole("button", { name: "Gain 1 Hope" }).click();
    await expect.poll(async () => (await sheetOf(playerClient, characterId)).hope).toBe(Math.min(6, hopeBefore + 1));
    await expectNoSeriousA11yViolations(player);
    await expectTouchTargets(drawer.locator("button, a"));

    await drawer.getByRole("button", { name: "Close character sheet" }).click();
    await expect(drawer).toBeHidden();
    await expect(sheetButton).toBeFocused();
  } finally {
    await context.close();
  }
});
