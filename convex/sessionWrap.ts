import { v, type Infer } from "convex/values";

import { inWindows } from "../src/lib/domain/journal";
import { dashboardNumber, lastSessionText, nextPlannedSession, nextSessionLine } from "../src/lib/domain/sessions";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { campaignMutation, campaignQuery, gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import { partyLevelUp } from "./lib/partyLevelUp";
import { campaignRole } from "./lib/permissions";
import { cleanText, lastPlayedSession, liveSession, liveWindows, loadSession, MAX_TALLY_ROWS, sessionPrepOf } from "./lib/sessions";
import { MAX_SESSIONS } from "./lib/validators/sessions";

/**
 * Wrap-up (D10 S6, plan `.omc/plans/d10-sessions.yaml`, rule B5): the recap (on `sessions`; since Journal JD5 every
 * member writes it and the whole table reads it for live and played sessions, Journal Q4), 'Loot & gold' and 'Countdowns & threads' (on `sessionPrep`, GM-only, Q4) and
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

/**
 * The recap (B5, B9; Journal Q4, user 2026-11-03: everyone can write it, always visible to the table): trimmed, at
 * most 6000 characters (INVALID past it); empty clears it. The GM writes any session's recap. A player writes the
 * recap of a live or played session (the ones they can read, `sessionRecords.list`); a planned one is
 * SESSION_NOT_FOUND to them, as if it did not exist. Access is `permissionFor`'s `view` (the wrapper), and the writer
 * must also be in the campaign (`campaignRole`, the role half of `permissionFor`, as `notesRole` does): a caller who
 * reaches the campaign only through a grant reads the recap but does not write it (FORBIDDEN).
 */
export const setRecap = campaignMutation({
  need: "view",
  enough: "owner",
  args: { sessionId: v.string(), recap: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, recap }) => {
    const gm = ctx.permission === "owner";
    if (!gm && (await campaignRole(ctx, ctx.user, ctx.campaign)) !== "player") throw appError("FORBIDDEN");
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    if (!gm && session.status === "planned") throw appError("SESSION_NOT_FOUND");
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

// ---------------------------------------------------------------- GM: after the session (Journal JD5)

/** One character's level-up during the session: the latest `levelUp` feed row of that character in the live windows. */
export const afterLevelUpValidator = v.object({
  characterId: v.id("characters"),
  /** The feed row's text ('Vex reached level 4.', 'Vex can level up to 4.'). */
  summary: v.string(),
  at: v.number(),
});

/** The Journal's 'After the session' panel (Log & recap). */
export const afterValidator = v.object({
  sessionId: v.id("sessions"),
  /** One entry per character, oldest first. */
  levelUps: v.array(afterLevelUpValidator),
  /** When the GM called the milestone on this session ('Milestone'), or null. */
  milestoneAt: v.union(v.number(), v.null()),
  /** 'Loot & gold' (`sessionPrep.loot`; written with `setLoot`), or null. */
  loot: v.union(v.string(), v.null()),
  /** A window held more than MAX_TALLY_ROWS feed rows: level-ups late in that window may be missing. */
  truncated: v.boolean(),
});
export type SessionAfter = Infer<typeof afterValidator>;

/**
 * 'After the session' (Journal JD5, GM only, Q5): the characters with a `levelUp` feed row (not undone) during the
 * session's live windows (`liveWindows`, so a restarted session counts every window), the milestone stamp and the loot.
 * Each window reads at most MAX_TALLY_ROWS feed rows by `by_campaign_at`. null for an id that is not one of this
 * campaign's sessions (a stale `?s=`), as `get` does. A planned session that never started has no windows: no level-ups.
 */
export const after = gmQuery({
  args: { sessionId: v.string() },
  returns: v.union(afterValidator, v.null()),
  handler: async (ctx, { sessionId }) => {
    const id = ctx.db.normalizeId("sessions", sessionId);
    const session = id === null ? null : await ctx.db.get("sessions", id);
    if (session === null || session.campaignId !== ctx.campaign._id) return null;
    const [windows, prep] = await Promise.all([liveWindows(ctx, session), sessionPrepOf(ctx, session._id)]);
    const latest = new Map<Id<"characters">, SessionAfter["levelUps"][number]>();
    let truncated = false;
    for (const w of windows) {
      const rows = await ctx.db
        .query("actionLog")
        .withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaign._id).gte("at", w.from).lte("at", w.to))
        .take(MAX_TALLY_ROWS + 1);
      if (rows.length > MAX_TALLY_ROWS) truncated = true;
      for (const row of rows.slice(0, MAX_TALLY_ROWS)) {
        if (row.kind !== "levelUp" || row.undoneAt !== undefined || row.characterId === undefined || !inWindows(windows, row.at)) continue;
        const known = latest.get(row.characterId);
        if (known === undefined || known.at <= row.at) latest.set(row.characterId, { characterId: row.characterId, summary: row.summary, at: row.at });
      }
    }
    return {
      sessionId: session._id,
      levelUps: [...latest.values()].sort((a, b) => a.at - b.at),
      milestoneAt: session.milestoneAt ?? null,
      loot: prep?.loot ?? null,
      truncated,
    };
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
