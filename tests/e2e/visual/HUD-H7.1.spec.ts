import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { hudScene, type HudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H7.1.md (E2E_VISUAL=1): every PlayerTablet and GMTablet Preview state and the sheet
// open, on the seed's real scene at 1024 × 768. Player: the default view, Moss's sheet open, Picking a target, Card
// result, Can't afford (the toast beside the fan), GM's turn, You're hit, Last Hit Point. GM: Requests, a PC's sheet
// open, Adversary acting (stat block + purple picker), Spend Fear, Areas, End scene. Board renders to compare:
// reference/designs/combat-hud/preview/{PlayerTablet,GMTablet}.dc.html (click each Preview button; click a banner).

test.use({ actionTimeout: 30_000 });

const OUT = "test-results/visual/HUD-H7.1";
const TABLET = { width: 1024, height: 768 };
/** Moss as a Druid with Wall Walk (Arcana, "Spend a Hope") beside Vicious Entangle, as on the board. */
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
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
const fanCard = (page: Page, name: string) => page.getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

async function setHope(s: HudScene, characterId: Id<"characters">, hope: number) {
  const sheet = await s.client.query(api.combatHud.sheet, { characterId });
  const delta = hope - sheet.trackers.hope.value;
  if (delta !== 0) await s.client.mutation(api.characters.adjustResource, { characterId, resource: "hope", delta });
}

async function open(page: Page, url: string) {
  await page.setViewportSize(TABLET);
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible();
  await expect(page.getByRole("list", { name: "The party" }).getByRole("button").first()).toBeVisible({ timeout: 30_000 });
  await settle(page);
}

async function settle(page: Page) {
  // The HUD fills the viewport under the campaign header: shoot it, not the header.
  await page.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView());
  await page.mouse.move(1, 400);
  await page.waitForTimeout(600); // the make-room move and the panels' slide-in
}

test("HUD-H7.1 PlayerTablet: every Preview state and the sheet at 1024 × 768", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await hudScene(browser, { moss: MOSS });
  const { player, client, campaignId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await setHope(s, moss.characterId, 2);
    await open(player, s.url);
    await shot(player, "player-default");

    // Sheet open: 340 px panel, the map at -60 px / .92, the title row hidden.
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" }).click();
    await expect(player.getByTestId("hud-sheet-trackers")).toBeVisible();
    await settle(player);
    await shot(player, "player-sheet-open");
    await player.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Moss's sheet" }).click();
    await settle(player);

    // Picking a target: Vicious Entangle from the hand, the Lieutenant picked.
    await expect(player.getByTestId("hud-hand")).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
    await fanCard(player, "Vicious Entangle").hover();
    await fanCard(player, "Vicious Entangle").getByRole("button", { name: "Use Vicious Entangle" }).click();
    const panel = player.getByTestId("hud-pick");
    await expect(panel).toBeVisible();
    await panel.locator(`[data-testid="hud-pick-row"][data-token="${enemies.lieutenant.tokenId}"]`).click();
    await settle(player);
    await shot(player, "player-picking");

    // Card result.
    await panel.getByTestId("hud-pick-go").click();
    const result = player.getByTestId("hud-result");
    const wait = player.getByTestId("hud-pick-wait");
    await expect(result.or(wait)).toBeVisible({ timeout: 30_000 });
    await settle(player);
    await shot(player, "player-card-result");
    if (await wait.isVisible()) await wait.getByRole("button", { name: /^Withdraw/ }).click();

    // Can't afford: no Hope, a press on Wall Walk; the toast beside the fan.
    await setHope(s, moss.characterId, 0);
    await open(player, s.url);
    const wall = fanCard(player, "Wall Walk");
    await expect(wall).toContainText("Needs 1 Hope");
    await wall.hover();
    const use = wall.getByRole("button", { name: "Use Wall Walk" });
    await use.focus();
    await use.press("Enter");
    await expect(player.getByRole("status", { name: "Notices" }).getByRole("listitem").first()).toBeVisible();
    await shot(player, "player-cant-afford");

    // GM's turn.
    await client.mutation(api.combatSpotlight.gmTake, { campaignId, idempotencyKey: key() });
    await expect(player.getByTestId("hud-gm-turn")).toBeVisible();
    await settle(player);
    await shot(player, "player-gm-turn");
    await client.mutation(api.combatSpotlight.handTo, { campaignId, characterId: moss.characterId, idempotencyKey: key() });

    // You're hit: a Brute next to Moss hits.
    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: key() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId: s.encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: key() });
    const instanceId = instanceIds[0]!;
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId: s.mapId, instanceIds: [instanceId], idempotencyKey: key() });
    const token = (await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId })).find((t) => t.instanceId === instanceId)!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 6, y: 10 });
    let res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [moss.characterId], idempotencyKey: key() });
    if (res.status === "confirmFear") res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [moss.characterId], spendFear: res.fear, idempotencyKey: key() });
    await open(player, s.url);
    await expect(player.getByRole("dialog", { name: "You were hit" })).toBeVisible({ timeout: 30_000 });
    await settle(player);
    await shot(player, "player-youre-hit");

    // Last Hit Point: the death move to choose.
    const party = await client.query(api.combatHud.party, { campaignId, mapId: s.mapId });
    const me = party.find((m) => m.characterId === moss.characterId)!;
    await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "hp", delta: me.hp.max - me.hp.marked });
    await open(player, s.url);
    await expect(player.getByRole("dialog", { name: "Choose a death move" })).toBeVisible({ timeout: 30_000 });
    await settle(player);
    await shot(player, "player-last-hit-point");
  } finally {
    await s.close();
  }
});

test("HUD-H7.1 GMTablet: every Preview state and the sheet at 1024 × 768", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await hudScene(browser);
  const { gm, client, playerClient, campaignId, mapId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    // Requests: the player's out-of-range attack and card wait on the GM.
    const base = { campaignId, characterId: moss.characterId, mapId, targetTokenIds: [enemies.sniper.tokenId] };
    await playerClient.mutation(api.combatActions.attack, { ...base, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: key() });
    await playerClient.mutation(api.combatCards.useCard, { ...base, cardId: s.farCardId, spell: "main", choices: [], idempotencyKey: key() });
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
    const lt = tokens.find((t) => t._id === enemies.lieutenant.tokenId)!.instanceId!;
    await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: lt, delta: 2, idempotencyKey: key() });
    await client.mutation(api.encounterTracking.markStress, { campaignId, instanceId: lt, delta: 1, idempotencyKey: key() });
    await client.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: lt, condition: "vulnerable", idempotencyKey: key() });
    await client.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: key() });

    await open(gm, s.url);
    await expect(gm.getByTestId("hud-queue-count")).toHaveText("2", { timeout: 30_000 });
    await settle(gm);
    await shot(gm, "gm-requests");

    // A PC's sheet open (GM edit).
    await gm.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Vex's sheet" }).click();
    await expect(gm.getByTestId("hud-sheet-trackers")).toBeVisible();
    await settle(gm);
    await shot(gm, "gm-sheet-open");
    await gm.getByRole("list", { name: "The party" }).getByRole("button", { name: "Open Vex's sheet" }).click();
    await settle(gm);

    // Adversary acting: the Lieutenant's stat block and the purple picker on Brannoc.
    const name = enemies.lieutenant.name;
    await gm.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${name}’s stat block`) }).click();
    const block = gm.getByRole("complementary", { name: `${name}’s stat block` });
    await expect(block.getByTestId("hud-statblock-body")).toBeVisible();
    await block.getByTestId("hud-statblock-attack").click();
    const panel = gm.getByTestId("hud-pick");
    await panel.getByTestId("hud-pick-row").filter({ hasText: "Brannoc" }).click();
    await settle(gm);
    await shot(gm, "gm-adversary-acting");

    // Spend Fear: the Fear question.
    await panel.getByRole("switch", { name: /Use Local Knowledge/ }).click();
    await panel.getByTestId("hud-pick-go").click();
    await expect(gm.getByTestId("hud-fear-confirm")).toBeVisible();
    await settle(gm);
    await shot(gm, "gm-spend-fear");
    await gm.getByTestId("hud-fear-confirm").getByRole("button", { name: "Cancel" }).click();
    await gm.keyboard.press("Escape");
    await block.getByRole("button", { name: /^Close/ }).click();
    await settle(gm);

    // Areas.
    const tools = gm.getByRole("group", { name: "GM tools" });
    await tools.getByRole("button", { name: "Areas", exact: true }).click();
    await expect(gm.getByRole("dialog", { name: "Areas" })).toBeVisible();
    await settle(gm);
    await shot(gm, "gm-areas");
    await gm.getByRole("dialog", { name: "Areas" }).getByRole("button", { name: "Close Areas" }).click();

    // End scene.
    await tools.getByRole("button", { name: "End scene" }).click();
    await expect(gm.getByRole("dialog", { name: "End the scene?" })).toBeVisible();
    await settle(gm);
    await shot(gm, "gm-end-scene");
  } finally {
    await s.close();
  }
});
