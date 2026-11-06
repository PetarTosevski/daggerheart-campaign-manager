import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { HUD_MAP_W, hudScene } from "./hud/helpers";

// Plan combat-hud H2.2 (docs/tasks/TASK-HUD-H2.2.md): while a sheet is open the HUD makes room (Main / GMDesktop
// `.sh-open`; HANDOFF "Layout"; CmpTokensDesign "Motion"): the map's viewport shifts -125 px and scales to 94 % over
// 350 ms, the Fear banner moves to right 424, the disc hides, the hand's region starts at 330, the pop region ends at
// the panel, and the GM's title and tools hide. Another token swaps the sheet, the same one closes it. A token drag
// and an area pick land on the square under the pointer while the map is shifted. The HUD root carries
// `hud-sh-open`, never the party sheet's global `.sh-open` pill style (dcm-bxp.99.32.11).

const SHIFTED = "matrix(0.94, 0, 0, 0.94, -125, 0)";

/** The on-screen size of one square (client px), from the stage's box: zoom times any make-room scale. */
async function squareOnScreen(page: Page): Promise<{ x: number; y: number; px: number }> {
  const box = (await page.getByTestId("combat-stage").boundingBox())!;
  return { x: box.x, y: box.y, px: box.width / HUD_MAP_W };
}

async function dragBy(page: Page, locator: Locator, dx: number, dy: number) {
  const box = (await locator.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

test("the GM: a stat block makes room, swaps and closes; drag and area picking stay exact on the shifted map", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId } = s;
  try {
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    const hud = gm.getByTestId("combat-hud");
    await expect(hud).toBeVisible();
    const board = gm.getByRole("region", { name: "Battle map" });
    const viewport = gm.getByTestId("combat-viewport");
    const ltName = s.enemies.lieutenant.name;
    const lt = board.getByRole("button", { name: new RegExp(`^Open the ${ltName}’s stat block`) });
    const sniper = board.getByRole("button", { name: new RegExp(`^Open the ${s.enemies.sniper.name}’s stat block`) });
    await expect(lt).toBeVisible();
    await expect(viewport).toHaveCSS("transform", "none");
    await expect(viewport).toHaveCSS("transition-duration", "0.35s");

    // Open the Areas pop-over first (the dock's Areas, H9.0): it stays while a sheet is open.
    await gm.getByRole("toolbar", { name: "Map controls" }).getByRole("button", { name: "Areas", exact: true }).click();
    const areas = gm.getByRole("dialog", { name: "Areas" });
    await expect(areas.getByTestId("area-tools")).toBeVisible();

    // A click on the Lieutenant opens its stat block: the HUD makes room.
    await lt.click();
    await expect(hud).toHaveClass(new RegExp(`(^|\\s)hud-sh-open(\\s|$)`));
    await expect(hud).toHaveClass(new RegExp(`(^|\\s)hud-sh-${s.enemies.lieutenant.tokenId}(\\s|$)`));
    await expect(hud).not.toHaveClass(/(^|\s)sh-open(\s|$)/);
    await expect(viewport).toHaveCSS("transform", SHIFTED);
    await expect(gm.locator(".hud-fear")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -400, 0)");
    const fearBox = (await gm.locator(".hud-fb").boundingBox())!;
    expect(Math.round(1440 - (fearBox.x + fearBox.width))).toBe(424);
    await expect(gm.getByTestId("hud-disc")).toBeHidden();
    await expect(gm.getByTestId("hud-title")).toBeHidden();
    // The dock (H9.0) stays, icons only, beside the sheet.
    await expect(gm.getByRole("toolbar", { name: "Map controls" })).toBeVisible();
    await expect(gm.locator('[data-hud-region="hand"]')).toHaveCSS("left", "330px");
    await expect(gm.locator('[data-hud-region="pop"]')).toHaveCSS("right", "400px");
    await expect(areas).toBeVisible();
    await expect(hud).toHaveCSS("border-radius", "0px");
    await test.info().attach("gm-stat-block-open", { body: await gm.screenshot(), contentType: "image/png" });

    // A drag with the sheet open moves the token by the squares it moved on screen.
    const [lx, ly] = (await lt.getAttribute("data-square"))!.split(",").map(Number) as [number, number];
    const sq = await squareOnScreen(gm);
    expect(sq.px).toBeGreaterThan(20);
    await dragBy(gm, lt, 2 * sq.px, sq.px);
    await expect(lt).toHaveAttribute("data-square", `${lx + 2},${ly + 1}`);
    // A drag is not a click: the stat block stays open.
    await expect(hud).toHaveClass(new RegExp(`hud-sh-${s.enemies.lieutenant.tokenId}`));

    // The Areas panel folded to its header bar once focus left it for the map (user answer 2026-11-02,
    // dcm-bxp.99.32.28), so it no longer covers the tokens under it; its header unfolds it.
    const fold = areas.getByRole("button", { name: "Areas on the map" });
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(areas.getByTestId("area-tools")).toBeHidden();
    expect((await areas.boundingBox())!.height).toBeLessThan(80);
    await fold.click();
    await expect(areas.getByTestId("area-tools")).toBeVisible();

    // An area pick lands on the square under the pointer (viewport.toSquares under the transform).
    await areas.getByRole("button", { name: "Pick on the map" }).click();
    await expect(gm.getByTestId("area-pick-banner")).toContainText("click a square on the map");
    // Open map, clear of the HUD: the four party banners (238 px tall) cover the top rows down to about row 5 at
    // 1440, and a click there opens a sheet instead of picking.
    const target = { x: 17, y: 8 };
    const at = await squareOnScreen(gm);
    await gm.mouse.click(at.x + (target.x + 0.5) * at.px, at.y + (target.y + 0.5) * at.px);
    await expect(gm.getByTestId("area-pick-result")).toHaveText(/drawn\./);
    await expect
      .poll(() => client.query(api.combatAreas.list, { campaignId, mapId: s.mapId }))
      .toMatchObject([{ centre: { kind: "square", x: target.x, y: target.y } }]);

    // Close the Areas panel (H5.3 docks it bottom right, over the Sniper), then another token swaps the sheet; the same
    // one closes it and the map comes back.
    await areas.getByRole("button", { name: "Close Areas" }).click();
    await expect(areas).toBeHidden();
    await sniper.click();
    await expect(hud).toHaveClass(new RegExp(`hud-sh-${s.enemies.sniper.tokenId}`));
    await expect(hud).not.toHaveClass(new RegExp(`hud-sh-${s.enemies.lieutenant.tokenId}`));
    await expect(viewport).toHaveCSS("transform", SHIFTED);
    await expectNoSeriousA11yViolations(gm);
    await sniper.click();
    await expect(hud).not.toHaveClass(/hud-sh-open/);
    await expect(viewport).toHaveCSS("transform", "none");
    await expect(gm.locator(".hud-fear")).toHaveCSS("transform", "none");
    await expect(gm.getByTestId("hud-disc")).toBeVisible();
    await expect(gm.getByRole("toolbar", { name: "Map controls" })).toBeVisible();
    await expect(gm.locator('[data-hud-region="hand"]')).toHaveCSS("left", "330px");
    await expect(gm.locator('[data-hud-region="pop"]')).toHaveCSS("right", "0px");

    // Without the sheet a drag still moves by the squares on screen.
    const [mx, my] = (await lt.getAttribute("data-square"))!.split(",").map(Number) as [number, number];
    const plain = await squareOnScreen(gm);
    await dragBy(gm, lt, -plain.px, 0);
    await expect(lt).toHaveAttribute("data-square", `${mx - 1},${my}`);
  } finally {
    await s.close();
  }
});

test("a player: their sheet makes room without the party sheet's .sh-open style; no motion under reduced motion", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser);
  const { player } = s;
  try {
    await player.emulateMedia({ reducedMotion: "reduce" });
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    const hud = player.getByTestId("combat-hud");
    await expect(hud).toBeVisible();
    const viewport = player.getByTestId("combat-viewport");
    await expect(viewport).toHaveCSS("transition-duration", "0s");

    // The banner opens Moss’s sheet panel (H2.1); the root never takes the party sheet’s global .sh-open style.
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" }).click();
    await expect(player.getByTestId("hud-sheet-trackers")).toBeVisible();
    await expect(hud).toHaveClass(/(^|\s)hud-sh-open(\s|$)/);
    await expect(hud).not.toHaveClass(/(^|\s)sh-open(\s|$)/);
    // The root keeps its frame: no pill button style (dcm-bxp.99.32.11).
    await expect(hud).toHaveCSS("border-radius", "0px");
    await expect(hud).toHaveCSS("display", "block");
    await expect(hud).toHaveCSS("padding", "0px");
    // At once under reduced motion: no transition to wait for.
    await expect(viewport).toHaveCSS("transform", SHIFTED);
    await expect(player.locator(".hud-fear")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -400, 0)");
    await expect(player.locator(".hud-fear")).toHaveCSS("transition-duration", "0s");
    await expect(player.getByTestId("hud-disc")).toBeHidden();
    // The player's title and row fade while a sheet is open, as the GM's do (H9.3, scene.css; Main `.sh-open .title`).
    await expect(player.getByTestId("hud-title")).toBeHidden();
    await test.info().attach("player-sheet-open", { body: await player.screenshot(), contentType: "image/png" });

    await player.keyboard.press("Escape");
    await expect(player.getByTestId("hud-sheet")).toBeHidden();
    await expect(hud).not.toHaveClass(/hud-sh-open/);
    await expect(viewport).toHaveCSS("transform", "none");
    await expectNoSeriousA11yViolations(player);
  } finally {
    await s.close();
  }
});
