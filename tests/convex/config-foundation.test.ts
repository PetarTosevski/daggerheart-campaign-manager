import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { TABLE_SETTING_DEFAULTS } from "../../src/lib/config/campaign-settings";
import { GM_EMAIL, setupWithCampaign } from "./helpers";

/** Config S0: the data foundation of Part A (table settings, archive stamp, co-GM fields, the per-user tables). */
describe("config foundation (S0)", () => {
  async function withPlayer() {
    const setup = await setupWithCampaign();
    const { t, campaignId } = setup;
    const playerId = await t.run((ctx) => ctx.db.insert("users", { email: "player@example.com", emailVerificationTime: 1 }));
    await t.run((ctx) => ctx.db.insert("campaignMembers", { campaignId, userId: playerId, joinedAt: 0, lastOpenedAt: 0 }));
    return { ...setup, playerId, player: t.withIdentity({ subject: `${playerId}|session` }) };
  }

  it("campaigns.get returns the default settings and archived false for a new campaign, to the GM and a player", async () => {
    const { gm, player, campaignId } = await withPlayer();
    const asGm = await gm.query(api.campaigns.get, { campaignId });
    const asPlayer = await player.query(api.campaigns.get, { campaignId });
    expect(asGm?.settings).toEqual(TABLE_SETTING_DEFAULTS);
    expect(asGm?.archived).toBe(false);
    expect(asPlayer?.settings).toEqual(TABLE_SETTING_DEFAULTS);
    expect(asPlayer?.archived).toBe(false);
  });

  it("campaigns.get resolves stored settings over the defaults, field by field", async () => {
    const { t, gm, player, campaignId } = await withPlayer();
    await t.run((ctx) =>
      ctx.db.patch("campaigns", campaignId as Id<"campaigns">, {
        tableSettings: { playersSeeFear: false, outOfRange: "refuse", sessionOpensOn: "combatMap" },
      }),
    );
    const expected = { ...TABLE_SETTING_DEFAULTS, playersSeeFear: false, outOfRange: "refuse", sessionOpensOn: "combatMap" };
    expect((await gm.query(api.campaigns.get, { campaignId }))?.settings).toEqual(expected);
    expect((await player.query(api.campaigns.get, { campaignId }))?.settings).toEqual(expected);
  });

  it("campaigns.get and list report an archived campaign", async () => {
    const { t, gm, campaignId } = await setupWithCampaign();
    await t.run((ctx) => ctx.db.patch("campaigns", campaignId, { archivedAt: Date.now() }));
    expect((await gm.query(api.campaigns.get, { campaignId }))?.archived).toBe(true);
    const listed = await gm.query(api.campaigns.list, {});
    expect(listed.find((c) => c._id === campaignId)).toMatchObject({ archived: true, settings: TABLE_SETTING_DEFAULTS });
  });

  it("stores a co-GM role on a member row and an email invite", async () => {
    const { t, campaignId } = await setupWithCampaign();
    const rows = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "cogm@example.com", emailVerificationTime: 1 });
      const gmId = (await ctx.db.query("users").collect()).find((u) => u.email === GM_EMAIL)!._id;
      const memberId = await ctx.db.insert("campaignMembers", { campaignId, userId, joinedAt: 0, lastOpenedAt: 0, role: "coGm" });
      const inviteId = await ctx.db.insert("campaignInvites", { campaignId, email: "next@example.com", invitedBy: gmId, createdAt: 0, role: "coGm" });
      return { member: await ctx.db.get("campaignMembers", memberId), invite: await ctx.db.get("campaignInvites", inviteId) };
    });
    expect(rows.member?.role).toBe("coGm");
    expect(rows.invite?.role).toBe("coGm");
  });

  it("stores preferences, one UI-state row per key, drafts and hand folds, read by their indexes", async () => {
    const { t, campaignId } = await setupWithCampaign();
    const read = await t.run(async (ctx) => {
      const userId = (await ctx.db.query("users").collect()).find((u) => u.email === GM_EMAIL)!._id;
      const characterId = await ctx.db.insert("characters", {
        campaignId,
        ownerId: userId,
        createdBy: userId,
        status: "active",
        sheet: {},
        createdAt: 0,
        updatedAt: 0,
      } as never);
      await ctx.db.insert("userPreferences", { userId, dice3d: false, diceVolume: 40, textSize: "large", updatedAt: 1 });
      await ctx.db.insert("userUiState", { userId, key: "tokenNames", value: true, updatedAt: 1 });
      await ctx.db.insert("userUiState", { userId, key: "adversarySort", value: "book", updatedAt: 1 });
      await ctx.db.insert("userUiState", { userId, key: "rangeRings", value: ["t1", "t2"], updatedAt: 1 });
      await ctx.db.insert("userDrafts", { userId, kind: "characterWizard", campaignId, schemaVersion: 1, data: '{"step":2}', updatedAt: 1 });
      await ctx.db.insert("userDrafts", { userId, kind: "customFrame", schemaVersion: 1, data: "{}", updatedAt: 1 });
      await ctx.db.insert("handFolds", { userId, campaignId, characterId, updatedAt: 1 });
      return {
        prefs: await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
        sort: await ctx.db
          .query("userUiState")
          .withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", "adversarySort"))
          .unique(),
        wizard: await ctx.db
          .query("userDrafts")
          .withIndex("by_user_kind_campaign", (q) => q.eq("userId", userId).eq("kind", "characterWizard").eq("campaignId", campaignId))
          .unique(),
        custom: await ctx.db
          .query("userDrafts")
          .withIndex("by_user_kind_campaign", (q) => q.eq("userId", userId).eq("kind", "customFrame").eq("campaignId", undefined))
          .unique(),
        folded: await ctx.db
          .query("handFolds")
          .withIndex("by_user_character", (q) => q.eq("userId", userId).eq("characterId", characterId))
          .unique(),
      };
    });
    expect(read.prefs).toMatchObject({ dice3d: false, diceVolume: 40, textSize: "large" });
    expect(read.sort?.value).toBe("book");
    expect(read.wizard?.data).toBe('{"step":2}');
    expect(read.custom?.kind).toBe("customFrame");
    expect(read.folded).not.toBeNull();
  });
});
