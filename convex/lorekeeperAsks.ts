import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { partyOf, readSheet } from "./lib/characterSheet";
import { campaignMutation, campaignQuery, gmMutation, gmQuery } from "./lib/functions";
import { verdictValidator } from "./lib/validators/lorekeeper";

/**
 * 'Ask the GM' (D13 L4, Q8): a member sends one of their own answers to the GM's Rulings card; the GM pins a ruling
 * (lorekeeperRulings.pin, then resolve with its id) or dismisses it. One open ask per answer (LOREKEEPER_ASK_EXISTS).
 * A member reads only their own asks; the open list is the GM's.
 *
 * | Function | Wrapper            | Who                              |
 * |----------|--------------------|----------------------------------|
 * | send     | campaignMutation view | members, on their own answer  |
 * | mine     | campaignQuery view | members: their own open asks     |
 * | listOpen | gmQuery            | the GM                           |
 * | resolve  | gmMutation         | the GM                           |
 */

/** Open asks the GM's card lists at once. */
const OPEN_LIMIT = 50;

const openAskView = v.object({
  _id: v.id("lorekeeperAsks"),
  messageId: v.id("lorekeeperMessages"),
  conversationId: v.id("lorekeeperConversations"),
  askedAt: v.number(),
  /** The asker's account name. */
  askerName: v.string(),
  /** The asker's character in play here ('Asked by Moss'), when they have one. */
  characterName: v.union(v.string(), v.null()),
  question: v.string(),
  verdict: v.union(verdictValidator, v.null()),
  /** The answer's suggested GM call (unclear answers). */
  call: v.union(v.string(), v.null()),
});

/** The question an answer replies to: the message just before it in its conversation. */
async function questionOf(ctx: QueryCtx, answer: Doc<"lorekeeperMessages">): Promise<string> {
  const before = await ctx.db
    .query("lorekeeperMessages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", answer.conversationId).lt("_creationTime", answer._creationTime))
    .order("desc")
    .first();
  return before?.role === "question" ? before.text : "";
}

/** The account name, as the Notes board names people. */
function accountName(user: Doc<"users"> | null): string {
  return user?.name?.trim() || user?.email?.split("@")[0] || "A player";
}

/** The name of a character `userId` has in play in the campaign, or null. */
function characterNameOf(party: Doc<"characters">[], userId: Id<"users">): string | null {
  for (const character of party) {
    if (character.ownerId !== userId || character.status !== "active") continue;
    try {
      return readSheet(character.sheet).name;
    } catch (error) {
      if ((error as { data?: { code?: unknown } }).data?.code !== "CHARACTER_CORRUPT") throw error;
    }
  }
  return null;
}

/** A member sends their own finished answer to the GM. */
export const send = campaignMutation({
  need: "view",
  args: { messageId: v.id("lorekeeperMessages") },
  returns: v.id("lorekeeperAsks"),
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get("lorekeeperMessages", messageId);
    if (message === null || message.campaignId !== ctx.campaign._id || message.userId !== ctx.user._id || message.role !== "answer") {
      throw appError("LOREKEEPER_NOT_FOUND");
    }
    if (message.status !== "done") throw appError("INVALID", "Wait for the answer to finish.");
    const asks = await ctx.db
      .query("lorekeeperAsks")
      .withIndex("by_message", (q) => q.eq("messageId", messageId))
      .take(20);
    if (asks.some((a) => a.resolvedAt === undefined)) throw appError("LOREKEEPER_ASK_EXISTS");
    return ctx.db.insert("lorekeeperAsks", {
      campaignId: ctx.campaign._id,
      messageId,
      askedBy: ctx.user._id,
      askedAt: Date.now(),
    });
  },
});

/** A member's own open asks (so their answers can show 'Sent to the GM'); never another member's. */
export const mine = campaignQuery({
  need: "view",
  args: {},
  returns: v.array(v.object({ _id: v.id("lorekeeperAsks"), messageId: v.id("lorekeeperMessages"), askedAt: v.number() })),
  handler: async (ctx) => {
    const open = await ctx.db
      .query("lorekeeperAsks")
      .withIndex("by_campaign_open", (q) => q.eq("campaignId", ctx.campaign._id).eq("resolvedAt", undefined))
      .take(OPEN_LIMIT * 4);
    return open.filter((a) => a.askedBy === ctx.user._id).map((a) => ({ _id: a._id, messageId: a.messageId, askedAt: a.askedAt }));
  },
});

/** The GM's open asks, oldest first: who asked, the question and the answer's verdict. */
export const listOpen = gmQuery({
  args: {},
  returns: v.array(openAskView),
  handler: async (ctx) => {
    const open = await ctx.db
      .query("lorekeeperAsks")
      .withIndex("by_campaign_open", (q) => q.eq("campaignId", ctx.campaign._id).eq("resolvedAt", undefined))
      .take(OPEN_LIMIT);
    const party = await partyOf(ctx, ctx.campaign._id);
    const out = [];
    for (const ask of open) {
      const answer = await ctx.db.get("lorekeeperMessages", ask.messageId);
      // The asker deleted the conversation: nothing left to rule on.
      if (answer === null) continue;
      out.push({
        _id: ask._id,
        messageId: ask.messageId,
        conversationId: answer.conversationId,
        askedAt: ask.askedAt,
        askerName: accountName(await ctx.db.get("users", ask.askedBy)),
        characterName: characterNameOf(party, ask.askedBy),
        question: await questionOf(ctx, answer),
        verdict: answer.parts?.verdict ?? null,
        call: answer.parts?.call ?? null,
      });
    }
    return out;
  },
});

/** The GM resolves an open ask: with the id of the ruling they pinned for it, or dismissed (no ruling id). */
export const resolve = gmMutation({
  args: { askId: v.id("lorekeeperAsks"), rulingId: v.optional(v.id("lorekeeperRulings")) },
  returns: v.null(),
  handler: async (ctx, { askId, rulingId }) => {
    const ask = await ctx.db.get("lorekeeperAsks", askId);
    if (ask === null || ask.campaignId !== ctx.campaign._id || ask.resolvedAt !== undefined) throw appError("LOREKEEPER_ASK_NOT_FOUND");
    if (rulingId !== undefined) {
      const ruling = await ctx.db.get("lorekeeperRulings", rulingId);
      if (ruling === null || ruling.campaignId !== ctx.campaign._id) throw appError("LOREKEEPER_RULING_NOT_FOUND");
    }
    await ctx.db.patch("lorekeeperAsks", ask._id, {
      resolvedAt: Date.now(),
      resolution: rulingId !== undefined ? "pinned" : "dismissed",
      ...(rulingId !== undefined ? { rulingId } : {}),
    });
    return null;
  },
});
