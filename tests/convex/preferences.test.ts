import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PREFERENCE_DEFAULTS } from "../../src/lib/config/preferences";
import { errorCode, GM_EMAIL, key, setupWithCampaign } from "./helpers";

/** Config P1: the account's preferences, the single-field setter, the one-time legacy import and hand folds. */
describe("preferences (P1)", () => {
  async function world() {
    const setup = await setupWithCampaign();
    const { t, gm, campaignId } = setup;
    // A second campaign the player is not in.
    const { campaignId: otherCampaignId } = await gm.mutation(
      api.campaigns.create,
      { frameId: "witherwild", name: "Other", idempotencyKey: key() },
    );
    const ids = await t.run(async (ctx) => {
      const gmId = (await ctx.db.query("users").collect()).find(
        (u) => u.email === GM_EMAIL,
      )!._id;
      const playerId = await ctx.db.insert("users", {
        email: "player@example.com",
        emailVerificationTime: 1,
      });
      await ctx.db.insert("campaignMembers", {
        campaignId,
        userId: playerId,
        joinedAt: 0,
        lastOpenedAt: 0,
      });
      const character = (ownerId: Id<"users">, campaign: Id<"campaigns">) =>
        ctx.db.insert("characters", {
          campaignId: campaign,
          ownerId,
          createdBy: ownerId,
          status: "active",
          sheet: {},
          createdAt: 0,
          updatedAt: 0,
        } as never);
      const characterId = await character(playerId, campaignId);
      const strangerCharacterId = await character(gmId, otherCampaignId);
      return {
        gmId,
        playerId,
        characterId,
        otherCampaignId,
        strangerCharacterId,
      };
    });
    return {
      ...setup,
      ...ids,
      player: t.withIdentity({ subject: `${ids.playerId}|session` }),
    };
  }

  const foldRows = (t: Awaited<ReturnType<typeof world>>["t"]) =>
    t.run((ctx) => ctx.db.query("handFolds").collect());

  it("get returns the defaults and legacyImported false when there is no row", async () => {
    const { other } = await setupWithCampaign();
    expect(await other.query(api.preferences.get, {})).toEqual({
      ...PREFERENCE_DEFAULTS,
      legacyImported: false,
    });
  });

  it("set creates the row on the first write and changes one field at a time", async () => {
    const { t, other } = await setupWithCampaign();
    await other.mutation(api.preferences.set, {
      change: { key: "diceSound", value: true },
    });
    await other.mutation(api.preferences.set, {
      change: { key: "diceVolume", value: 35 },
    });
    await other.mutation(api.preferences.set, {
      change: { key: "textSize", value: "large" },
    });
    await other.mutation(api.preferences.set, {
      change: { key: "reduceMotion", value: true },
    });
    await other.mutation(api.preferences.set, {
      change: { key: "spotlightPing", value: false },
    });
    await other.mutation(api.preferences.set, {
      change: { key: "dice3d", value: false },
    });
    expect(await other.query(api.preferences.get, {})).toEqual({
      dice3d: false,
      diceSound: true,
      diceVolume: 35,
      reduceMotion: true,
      textSize: "large",
      spotlightPing: false,
      legacyImported: false,
    });
    expect(
      await t.run((ctx) => ctx.db.query("userPreferences").collect()),
    ).toHaveLength(1);
  });

  it("set refuses a volume outside 0-100 or not an integer", async () => {
    const { other } = await setupWithCampaign();
    for (const value of [-1, 101, 12.5]) {
      await expect(
        other.mutation(api.preferences.set, {
          change: { key: "diceVolume", value },
        }),
      ).rejects.toSatisfy((e) => errorCode(e) === "SETTING_INVALID");
    }
    await other.mutation(api.preferences.set, {
      change: { key: "diceVolume", value: 0 },
    });
    await other.mutation(api.preferences.set, {
      change: { key: "diceVolume", value: 100 },
    });
    expect((await other.query(api.preferences.get, {})).diceVolume).toBe(100);
  });

  it("each user reads and writes only their own row", async () => {
    const { gm, other } = await setupWithCampaign();
    await gm.mutation(api.preferences.set, {
      change: { key: "diceSound", value: true },
    });
    expect((await other.query(api.preferences.get, {})).diceSound).toBe(false);
    expect((await gm.query(api.preferences.get, {})).diceSound).toBe(true);
  });

  it("importLegacy sets only unset fields, runs once per account and reports it", async () => {
    const { player, characterId, campaignId, t } = await world();
    await player.mutation(api.preferences.set, {
      change: { key: "dice3d", value: true },
    });
    const first = await player.mutation(api.preferences.importLegacy, {
      dice3d: false,
      diceSound: true,
      folds: [{ campaignId, characterId }],
    });
    expect(first).toEqual({ imported: true, folds: 1 });
    const after = await player.query(api.preferences.get, {});
    expect(after).toMatchObject({
      dice3d: true,
      diceSound: true,
      legacyImported: true,
    });

    const second = await player.mutation(api.preferences.importLegacy, {
      dice3d: false,
      diceSound: false,
      folds: [],
    });
    expect(second).toEqual({ imported: false, folds: 0 });
    expect(await player.query(api.preferences.get, {})).toMatchObject({
      dice3d: true,
      diceSound: true,
    });
    expect(await foldRows(t)).toHaveLength(1);
  });

  it("importLegacy skips folds it cannot verify and never fails for them", async () => {
    const {
      player,
      characterId,
      campaignId,
      otherCampaignId,
      strangerCharacterId,
      t,
    } = await world();
    const result = await player.mutation(api.preferences.importLegacy, {
      folds: [
        { campaignId: "not-an-id", characterId },
        { campaignId, characterId: "nope" },
        { campaignId: otherCampaignId, characterId: strangerCharacterId }, // a campaign the player can't see
        { campaignId, characterId: strangerCharacterId }, // a character of another campaign
        { campaignId, characterId },
        { campaignId, characterId }, // a duplicate
      ],
    });
    expect(result).toEqual({ imported: true, folds: 1 });
    expect((await foldRows(t)).map((r) => r.characterId)).toEqual([
      characterId,
    ]);
  });

  it("importLegacy refuses more than 50 folds", async () => {
    const { player, characterId, campaignId } = await world();
    const folds = Array.from({ length: 51 }, () => ({
      campaignId,
      characterId,
    }));
    await expect(
      player.mutation(api.preferences.importLegacy, { folds }),
    ).rejects.toSatisfy((e) => errorCode(e) === "INVALID");
    expect((await player.query(api.preferences.get, {})).legacyImported).toBe(
      false,
    );
  });

  it("setFold folds and unfolds; folds lists only the caller's rows in that campaign", async () => {
    const {
      gm,
      player,
      characterId,
      campaignId,
      t,
      otherCampaignId,
      gmId,
      strangerCharacterId,
    } = await world();
    await player.mutation(api.preferences.setFold, {
      campaignId,
      characterId,
      folded: true,
    });
    await player.mutation(api.preferences.setFold, {
      campaignId,
      characterId,
      folded: true,
    }); // idempotent
    expect(await player.query(api.preferences.folds, { campaignId })).toEqual([
      characterId,
    ]);
    expect(await gm.query(api.preferences.folds, { campaignId })).toEqual([]);
    // The GM's fold in another campaign does not show up here.
    await t.run((ctx) =>
      ctx.db.insert("handFolds", {
        userId: gmId,
        campaignId: otherCampaignId,
        characterId: strangerCharacterId,
        updatedAt: 1,
      }),
    );
    await gm.mutation(api.preferences.setFold, {
      campaignId,
      characterId,
      folded: true,
    });
    expect(await gm.query(api.preferences.folds, { campaignId })).toEqual([
      characterId,
    ]);
    expect(await foldRows(t)).toHaveLength(3);

    await player.mutation(api.preferences.setFold, {
      campaignId,
      characterId,
      folded: false,
    });
    await player.mutation(api.preferences.setFold, {
      campaignId,
      characterId,
      folded: false,
    });
    expect(await player.query(api.preferences.folds, { campaignId })).toEqual(
      [],
    );
    expect(await gm.query(api.preferences.folds, { campaignId })).toEqual([
      characterId,
    ]);
  });

  it("setFold refuses a character of another campaign with NOT_FOUND", async () => {
    const { player, campaignId, strangerCharacterId } = await world();
    await expect(
      player.mutation(api.preferences.setFold, {
        campaignId,
        characterId: strangerCharacterId,
        folded: true,
      }),
    ).rejects.toSatisfy((e) => errorCode(e) === "NOT_FOUND");
  });

  it("folds and setFold refuse an outsider with NOT_FOUND", async () => {
    const { other, campaignId, characterId } = await world();
    await expect(
      other.query(api.preferences.folds, { campaignId }),
    ).rejects.toSatisfy((e) => errorCode(e) === "NOT_FOUND");
    await expect(
      other.mutation(api.preferences.setFold, {
        campaignId,
        characterId,
        folded: true,
      }),
    ).rejects.toSatisfy((e) => errorCode(e) === "NOT_FOUND");
  });
});
