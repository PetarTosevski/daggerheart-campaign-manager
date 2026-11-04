import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "../a11y";
import { signInAsTestGm } from "../fixtures";
import { gmAndPlayer } from "../live";
import { convexAs } from "./helpers";

// Plan glass-buttons G6 (docs/tasks/TASK-GLASS-G6.md; E2E_VISUAL=1): the Codex and the World Map as the GM and as a
// player at 1440 x 900, 1024 x 768 and 390 x 844, plus the Horizon hex-crawl panels (GM). New entry / Send party /
// Save speeds = confirm, Cancel / Close / Undo / Done = cancel, Delete / Remove = danger, the map toolbar = tool (lit
// when on), the rest neutral. Map tokens, hexes, pins, terrain brushes and colour swatches keep their look. A hovered
// confirm and a keyboard-focused button pass axe; small buttons are 44 px at the touch breakpoint.

// A missing button fails in 30 s instead of hanging until the test's timeout.
test.use({ actionTimeout: 30_000 });

const OUT = "test-results/visual/GLASS-G6";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

const HOPE_RIM = "rgb(227, 180, 90)"; // --gb-hope
const FEAR_RIM = "rgb(143, 123, 209)"; // --gb-fear

async function shoot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", fullPage });
}

/** Keyboard focus on `locator` (Tab into it, so :focus-visible applies). */
async function keyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(locator).toBeFocused();
  await page.waitForTimeout(400);
}

async function expectAtLeast44(buttons: Locator[]) {
  for (const button of buttons) {
    const box = await button.boundingBox();
    expect(box, (await button.textContent()) ?? "").not.toBeNull();
    expect(box!.height, (await button.textContent()) ?? "").toBeGreaterThanOrEqual(44);
  }
}

const rim = (button: Locator) => button.evaluate((el) => getComputedStyle(el).boxShadow);

/** A small PNG drawn in the page (the gallery re-encodes it as JPEG). */
async function samplePng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(600, 400);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#3a5f6f";
    ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = "#e3b45a";
    ctx.beginPath();
    ctx.arc(300, 200, 120, 0, Math.PI * 2);
    ctx.fill();
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  return Buffer.from(base64, "base64");
}

test("GLASS-G6 the Codex as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId } = table;
  const npc = `Kreil ${crypto.randomUUID().slice(0, 4)}`;
  try {
    // The GM makes a character, gives it an image and reveals the image (which marks the entry known).
    await gm.goto(`/campaigns/${campaignId}/codex`);
    const newCharacter = gm.getByRole("button", { name: "+ New character" });
    await expect(newCharacter).toHaveClass(/\bgb-confirm\b/);
    await newCharacter.click();
    const detail = gm.getByRole("region", { name: "Entry detail" });
    const nameInput = detail.getByLabel("Name", { exact: true });
    await expect(nameInput).toHaveValue("");
    await nameInput.fill(npc);
    await nameInput.press("Tab");
    await expect(gm.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: new RegExp(npc) })).toBeVisible();
    await detail.locator('input[type="file"]').setInputFiles({ name: "npc.png", mimeType: "image/png", buffer: await samplePng(gm) });
    await detail.getByRole("button", { name: "🔒 Hidden" }).click();
    await expect(detail.getByRole("button", { name: "👁 Revealed" })).toHaveAttribute("aria-pressed", "true");
    await expect(detail.getByRole("button", { name: "👁 Known to players" })).toHaveAttribute("aria-pressed", "true");

    // Roles on the GM's side.
    await expect(gm.getByRole("button", { name: "👁 Player view" })).toHaveClass(/\bgb-neutral\b/);
    await expect(detail.getByRole("button", { name: "Delete", exact: true })).toHaveClass(/\bgb-danger\b/);
    await expect(detail.getByRole("button", { name: "Delete image" })).toHaveClass(/\bgb-danger\b/);
    await expect(detail.getByRole("button", { name: "Use as the main picture" })).toHaveClass(/\bgb-neutral\b/);
    await expect(detail.getByRole("button", { name: "👁 Revealed" })).toHaveClass(/\bgb-neutral\b/);
    // The confirm follows the viewer: Fear rim for the GM.
    expect(await rim(newCharacter)).toContain(FEAR_RIM);

    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await gm.goto(`/campaigns/${campaignId}/codex`);
      await gm.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: new RegExp(npc) }).click();
      await expect(detail.getByRole("button", { name: "👁 Revealed" })).toBeVisible();
      await shoot(gm, `codex-gm-${viewport.width}`);
      if (viewport.width <= 1100) {
        await expectAtLeast44([detail.getByRole("button", { name: "👁 Revealed" }), detail.getByRole("button", { name: "Delete image" })]);
      }
    }

    await gm.setViewportSize(VIEWPORTS[0]);
    // A hovered confirm, then a keyboard-focused switch; both pass axe.
    await newCharacter.hover();
    await gm.waitForTimeout(400);
    await shoot(gm, "codex-gm-hover-confirm", false);
    await expectNoSeriousA11yViolations(gm, { include: "main" });
    await gm.mouse.move(0, 0);
    await keyboardFocus(gm, detail.getByRole("button", { name: "👁 Known to players" }));
    await shoot(gm, "codex-gm-focus-known", false);
    await expectNoSeriousA11yViolations(gm, { include: "main" });

    // The image tile's tools hovered (the delete two-tap's first tap shows "Sure?").
    const tile = detail.getByRole("button", { name: "Delete image" });
    await tile.click();
    await expect(detail.getByRole("button", { name: "Click again to delete this image" })).toHaveText("Sure?");
    await detail.getByRole("button", { name: "Click again to delete this image" }).hover();
    await gm.waitForTimeout(400);
    await detail.getByRole("heading", { name: "Images" }).locator("xpath=../..").screenshot({ path: `${OUT}/codex-gm-gallery-sure.png` });
    await expectNoSeriousA11yViolations(gm, { include: "main" });

    // The entry's Delete two-tap, hovered.
    await detail.getByRole("button", { name: "Delete", exact: true }).click();
    const sure = detail.getByRole("button", { name: "Click again to delete", exact: true });
    await expect(sure).toHaveClass(/\bgb-danger\b/);
    await sure.hover();
    await gm.waitForTimeout(400);
    await shoot(gm, "codex-gm-hover-delete", false);
    await expectNoSeriousA11yViolations(gm, { include: "main" });

    // The lightbox: ‹ › neutral, Close cancel (Hope for the GM).
    await gm.goto(`/campaigns/${campaignId}/codex`);
    await gm.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: new RegExp(npc) }).click();
    // The tile opens from its upper part; the GM's tools cover the lower part.
    await detail.getByRole("button", { name: /^Open image of/ }).click({ position: { x: 20, y: 20 } });
    const lightbox = gm.getByRole("dialog", { name: npc });
    const close = lightbox.getByRole("button", { name: "Close · Esc" });
    await expect(close).toHaveClass(/\bgb-cancel\b/);
    expect(await rim(close)).toContain(HOPE_RIM);
    await expect(lightbox.getByRole("button", { name: "Next image" })).toHaveClass(/\bgb-neutral\b/);
    await shoot(gm, "codex-gm-lightbox", false);
    await close.click();

    // A location and its pin picker (Cancel = cancel).
    await gm.getByRole("tab", { name: /^Locations/ }).click();
    await gm.getByRole("button", { name: "+ New location" }).click();
    await expect(gm.getByRole("button", { name: "📍 From map" })).toHaveClass(/\bgb-neutral\b/);
    await detail.getByRole("button", { name: "📍 Link to map pin" }).click();
    const picker = gm.getByRole("dialog", { name: /on the map$/ });
    await expect(picker.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
    await shoot(gm, "codex-gm-pin-picker", false);
    await picker.getByRole("button", { name: "Cancel" }).click();

    // The player: the known character, its revealed image and the lightbox (Close = cancel, Fear for a player).
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      await player.goto(`/campaigns/${campaignId}/codex`);
      await player.getByRole("complementary", { name: "Entries" }).getByRole("button", { name: new RegExp(npc) }).click();
      await expect(player.getByRole("button", { name: /^Open image of/ })).toBeVisible();
      await shoot(player, `codex-player-${viewport.width}`);
    }
    await player.setViewportSize(VIEWPORTS[0]);
    await player.getByRole("button", { name: /^Open image of/ }).click();
    const playerClose = player.getByRole("dialog", { name: npc }).getByRole("button", { name: "Close · Esc" });
    expect(await rim(playerClose)).toContain(FEAR_RIM);
    await keyboardFocus(player, playerClose);
    await shoot(player, "codex-player-lightbox-focus-close", false);
    await expectNoSeriousA11yViolations(player, { include: '[role="dialog"]' });
  } finally {
    await table.close();
  }
});

test("GLASS-G6 the World Map as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId } = table;
  try {
    await gm.goto(`/campaigns/${campaignId}/world`);
    const map = gm.getByRole("application", { name: /^Map of/ });
    await expect(map).toBeVisible();
    // A marker on the map, selected: the token panel's Send party (confirm) and Delete (danger).
    await gm.getByRole("complementary", { name: "Map tokens" }).getByRole("button", { name: "Village", exact: true }).click();
    await map.click({ position: { x: 320, y: 260 } });
    const editor = gm.getByRole("complementary", { name: "Selected token" });
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Village");
    const send = editor.getByRole("button", { name: "Send party here" });
    await expect(send).toHaveClass(/\bgb-confirm\b/);
    await expect(editor.getByRole("button", { name: "Delete" })).toHaveClass(/\bgb-danger\b/);
    expect(await rim(send)).toContain(FEAR_RIM);
    await expect(gm.getByRole("button", { name: "Zoom in" })).toHaveClass(/\bgb-tool\b/);
    await expect(gm.getByRole("button", { name: /Measure/ })).toHaveClass(/\bgb-tool\b/);
    await expect(gm.getByRole("complementary", { name: "Map tokens" }).getByRole("button", { name: "Village", exact: true })).toHaveClass(/\bgb-tool\b/);

    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await map.scrollIntoViewIfNeeded();
      await shoot(gm, `world-gm-${viewport.width}`);
      if (viewport.width <= 1100) {
        await expectAtLeast44([
          gm.getByRole("button", { name: "Zoom in" }),
          gm.getByRole("button", { name: "Rename Village" }),
          gm.getByRole("button", { name: "Edit speeds…" }),
        ]);
      }
    }
    await gm.setViewportSize(VIEWPORTS[0]);

    // A hovered confirm (Send party here) and a keyboard-focused tool with its tooltip; both pass axe.
    await send.hover();
    await gm.waitForTimeout(400);
    await editor.screenshot({ path: `${OUT}/world-gm-hover-send.png` });
    await expectNoSeriousA11yViolations(gm, { include: "main" });
    await gm.mouse.move(0, 0);
    await keyboardFocus(gm, gm.getByRole("button", { name: "Zoom in" }));
    await shoot(gm, "world-gm-focus-zoom-tip", false);
    await expectNoSeriousA11yViolations(gm, { include: "main" });

    // Paint: the toolbar (brush sizes = tool, Undo stroke / Done = cancel, Reset = neutral); Paint is lit.
    await gm.getByRole("button", { name: /Paint/ }).click();
    await expect(gm.getByRole("button", { name: /Paint/ })).toHaveAttribute("aria-pressed", "true");
    const brushes = gm.getByRole("toolbar", { name: "Terrain brushes" });
    await expect(brushes.getByRole("button", { name: "Done" })).toHaveClass(/\bgb-cancel\b/);
    await expect(brushes.getByRole("button", { name: /Undo stroke/ })).toHaveClass(/\bgb-cancel\b/);
    await expect(brushes.getByRole("button", { name: /^Brush size/ }).first()).toHaveClass(/\bgb-tool\b/);
    await brushes.getByRole("button", { name: "Reset to suggested" }).hover();
    await gm.waitForTimeout(400);
    await shoot(gm, "world-gm-paint", false);
    await expectNoSeriousA11yViolations(gm, {
      include: "main",
      exclude: ".brush",
      reason: "the terrain brushes are terrain colour swatches (white text on the paint colour), unchanged by G6 and out of its scope; their contrast is filed separately",
    });
    await brushes.getByRole("button", { name: "Done" }).click();

    // Measure: the route panel (modes = neutral switches, Move party along route = confirm, Done = cancel).
    await gm.getByRole("button", { name: /Measure/ }).click();
    const route = gm.getByRole("region", { name: "Measure and plan a route" });
    await route.getByRole("button", { name: "Waypoints" }).click();
    await expect(route.getByRole("button", { name: "Waypoints" })).toHaveAttribute("aria-pressed", "true");
    await map.click({ position: { x: 200, y: 200 } });
    await map.click({ position: { x: 420, y: 320 } });
    await expect(route.getByRole("button", { name: "Move party along route" })).toHaveClass(/\bgb-confirm\b/);
    await expect(route.getByRole("button", { name: "Done" })).toHaveClass(/\bgb-cancel\b/);
    await route.screenshot({ path: `${OUT}/world-gm-measure.png` });
    for (const viewport of VIEWPORTS.slice(1)) {
      await gm.setViewportSize(viewport);
      await route.scrollIntoViewIfNeeded();
      await route.screenshot({ path: `${OUT}/world-gm-measure-${viewport.width}.png` });
      await expectAtLeast44([route.getByRole("button", { name: "Waypoints" }), route.getByRole("button", { name: "Done" })]);
    }
    await gm.setViewportSize(VIEWPORTS[0]);
    await route.getByRole("button", { name: "Done" }).click();

    // The speeds dialog: Restore = neutral, Save speeds = confirm.
    await gm.getByRole("button", { name: "Edit speeds…" }).click();
    const rules = gm.getByRole("dialog", { name: "Travel speeds" });
    await expect(rules.getByRole("button", { name: "Save speeds" })).toHaveClass(/\bgb-confirm\b/);
    await rules.getByRole("button", { name: "Save speeds" }).hover();
    await gm.waitForTimeout(400);
    await rules.screenshot({ path: `${OUT}/world-gm-speeds-hover-save.png` });
    await expectNoSeriousA11yViolations(gm, { include: "dialog[open]" });
    await gm.keyboard.press("Escape");

    // The player: the map toolbar only (tools), in the player's colours.
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      await player.goto(`/campaigns/${campaignId}/world`);
      await expect(player.getByRole("application", { name: /^Map of/ })).toBeVisible();
      await shoot(player, `world-player-${viewport.width}`);
    }
    await player.setViewportSize(VIEWPORTS[0]);
    await expect(player.getByRole("button", { name: "Fit map" })).toHaveClass(/\bgb-tool\b/);
    await player.getByRole("button", { name: /Measure/ }).click();
    const playerRoute = player.getByRole("region", { name: "Measure and plan a route" });
    const playerDone = playerRoute.getByRole("button", { name: "Done" });
    expect(await rim(playerDone)).toContain(FEAR_RIM);
    await keyboardFocus(player, playerDone);
    await shoot(player, "world-player-focus-done", false);
    await expectNoSeriousA11yViolations(player, { include: "main" });
  } finally {
    await table.close();
  }
});

test("GLASS-G6 the Horizon hex-crawl panels (GM)", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  const { campaignId } = await client.mutation(api.campaigns.create, {
    frameId: "journey-to-horizon",
    name: `Horizon ${crypto.randomUUID().slice(0, 6)}`,
    idempotencyKey: crypto.randomUUID(),
  });
  const id = campaignId as Id<"campaigns">;
  await client.mutation(api.maps.addToken, { campaignId: id, type: "sanctuary", x: 50, y: 50, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.maps.placePartyHex, { campaignId: id, q: 0, r: 0 });

  await page.goto(`/campaigns/${id}/world`);
  const panel = page.getByRole("region", { name: "Regions & Soul Echoes" });
  await panel.getByRole("checkbox", { name: "Sanctuary: Soul Echo" }).click();
  await expect(panel.getByRole("button", { name: "Collect the Echo" })).toHaveClass(/\bgb-confirm\b/);
  await expect(panel.getByRole("button", { name: "Locate Soul Echoes" })).toHaveClass(/\bgb-neutral\b/);
  await panel.getByLabel("New region name").fill("Ashen Wood");
  await panel.getByRole("button", { name: "Generate region" }).click();
  const region = panel.getByRole("list", { name: "Regions" }).getByRole("listitem").filter({ hasText: "Ashen Wood" });
  await expect(region).toContainText(/of \d+ hexes/);
  await region.locator("summary").click();
  await expect(region.getByRole("button", { name: "Remove region" })).toHaveClass(/\bgb-danger\b/);
  await expect(page.getByRole("button", { name: /Hex grid/ })).toHaveClass(/\bgb-tool\b/);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(`/campaigns/${id}/world`);
    await expect(panel).toBeVisible();
    await shoot(page, `horizon-gm-${viewport.width}`);
  }
  await page.setViewportSize(VIEWPORTS[0]);
  await panel.getByRole("button", { name: "Generate region" }).hover();
  await page.waitForTimeout(400);
  await panel.screenshot({ path: `${OUT}/horizon-gm-hover-generate.png` });
  await expectNoSeriousA11yViolations(page, { include: "main" });
});
