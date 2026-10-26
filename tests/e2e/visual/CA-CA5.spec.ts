import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { signInAsTestGm } from "../fixtures";
import { VIEWPORTS, bardDraft, convexAs, openCombatMap } from "./helpers";

const PLAYER = "e2e-player@example.test";

/** The scene of tests/e2e/combat-attack.spec.ts (a spec can't import another spec's tests): Difficulty 1, thresholds 1 / 100. */
const SURE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 1,
  thresholds: { major: 1, severe: 100 },
  hp: 5,
  stress: 3,
  attack: { modifier: 0, name: "Club", range: "Melee", damage: "1d6 phy" },
  experiences: [],
  features: [],
};

/** Ash (Rapier) at (5, 10) facing east, the Bandit beside Ash, the Archer 10 squares east (Far). */
async function attackScene(page: Page, browser: Browser) {
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const player = await context.newPage();
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const playerClient = await convexAs(player);
  await playerClient.mutation(api.members.joinByCode, { code });
  await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { customId: archerId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: { ...SURE_BANDIT, name: "Archer" }, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds: bandit } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  const { instanceIds: archer } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId: archerId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [...bandit, ...archer], idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  const ash = tokens.find((t) => t.name === "Ash")!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === bandit[0])!._id, x: 6, y: 10 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === archer[0])!._id, x: 16, y: 10 });
  return { url, player, closePlayer: () => context.close() };
}

// Shots for the CA5 task doc (E2E_VISUAL=1), at 1440 and 390: the player's page with a picked Bandit (ring on the map,
// target list, Attack bar), the attack result, the GM's Resolutions with a sanction waiting and a resolution with Undo,
// and the phone bottom sheet closed and open on each tab. The board (reference/designs/project/Combat.dc.html) has no
// attack UI; the shots are compared with its player-day and gm-play regions (node scripts/board-shots.mjs
// combat:player-day combat:gm-play) for the column, card and colour language.

const OUT = "test-results/visual/CA-CA5";

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
}

test("CA5 targets, Attack bar, result, Resolutions and the bottom sheet", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await attackScene(page, browser);
  const { player } = s;
  try {
    // ---- Desktop: the player picks the Bandit and attacks.
    await player.goto(s.url);
    const attackCard = player.getByRole("region", { name: "Attack", exact: true });
    await expect(attackCard.getByTestId("combat-attack-bar")).toBeVisible({ timeout: 30_000 });
    await player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Bandit, Enemy/ }).click();
    await expect(player.getByTestId("combat-target-ring")).toHaveCount(1);
    await settle(player);
    await player.screenshot({ path: `${OUT}/player-picked-1440.png`, animations: "disabled" });
    await attackCard.screenshot({ path: `${OUT}/attack-card-picked-1440.png`, animations: "disabled" });
    await attackCard.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    await expect(attackCard.getByRole("region", { name: "Attack result" })).toBeVisible();
    await attackCard.screenshot({ path: `${OUT}/attack-card-result-1440.png`, animations: "disabled" });
    await player.getByRole("region", { name: "Roll feed" }).screenshot({ path: `${OUT}/mini-feed-1440.png`, animations: "disabled" });
    await player.getByRole("region", { name: "Map dice" }).screenshot({ path: `${OUT}/map-dice-1440.png`, animations: "disabled" });

    // An out-of-range attack on the Archer, waiting for the GM.
    await attackCard.getByRole("list", { name: "Enemies in sight" }).getByRole("button", { name: /^Archer/ }).click();
    await attackCard.getByRole("button", { name: "⚔ Attack Archer with Rapier" }).click();
    await expect(attackCard.getByTestId("combat-sanction-waiting")).toBeVisible();
    await attackCard.screenshot({ path: `${OUT}/attack-card-waiting-1440.png`, animations: "disabled" });

    // ---- The GM's Resolutions, at both sizes.
    await page.goto(s.url);
    const resolutions = page.getByRole("region", { name: "Resolutions" });
    await expect(resolutions.getByTestId("combat-sanction")).toBeVisible();
    await expect(resolutions.getByTestId("combat-resolution")).toHaveCount(1);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await settle(page);
      await resolutions.screenshot({ path: `${OUT}/gm-resolutions-${viewport.width}.png`, animations: "disabled" });
    }
    await page.setViewportSize(VIEWPORTS[0]);
    await page.screenshot({ path: `${OUT}/gm-page-1440.png`, animations: "disabled" });

    // ---- Phone: the bottom sheet, closed and on each tab.
    await player.setViewportSize(VIEWPORTS[1]);
    const sheet = player.getByTestId("combat-actions-sheet");
    const tabs = sheet.getByRole("tablist", { name: "Combat actions" });
    await expect(tabs).toBeVisible();
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await player.getByRole("region", { name: "Battle map" }).scrollIntoViewIfNeeded();
    await settle(player);
    await player.screenshot({ path: `${OUT}/sheet-closed-390.png`, animations: "disabled" });
    await player.screenshot({ path: `${OUT}/player-full-390.png`, animations: "disabled", fullPage: true });
    for (const tab of ["Attack", "Dice", "Feed", "Hand"]) {
      await tabs.getByRole("tab", { name: tab }).click();
      await expect(tabs.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      await settle(player);
      await player.screenshot({ path: `${OUT}/sheet-${tab.toLowerCase()}-390.png`, animations: "disabled" });
    }
  } finally {
    await s.closePlayer();
  }
});
