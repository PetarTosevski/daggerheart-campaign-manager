import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { HUD_MAP_W, hudScene } from "./hud/helpers";

// Plan combat-hud H5.3 (docs/tasks/TASK-HUD-H5.3.md; GMDesktop 'Areas' and 'End scene', CmpPromptsGM 'End the
// scene?'): with the HUD on, the GM's Areas (the dock, H9.0) opens "Areas on the map" at the bottom right above the dock (H9.2) (draw, list, remove); End
// scene asks "End the scene?" naming what ends (combatHud.sceneEndPreview) and Keep playing ends nothing. The
// "Spend n Fear?" card (FearConfirm) has no live host until H5.2's stat block; tests/unit/hud/fear-confirm.test.tsx
// covers it.

/** The on-screen size of one square (client px), from the stage's box. */
async function squareOnScreen(page: Page): Promise<{ x: number; y: number; px: number }> {
  const box = (await page.getByTestId("combat-stage").boundingBox())!;
  return { x: box.x, y: box.y, px: box.width / HUD_MAP_W };
}

test("the GM's Areas panel draws and lists areas; End scene names what ends and asks first", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId } = s;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }
    // Players have neither Areas nor End scene.
    const playerTools = player.getByRole("group", { name: "Your tools" });
    await expect(playerTools.getByRole("button", { name: "Sheet" })).toBeVisible();
    await expect(playerTools.getByRole("button", { name: "Areas", exact: true })).toHaveCount(0);
    await expect(playerTools.getByRole("button", { name: "End scene" })).toHaveCount(0);

    // The dock's Areas opens "Areas on the map" bottom right above the dock (plan combat-hud H9.2, GMDesktop `.gmc .ar`:
    // right 182, bottom 80, 360 wide).
    const tools = gm.getByRole("toolbar", { name: "Map controls" });
    const areasButton = tools.getByRole("button", { name: "Areas", exact: true });
    await areasButton.click();
    await expect(areasButton).toHaveAttribute("aria-pressed", "true");
    const panel = gm.getByRole("dialog", { name: "Areas" });
    await expect(panel.getByRole("heading", { name: "Areas on the map" })).toBeVisible();
    await expect(panel).toContainText("No live area on this map.");
    const box = (await panel.boundingBox())!;
    const root = (await gm.getByTestId("combat-hud").boundingBox())!;
    expect(Math.round(root.x + root.width - (box.x + box.width))).toBe(182);
    expect(Math.round(root.y + root.height - (box.y + box.height))).toBe(80);
    expect(Math.round(box.width)).toBe(360);
    await test.info().attach("gm-areas-panel", { body: await gm.screenshot(), contentType: "image/png" });

    // Draw "Smoke" (a circle, Close, blocks sight) on a square; it lists with its line.
    await panel.getByLabel("Name").fill("Smoke");
    await panel.getByRole("button", { name: "Pick on the map" }).click();
    await expect(gm.getByTestId("area-pick-banner")).toContainText("click a square on the map");
    const at = await squareOnScreen(gm);
    await gm.mouse.click(at.x + 14.5 * at.px, at.y + 6.5 * at.px);
    await expect(gm.getByTestId("area-pick-result")).toHaveText(/Smoke drawn\./);
    const row = panel.getByTestId("area-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Smoke");
    await expect(row).toContainText(/Circle · radius Close · blocks sight · \S+/);
    // Done with it (a press on the map): the panel folds to its header bar, clear of the tokens under it (user answer
    // 2026-11-02, dcm-bxp.99.32.28); the header unfolds it.
    const fold = panel.getByRole("button", { name: "Areas on the map" });
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(row).toBeHidden();
    const folded = (await panel.boundingBox())!;
    expect(folded.height).toBeLessThan(80);
    await fold.click();
    await expect(row).toBeVisible();
    await expectNoSeriousA11yViolations(gm);

    // End scene asks first and names what ends (the drawn area lasts until the scene).
    await tools.getByRole("button", { name: "End scene" }).click();
    const confirm = gm.getByRole("dialog", { name: "End the scene?" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Forest Camp");
    await expect(confirm.getByTestId("hud-end-scene-text")).toContainText("Effects that last “until the end of the scene” end: Smoke.");
    await expect(confirm).toContainText("Fear, Hope, HP and Stress stay as they are.");
    await expectNoSeriousA11yViolations(gm);

    // Keep playing ends nothing.
    await confirm.getByRole("button", { name: "Keep playing" }).click();
    await expect(confirm).toBeHidden();
    if ((await areasButton.getAttribute("aria-pressed")) !== "true") await areasButton.click();
    await expect(row).toHaveCount(1);
    expect(await client.query(api.combatAreas.list, { campaignId, mapId: s.mapId })).toHaveLength(1);

    // End the scene: the area closes and the dock reports it. (The dock's End scene closes any other GM panel, one at a
    // time, H9.0: Areas reopens from the dock.)
    await tools.getByRole("button", { name: "End scene" }).click();
    await confirm.getByRole("button", { name: "End the scene" }).click();
    await expect(confirm).toBeHidden();
    await expect(tools.getByTestId("end-scene-status")).toContainText("1 map area closed");
    await expect.poll(() => client.query(api.combatAreas.list, { campaignId, mapId: s.mapId })).toEqual([]);
    if ((await areasButton.getAttribute("aria-pressed")) !== "true") await areasButton.click();
    await expect(panel).toContainText("No live area on this map.");

    // With nothing left, the confirm says so.
    await tools.getByRole("button", { name: "End scene" }).click();
    await expect(confirm.getByTestId("hud-end-scene-text")).toContainText("Nothing lasts “until the end of the scene” right now.");
    await confirm.press("Escape");
    await expect(confirm).toBeHidden();

    // ✕ closes the panel and focus returns to the dock's Areas (H9.2: through hud/panels.ts).
    if ((await areasButton.getAttribute("aria-pressed")) !== "true") await areasButton.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close Areas" }).click();
    await expect(panel).toHaveCount(0);
    await expect(areasButton).toBeFocused();
  } finally {
    await s.close();
  }
});
