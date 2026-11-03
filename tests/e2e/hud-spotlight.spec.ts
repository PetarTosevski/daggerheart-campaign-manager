import { expect, test } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H1.S (docs/tasks/TASK-HUD-H1.S.md; user answer 1c): the GM takes the spotlight from the HUD's
// spotlight menu and the player's HUD shows the GM's turn ("The GM has the spotlight", "Reactions only until the
// spotlight comes back to you") without a reload; the GM hands it back to Moss and the notice goes away. Two browsers,
// switch on for both. axe passes on both views.

test("the GM takes the spotlight and hands it back; the player's HUD follows live", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await player.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    // At the start nobody in particular holds it: the player sees no GM's turn, the GM sees the menu.
    const menu = gm.getByRole("region", { name: "Spotlight" });
    await expect(menu).toContainText("The players have the spotlight.");
    await expect(player.getByTestId("hud-gm-turn")).toHaveCount(0);

    // The GM takes it.
    await menu.getByRole("button", { name: "Take the spotlight" }).click();
    await expect(menu).toContainText("You have the spotlight. The GM is making a move.");
    await expect(menu.getByRole("button", { name: "Take the spotlight" })).toHaveCount(0);

    // The player's HUD shows the GM's turn without a reload.
    const card = player.getByTestId("hud-gm-turn");
    await expect(card).toContainText("The GM has the spotlight");
    await expect(card).toContainText("The GM is making a move.");
    await expect(player.getByText("Reactions only until the spotlight comes back to you")).toBeVisible();
    await expect(player.getByRole("region", { name: "Spotlight" })).toHaveCount(0);
    await player.screenshot({ path: "test-results/visual/HUD-H1.S/player-gm-turn-1440.png", animations: "disabled" });
    await gm.screenshot({ path: "test-results/visual/HUD-H1.S/gm-holds-1440.png", animations: "disabled" });
    await expectNoSeriousA11yViolations(player);
    await expectNoSeriousA11yViolations(gm);

    // The GM hands it back to Moss: the notice leaves the player's screen.
    await menu.getByRole("group", { name: "Hand the spotlight back to" }).getByRole("button", { name: "Hand the spotlight to Moss" }).click();
    await expect(menu).toContainText("Moss has the spotlight.");
    await expect(player.getByTestId("hud-gm-turn")).toHaveCount(0);
    await expect(player.getByText("Reactions only until the spotlight comes back to you")).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Hand the spotlight to Moss" })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Take the spotlight" })).toBeVisible();
  } finally {
    await s.close();
  }
});

// Bead dcm-bxp.99.32.42 (user decision 2026-11-04): at 1440 px and wider the GM's spotlight panel sits top middle but
// starts below the toolbar row, so it covers neither the map's own toolbar (Zoom, Fit, Names, Areas) nor the "Player
// view" button and its menu; below 1440 px it sits in the left column with the queue.
test("the GM's spotlight panel: below the toolbars at 1440 × 900, in the left column at 1280 × 720", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { gm } = s;
  const OUT = "test-results/visual/HUD-spot-placement";
  type Box = { x: number; y: number; width: number; height: number };
  const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    const panel = gm.getByRole("region", { name: "Spotlight" });
    await expect(panel).toContainText("The players have the spotlight.");
    await expect(gm.locator("[data-hud-region=scene]").getByRole("region", { name: "Spotlight" })).toHaveCount(1);
    await gm.screenshot({ path: `${OUT}/gm-1440x900.png`, animations: "disabled" });

    const toolbar = gm.locator(".hud-map .cm-toolbar");
    const pvButton = gm.getByRole("button", { name: /Player view/ });
    const covered = [
      toolbar.getByRole("button", { name: "Zoom out" }),
      toolbar.getByRole("button", { name: "Zoom in" }),
      toolbar.getByRole("button", { name: "Fit" }),
      toolbar.getByRole("button", { name: /Names/ }),
      toolbar.getByRole("button", { name: "Areas" }),
      pvButton,
    ];
    let box = (await panel.boundingBox())!;
    for (const control of covered) {
      if ((await control.count()) === 0) continue;
      const b = (await control.boundingBox())!;
      expect(intersects(box, b), `the spotlight panel covers ${await control.textContent()}`).toBe(false);
    }
    // Top middle, below the map's toolbar row.
    const tb = (await toolbar.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(tb.y + tb.height);
    expect(box.x).toBeGreaterThan(400);

    // The open Player view menu lies over the panel: its items take clicks.
    await pvButton.click();
    const menu = gm.getByRole("menu", { name: "Open the player view as" });
    await expect(menu).toBeVisible();
    await gm.screenshot({ path: `${OUT}/gm-1440x900-player-view.png`, animations: "disabled" });
    await menu.getByRole("menuitemradio", { name: "Moss" }).click({ trial: true });
    await gm.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // 1280 × 720: in the left column, with the queue.
    await gm.setViewportSize({ width: 1280, height: 720 });
    await expect(gm.locator("[data-hud-region=left]").getByRole("region", { name: "Spotlight" })).toHaveCount(1);
    await expect(gm.locator("[data-hud-region=scene]").getByRole("region", { name: "Spotlight" })).toHaveCount(0);
    await expect(panel).toBeVisible();
    box = (await panel.boundingBox())!;
    const column = (await gm.locator("[data-hud-region=left]").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(column.x);
    expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width + 1);
    // The HUD is a screen tall under the campaign header: scrolled down, the whole panel shows above the map's bottom.
    await panel.scrollIntoViewIfNeeded();
    box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    await gm.screenshot({ path: `${OUT}/gm-1280x720.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
});
