import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "../a11y";
import { hudScene, HUD_MAP_W } from "../hud/helpers";

// Shots for docs/tasks/TASK-GLASS-G10.md (E2E_VISUAL=1): the Combat Map's edit side as glass buttons. The GM's Edit
// mode (Maps, the Play / Edit switch, Scene, Edit by hand, the selected object, the header tools) at 1440 x 900,
// 1024 x 768 and 390 x 844; the same column in the HUD's Map tools drawer in Play, the Fog pop-over's vision card and
// the sprite packs page; the player's "Your character" drawer (view card, token card) at the three widths. A hovered
// confirm and a keyboard-focused tool, each with axe; 44 px at 1024 and 390. The HUD's own buttons (the dock, its
// "Player view") keep their look: the dock's Player view is not a glass button.

const OUT = "test-results/visual/GLASS-G10";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

/** A shot of a region (a Locator) or of the whole viewport (a Page; `fullPage` for the scrolled page). */
async function shoot(target: Locator | Page, name: string, fullPage = false) {
  if ("goto" in target) {
    await settle(target);
    await target.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage });
    return;
  }
  await settle(target.page());
  await target.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

/** Keyboard focus on `locator` (Tab into it, so :focus-visible applies). */
async function keyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(locator).toBeFocused();
  await page.waitForTimeout(400);
}

async function expectAtLeast44(buttons: Locator) {
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    const name = (await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "";
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
}

async function rimOf(button: Locator) {
  return button.evaluate((el) => getComputedStyle(el).getPropertyValue("--rim").trim());
}

async function hopeRim(page: Page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--gb-hope").trim());
}

test("GLASS-G10 the Combat Map's edit side, the Map tools drawer and the player's drawer", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(900_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId, mapId } = s;
  try {
    const { objectId: crate } = await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "crate", x: 4, y: 16 });
    expect(crate).toBeTruthy();

    // ── Play: the HUD's Map tools drawer holds the classic column (glass); the dock keeps the HUD's own buttons ──
    await gm.setViewportSize(VIEWPORTS[0]);
    await gm.goto(s.url);
    const dock = gm.getByRole("toolbar", { name: "Map controls" });
    await expect(dock).toBeVisible();
    const dockPv = dock.getByRole("button", { name: /Player view|Viewing as/ });
    await expect(dockPv).toHaveClass(/\bcm-pv-btn\b/);
    await expect(dockPv).not.toHaveClass(/\bgb\b/);
    await dock.getByRole("button", { name: "Map tools" }).click();
    const drawer = gm.getByRole("complementary", { name: "Map tools" });
    await expect(drawer.getByRole("heading", { name: "Maps" })).toBeVisible();
    const modeGroup = drawer.getByRole("group", { name: "Map mode" });
    await expect(modeGroup.getByRole("button", { name: /Play/ })).toHaveClass(/\bgb-neutral\b/);
    await expect(modeGroup.getByRole("button", { name: /Play/ })).toHaveAttribute("aria-pressed", "true");
    await expect(drawer.getByRole("button", { name: "＋ New map" })).toHaveClass(/\bgb-neutral\b.*\bgb-sm\b/);
    await expect(drawer.getByRole("button", { name: "Delete", exact: true })).toHaveClass(/\bgb-danger\b/);
    await expect(drawer.getByRole("button", { name: "Spend a Fear" })).toHaveClass(/\bgb-neutral\b.*\bgb-icon\b/);
    await expect(drawer.getByRole("button", { name: /Player view|Viewing as/ })).toHaveClass(/\bgb-neutral\b/);
    await expect(drawer.getByRole("button", { name: "Clear tokens" })).toHaveClass(/\bgb-danger\b/);
    await expect(drawer.getByRole("button", { name: "Sprite packs" })).toHaveCount(0);
    await expect(drawer.getByRole("link", { name: "Sprite packs" })).toHaveClass(/\bgb-neutral\b/);
    await shoot(gm, "tools-gm-1440");
    await expectNoSeriousA11yViolations(gm);
    await drawer.press("Escape");
    await expect(drawer).toHaveCount(0);

    // The Fog pop-over: the classic vision card inside the HUD (fog brush tools, Clear marks / Forget explored).
    await dock.getByRole("button", { name: "Fog" }).click();
    const fogPop = gm.getByRole("dialog", { name: "Vision and fog" });
    const fogBrush = fogPop.getByRole("group", { name: "Fog brush" });
    await expect(fogBrush).toBeVisible();
    await expect(fogBrush.getByRole("button").first()).toHaveClass(/\bgb-tool\b/);
    await expect(fogPop.getByRole("button", { name: "Forget explored" })).toHaveClass(/\bgb-danger\b/);
    await shoot(fogPop, "fog-pop-gm");
    await expectNoSeriousA11yViolations(gm);
    await fogPop.press("Escape");

    // ── Edit: the classic two-column layout ──
    await dock.getByRole("button", { name: "Map tools" }).click();
    await gm.getByRole("complementary", { name: "Map tools" }).getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
    const column = gm.getByRole("complementary", { name: "Map tools" });
    await expect(column.getByRole("heading", { name: "Scene" })).toBeVisible();
    const editCard = column.getByRole("region", { name: "Edit by hand" });
    await expect(editCard).toBeVisible();
    const tools = editCard.getByRole("group", { name: "Edit tool" });
    await tools.getByRole("button", { name: /Terrain/ }).click();
    await expect(tools.getByRole("button", { name: /Terrain/ })).toHaveClass(/\bgb-tool\b/);
    await expect(tools.getByRole("button", { name: /Terrain/ })).toHaveAttribute("aria-pressed", "true");
    await expect(editCard.getByRole("button", { name: "stone", exact: true })).toHaveClass(/\bgb-tool\b/);
    await expect(editCard.getByRole("button", { name: "Brush 1 × 1 squares" })).toHaveClass(/\bgb-tool\b.*\bgb-icon\b/);
    await expect(column.getByRole("button", { name: "✦ Generate map" })).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await expect(column.getByRole("heading", { name: "Scene" })).toBeVisible();
      await shoot(gm, `edit-gm-${viewport.width}`);
      await shoot(gm, `edit-gm-${viewport.width}-full`, true);
      if (viewport.width < 1440) await expectAtLeast44(gm.locator(".cm-root button.gb"));
    }
    await gm.setViewportSize(VIEWPORTS[0]);

    // The GM's confirm wears Fear (purple), not the player's Hope gold; Stop / Done are cancel.
    const confirm = column.getByRole("button", { name: "✦ Generate map" });
    await expect(confirm).toHaveClass(/\bgb-confirm\b/);
    expect(await rimOf(confirm)).not.toBe(await hopeRim(gm));

    // A hovered confirm and a keyboard-focused tool, axe on both.
    const sceneCard = column.getByRole("region", { name: "Scene" });
    await sceneCard.getByRole("textbox").first().fill("A ruined watchtower on a hill, rain");
    await confirm.scrollIntoViewIfNeeded();
    await confirm.hover();
    await shoot(sceneCard, "scene-gm-hover-confirm");
    await expectNoSeriousA11yViolations(gm);
    await gm.mouse.move(0, 0);
    await keyboardFocus(gm, tools.getByRole("button", { name: /Objects/ }));
    await shoot(editCard, "edit-gm-focus-tool");
    await expectNoSeriousA11yViolations(gm);

    // The selected object: sight switch, Smaller / Bigger / rotate, Done = cancel, Delete = danger.
    await tools.getByRole("button", { name: /Objects/ }).click();
    await gm.evaluate(() => window.scrollTo(0, 0));
    await gm.getByTestId("combat-stage").scrollIntoViewIfNeeded();
    const box = (await gm.getByTestId("combat-stage").boundingBox())!;
    const step = box.width / HUD_MAP_W;
    await gm.mouse.click(box.x + 4 * step, box.y + 16 * step);
    const objectCard = editCard.getByRole("group", { name: "Selected object: Crate" });
    await expect(objectCard).toBeVisible();
    await expect(objectCard.getByRole("button", { name: "Done" })).toHaveClass(/\bgb-cancel\b/);
    await expect(objectCard.getByRole("button", { name: "Delete" })).toHaveClass(/\bgb-danger\b/);
    await expect(objectCard.getByRole("button", { name: "Rotate left" })).toHaveClass(/\bgb-neutral\b.*\bgb-icon\b/);
    await objectCard.scrollIntoViewIfNeeded();
    await objectCard.getByRole("button", { name: "Delete" }).hover();
    await shoot(editCard, "object-gm-hover-delete");
    await expectNoSeriousA11yViolations(gm);
    await gm.mouse.move(0, 0);

    // The map's own toolbar in Edit: zoom and Names are tools.
    await expect(gm.getByRole("button", { name: "Zoom in" })).toHaveClass(/\bgb-tool\b/);
    await expect(gm.getByRole("button", { name: "Aa Names" })).toHaveClass(/\bgb-tool\b/);

    // ── The sprite packs page ──
    await gm.goto(`/campaigns/${campaignId}/combat-map/packs`);
    await expect(gm.getByRole("heading", { level: 1, name: "Sprite packs" })).toBeVisible();
    await expect(gm.getByRole("link", { name: "← Combat Map" })).toHaveClass(/\bgb-cancel\b/);
    await expect(gm.getByRole("button", { name: "Create pack" })).toHaveClass(/\bgb-confirm\b/);
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await shoot(gm, `packs-gm-${viewport.width}`);
    }
    await gm.setViewportSize(VIEWPORTS[0]);
    await expectNoSeriousA11yViolations(gm);

    // ── The player: "Your character" holds the view card and the token card (player colours) ──
    await player.goto(s.url);
    const mine = s.pcs[0]!;
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      await player.goto(s.url);
      await player.getByRole("button", { name: "Your character", exact: true }).click();
      const yours = player.getByRole("complementary", { name: "Your character" });
      await expect(yours.getByRole("region", { name: "Your view" })).toBeVisible();
      await expect(yours.getByRole("button", { name: "Find me" })).toHaveClass(/\bgb-neutral\b/);
      if (viewport.width === 1440) {
        await yours.getByRole("button", { name: "Find me" }).click();
        await expect(yours.getByRole("button", { name: "Turn left" })).toHaveClass(/\bgb-neutral\b.*\bgb-icon\b/);
      }
      await shoot(player, `drawer-player-${viewport.width}`);
      if (viewport.width < 1440) await expectAtLeast44(yours.locator("button.gb"));
      await expectNoSeriousA11yViolations(player);
    }
    // The player's drawer sits under the HUD's data-viewer="player": confirm gold, cancel purple.
    await expect(player.getByTestId("combat-hud")).toHaveAttribute("data-viewer", "player");
    expect(mine.name).toBe("Moss");
  } finally {
    await s.close();
  }
});
