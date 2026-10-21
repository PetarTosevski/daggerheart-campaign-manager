import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { campaignQuery, gmMutation } from "./lib/functions";
import { LOREKEEPER_LIMITS } from "./lib/validators/lorekeeper";

/**
 * Table rulings (D13 L4, Q14): the GM pins, edits and unpins them; every member reads them; the Lorekeeper's prompt
 * carries the newest 50 (convex/lib/lorekeeper/context.ts). At most 50 per campaign (LOREKEEPER_RULING_LIMIT).
 *
 * | Function | Wrapper            | Who        |
 * |----------|--------------------|------------|
 * | list     | campaignQuery view | members    |
 * | pin      | gmMutation         | the GM     |
 * | update   | gmMutation         | the GM     |
 * | unpin    | gmMutation         | the GM     |
 */

const rulingView = v.object({
  _id: v.id("lorekeeperRulings"),
  title: v.string(),
  text: v.string(),
  /** The session it was pinned in, by number; null when none. */
  sessionN: v.union(v.number(), v.null()),
  /** "Pinned by the GM" or "Pinned by the GM · Session N" (derived on read). */
  meta: v.string(),
  fromMessageId: v.union(v.id("lorekeeperMessages"), v.null()),
  pinnedAt: v.number(),
  updatedAt: v.number(),
});

/** A trimmed title of 1-80 and text of 1-600 characters, or INVALID. */
function cleanTitle(raw: string): string {
  const title = raw.trim();
  if (title.length < 1 || title.length > LOREKEEPER_LIMITS.rulingTitle) throw appError("INVALID", "A ruling's title is 1-80 characters.");
  return title;
}

function cleanText(raw: string): string {
  const text = raw.trim();
  if (text.length < 1 || text.length > LOREKEEPER_LIMITS.rulingText) throw appError("INVALID", "A ruling is 1-600 characters.");
  return text;
}

/** A ruling of this campaign, or LOREKEEPER_RULING_NOT_FOUND. */
async function campaignRuling(ctx: QueryCtx, campaign: Doc<"campaigns">, rulingId: Id<"lorekeeperRulings">) {
  const ruling = await ctx.db.get("lorekeeperRulings", rulingId);
  if (ruling === null || ruling.campaignId !== campaign._id) throw appError("LOREKEEPER_RULING_NOT_FOUND");
  return ruling;
}

/**
 * The answer a ruling is pinned from: an answer of this campaign that is the GM's own, or one a player sent to the GM
 * ('Ask the GM', Q8). Anything else is LOREKEEPER_NOT_FOUND.
 */
async function pinnableAnswer(ctx: MutationCtx, campaign: Doc<"campaigns">, user: Doc<"users">, messageId: Id<"lorekeeperMessages">) {
  const message = await ctx.db.get("lorekeeperMessages", messageId);
  if (message === null || message.campaignId !== campaign._id || message.role !== "answer") throw appError("LOREKEEPER_NOT_FOUND");
  if (message.userId === user._id) return message;
  const asked = await ctx.db
    .query("lorekeeperAsks")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .first();
  if (asked === null) throw appError("LOREKEEPER_NOT_FOUND");
  return message;
}

/** Every member: the campaign's rulings, newest first, with their 'Pinned by the GM · Session N' line. */
export const list = campaignQuery({
  need: "view",
  args: {},
  returns: v.array(rulingView),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("lorekeeperRulings")
      .withIndex("by_campaign_pinned", (q) => q.eq("campaignId", ctx.campaign._id))
      .order("desc")
      .take(LOREKEEPER_LIMITS.rulingsPerCampaign);
    const numbers = new Map<Id<"sessions">, number | null>();
    for (const r of rows) {
      if (r.sessionId === undefined || numbers.has(r.sessionId)) continue;
      const session = await ctx.db.get("sessions", r.sessionId);
      numbers.set(r.sessionId, session !== null && session.campaignId === ctx.campaign._id ? session.n : null);
    }
    return rows.map((r) => {
      const sessionN = r.sessionId === undefined ? null : (numbers.get(r.sessionId) ?? null);
      return {
        _id: r._id,
        title: r.title,
        text: r.text,
        sessionN,
        meta: sessionN === null ? "Pinned by the GM" : `Pinned by the GM · Session ${sessionN}`,
        fromMessageId: r.fromMessageId ?? null,
        pinnedAt: r.pinnedAt,
        updatedAt: r.updatedAt,
      };
    });
  },
});

/** The GM pins a ruling (title ≤ 80, text ≤ 600), optionally from an answer and in a session. */
export const pin = gmMutation({
  args: {
    title: v.string(),
    text: v.string(),
    fromMessageId: v.optional(v.id("lorekeeperMessages")),
    sessionId: v.optional(v.id("sessions")),
  },
  returns: v.id("lorekeeperRulings"),
  handler: async (ctx, { title: rawTitle, text: rawText, fromMessageId, sessionId }) => {
    const title = cleanTitle(rawTitle);
    const text = cleanText(rawText);
    const pinned = await ctx.db
      .query("lorekeeperRulings")
      .withIndex("by_campaign_pinned", (q) => q.eq("campaignId", ctx.campaign._id))
      .take(LOREKEEPER_LIMITS.rulingsPerCampaign);
    if (pinned.length >= LOREKEEPER_LIMITS.rulingsPerCampaign) throw appError("LOREKEEPER_RULING_LIMIT");
    if (fromMessageId !== undefined) await pinnableAnswer(ctx, ctx.campaign, ctx.user, fromMessageId);
    if (sessionId !== undefined) {
      const session = await ctx.db.get("sessions", sessionId);
      if (session === null || session.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
    }
    const now = Date.now();
    return ctx.db.insert("lorekeeperRulings", {
      campaignId: ctx.campaign._id,
      title,
      text,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(fromMessageId !== undefined ? { fromMessageId } : {}),
      pinnedBy: ctx.user._id,
      pinnedAt: now,
      updatedAt: now,
    });
  },
});

/** The GM edits a ruling's title or text (each optional; only the given fields change). */
export const update = gmMutation({
  args: { rulingId: v.id("lorekeeperRulings"), title: v.optional(v.string()), text: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { rulingId, title, text }) => {
    const ruling = await campaignRuling(ctx, ctx.campaign, rulingId);
    await ctx.db.patch("lorekeeperRulings", ruling._id, {
      ...(title !== undefined ? { title: cleanTitle(title) } : {}),
      ...(text !== undefined ? { text: cleanText(text) } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** The GM unpins (deletes) a ruling. Answers that quoted it keep their quote text (the quote's rulingId dangles). */
export const unpin = gmMutation({
  args: { rulingId: v.id("lorekeeperRulings") },
  returns: v.null(),
  handler: async (ctx, { rulingId }) => {
    const ruling = await campaignRuling(ctx, ctx.campaign, rulingId);
    await ctx.db.delete("lorekeeperRulings", ruling._id);
    return null;
  },
});
