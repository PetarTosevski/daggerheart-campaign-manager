import { v, type Infer } from "convex/values";

import { dashboardNumber, lastSessionText, nextPlannedSession, nextSessionLine } from "../src/lib/domain/sessions";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { campaignQuery, gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import { partyLevelUp } from "./lib/partyLevelUp";
import { cleanText, lastPlayedSession, liveSession, loadSession, sessionPrepOf } from "./lib/sessions";
import { MAX_SESSIONS } from "./lib/validators/sessions";

/**
 * Wrap-up (D10 S6, plan `.omc/plans/d10-sessions.yaml`, rule B5): the GM writes the recap (on `sessions`, players read
 * it for live and played sessions, Q4), 'Loot & gold' and 'Countdowns & threads' (on `sessionPrep`, GM-only, Q4) and
 * calls the milestone (Q5: the roster's 'Party levels up', one way, stamped on the session). `dashboard` hands every
 * member the hero line, the next date and the Last Session card (B9) for S7.
 */

// ---------------------------------------------------------------- GM: the stage

/** The Wrap-up stage of one session (GM only). Missing text is absent; `milestoneAt` is set once the milestone was called. */
export const wrapValidator = v.object({
  sessionId: v.id("sessions"),
  n: v.number(),
  recap: v.optional(v.string()),
  loot: v.optional(v.string()),
  threads: v.optional(v.string()),
  milestoneAt: v.optional(v.number()),
});
export type SessionWrap = Infer<typeof wrapValidator>;

/**
 * The session's recap, loot, threads and milestone (B5). null for an id that is not one of this campaign's sessions
 * (a stale or hand-edited `?s=`), so the stage says so instead of failing; the writes refuse it with SESSION_NOT_FOUND.
 */
export const get = gmQuery({
  args: { sessionId: v.string() },
  returns: v.union(wrapValidator, v.null()),
  handler: async (ctx, { sessionId }) => {
    const id = ctx.db.normalizeId("sessions", sessionId);
    const session = id === null ? null : await ctx.db.get("sessions", id);
    if (session === null || session.campaignId !== ctx.campaign._id) return null;
    const prep = await sessionPrepOf(ctx, session._id);
    return { sessionId: session._id, n: session.n, recap: session.recap, loot: prep?.loot, threads: prep?.threads, milestoneAt: session.milestoneAt };
  },
});

/** The recap (B5, B9): trimmed, at most 6000 characters (INVALID past it); empty clears it. Players read it (Q4). */
export const setRecap = gmMutation({
  args: { sessionId: v.string(), recap: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, recap }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const text = cleanText("recap", recap);
    if (text !== (session.recap ?? "")) await ctx.db.patch("sessions", session._id, { recap: text === "" ? undefined : text, updatedAt: Date.now() });
    return null;
  },
});

/** Writes one text field of the session's prep row, creating the row on the first write (S0: `sessionPrepOf` null = empty). */
async function setPrepText(ctx: MutationCtx & { campaign: Doc<"campaigns"> }, sessionId: string, field: "loot" | "threads", value: string) {
  const session = await loadSession(ctx, ctx.campaign._id, sessionId);
  const text = cleanText(field, value);
  const stored = text === "" ? undefined : text;
  const prep = await sessionPrepOf(ctx, session._id);
  const now = Date.now();
  if (prep === null) {
    if (stored !== undefined) await ctx.db.insert("sessionPrep", { campaignId: ctx.campaign._id, sessionId: session._id, scenes: [], [field]: stored, updatedAt: now });
  } else if (prep[field] !== stored) {
    await ctx.db.patch("sessionPrep", prep._id, { [field]: stored, updatedAt: now });
  }
  return null;
}

/** 'Loot & gold' (B5): trimmed, at most 2000 characters; empty clears it. GM-only (Q4). */
export const setLoot = gmMutation({
  args: { sessionId: v.string(), loot: v.string() },
  returns: v.null(),
  handler: (ctx, { sessionId, loot }) => setPrepText(ctx, sessionId, "loot", loot),
});

/** 'Countdowns & threads' (B5): trimmed, at most 4000 characters; empty clears it. GM-only (Q4). */
export const setThreads = gmMutation({
  args: { sessionId: v.string(), threads: v.string() },
  returns: v.null(),
  handler: (ctx, { sessionId, threads }) => setPrepText(ctx, sessionId, "threads", threads),
});

/**
 * 'Milestone reached: the party levels up' (Q5, K5): runs the roster's 'Party levels up' (convex/lib/partyLevelUp.ts:
 * every active character below level 10 is flagged, one public log row each) and stamps `milestoneAt` on the session
 * in the same mutation. One way: a session whose milestone was called returns `{ flagged: 0, called: false }` and
 * changes nothing; there is no unflag. Retry-safe through the key.
 */
export const callMilestone = keyedGmMutation({
  args: { sessionId: v.string() },
  returns: v.object({ flagged: v.number(), called: v.boolean(), milestoneAt: v.number() }),
  handler: async (ctx, { sessionId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    return ctx.once("session_milestone", { sessionId: session._id }, async () => {
      const current = await ctx.db.get("sessions", session._id);
      if (current?.milestoneAt !== undefined) return { flagged: 0, called: false, milestoneAt: current.milestoneAt };
      const { flagged } = await partyLevelUp(ctx, ctx.campaign._id, ctx.user._id);
      const milestoneAt = Date.now();
      await ctx.db.patch("sessions", session._id, { milestoneAt, updatedAt: milestoneAt });
      return { flagged, called: true, milestoneAt };
    });
  },
});

// ---------------------------------------------------------------- every member: the dashboard

/** What the dashboard shows about sessions (B9), for every member. No planned titles, no prep (Q4). */
export const dashboardValidator = v.object({
  /** Hero: 'Session N' (the live one, else the last played) or 'No sessions yet'. */
  dashboardNumber: v.string(),
  /** Hero: 'Next session <date>' / 'Next session not scheduled' (formatted on the server; `nextDate` to format locally). */
  nextSessionLine: v.string(),
  /** 'YYYY-MM-DD' of the first planned session that has a date (lowest number), or null. */
  nextDate: v.union(v.string(), v.null()),
  /** The live session (B6: at most one), or null. Players may open it (Q4). */
  live: v.union(v.object({ sessionId: v.id("sessions"), n: v.number() }), v.null()),
  /** The last played session (highest number), or null. */
  lastPlayed: v.union(v.object({ sessionId: v.id("sessions"), n: v.number(), recap: v.union(v.string(), v.null()) }), v.null()),
  /** The Last Session card's text: the last played recap, else the board's two fallbacks (B9). */
  lastSessionText: v.string(),
});
export type SessionDashboard = Infer<typeof dashboardValidator>;

/** The dashboard's session line and Last Session card (B9), for every member of the campaign. */
export const dashboard = campaignQuery({
  need: "view",
  args: {},
  returns: dashboardValidator,
  handler: async (ctx) => {
    const campaignId: Id<"campaigns"> = ctx.campaign._id;
    const [live, lastPlayed, planned] = await Promise.all([
      liveSession(ctx, campaignId),
      lastPlayedSession(ctx, campaignId),
      ctx.db
        .query("sessions")
        .withIndex("by_campaign_status_n", (q) => q.eq("campaignId", campaignId).eq("status", "planned"))
        .take(MAX_SESSIONS),
    ]);
    // The S1 rules read only these: the live one, the last played one and the planned ones (B9).
    const rows = [...(live ? [live] : []), ...(lastPlayed ? [lastPlayed] : []), ...planned];
    return {
      dashboardNumber: dashboardNumber(rows),
      nextSessionLine: nextSessionLine(rows, { locale: "en-US" }),
      nextDate: nextPlannedSession(rows)?.date ?? null,
      live: live ? { sessionId: live._id, n: live.n } : null,
      lastPlayed: lastPlayed ? { sessionId: lastPlayed._id, n: lastPlayed.n, recap: lastPlayed.recap ?? null } : null,
      lastSessionText: lastSessionText(rows),
    };
  },
});
