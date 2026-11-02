import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H7.2 (docs/tasks/TASK-HUD-H7.2.md): at 390 px (board PlayerPhone; HANDOFF "Phone (390)") the player
// gets the mini banner strip with Fear across the top, the bottom sheet with the resource line, Sheet and the tabs
// Hand / Attack / Dice / Feed (each the HUD's own part), edge chips for off-screen targets during a pick and a
// full-screen sheet; the GM keeps the tablet layout with the request queue as a bottom sheet (answer 13a).

const PHONE = { width: 390, height: 844 };

const sheet = (page: Page) => page.getByTestId("hud-phone-sheet");

async function open(page: Page, url: string) {
  await page.setViewportSize(PHONE);
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible();
  // The HUD is viewport-tall under the campaign header: scroll so it fills the window.
  await page.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
}

test("the player at 390: strip with Fear, bottom sheet with resources and tabs, full-screen sheet, edge chips", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, pcs, enemies } = s;
  try {
    await open(player, s.url);
    const hud = player.getByTestId("combat-hud");
    await expect(hud).toHaveClass(/(^|\s)hud-ph-on(\s|$)/);

    // The strip: the four PCs (yours first) as buttons that open their sheets, then Fear, read only.
    const strip = player.getByTestId("hud-phone-strip");
    await expect(strip.getByRole("button", { name: /^Open .*'s sheet$/ })).toHaveCount(4);
    await expect(strip.getByRole("button").first()).toHaveAccessibleName("Open Moss's sheet");
    await expect(strip.getByRole("img", { name: /^GM Fear \d+$/ })).toBeVisible();
    // The desktop regions are not mounted on the phone.
    await expect(player.locator('[data-hud-region="banners"]')).toHaveCount(0);
    await expect(player.locator('[data-hud-region="hand"]')).toHaveCount(0);
    await expect(player.locator('[data-hud-region="fear"]')).toHaveCount(0);
    const stripBox = (await strip.boundingBox())!;
    expect(Math.round(stripBox.width)).toBe(390);
    expect(Math.round(stripBox.height)).toBe(104);

    // The bottom sheet starts folded: resources (read as marked), Sheet and the tabs; the map above stays reachable.
    const bs = sheet(player);
    await expect(bs).toBeVisible();
    await expect(bs).toHaveAttribute("data-open", "false");
    const res = player.getByTestId("hud-phone-resources");
    await expect(res.getByLabel(/^\d+ of \d+ Hit Points marked$/)).toBeVisible();
    await expect(res.getByLabel(/^\d+ of \d+ Stress marked$/)).toBeVisible();
    await expect(res.getByLabel(/^Hope \d+ of \d+$/)).toBeVisible();
    const tabs = bs.getByRole("tablist", { name: "Combat actions" });
    await expect(tabs.getByRole("tab")).toHaveText(["Hand", "Attack", "Dice", "Feed"]);
    expect((await bs.boundingBox())!.height).toBeLessThan(260);
    await expectNoSeriousA11yViolations(player);

    // Hand opens the 'Hand tab' (PlayerPhone): the hand's cards in a row.
    await tabs.getByRole("tab", { name: "Hand" }).click();
    await expect(bs).toHaveAttribute("data-open", "true");
    await expect(tabs.getByRole("tab", { name: "Hand" })).toHaveAttribute("aria-selected", "true");
    const handTab = player.getByTestId("hud-phone-tab-hand");
    await expect(handTab.getByTestId("hud-hand")).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    const cards = handTab.getByTestId("hud-hand-card");
    await expect(cards).toHaveCount(2);
    // A row, not a fan: the two cards side by side, unrotated, fully inside the sheet.
    const [a, b] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!];
    expect(Math.round(a.width)).toBe(140);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    const bsBox = (await bs.boundingBox())!;
    expect(a.y + a.height).toBeLessThanOrEqual(bsBox.y + bsBox.height);
    await expect(handTab.getByRole("button", { name: "Roll options" })).toBeVisible();
    await test.info().attach("player-hand-tab-390", { body: await player.screenshot(), contentType: "image/png" });
    await expectNoSeriousA11yViolations(player);

    // Arrow keys move along the tabs; the open tab again folds the sheet to its resource line and tabs.
    await tabs.getByRole("tab", { name: "Hand" }).focus();
    await player.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Attack" })).toBeFocused();
    await expect(player.getByTestId("hud-phone-tab-attack").getByTestId("hud-phone-attack")).toBeVisible();
    await tabs.getByRole("tab", { name: "Dice" }).click();
    await expect(player.getByTestId("hud-phone-tab-dice").getByTestId("hud-dice-box")).toBeVisible({ timeout: 30_000 });
    await tabs.getByRole("tab", { name: "Feed" }).click();
    await expect(player.getByTestId("hud-phone-tab-feed").getByTestId("hud-feed")).toBeVisible();
    await tabs.getByRole("tab", { name: "Feed" }).click();
    await expect(player.getByTestId("hud-phone-tab-feed")).toHaveCount(0);
    await expect(bs.getByRole("button", { name: "Show the actions" })).toHaveAttribute("aria-expanded", "false");
    await bs.getByRole("button", { name: "Show the actions" }).click();
    await expect(player.getByTestId("hud-phone-tab-feed")).toBeVisible();
    await tabs.getByRole("tab", { name: "Hand" }).click();

    // Sheet: your sheet, full screen, with a 44 px close; the strip and the bottom sheet hide under it.
    await player.getByTestId("hud-phone-sheet-button").click();
    const panel = player.getByRole("complementary", { name: /^Moss.s sheet$/ });
    await expect(panel).toBeVisible();
    // After its 280 ms slide-in: the whole screen.
    await expect.poll(async () => Math.round((await panel.boundingBox())!.x)).toBe(0);
    expect(Math.round((await panel.boundingBox())!.width)).toBe(390);
    const close = panel.getByRole("button", { name: /^Close Moss.s sheet$/ });
    expect(Math.round((await close.boundingBox())!.width)).toBe(44);
    await expect(strip).toBeHidden();
    await expect(bs).toBeHidden();
    await test.info().attach("player-sheet-full-390", { body: await player.screenshot(), contentType: "image/png" });
    await expectNoSeriousA11yViolations(player);
    await close.click();
    await expect(panel).toHaveCount(0);
    await expect(strip).toBeVisible();

    // An ally's mini banner opens their sheet full screen too.
    const brannoc = pcs.find((p) => p.name === "Brannoc")!;
    await player.getByTestId(`hud-phone-banner-${brannoc.characterId}`).click();
    await expect(player.getByRole("complementary", { name: /^Brannoc.s sheet$/ })).toBeVisible();
    await player.keyboard.press("Escape");
    await expect(player.getByRole("complementary", { name: /^Brannoc.s sheet$/ })).toHaveCount(0);

    // A pick session: the bottom sheet steps aside; zoomed in, the Sniper's ring is off screen and gets an edge chip.
    await cards.filter({ has: player.getByRole("heading", { name: "Vicious Entangle", exact: true }) }).getByRole("button", { name: "Use Vicious Entangle" }).click();
    await expect(player.getByTestId("hud-pick")).toBeVisible();
    await expect(bs).toBeHidden();
    const zoomIn = player.getByRole("button", { name: /zoom in/i });
    for (let i = 0; i < 4; i += 1) await zoomIn.click();
    const chip = player.locator(`[data-testid="hud-phone-edge"][data-token="${enemies.sniper.tokenId}"]`);
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText(new RegExp(`^${enemies.sniper.name} · Very Far · GM [→←↑↓]$`));
    await test.info().attach("player-edge-chips-390", { body: await player.screenshot(), contentType: "image/png" });
    await expectNoSeriousA11yViolations(player);
    // At 760 px and below the picker is a bottom sheet whose footer Cancel replaces the header's ✕ (H7.3).
    await player.getByTestId("hud-pick").getByTestId("hud-pick-cancel").click();
    await expect(chip).toHaveCount(0);
    await expect(bs).toBeVisible();
  } finally {
    await s.close();
  }
});

test("the GM at 390: the tablet layout with the request queue as a bottom sheet", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm } = s;
  try {
    await open(gm, s.url);
    const hud = gm.getByTestId("combat-hud");
    await expect(hud).not.toHaveClass(/(^|\s)hud-ph-on(\s|$)/);
    await expect(gm.getByTestId("hud-phone-strip")).toHaveCount(0);
    await expect(gm.locator('[data-hud-region="banners"]')).toHaveCount(1);

    const q = gm.getByTestId("hud-phone-queue");
    await expect(q).toBeVisible();
    const qb = (await q.boundingBox())!;
    expect(Math.round(qb.x)).toBe(0);
    expect(Math.round(qb.width)).toBe(390);
    expect(Math.round(qb.y + qb.height)).toBe(844);
    // Folded: the heading with its count; the cards and Resolutions behind the handle.
    await expect(q.getByRole("heading", { name: /^Waiting on you/ })).toBeVisible();
    await expect(q.getByTestId("hud-queue-count")).toBeVisible();
    const handle = q.getByRole("button", { name: "Show the requests" });
    await expect(handle).toHaveAttribute("aria-expanded", "false");
    await test.info().attach("gm-queue-folded-390", { body: await gm.screenshot(), contentType: "image/png" });
    await expectNoSeriousA11yViolations(gm);
    await handle.click();
    await expect(q.getByRole("button", { name: "Fold the requests down" })).toHaveAttribute("aria-expanded", "true");
    await expect(q.getByRole("heading", { name: "Resolutions" })).toBeVisible();
    await test.info().attach("gm-queue-open-390", { body: await gm.screenshot(), contentType: "image/png" });
    await expectNoSeriousA11yViolations(gm);
  } finally {
    await s.close();
  }
});
