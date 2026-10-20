import { v, type Infer } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { newestFirst } from "../src/lib/domain/sessions";
import type { Doc } from "./_generated/dataModel";
import { campaignQuery, gmMutation, keyedGmMutation } from "./lib/functions";
import { assertSessionDate, cleanText, deleteSessionRows, insertSession, loadSession, sessionsNewestFirst } from "./lib/sessions";
import { MAX_SESSIONS, sessionStatusValidator } from "./lib/validators/sessions";

/**
 * Session records (D10 S2, plan `.omc/plans/d10-sessions.yaml`, rule B1): the GM creates a session, edits its title
 * and date, marks it played or not and deletes it; everyone in the campaign reads the list. Players read only live
 * and played sessions with their recap (Q4); planned sessions and every prep / play field stay GM-only. Start and
 * end (with their party effects) are S3's; nothing here runs them.
 */

/** One entry of `list`. GM: number, title, date, status and times. Player: number, title, date, status and recap (Q4). */
export const sessionListItemValidator = v.object({
  _id: v.id("sessions"),
  n: v.number(),
  title: v.optional(v.string()),
  date: v.optional(v.string()),
  status: sessionStatusValidator,
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  recap: v.optional(v.string()),
});
export type SessionListItem = Infer<typeof sessionListItemValidator>;

function gmItem(s: Doc<"sessions">): SessionListItem {
  return { _id: s._id, n: s.n, title: s.title, date: s.date, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt };
}

function playerItem(s: Doc<"sessions">): SessionListItem {
  return { _id: s._id, n: s.n, title: s.title, date: s.date, status: s.status, recap: s.recap };
}

/** The campaign's sessions, newest first (B1). The GM gets every session; a player only the live and played ones (Q4). */
export const list = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(sessionListItemValidator),
  handler: async (ctx) => {
    const campaignId = ctx.campaign._id;
    if (ctx.permission === "owner") return (await sessionsNewestFirst(ctx, campaignId)).map(gmItem);
    const byStatus = (status: "live" | "played") =>
      ctx.db
        .query("sessions")
        .withIndex("by_campaign_status_n", (q) => q.eq("campaignId", campaignId).eq("status", status))
        .order("desc")
        .take(MAX_SESSIONS);
    const [live, played] = await Promise.all([byStatus("live"), byStatus("played")]);
    return newestFirst([...live, ...played]).map(playerItem);
  },
});

/** '+ New session' (B1): number = highest + 1, status planned. SESSION_LIMIT past MAX_SESSIONS. Retry-safe. */
export const create = keyedGmMutation({
  args: {},
  returns: v.object({ sessionId: v.id("sessions"), n: v.number() }),
  handler: async (ctx) => ctx.once("session_create", {}, () => insertSession(ctx, ctx.campaign._id)),
});

/** The session's title (B1); trimmed, at most 120 characters (INVALID past it); empty clears it ('Untitled session'). */
export const setTitle = gmMutation({
  args: { sessionId: v.string(), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, title }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const text = cleanText("title", title);
    await ctx.db.patch("sessions", session._id, { title: text === "" ? undefined : text, updatedAt: Date.now() });
    return null;
  },
});

/** The session's date (B1): 'YYYY-MM-DD', or null / '' to clear it ('No date set'); anything else is INVALID. */
export const setDate = gmMutation({
  args: { sessionId: v.string(), date: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { sessionId, date }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    if (date !== null && date !== "") assertSessionDate(date);
    await ctx.db.patch("sessions", session._id, { date: date === null || date === "" ? undefined : date, updatedAt: Date.now() });
    return null;
  },
});

/**
 * 'Mark as played' / 'Mark as not played' (B1): planned <-> played by hand, WITHOUT the start or end effects. The live
 * session refuses with SESSION_LIVE (it ends through End, S3). Marking a session what it already is changes nothing.
 */
export const setPlayed = gmMutation({
  args: { sessionId: v.string(), played: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { sessionId, played }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    if (session.status === "live") throw appError("SESSION_LIVE");
    const status = played ? "played" : "planned";
    if (session.status !== status) await ctx.db.patch("sessions", session._id, { status, updatedAt: Date.now() });
    return null;
  },
});

/**
 * Deletes a session with its prep, log and spotlight rows; a linked encounter stays (Q1). The live session refuses
 * with SESSION_LIVE (Q10: end it first). Numbers are not reused (B1: gaps are kept).
 */
export const remove = gmMutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    if (session.status === "live") throw appError("SESSION_LIVE");
    await deleteSessionRows(ctx, session._id);
    await ctx.db.delete("sessions", session._id);
    return null;
  },
});
