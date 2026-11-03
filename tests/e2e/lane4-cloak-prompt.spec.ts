import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan lanes-2 wave 10, E1.4a (dcm-vx5n; user 2026-10-31; CB p.42 Cloaked, CB p.99), in two browsers: a Cloaked rogue
// casts Enrapture (a Spellcast Roll that debuffs, not an attack) on a Bandit; the GM's HUD queue ("Waiting on you";
// plan combat-hud H8.2 removed the classic Resolutions card) asks "Does Ash's Cloaked end?"; the GM answers Yes and the
// rogue is no longer Cloaked (the card goes, the feed says it).

const PLAYER = "e2e-player@example.test";

/** A Bandit any roll hits (Difficulty 1). */
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

/** A level-1 Syndicate Rogue holding Enrapture (Grace 1, CB p.334) and Deft Deceiver. */
const rogueDraft = (name: string) => ({ ...bardDraft(name), classId: "rogue", subclassId: "syndicate", domainCards: ["enrapture", "deft-deceiver"] });

test("a Cloaked rogue's Enrapture asks the GM; Yes ends Cloaked", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft: rogueDraft("Ash"), idempotencyKey: crypto.randomUUID() });

    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
    const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.encounters.start, { campaignId, encounterId });
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
    const mine = tokens.find((t) => t.characterId === characterId)!;
    const bandit = tokens.find((t) => t.instanceId === instanceIds[0])!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: mine._id, x: 5, y: 10 });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId: mine._id, angle: 0 });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: bandit._id, x: 8, y: 10 });

    // The rogue is Cloaked (CB p.42) and casts Enrapture on the Bandit from their own browser's session.
    await playerClient.mutation(api.characters.toggleCondition, { characterId, condition: "cloaked" });
    await player.goto(url);
    await expect(player.getByRole("region", { name: "Your hand" }).getByRole("article", { name: "Enrapture" })).toBeVisible({ timeout: 30_000 });
    const out = await playerClient.mutation(api.combatCards.useCard, { campaignId, characterId, mapId, cardId: "enrapture", spell: "main", targetTokenIds: [bandit._id], choices: [], idempotencyKey: crypto.randomUUID() });
    expect(out.status).toBe("resolved");
    const sheet = async () => (await playerClient.query(api.characters.get, { characterId }))!.sheet!;
    expect((await sheet()).conditions).toContain("cloaked");

    // The GM's HUD queue ("Waiting on you") asks; Yes ends Cloaked.
    await page.goto(url);
    const queue = page.getByTestId("hud-queue");
    const card = queue.getByTestId("hud-queue-cloak");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("heading", { name: "Does Ash’s Cloaked end?" })).toBeVisible();
    await expect(card).toContainText("Enrapture on Bandit");
    await expectNoSeriousA11yViolations(page, { include: "[data-testid=hud-queue]" });
    await card.getByRole("button", { name: /^Yes, Cloaked ends/ }).click();
    await expect(page.getByTestId("hud-queue-result")).toHaveText("Ash is no longer Cloaked.", { timeout: 30_000 });
    await expect(card).toHaveCount(0);
    await expect.poll(async () => ((await sheet())?.conditions ?? []).includes("cloaked")).toBe(false);
    const feed = await playerClient.query(api.feed.list, { campaignId, paginationOpts: { numItems: 20, cursor: null } });
    expect(feed.page.some((r) => r.summary === "Ash is no longer Cloaked (Enrapture)")).toBe(true);
  } finally {
    await context.close();
  }
});
