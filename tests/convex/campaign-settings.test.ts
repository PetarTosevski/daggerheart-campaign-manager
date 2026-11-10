import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { TABLE_SETTING_DEFAULTS } from "../../src/lib/config/campaign-settings";
import { errorCode, setupWithCampaign } from "./helpers";

/** Config S2: `campaignSettings.set`, one table setting per call (rule 12). */
describe("campaignSettings.set (config S2)", () => {
  async function withPlayer() {
    const setup = await setupWithCampaign();
    const { t, campaignId } = setup;
    const playerId = await t.run((ctx) => ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }));
    await t.run((ctx) => ctx.db.insert("campaignMembers", { campaignId, userId: playerId, joinedAt: 0, lastOpenedAt: 0 }));
    return { ...setup, player: t.withIdentity({ subject: `${playerId}|session` }) };
  }

  const stored = (setup: Awaited<ReturnType<typeof setupWithCampaign>>) =>
    setup.t.run(async (ctx) => (await ctx.db.get("campaigns", setup.campaignId))?.tableSettings);

  it("patches only the changed field, and every member's campaigns.get sees it", async () => {
    const setup = await withPlayer();
    const { gm, player, campaignId } = setup;
    expect(await gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "playersSeeFear", value: false } })).toBeNull();
    await gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "spotlightToPlayers", value: true } });
    expect(await stored(setup)).toEqual({ playersSeeFear: false, spotlightToPlayers: true });
    const expected = { ...TABLE_SETTING_DEFAULTS, playersSeeFear: false, spotlightToPlayers: true };
    expect((await gm.query(api.campaigns.get, { campaignId }))?.settings).toEqual(expected);
    expect((await player.query(api.campaigns.get, { campaignId }))?.settings).toEqual(expected);
  });

  it("sets every key", async () => {
    const setup = await setupWithCampaign();
    const changes = [
      { key: "playersSeeFear", value: false },
      { key: "spotlightToPlayers", value: true },
      { key: "lorekeeperWeb", value: false },
      { key: "lorekeeperAsk", value: "gm" },
      { key: "fearAtStart", value: "pcs" },
      { key: "sessionOpensOn", value: "combatMap" },
      { key: "autoSessionLog", value: false },
    ] as const;
    for (const change of changes) await setup.gm.mutation(api.campaignSettings.set, { campaignId: setup.campaignId, change });
    expect(await stored(setup)).toEqual(Object.fromEntries(changes.map((c) => [c.key, c.value])));
  });

  it("writes nothing for a no-op change (the stored value, or the default when unset)", async () => {
    const setup = await setupWithCampaign();
    const { t, gm, campaignId } = setup;
    await gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "playersSeeFear", value: TABLE_SETTING_DEFAULTS.playersSeeFear } });
    expect(await stored(setup)).toBeNull();
    await gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "lorekeeperAsk", value: "gm" } });
    const doc = await t.run((ctx) => ctx.db.get("campaigns", campaignId));
    await gm.mutation(api.campaignSettings.set, { campaignId, change: { key: "lorekeeperAsk", value: "gm" } });
    expect(await t.run((ctx) => ctx.db.get("campaigns", campaignId))).toEqual(doc);
  });

  it("rejects an unknown key or a wrong-typed value at the args validator", async () => {
    const { gm, campaignId } = await setupWithCampaign();
    const bad = [
      { key: "clock", value: "perScene" },
      { key: "playersSeeFear", value: "yes" },
      // Plan rule-switches WF (M4, Q12 a): out of range moved to House rules.
      { key: "outOfRange", value: "refuse" },
      { key: "autoSessionLog" },
      { key: "playersSeeFear", value: true, extra: 1 },
    ];
    for (const change of bad) {
      await expect(gm.mutation(api.campaignSettings.set, { campaignId, change } as never)).rejects.toThrow(/Validator|validator/);
    }
  });

  it("refuses a player (FORBIDDEN) and writes nothing", async () => {
    const setup = await withPlayer();
    const error = await setup.player
      .mutation(api.campaignSettings.set, { campaignId: setup.campaignId, change: { key: "playersSeeFear", value: false } })
      .catch((e: unknown) => e);
    expect(errorCode(error)).toBe("FORBIDDEN");
    expect(await stored(setup)).toBeNull();
  });

  // Config G1 adds the archived guard to the campaign mutation wrappers; turn this on once it is merged.
  it.todo("refuses an archived campaign with CAMPAIGN_ARCHIVED (G1's wrapper guard)");
});
