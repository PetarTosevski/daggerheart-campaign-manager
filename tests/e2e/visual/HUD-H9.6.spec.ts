import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { hudScene, type HudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H9.6.md (E2E_VISUAL=1): every v2 board state on the seed's real scene beside the board
// renders. GMTablet (1024 × 768): Calm, Requests, Adversary acting, Spend Fear, Areas, Log, End scene, a sheet open,
// plus the spotlight popover and the day disc's pop-over. PlayerTablet: the default view, a sheet open, Picking a
// target, GM's turn, You're hit. PlayerPhone (390 × 844): the main view, the Hand tab, edge chips while picking (clear
// of the spotlight disc), You're hit with an adversary holding the spotlight, the full-screen sheet; the GM at 390.
// Whole pages (app bar or phone header included) for the GM and the player at 1440, 1024 and 390.

test.use({ actionTimeout: 30_000 });

const OUT = "test-results/visual/HUD-H9.6";
const BOARDS = path.resolve("reference/designs/combat-hud/preview");
const TABLET = { width: 1024, height: 768 };
const PHONE = { width: 390, height: 844 };
const SIZES = [{ width: 1440, height: 900 }, TABLET, PHONE] as const;
/** Moss as a Druid with Wall Walk beside Vicious Entangle, as on the boards. */
const MOSS = { classId: "druid", domainCards: ["vicious-entangle", "wall-walk"] };

/** A Bandit that always hits (ATK +20) for 11-14 physical damage (as tests/e2e/hud-hit.spec.ts). */
const BRUTE = {
  name: "Brute",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 20, name: "Club", range: "Melee", damage: "1d4+6 phy" },
  experiences: [],
  features: [],
};

const key = () => crypto.randomUUID();
const fanCard = (page: Page, name: string) => page.getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

async function shot(page: Page, name: string) {
  await page.mouse.move(1, 400);
  await page.waitForTimeout(600); // the make-room move and the panels' slide-in
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

async function open(page: Page, url: string, size: { width: number; height: number } = TABLET) {
  await page.setViewportSize(size);
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible();
  const party = size.width <= 760 ? page.getByTestId("combat-hud").getByRole("button", { name: /^Open .*'s sheet$/ }) : page.getByRole("list", { name: "The party" }).getByRole("button");
  await expect(party.first()).toBeVisible({ timeout: 30_000 });
  // The HUD fills the window under the app bar (the phone keeps the campaign header above it): shoot the HUD.
  await page.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
}

async function setHope(s: HudScene, characterId: Id<"characters">, hope: number) {
  const sheet = await s.client.query(api.combatHud.sheet, { characterId });
  const delta = hope - sheet.trackers.hope.value;
  if (delta !== 0) await s.client.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta });
}

/** A Brute next to Moss hits Moss (You're hit). */
async function hitMoss(s: HudScene, mossId: Id<"characters">) {
  const { client, campaignId, mapId } = s;
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: key() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId: s.encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: key() });
  const instanceId = instanceIds[0]!;
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [instanceId], idempotencyKey: key() });
  const token = (await client.query(api.combatTokensReads.list, { campaignId, mapId })).find((t) => t.instanceId === instanceId)!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 6, y: 10 });
  let res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [mossId], idempotencyKey: key() });
  if (res.status === "confirmFear") res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [mossId], spendFear: res.fear, idempotencyKey: key() });
}

/** The player's out-of-range attack and card that wait on the GM. */
async function requests(s: HudScene, mossId: Id<"characters">) {
  const base = { campaignId: s.campaignId, characterId: mossId, mapId: s.mapId, targetTokenIds: [s.enemies.sniper.tokenId] };
  await s.playerClient.mutation(api.combatActions.attack, { ...base, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
  await s.playerClient.mutation(api.combatCards.useCard, { ...base, cardId: s.farCardId, spell: "main", choices: [], idempotencyKey: key() });
}

test("H9.6 board renders: GMTablet, PlayerTablet (every Preview state), PlayerPhone", { tag: "@visual" }, async ({ page }) => {
  for (const [board, size, states] of [
    ["GMTablet", TABLET, ["Calm", "Requests", "Adversary acting", "Spend Fear", "Areas", "Log", "End scene"]],
    ["PlayerTablet", TABLET, ["Picking a target", "Card result", "You’re hit", "Last Hit Point", "Can’t afford", "GM’s turn"]],
    ["PlayerPhone", { width: 1800, height: 940 }, []],
  ] as const) {
    await page.setViewportSize(size);
    await page.goto(pathToFileURL(path.join(BOARDS, `${board}.dc.html`)).href);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/board-${board}.png`, animations: "disabled" });
    for (const state of states) {
      await page.getByRole("button", { name: state, exact: true }).last().click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/board-${board}-${state.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, "-")}.png`, animations: "disabled" });
    }
  }
});

test("H9.6 GMTablet on the seed: every board state, a sheet, the spotlight and day disc pop-overs", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await client.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: key() });
    await open(gm, s.url);
    await shot(gm, "gm-tablet-calm");
    const dock = gm.getByRole("toolbar", { name: "Map controls" });

    // The spotlight disc's popover and the day disc's pop-over (Day / Dim / Night above the calendar).
    await gm.getByRole("button", { name: /^Spotlight: .*Change who has it$/ }).click();
    await expect(gm.getByRole("dialog", { name: "Spotlight" })).toBeVisible();
    await shot(gm, "gm-tablet-spotlight");
    await gm.keyboard.press("Escape");
    await gm.locator(".hud-sun-btn").click();
    await shot(gm, "gm-tablet-day-disc");
    await gm.keyboard.press("Escape");

    // Requests: two wait on the GM; the queue opens above "Waiting on you".
    await requests(s, moss.characterId);
    await expect(gm.getByTestId("hud-wait-count")).toHaveText("2", { timeout: 30_000 });
    await gm.getByRole("button", { name: /^Waiting on you/ }).click();
    await expect(gm.getByTestId("hud-queue")).toBeVisible();
    await shot(gm, "gm-tablet-requests");
    await gm.keyboard.press("Escape");

    // A PC's sheet open: the dock moves right of the panel, the disc hides.
    const banner = gm.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Vex's sheet" });
    await banner.click();
    await expect(gm.getByTestId("hud-sheet-trackers")).toBeVisible();
    await shot(gm, "gm-tablet-sheet-open");
    await banner.click();

    // Adversary acting: the Lieutenant's stat block and the purple picker on Brannoc; then the Fear question.
    const name = enemies.lieutenant.name;
    await gm.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${name}’s stat block`) }).click();
    const block = gm.getByRole("complementary", { name: `${name}’s stat block` });
    await expect(block.getByTestId("hud-statblock-body")).toBeVisible();
    await block.getByTestId("hud-statblock-attack").click();
    const panel = gm.getByTestId("hud-pick");
    await panel.getByTestId("hud-pick-row").filter({ hasText: "Brannoc" }).click();
    await shot(gm, "gm-tablet-adversary-acting");
    await panel.getByRole("switch", { name: /Use Local Knowledge/ }).click();
    await panel.getByTestId("hud-pick-go").click();
    await expect(gm.getByTestId("hud-fear-confirm")).toBeVisible();
    await shot(gm, "gm-tablet-spend-fear");
    await gm.getByTestId("hud-fear-confirm").getByRole("button", { name: "Cancel" }).click();
    await gm.keyboard.press("Escape");
    await block.getByRole("button", { name: /^Close/ }).click();

    // Areas, Log, End scene from the dock.
    await dock.getByRole("button", { name: "Areas", exact: true }).click();
    await expect(gm.getByRole("dialog", { name: "Areas" })).toBeVisible();
    await shot(gm, "gm-tablet-areas");
    await dock.getByRole("button", { name: "Log" }).click();
    await expect(gm.getByTestId("hud-resolutions")).toBeVisible();
    await shot(gm, "gm-tablet-log");
    await dock.getByRole("button", { name: "Log" }).click();
    await dock.getByRole("button", { name: "End scene" }).click();
    await expect(gm.getByRole("dialog", { name: "End the scene?" })).toBeVisible();
    await shot(gm, "gm-tablet-end-scene");
  } finally {
    await s.close();
  }
});

test("H9.6 PlayerTablet on the seed: default, sheet open, picking, GM's turn, You're hit", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await hudScene(browser, { moss: MOSS });
  const { player, client, campaignId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await setHope(s, moss.characterId, 2);
    await open(player, s.url);
    await shot(player, "player-tablet-default");

    const banner = player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" });
    await banner.click();
    await expect(player.getByTestId("hud-sheet-trackers")).toBeVisible();
    await shot(player, "player-tablet-sheet-open");
    await banner.click();

    await expect(player.getByTestId("hud-hand")).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    await fanCard(player, "Vicious Entangle").hover();
    await fanCard(player, "Vicious Entangle").getByRole("button", { name: "Use Vicious Entangle" }).click();
    const panel = player.getByTestId("hud-pick");
    await panel.locator(`[data-testid="hud-pick-row"][data-token="${enemies.lieutenant.tokenId}"]`).click();
    await shot(player, "player-tablet-picking");
    await player.keyboard.press("Escape");

    await client.mutation(api.combatSpotlight.gmTake, { campaignId, idempotencyKey: key() });
    await expect(player.getByTestId("hud-gm-turn")).toBeVisible();
    await shot(player, "player-tablet-gm-turn");
    await client.mutation(api.combatSpotlight.handTo, { campaignId, characterId: moss.characterId, idempotencyKey: key() });

    await hitMoss(s, moss.characterId);
    await open(player, s.url);
    await expect(player.getByRole("dialog", { name: "You were hit" })).toBeVisible({ timeout: 30_000 });
    await shot(player, "player-tablet-youre-hit");
  } finally {
    await s.close();
  }
});

test("H9.6 PlayerPhone and the GM at 390 on the seed", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await client.mutation(api.combatSpotlight.handTo, { campaignId, characterId: moss.characterId, idempotencyKey: key() });
    await open(player, s.url, PHONE);
    await expect(player.getByTestId("hud-phone-spotlight")).toBeVisible();
    await shot(player, "player-phone-main");
    const tabs = player.getByRole("tablist", { name: "Combat actions" });
    await tabs.getByRole("tab", { name: "Hand" }).click();
    await expect(player.getByTestId("hud-phone-tab-hand").getByTestId("hud-hand-card")).toHaveCount(2, { timeout: 30_000 });
    await shot(player, "player-phone-hand-tab");

    // Picking a target: zoomed in, the off-screen targets get edge chips below the spotlight disc.
    await player.getByTestId("hud-phone-tab-hand").getByRole("button", { name: "Use Vicious Entangle" }).click();
    await expect(player.getByTestId("hud-pick")).toBeVisible();
    for (let i = 0; i < 4; i += 1) await player.getByRole("button", { name: "Zoom in" }).click();
    await expect(player.getByTestId("hud-phone-edge").first()).toBeVisible();
    await shot(player, "player-phone-picking-edge-chips");
    await player.getByTestId("hud-pick").getByTestId("hud-pick-cancel").click();

    await player.getByTestId("hud-phone-sheet-button").click();
    await expect(player.getByRole("complementary", { name: /^Moss.s sheet$/ })).toBeVisible();
    await shot(player, "player-phone-sheet-full-screen");
    await player.keyboard.press("Escape");

    // You're hit, with the Lieutenant holding the spotlight (purple disc).
    await client.mutation(api.combatSpotlight.gmTake, { campaignId, tokenId: enemies.lieutenant.tokenId, idempotencyKey: key() });
    await hitMoss(s, moss.characterId);
    await open(player, s.url, PHONE);
    await expect(player.getByRole("dialog", { name: "You were hit" })).toBeVisible({ timeout: 30_000 });
    await shot(player, "player-phone-youre-hit");

    // The GM at 390: the queue folded and open, the spotlight popover, Log, Areas.
    await requests(s, moss.characterId);
    await open(gm, s.url, PHONE);
    await expect(gm.getByTestId("hud-phone-queue")).toBeVisible();
    await shot(gm, "gm-phone-main");
    await gm.getByRole("button", { name: "Show the requests" }).click();
    await shot(gm, "gm-phone-queue-open");
    await gm.getByRole("button", { name: "Fold the requests down" }).click();
    await gm.getByRole("button", { name: /^Spotlight: .*Change who has it$/ }).click();
    await expect(gm.getByRole("dialog", { name: "Spotlight" })).toBeVisible();
    await shot(gm, "gm-phone-spotlight");
    await gm.keyboard.press("Escape");
    await gm.locator(".hud-sun-btn").click();
    await shot(gm, "gm-phone-day-disc");
    await gm.keyboard.press("Escape");
    const dock = gm.getByRole("toolbar", { name: "Map controls" });
    await dock.getByRole("button", { name: "Log" }).click();
    await expect(gm.getByTestId("hud-log").getByTestId("hud-resolutions")).toBeVisible();
    await shot(gm, "gm-phone-log");
    await dock.getByRole("button", { name: "Areas", exact: true }).click();
    await expect(gm.getByRole("dialog", { name: "Areas" })).toBeVisible();
    await shot(gm, "gm-phone-areas");
  } finally {
    await s.close();
  }
});

test("H9.6 whole pages: GM and player at 1440, 1024 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await hudScene(browser);
  try {
    for (const size of SIZES) {
      for (const [who, page] of [
        ["gm", s.gm],
        ["player", s.player],
      ] as const) {
        await open(page, s.url, size);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.mouse.move(1, 400);
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/page-${who}-${size.width}.png`, fullPage: true, animations: "disabled" });
      }
    }
  } finally {
    await s.close();
  }
});
