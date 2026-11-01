import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan lanes-2 wave 10, E1.4b (dcm-uxsd; user answer 2026-10-31: "a roll request opens the player's attack with the target
// locked"). Beguiled (Tentacle Rays, HF p.75): "a Beguiled PC must mark a Stress or attack a target chosen by the
// Gobstalker". E7.4 writes the request; here an internal e2e seed opens it (as convex/lib/forcedAttacks.ts will). In two
// browsers: the player's Attack bar lists the forced attack, opening it locks the target (an Archer out of the Rapier's
// range: the GM chose it, so no sanction), the attack resolves and the request is gone.

const PLAYER = "e2e-player@example.test";

const SURE = {
  name: "Archer",
  tier: 1,
  type: "Standard" as const,
  description: "A sharpshooter.",
  motives: "Shoot",
  difficulty: 1,
  thresholds: { major: 1, severe: 100 },
  hp: 5,
  stress: 3,
  attack: { modifier: 0, name: "Bow", range: "Far", damage: "1d6 phy" },
  experiences: [],
  features: [],
};

test("a forced attack opens the Attack bar with its target locked and resolves without a sanction", async ({ page, browser }) => {
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
    const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE, idempotencyKey: crypto.randomUUID() });
    const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Gobstalker's den", idempotencyKey: crypto.randomUUID() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.encounters.start, { campaignId, encounterId });
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Den", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
    const ash = tokens.find((t) => t.name === "Ash")!;
    const archer = tokens.find((t) => t.instanceId === instanceIds[0])!._id;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 5, y: 10 });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: archer, x: 16, y: 10 });

    execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "combatRequests:seedForcedAttackForE2e", JSON.stringify({ characterId, targetTokenIds: [archer], instanceLabel: "Gobstalker", feature: "Beguile" })], { stdio: "pipe" });

    await player.goto(url);
    const attackCard = player.getByRole("region", { name: "Attack", exact: true });
    const forced = attackCard.getByTestId("combat-forced-attack");
    await expect(forced).toContainText("Gobstalker's Beguile: you must attack Archer.", { timeout: 30_000 });
    await forced.getByRole("button", { name: "Make the attack" }).click();
    await expect(attackCard.getByTestId("combat-forced-attack-locked")).toContainText("the target is locked (Archer)");

    await attackCard.getByRole("button", { name: "⚔ Attack Archer with Rapier" }).click();
    const result = attackCard.getByRole("region", { name: "Attack result" });
    await expect(result.getByTestId("combat-verdict")).toHaveText(/Archer\s*(Hit|Defeated)/);
    await expect(attackCard.getByTestId("combat-attack-pending")).toHaveCount(0);
    await expect(attackCard.getByTestId("combat-forced-attack")).toHaveCount(0);
    await expect(attackCard.getByTestId("combat-forced-attack-locked")).toHaveCount(0);
    expect(await playerClient.query(api.combatRequests.forcedAttacks, { campaignId })).toEqual([]);
  } finally {
    await context.close();
  }
});
