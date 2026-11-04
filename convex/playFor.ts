import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { loadCharacter } from "./lib/characterSheet";
import { gmMutation, gmQuery } from "./lib/functions";

/**
 * The GM's "Play for this character" switch (plan drawer-answers DA6, user answers 2026-10-30): one switch per PC,
 * shared by the map Hand and the sheet drawer, kept on the server so it follows the GM to every device, and on until the
 * GM turns it off. The server already lets the GM act for any PC; the switch only keeps the GM's view greyed until they
 * mean to play for that character. GM only (the same access as the Hand's switch).
 *
 * - `list`: the characters the calling GM plays for in this campaign.
 * - `set`: turns one character's switch on or off (an intent; setting it twice is harmless).
 */

/** A campaign holds a few dozen PCs at most; the read stays bounded anyway. */
const MAX_SWITCHES = 200;

export const list = gmQuery({
  args: {},
  returns: v.array(v.id("characters")),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("playFor")
      .withIndex("by_campaign_user_character", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", ctx.user._id))
      .take(MAX_SWITCHES);
    return rows.map((r) => r.characterId);
  },
});

export const set = gmMutation({
  args: { characterId: v.id("characters"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { characterId, on }) => {
    const { campaign } = await loadCharacter(ctx, ctx.user, characterId, "owner");
    if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
    const rows = await ctx.db
      .query("playFor")
      .withIndex("by_campaign_user_character", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", ctx.user._id).eq("characterId", characterId))
      .take(2);
    if (on && rows.length === 0) await ctx.db.insert("playFor", { campaignId: ctx.campaign._id, userId: ctx.user._id, characterId });
    if (!on) for (const row of rows) await ctx.db.delete("playFor", row._id);
    return null;
  },
});
