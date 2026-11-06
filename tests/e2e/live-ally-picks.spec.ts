import { expect as baseExpect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { gmAndPlayer } from "./live";

// Plan finish-hud-lk FH-AP (bead dcm-bxp.99.32.24; user 2026-11-05; board CmpPicking 'After the roll'): a pick that is
// each PC's own goes to that PC's screen. The GM uses the Gargantuan War Machine's Awesome Size (HF p.93: "each PC must
// either lose a Hope or mark 1d4 Stress") on the party: nothing applies yet; the player's HUD shows their pick card and
// the GM's queue shows the same pick (the GM may answer a no-show). The player picks on their own screen: both cards go
// and the Hope comes off, without a reload. Rule checks: tests/convex/ally-picks.test.ts.

const expect = baseExpect.configure({ timeout: 15_000 });

/** Runs a seeding call again when the loaded local backend times out a Convex function (rolled back, so safe). */
async function seed<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= 4 || !String(error).includes("timed out")) throw error;
    }
  }
}

test("live per-ally picks: the player answers Awesome Size on their own screen; the GM's queue follows", async ({ browser }) => {
  test.setTimeout(240_000);
  const { gm, player, campaignId, characterId, characterName, client, close } = await seed(() => gmAndPlayer(browser));
  try {
    // The War Machine is a Hope & Fear stat block: the campaign's switch must be on to add it.
    await seed(() => client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true }));
    const { mapId } = await seed(() => client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Field", idempotencyKey: crypto.randomUUID() }));
    await seed(() => client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() }));
    const { encounterId } = await seed(() => client.mutation(api.encounters.create, { campaignId, name: "Siege", idempotencyKey: crypto.randomUUID() }));
    const { instanceIds } = await seed(() =>
      client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "srd", adversaryId: "gargantuan-war-machine" }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() }),
    );
    await seed(() => client.mutation(api.encounters.start, { campaignId, encounterId }));
    const hope = async () => (await client.query(api.charactersReads.get, { characterId }))!.sheet.hope;
    const before = await hope();
    baseExpect(before).toBeGreaterThan(0);

    const url = `/campaigns/${campaignId}/combat-map`;
    await gm.setViewportSize({ width: 1440, height: 900 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await Promise.all([gm.goto(url), player.goto(url)]);
    await expect(player.getByRole("region", { name: "Battle map" })).toBeVisible();
    await expect(gm.getByRole("region", { name: "Battle map" })).toBeVisible();

    // ---- The GM's Awesome Size waits for the PC's own pick: nothing applied.
    const used = await seed(() => client.mutation(api.adversaryActions.useFeature, { campaignId, instanceId: instanceIds[0]!, feature: "Awesome Size", targets: [], picked: [characterId], idempotencyKey: crypto.randomUUID() }));
    baseExpect(used.status === "resolved" && used.picks !== undefined).toBe(true);
    baseExpect(await hope()).toBe(before);

    // ---- The GM's queue lists the pick (the GM answers it if the player doesn't).
    await gm.getByRole("button", { name: /Waiting on you/ }).click();
    const gmCard = gm.getByTestId("hud-queue").getByTestId("hud-ally-pick");
    await expect(gmCard).toContainText(`${characterName}’s pick`);

    // ---- The player's own screen: their pick card; they lose a Hope.
    const card = player.getByTestId("hud-ally-pick");
    await expect(card).toContainText("Awesome Size");
    await expect(card).toContainText("your pick");
    await card.getByRole("button", { name: "Lose a Hope" }).click();
    await card.getByRole("button", { name: `Choose for ${characterName}: Awesome Size` }).click();
    await expect(card).toHaveCount(0);
    await expect(gmCard).toHaveCount(0);
    await expect.poll(hope).toBe(before - 1);
  } finally {
    await close();
  }
});
