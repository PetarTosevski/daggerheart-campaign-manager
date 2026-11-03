import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H0 (docs/tasks/TASK-HUD-H0.md), cut over in H8.1 (docs/tasks/TASK-HUD-H8.1.md): the HUD shell for
// the GM and a player. Play is a full-bleed map with the HUD regions over it and the classic column in a left drawer
// ("Map tools" for the GM, "Your character" for the player); the GM's Edit mode keeps the classic two-column layout
// (answer 12a). There is no switch: no button, no `?hud=` override, no stored choice. The GM's drawer holds the hand
// sharing switch; its "Map tools" button is the first of the GM's bottom dock (H9.0). axe passes.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function expectHud(page: Page, regions: number) {
  const hud = page.getByTestId("combat-hud");
  await expect(hud).toBeVisible();
  await expect(hud.locator("[data-hud-region]")).toHaveCount(regions);
  // Full bleed: the map fills the HUD's width, with no classic header or column beside it.
  await expect(page.locator(".cm-head")).toHaveCount(0);
  await expect(page.locator(".cm-aside")).toHaveCount(0);
  const box = await hud.locator(".cm-vp").boundingBox();
  const hudBox = await hud.boundingBox();
  expect(box && hudBox ? Math.round(box.width) : 0).toBe(Math.round(hudBox?.width ?? -1));
  // The opt-in switch is gone (H8.1).
  await expect(page.getByTestId("hud-switch")).toHaveCount(0);
  // The map's own toolbar is gone from the HUD (H9.0): the GM's dock or a player's map controls drive the map.
  await expect(hud.locator(".cm-toolbar")).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Map controls" })).toBeVisible();
}

test("the GM always gets the HUD in Play; Map tools holds today's column; Edit keeps the classic layout", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { gm } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    // The full-bleed HUD with every region mounted (GM: banners, scene, fear, waiting, dock, log, hand, pop, panel; H9.0).
    await expectHud(gm, 9);
    await expectNoSeriousA11yViolations(gm);
    await gm.screenshot({ path: "test-results/visual/HUD-H0/gm-hud-1440.png", animations: "disabled" });
    const board = gm.getByRole("region", { name: "Battle map" });
    // H1.3: the GM's adversary tokens read "Open the <name>’s stat block, …".
    await expect(board.getByRole("button", { name: new RegExp(`^Open the ${escape(s.enemies.lieutenant.name)}’s stat block`) })).toBeVisible();

    // The Map tools drawer: Maps, the Play / Edit switch, Combatants and the header tools (Fear) inside it. Its button
    // is the first of the GM's dock (H9.0, user answer Q4a).
    const toolsButton = gm.getByRole("toolbar", { name: "Map controls" }).getByRole("button", { name: "Map tools" });
    await expect(toolsButton).toHaveAttribute("aria-expanded", "false");
    await toolsButton.click();
    const drawer = gm.getByRole("complementary", { name: "Map tools" });
    await expect(drawer.getByRole("heading", { name: "Maps" })).toBeVisible();
    await expect(drawer.getByRole("group", { name: "Map mode" })).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Combatants" })).toBeVisible();
    await expect(drawer.getByRole("group", { name: "GM Fear" })).toBeVisible();
    // The campaign switch "Players can see each other's cards" (F7-H4) ends the GM's drawer (H8.1: the classic GM hand
    // card that held it is gone); it writes the campaign option.
    const sharing = drawer.getByTestId("combat-hand-sharing").getByRole("switch", { name: "Players can see each other's cards" });
    await expect(sharing).toBeChecked();
    await sharing.click();
    await expect(sharing).not.toBeChecked();
    await expect.poll(async () => (await s.client.query(api.combatCards.handSharing, { campaignId: s.campaignId })).playersSeeHands).toBe(false);
    await sharing.click();
    await expect(sharing).toBeChecked();
    await expect.poll(async () => (await s.client.query(api.combatCards.handSharing, { campaignId: s.campaignId })).playersSeeHands).toBe(true);
    await gm.screenshot({ path: "test-results/visual/HUD-H0/gm-tools-1440.png", animations: "disabled" });
    await expectNoSeriousA11yViolations(gm);
    await drawer.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(toolsButton).toBeFocused();

    // Edit keeps today's two-column layout with its header; Play brings the HUD back.
    await toolsButton.click();
    await drawer.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
    await expect(gm.getByTestId("combat-hud")).toHaveCount(0);
    await expect(gm.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
    const column = gm.getByRole("complementary", { name: "Map tools" });
    await expect(column.getByRole("heading", { name: "Scene" })).toBeVisible();
    await expect(gm.getByTestId("hud-switch")).toHaveCount(0);
    await column.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Play/ }).click();
    await expectHud(gm, 9);

    // A reload, and the old `?hud=0` link, still open the HUD.
    await gm.reload();
    await expectHud(gm, 9);
    await gm.goto(`${s.url}?hud=0`);
    await expectHud(gm, 9);
  } finally {
    await s.close();
  }
});

test("a player always gets the HUD with their view and token card in the drawer", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { player } = s;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    // Player: banners, scene, fear, left (feed), hand, pop, panel; no GM-only parts.
    await expectHud(player, 7);
    const board = player.getByRole("region", { name: "Battle map" });
    const token = (name: string) => board.getByRole("button", { name: new RegExp(`^${escape(name)},`) });
    await expect(token(s.enemies.lieutenant.name)).toBeVisible();
    // The Bandit behind the wall is out of Moss's sight: the server never sends it.
    await expect(token(s.enemies.hiddenBandit.name)).toHaveCount(0);
    await player.screenshot({ path: "test-results/visual/HUD-H0/player-hud-1440.png", animations: "disabled" });
    await expectNoSeriousA11yViolations(player);

    // The drawer holds the player's view card; the classic combat actions are the HUD's now (H8.1).
    await player.getByRole("button", { name: "Your character", exact: true }).click();
    const drawer = player.getByRole("complementary", { name: "Your character" });
    await expect(drawer.getByRole("region", { name: "Your view" })).toBeVisible();
    await expect(drawer.getByRole("region", { name: "Attack", exact: true })).toHaveCount(0);
    await expect(drawer.getByRole("group", { name: "GM Fear" })).toHaveCount(0);
    await expectNoSeriousA11yViolations(player);
    await drawer.getByRole("button", { name: "Close Your character" }).click();
    await expect(drawer).toHaveCount(0);

    // The old `?hud=0` link and a stale stored choice change nothing.
    await player.evaluate(() => window.localStorage.setItem("dcm:combat-hud", "0"));
    await player.goto(`${s.url}?hud=0`);
    await expectHud(player, 7);
  } finally {
    await s.close();
  }
});
