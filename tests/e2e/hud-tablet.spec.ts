import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectFitsViewport, expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H7.1 (docs/tasks/TASK-HUD-H7.1.md): the HUD at tablet width matches PlayerTablet and GMTablet
// (1024 × 768; the boards' `.tab` rules, HANDOFF "Layout · Tablet"): banners 108 px wide every 114 px from x = 12, the
// title at x = 484, the feed (and the GM's Resolutions) hidden, the map's own toolbar bottom-left (players) or right of
// the GM's 280 px column; with a sheet open the panel is 340 px, the map shifts -60 px and scales to .92, the Fear
// banner moves to right 356 and the title row hides. HUD controls are at least 44 px, the page never scrolls sideways
// and axe passes. The toasts hang beside the fan (dcm-bxp.99.32.29): at 1024 right 24 / bottom 220 (right 356 with a
// sheet), at 1440 left 880 / bottom 262 as Main draws them.

test.use({ actionTimeout: 30_000 });

const TABLET = { width: 1024, height: 768 };
const SHIFTED = "matrix(0.92, 0, 0, 0.92, -60, 0)";
/** Moss as a Druid with Wall Walk (1 Hope) in the loadout, for a refusal toast. */
const MOSS = { classId: "druid", domainCards: ["vicious-entangle", "wall-walk"] };

async function setHope(s: HudScene, characterId: Id<"characters">, hope: number) {
  const sheet = await s.client.query(api.combatHud.sheet, { characterId });
  const delta = hope - sheet.trackers.hope.value;
  if (delta !== 0) await s.client.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta });
}

async function openHud(page: Page, url: string, size = TABLET) {
  await page.setViewportSize(size);
  await page.goto(url);
  const hud = page.getByTestId("combat-hud");
  await expect(hud).toBeVisible();
  await expect(page.getByRole("list", { name: "The party" }).getByRole("button").first()).toBeVisible({ timeout: 30_000 });
  await hud.evaluate((el) => el.scrollIntoView());
  return hud;
}

/** A box relative to the HUD root (the root sits under the campaign header). */
async function boxIn(hud: Locator, part: Locator) {
  const root = (await hud.boundingBox())!;
  const b = (await part.boundingBox())!;
  return { left: Math.round(b.x - root.x), top: Math.round(b.y - root.y), right: Math.round(root.x + root.width - (b.x + b.width)), bottom: Math.round(root.y + root.height - (b.y + b.height)), width: Math.round(b.width), height: Math.round(b.height) };
}

const banner = (page: Page, name: string) => page.getByRole("list", { name: "The party" }).getByRole("button", { name: `Open ${name}'s sheet` });
const fanCard = (page: Page, name: string) => page.getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
const toast = (page: Page) => page.getByRole("status", { name: "Notices" }).getByRole("listitem").first();

async function pressWallWalk(page: Page) {
  const wall = fanCard(page, "Wall Walk");
  await expect(wall).toContainText("Needs 1 Hope");
  await wall.hover();
  const use = wall.getByRole("button", { name: "Use Wall Walk" });
  // aria-disabled stays focusable and pressable: press it from the keyboard (as hud-blocked.spec.ts).
  await use.focus();
  await use.press("Enter");
  await expect(toast(page)).toContainText("Not enough Hope");
}

test("PlayerTablet at 1024 × 768: banners, title, map tools, no feed; the sheet makes room; toasts beside the fan", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser, { moss: MOSS });
  const { player } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await setHope(s, moss.characterId, 0);
    const hud = await openHud(player, s.url);

    // Banners: 108 px wide, every 114 px from x = 12; yours 206 px tall, allies 186.
    const first = await boxIn(hud, banner(player, "Moss"));
    const second = await boxIn(hud, banner(player, "Brannoc"));
    expect(first.left).toBe(12);
    expect(first.width).toBe(108);
    expect(second.left - first.left).toBe(114);
    expect(first.height).toBe(206);
    expect(second.height).toBe(186);

    // The title at x = 484; the feed is hidden; the map's own toolbar bottom-left, clear of the banners.
    expect((await boxIn(hud, player.getByTestId("hud-title"))).left).toBe(484);
    await expect(player.getByTestId("hud-feed")).toBeHidden();
    const mapTools = player.locator(".hud-map .cm-toolbar");
    const tools = await boxIn(hud, mapTools);
    expect(tools.left).toBe(12);
    expect(tools.bottom).toBe(16);

    // Touch targets: the banners, the toolbar, the map's toolbar, the Fear banner's disc.
    await expectTouchTargets(player.getByRole("list", { name: "The party" }).getByRole("button"));
    await expectTouchTargets(player.getByRole("group", { name: "Your tools" }).getByRole("button"));
    await expectTouchTargets(mapTools.getByRole("button"));
    await expectFitsViewport(player);
    await expectNoSeriousA11yViolations(player);

    // A refusal toast hangs beside the fan (board .tab .blk: right 24, bottom 220).
    await pressWallWalk(player);
    const t = await boxIn(hud, player.locator(".hud-toasts"));
    expect(t.right).toBe(24);
    expect(t.bottom).toBe(220);
    // The toast slides in: measure its Dismiss at rest.
    await expect.poll(async () => (await player.getByRole("button", { name: /^Dismiss: Not enough Hope/ }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expectTouchTargets(player.getByRole("status", { name: "Notices" }).getByRole("button"));
    await expectNoSeriousA11yViolations(player);
    await player.getByRole("button", { name: /^Dismiss: Not enough Hope/ }).click();

    // Picking a target (PlayerTablet 'Picking a target'): the action ring and the picking panel at touch size.
    await setHope(s, moss.characterId, 2);
    await player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Open Moss’s sheet \(your character\)/ }).click();
    const ring = player.getByRole("toolbar", { name: "Your actions (Moss)" });
    await expect(ring.getByRole("button", { name: "Attack", exact: true })).toBeEnabled({ timeout: 30_000 });
    // The buttons pop in (scale .6 → 1 over 160 ms): measure them at rest.
    await expect
      .poll(async () => Math.min(...(await ring.getByRole("button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width).filter((w) => w > 0)))))
      .toBeGreaterThanOrEqual(44);
    await expectTouchTargets(ring.getByRole("button"));
    await player.keyboard.press("Escape");
    await fanCard(player, "Vicious Entangle").hover();
    await fanCard(player, "Vicious Entangle").getByRole("button", { name: "Use Vicious Entangle" }).click();
    const pick = player.getByTestId("hud-pick");
    await expect(pick).toBeVisible();
    await pick.locator(`[data-testid="hud-pick-row"][data-token="${s.enemies.lieutenant.tokenId}"]`).click();
    await expectTouchTargets(pick.getByRole("button"));
    await expectFitsViewport(player);
    await expectNoSeriousA11yViolations(player);
    await player.keyboard.press("Escape");
    await expect(pick).toHaveCount(0);
    await setHope(s, moss.characterId, 0);

    // The sheet: 340 px, the map -60 px / .92, the Fear banner left by the panel, the title row hidden.
    await banner(player, "Moss").click();
    const sheet = player.getByRole("complementary", { name: "Moss’s sheet" });
    await expect(sheet.getByTestId("hud-sheet-trackers")).toBeVisible();
    await expect(player.getByTestId("combat-viewport")).toHaveCSS("transform", SHIFTED);
    await expect(player.locator(".hud-fear")).toHaveCSS("transform", "matrix(1, 0, 0, 1, -340, 0)");
    await expect(player.getByTestId("hud-title")).toBeHidden();
    await expect(player.getByRole("group", { name: "Your tools" })).toBeHidden();
    await expect(player.locator('[data-hud-region="hand"]')).toHaveCSS("left", "150px");
    const panel = await boxIn(hud, sheet);
    expect(panel.width).toBe(340);
    expect(panel.right).toBe(0);
    expect((await boxIn(hud, mapTools)).left).toBe(12);
    await expectTouchTargets(sheet.getByRole("button"));
    await expectFitsViewport(player);
    await expectNoSeriousA11yViolations(player);

    // With the sheet open the toast moves left of the panel (board .tab.sh-open .blk: right 356).
    await pressWallWalk(player);
    await expect.poll(async () => (await boxIn(hud, player.locator(".hud-toasts"))).right).toBe(356);
  } finally {
    await s.close();
  }
});

test("GMTablet at 1024 × 768: the 280 px column without Resolutions, the map tools beside it; the stat block makes room", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, playerClient, campaignId, mapId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    // One request waits on the GM (an out-of-range attack on the Sniper).
    await playerClient.mutation(api.combatActions.attack, {
      campaignId,
      characterId: moss.characterId,
      mapId,
      targetTokenIds: [enemies.sniper.tokenId],
      slot: "primary",
      modifier: 0,
      experienceIds: [],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
      idempotencyKey: crypto.randomUUID(),
    });
    const hud = await openHud(gm, s.url);
    await expect(gm.getByTestId("hud-queue-count")).toHaveText("1", { timeout: 30_000 });

    const column = await boxIn(hud, gm.getByTestId("hud-queue-column"));
    expect(column.left).toBe(12);
    expect(column.width).toBe(280);
    expect(column.top).toBeGreaterThanOrEqual(236);
    await expect(gm.getByTestId("hud-resolutions")).toBeHidden();
    expect((await boxIn(hud, gm.getByTestId("hud-title"))).left).toBe(484);
    const mapTools = gm.locator(".hud-map .cm-toolbar");
    const tools = await boxIn(hud, mapTools);
    expect(tools.left).toBe(308);
    expect(tools.bottom).toBe(16);

    await expectTouchTargets(gm.getByRole("group", { name: "GM tools" }).getByRole("button"));
    await expectTouchTargets(mapTools.getByRole("button"));
    await expectTouchTargets(gm.getByTestId("hud-queue").getByRole("button"));
    await expectTouchTargets(gm.locator(".hud-fb-ctl button"));
    await expectFitsViewport(gm);
    await expectNoSeriousA11yViolations(gm);

    // Areas hangs under the Fear banner, clear of the Lorekeeper button bottom right (dcm-bxp.99.32.28).
    await gm.getByRole("group", { name: "GM tools" }).getByRole("button", { name: "Areas", exact: true }).click();
    const areas = gm.getByRole("dialog", { name: "Areas" });
    await expect(areas.getByTestId("area-tools")).toBeVisible();
    const a = await boxIn(hud, areas);
    expect(a).toMatchObject({ top: 232, right: 16, width: 360 });
    expect(a.bottom).toBeGreaterThanOrEqual(96);
    await expectTouchTargets(areas.getByRole("button"));
    await expectNoSeriousA11yViolations(gm);
    await areas.getByRole("button", { name: "Close Areas" }).click();
    await expect(areas).toBeHidden();

    // The Lieutenant's stat block: 340 px, the map shifted; the GM picks for it and the column steps aside.
    const name = enemies.lieutenant.name;
    await gm.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${name}’s stat block`) }).click();
    const block = gm.getByRole("complementary", { name: `${name}’s stat block` });
    await expect(block.getByTestId("hud-statblock-body")).toBeVisible();
    await expect(gm.getByTestId("combat-viewport")).toHaveCSS("transform", SHIFTED);
    await expect(gm.getByTestId("hud-title")).toBeHidden();
    await expect(mapTools).toBeHidden();
    expect((await boxIn(hud, block)).width).toBe(340);
    await expectTouchTargets(block.getByRole("button"));
    await expectFitsViewport(gm);
    await expectNoSeriousA11yViolations(gm);

    await block.getByTestId("hud-statblock-attack").click();
    await expect(gm.getByTestId("hud-pick")).toBeVisible();
    await expect(gm.getByTestId("hud-queue-column")).toBeHidden();
    await expectTouchTargets(gm.getByTestId("hud-pick").getByRole("button"));
    await gm.keyboard.press("Escape");
    await expect(gm.getByTestId("hud-pick")).toHaveCount(0);
    await expect(gm.getByTestId("hud-queue-column")).toBeVisible();
  } finally {
    await s.close();
  }
});

test("Main at 1440 × 900: a refusal toast hangs beside the fan, not at the top of the map (dcm-bxp.99.32.29)", async ({ browser }) => {
  test.setTimeout(240_000);
  const s = await hudScene(browser, { moss: MOSS });
  const { player } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await setHope(s, moss.characterId, 0);
    const hud = await openHud(player, s.url, { width: 1440, height: 900 });
    await pressWallWalk(player);
    const t = await boxIn(hud, player.locator(".hud-toasts"));
    expect(t.left).toBe(880);
    expect(t.bottom).toBe(262);
    expect(t.width).toBe(330);
    await expectNoSeriousA11yViolations(player);
  } finally {
    await s.close();
  }
});
