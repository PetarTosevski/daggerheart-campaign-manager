import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H9.0 (docs/tasks/TASK-HUD-H9.0.md): the GM's bottom dock is the only map toolbar (GMDesktop /
// GMTablet `.dock`): Map tools (Q4a) | Select, Measure, Areas, Fog, Names | Zoom out, the % (fits the map), Zoom in |
// Dice, Player view, Log | End scene. The map's own toolbar is gone from the HUD. Every dock button works from the
// keyboard alone; one GM panel opens at a time and Escape closes it. Measure (Q9b) shows the distance and range band
// for the GM and for a player, each on their own screen. axe passes at 1440 x 900 and 1024 x 768; at tablet width and
// with a sheet open the dock shows icons only.

test.use({ actionTimeout: 30_000 });

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const BAND = /^\d+ squares? · (Melee|Very Close|Close|Far|Very Far)$/;

async function openHud(page: Page, url: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto(url);
  const hud = page.getByTestId("combat-hud");
  await expect(hud).toBeVisible();
  await expect(page.getByRole("list", { name: "The party" }).getByRole("button").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas")).toBeVisible();
  await hud.evaluate((el) => el.scrollIntoView());
  return hud;
}

/** A box relative to the HUD root (the root sits under the campaign header). */
async function boxIn(hud: Locator, part: Locator) {
  const root = (await hud.boundingBox())!;
  const b = (await part.boundingBox())!;
  return { left: b.x - root.x, centre: b.x - root.x + b.width / 2, bottom: root.y + root.height - (b.y + b.height), width: b.width, height: b.height };
}

/** Focuses `button` and presses `key` on it (keyboard only: no pointer). */
async function press(button: Locator, key = "Enter") {
  await button.focus();
  await button.press(key);
}

test("the GM's dock: every button from the keyboard, one panel at a time, axe at 1440 x 900", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm } = s;
  try {
    const hud = await openHud(gm, s.url, DESKTOP);
    const dock = gm.getByRole("toolbar", { name: "Map controls" });
    await expect(dock).toBeVisible();
    // The map's own toolbar (name, LIVE, Areas, Names, zoom, Fit) is gone from the HUD.
    await expect(hud.locator(".cm-toolbar")).toHaveCount(0);
    await expect(gm.getByRole("button", { name: "Aa Names" })).toHaveCount(0);
    await expect(gm.getByRole("button", { name: "Fit", exact: true })).toHaveCount(0);
    // GMDesktop: centred, bottom 16; icon over a label; 44 px tall buttons.
    const box = await boxIn(hud, dock);
    expect(Math.abs(box.centre - DESKTOP.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.round(box.bottom)).toBe(16);
    await expect(dock.getByRole("button", { name: "Select" })).toContainText("Select");
    await expectTouchTargets(dock.getByRole("button"));
    await expectNoSeriousA11yViolations(gm);
    await gm.screenshot({ path: "test-results/visual/HUD-H9.0/gm-dock-1440.png", animations: "disabled" });

    // Map tools (Q4a): the drawer, with the cards switch; Escape closes it and the focus comes back.
    const tools = dock.getByRole("button", { name: "Map tools" });
    await press(tools);
    const drawer = gm.getByRole("complementary", { name: "Map tools" });
    await expect(drawer.getByTestId("combat-hand-sharing").getByRole("switch", { name: "Players can see each other's cards" })).toBeVisible();
    await drawer.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(tools).toBeFocused();

    // Select is pressed by default; Measure takes over the pointer and Select gives it back.
    const select = dock.getByRole("button", { name: "Select" });
    const measure = dock.getByRole("button", { name: "Measure" });
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await press(measure, " ");
    await expect(measure).toHaveAttribute("aria-pressed", "true");
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await expect(gm.getByTestId("combat-measure")).toHaveCount(1);
    await press(select);
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(gm.getByTestId("combat-measure")).toHaveCount(0);

    // Names: token names always shown (per viewer).
    const names = dock.getByRole("button", { name: "Names" });
    const before = await names.getAttribute("aria-pressed");
    await press(names);
    await expect(names).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
    await expect(gm.getByTestId("combat-viewport")).toHaveClass(before === "true" ? /^((?!names).)*$/ : /\bnames\b/);
    await press(names);
    await expect(names).toHaveAttribute("aria-pressed", before ?? "false");

    // Zoom in changes the %, the % fits the map again, Zoom out zooms out.
    const pct = dock.getByRole("button", { name: "Fit the map to the screen" });
    const fitted = (await pct.textContent())!;
    await press(dock.getByRole("button", { name: "Zoom in" }));
    await expect(pct).not.toHaveText(fitted);
    await press(pct);
    await expect(pct).toHaveText(fitted);
    await press(dock.getByRole("button", { name: "Zoom out" }));
    await expect(pct).not.toHaveText(fitted);
    await press(pct);
    await expect(pct).toHaveText(fitted);

    // Dice: the dice box above the dock (the GM's own roller); Escape closes it and the focus comes back.
    const dice = dock.getByRole("button", { name: "Dice" });
    await press(dice);
    await expect(dice).toHaveAttribute("aria-expanded", "true");
    const dicePop = gm.getByRole("dialog", { name: "Dice" });
    await expect(dicePop.getByTestId("hud-gm-roller")).toBeVisible();
    await expectNoSeriousA11yViolations(gm);
    await gm.screenshot({ path: "test-results/visual/HUD-H9.0/gm-dice-1440.png", animations: "disabled" });
    await dicePop.press("Escape");
    await expect(dicePop).toHaveCount(0);
    await expect(dice).toBeFocused();

    // Fog: the vision and fog card; opening Areas closes it (one panel at a time).
    const fog = dock.getByRole("button", { name: "Fog" });
    await press(fog);
    const fogPop = gm.getByRole("dialog", { name: "Vision and fog" });
    await expect(fogPop.getByRole("group", { name: "Fog brush" })).toBeVisible();
    const areas = dock.getByRole("button", { name: "Areas" });
    await press(areas);
    await expect(areas).toHaveAttribute("aria-pressed", "true");
    await expect(fogPop).toHaveCount(0);
    const areasPanel = gm.getByRole("dialog", { name: "Areas" });
    await expect(areasPanel).toBeVisible();
    await areasPanel.press("Escape");
    await expect(areasPanel).toHaveCount(0);
    await expect(areas).toHaveAttribute("aria-pressed", "false");

    // Log: Resolutions with Undo above the dock on the right; Escape closes it and the focus comes back.
    const log = dock.getByRole("button", { name: "Log" });
    await press(log);
    await expect(log).toHaveAttribute("aria-pressed", "true");
    const resolutions = gm.getByTestId("hud-log");
    await expect(resolutions.getByRole("heading", { name: "Resolutions" })).toBeVisible();
    await gm.screenshot({ path: "test-results/visual/HUD-H9.0/gm-log-1440.png", animations: "disabled" });
    await log.press("Escape");
    await expect(resolutions).toHaveCount(0);
    await expect(log).toBeFocused();

    // Player view: the existing menu, opening upward; Escape closes it.
    const pv = dock.getByRole("button", { name: /Player view/ });
    await press(pv);
    const menu = gm.getByRole("menu", { name: "Open the player view as" });
    await expect(menu.getByRole("menuitemradio", { name: "GM (everything)" })).toBeVisible();
    await pv.press("Escape");
    await expect(menu).toHaveCount(0);

    // End scene: the "End the scene?" confirm; Keep playing ends nothing.
    await press(dock.getByRole("button", { name: "End scene" }));
    const confirm = gm.getByRole("dialog", { name: "End the scene?" });
    await expect(confirm).toBeVisible();
    await expectNoSeriousA11yViolations(gm);
    await press(confirm.getByRole("button", { name: "Keep playing" }));
    await expect(confirm).toBeHidden();
  } finally {
    await s.close();
  }
});

test("Measure: the GM and a player each see the range band on their own screen", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    for (const page of [gm, player]) {
      await openHud(page, s.url, DESKTOP);
      const controls = page.getByRole("toolbar", { name: "Map controls" });
      await press(controls.getByRole("button", { name: "Measure" }));
      const layer = page.getByTestId("combat-measure");
      await expect(layer).toBeVisible();
      const zoom = Number.parseInt((await controls.getByTestId("combat-zoom").textContent()) ?? "100", 10) / 100;
      const px = 48 * zoom;
      const stage = (await page.getByTestId("combat-stage").boundingBox())!;
      // The GM's stage is the map; a player's is padded with fog: measure from the viewport's middle, 7 squares east.
      const vp = (await page.getByTestId("combat-viewport").boundingBox())!;
      const sx = Math.floor((vp.x + vp.width / 2 - stage.x) / px);
      const sy = Math.floor((vp.y + vp.height / 2 - stage.y) / px);
      const from = { x: stage.x + (sx + 0.5) * px, y: stage.y + (sy + 0.5) * px };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 3.5 * px, from.y, { steps: 4 });
      await page.mouse.move(from.x + 7 * px, from.y, { steps: 4 });
      await page.mouse.up();
      const label = page.getByTestId("combat-measure-label");
      await expect(label).toHaveText(BAND);
      await expect(label).toHaveText("7 squares · Far");
      await page.screenshot({ path: `test-results/visual/HUD-H9.0/${page === gm ? "gm" : "player"}-measure-1440.png`, animations: "disabled" });
      // Back to Select: the measurement goes (nothing was saved).
      if (page === gm) await press(controls.getByRole("button", { name: "Select" }));
      else await press(controls.getByRole("button", { name: "Measure" }));
      await expect(layer).toHaveCount(0);
    }
    // The other screen never saw it.
    await expect(player.getByTestId("combat-measure-label")).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("tablet and sheet open: icons only, dock at left 342 / 640; axe at 1024 x 768", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    // Desktop with a sheet open: the dock centres on x = 640 and drops its labels.
    let hud = await openHud(gm, s.url, DESKTOP);
    const dock = gm.getByRole("toolbar", { name: "Map controls" });
    await gm.getByRole("list", { name: "The party" }).getByRole("button", { name: /^Open Moss/ }).click();
    await expect(hud).toHaveClass(/hud-sh-open/);
    await expect.poll(async () => Math.round((await boxIn(hud, dock)).centre)).toBe(640);
    const label = dock.getByRole("button", { name: "Dice" }).locator(".hud-dk-l");
    await expect.poll(async () => (await label.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await gm.screenshot({ path: "test-results/visual/HUD-H9.0/gm-sheet-1440.png", animations: "disabled" });

    // Tablet: icons only, bottom 12, 44 px targets; with the sheet open it centres on x = 342.
    hud = await openHud(gm, s.url, TABLET);
    await expect(dock).toBeVisible();
    await expect.poll(async () => Math.round((await boxIn(hud, dock)).bottom)).toBe(12);
    await expect.poll(async () => (await label.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
    await expectTouchTargets(dock.getByRole("button"));
    await expectNoSeriousA11yViolations(gm);
    await gm.screenshot({ path: "test-results/visual/HUD-H9.0/gm-dock-1024.png", animations: "disabled" });
    await press(dock.getByRole("button", { name: "Dice" }));
    await expect(gm.getByRole("dialog", { name: "Dice" })).toBeVisible();
    await expectNoSeriousA11yViolations(gm);
    await gm.getByRole("dialog", { name: "Dice" }).press("Escape");
    await gm.getByRole("list", { name: "The party" }).getByRole("button", { name: /^Open Moss/ }).click();
    await expect(hud).toHaveClass(/hud-sh-open/);
    await expect.poll(async () => Math.round((await boxIn(hud, dock)).centre)).toBe(342);

    // A player has no dock: their map controls (Measure, Names, zoom) sit in their title row.
    await openHud(player, s.url, TABLET);
    const controls = player.getByRole("toolbar", { name: "Map controls" });
    await expect(controls.getByRole("button")).toHaveCount(5);
    await expect(player.getByRole("button", { name: "Map tools" })).toHaveCount(0);
    await expectTouchTargets(controls.getByRole("button"));
    await expectNoSeriousA11yViolations(player);
    await player.screenshot({ path: "test-results/visual/HUD-H9.0/player-1024.png", animations: "disabled" });
  } finally {
    await s.close();
  }
});
