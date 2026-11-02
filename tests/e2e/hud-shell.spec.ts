import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { enableHud, hudScene } from "./hud/helpers";

// Plan combat-hud H0 (docs/tasks/TASK-HUD-H0.md): the opt-in switch and the HUD shell, for the GM and a player. With
// the switch off the Combat Map is the classic page; with it on, Play is a full-bleed map with the HUD regions over
// it and today's column in a left drawer ("Map tools" for the GM, "Your character" for the player); the GM's Edit mode
// keeps the classic two-column layout (answer 12a). axe passes both ways.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function expectClassic(page: Page, column: string) {
  await expect(page.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
  await expect(page.getByTestId("combat-hud")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: column })).toBeVisible();
  await expect(page.getByTestId("hud-switch")).toHaveText("Try the new combat HUD");
}

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
  await expect(hud.getByTestId("hud-switch")).toHaveText("Back to the classic view");
}

test("the GM switches the HUD on and off; Map tools holds today's column; Edit keeps the classic layout", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser, { hud: false });
  const { gm } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expectClassic(gm, "Map tools");
    await expectNoSeriousA11yViolations(gm);

    // On: the full-bleed HUD with every region mounted (GM: banners, scene, fear, left, hand, pop, panel).
    await gm.getByTestId("hud-switch").click();
    await expectHud(gm, 7);
    await gm.screenshot({ path: "test-results/visual/HUD-H0/gm-hud-1440.png", animations: "disabled" });
    const board = gm.getByRole("region", { name: "Battle map" });
    await expect(board.getByRole("button", { name: new RegExp(`^${escape(s.enemies.lieutenant.name)},`) })).toBeVisible();

    // The Map tools drawer: Maps, the Play / Edit switch, Combatants and the header tools (Fear) inside it.
    const toolsButton = gm.getByRole("button", { name: "Map tools" });
    await expect(toolsButton).toHaveAttribute("aria-expanded", "false");
    await toolsButton.click();
    const drawer = gm.getByRole("complementary", { name: "Map tools" });
    await expect(drawer.getByRole("heading", { name: "Maps" })).toBeVisible();
    await expect(drawer.getByRole("group", { name: "Map mode" })).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Combatants" })).toBeVisible();
    await expect(drawer.getByRole("group", { name: "GM Fear" })).toBeVisible();
    await gm.screenshot({ path: "test-results/visual/HUD-H0/gm-tools-1440.png", animations: "disabled" });
    await expectNoSeriousA11yViolations(gm);
    await drawer.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(toolsButton).toBeFocused();

    // Edit keeps today's two-column layout; Play brings the HUD back.
    await toolsButton.click();
    await drawer.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
    await expect(gm.getByTestId("combat-hud")).toHaveCount(0);
    const column = gm.getByRole("complementary", { name: "Map tools" });
    await expect(column.getByRole("heading", { name: "Scene" })).toBeVisible();
    await expect(gm.getByTestId("hud-switch")).toHaveText("Back to the classic view");
    await column.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Play/ }).click();
    await expectHud(gm, 7);

    // The switch is per viewer and survives a reload; Back to the classic view turns it off.
    await gm.reload();
    await expectHud(gm, 7);
    await gm.getByTestId("hud-switch").click();
    await expectClassic(gm, "Map tools");
    await gm.reload();
    await expectClassic(gm, "Map tools");
  } finally {
    await s.close();
  }
});

test("a player gets the HUD with their column in the drawer; ?hud=0 / ?hud=1 override the stored switch", async ({ browser }) => {
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

    await player.getByRole("button", { name: "Your character", exact: true }).click();
    const drawer = player.getByRole("complementary", { name: "Your character" });
    await expect(drawer.getByRole("region", { name: "Attack", exact: true })).toBeVisible();
    await expect(drawer.getByRole("group", { name: "GM Fear" })).toHaveCount(0);
    await expectNoSeriousA11yViolations(player);
    await drawer.getByRole("button", { name: "Close Your character" }).click();
    await expect(drawer).toHaveCount(0);

    // The URL overrides the stored value for that page view.
    await player.goto(`${s.url}?hud=0`);
    await expectClassic(player, "Your character");
    await enableHud(player, false);
    await player.goto(`${s.url}?hud=1`);
    await expectHud(player, 7);
    // The toggle drops the override and stores the choice.
    await player.getByTestId("hud-switch").click();
    await expectClassic(player, "Your character");
    await expect(player).toHaveURL(s.url);
    await expectNoSeriousA11yViolations(player);
  } finally {
    await s.close();
  }
});
