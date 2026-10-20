import { v, type Infer } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { addTally, spotlight as spotlightEntries, windowTally } from "../src/lib/domain/sessions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN, partyOf, readSheet } from "./lib/characterSheet";
import { gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import { assertCanAddLog, cleanText, loadSession, tallyRows } from "./lib/sessions";
import { MAX_LOG_ENTRIES, sessionTallyValidator } from "./lib/validators/sessions";

/**
 * The Play stage (D10 S5, plan `.omc/plans/d10-sessions.yaml`, rule B4): the spotlight (K7, Q12), the read-only
 * session tally (Q3) and the session log. Everything here is GM-only (K10, Q4): the wrappers refuse players with
 * FORBIDDEN, outsiders with NOT_FOUND. S3 writes the automatic 'Session started.' / 'Session ended.' log lines
 * (`auto: true`, B10); `log` lists them with the GM's own lines.
 */

// ---------------------------------------------------------------- spotlight (B4, K7, Q12)

export const spotlightEntryValidator = v.object({
  characterId: v.id("characters"),
  name: v.string(),
  count: v.number(),
  /** One of the least-spotlit listed characters (S1 `spotlight`): the card rings it. */
  due: v.boolean(),
});
export type SpotlightEntry = Infer<typeof spotlightEntryValidator>;

/** The name a pill shows; an unreadable sheet still gets a pill (the roster shows it as corrupt). */
function characterName(character: Doc<"characters">): string {
  try {
    return readSheet(character.sheet).name.trim() || "Unnamed character";
  } catch {
    return "Unnamed character";
  }
}

/** The session's spotlight rows (one per character, so bounded by the campaign's character cap). */
function spotlightRows(ctx: QueryCtx, sessionId: Id<"sessions">) {
  return ctx.db
    .query("sessionSpotlights")
    .withIndex("by_session_character", (q) => q.eq("sessionId", sessionId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
}

/**
 * The active characters (Q12: status active, so the extras the GM allowed for the session (XC1) are in, dead,
 * retired and away ones are out), in roster order, with their spotlight counts for the session and who is due.
 */
export const spotlight = gmQuery({
  args: { sessionId: v.string() },
  returns: v.array(spotlightEntryValidator),
  handler: async (ctx, { sessionId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const active = (await partyOf(ctx, ctx.campaign._id)).filter((c) => c.status === "active");
    const names = new Map(active.map((c) => [c._id, characterName(c)]));
    const rows = await spotlightRows(ctx, session._id);
    return spotlightEntries(
      active.map((c) => c._id),
      rows,
    ).map((e) => ({ ...e, name: names.get(e.characterId) ?? "Unnamed character" }));
  },
});

/**
 * One spotlight moment for a character (a tap, B4): its count for the session goes up by one. The character must be
 * an active character of this campaign (Q12), else NOT_FOUND. Retry-safe (the key).
 */
export const bumpSpotlight = keyedGmMutation({
  args: { sessionId: v.string(), characterId: v.string() },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { sessionId, characterId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const id = ctx.db.normalizeId("characters", characterId);
    const character = id === null ? null : await ctx.db.get("characters", id);
    if (character === null || character.campaignId !== ctx.campaign._id || character.status !== "active") throw appError("NOT_FOUND");
    return ctx.once("session_spotlight_bump", { sessionId: session._id, characterId: character._id }, async () => {
      const row = await ctx.db
        .query("sessionSpotlights")
        .withIndex("by_session_character", (q) => q.eq("sessionId", session._id).eq("characterId", character._id))
        .unique();
      if (row !== null) {
        await ctx.db.patch("sessionSpotlights", row._id, { count: row.count + 1 });
        return { count: row.count + 1 };
      }
      await ctx.db.insert("sessionSpotlights", { campaignId: ctx.campaign._id, sessionId: session._id, characterId: character._id, count: 1 });
      return { count: 1 };
    });
  },
});

/** 'Reset spotlight' (B4): deletes the session's spotlight rows, so every character is back at 0. */
export const resetSpotlight = gmMutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    for (const row of await spotlightRows(ctx, session._id)) await ctx.db.delete("sessionSpotlights", row._id);
    return null;
  },
});

// ---------------------------------------------------------------- tally (Q3)

export const sessionTallyViewValidator = v.object({
  /** The counts, or null before the session was ever live (the card shows dashes). */
  tally: v.union(sessionTallyValidator, v.null()),
  /** True while the session is live: the open window since `startedAt` is counted in. */
  live: v.boolean(),
  /** The open window hit the read cap (MAX_TALLY_ROWS): the counts are a floor. */
  truncated: v.boolean(),
});

/**
 * The session tally (Q3 a, read-only): the stored counts of the session's finished live windows (S3 adds each at
 * end) plus, while the session is live, the window since `startedAt`, counted from the Fear history and the finished
 * rests (S0 `tallyRows`, S1 `windowTally` / `addTally`). A session that was never live has no tally (null).
 */
export const tally = gmQuery({
  args: { sessionId: v.string() },
  returns: sessionTallyViewValidator,
  handler: async (ctx, { sessionId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const from = session.status === "live" ? session.startedAt : undefined;
    if (from === undefined) return { tally: session.tally ?? null, live: false, truncated: false };
    const rows = await tallyRows(ctx, ctx.campaign._id, from);
    const open = windowTally(rows.fear, rows.rests, { from });
    return { tally: addTally(session.tally, open), live: true, truncated: rows.truncated };
  },
});

// ---------------------------------------------------------------- log (B4, B10)

export const sessionLogEntryValidator = v.object({
  _id: v.id("sessionLog"),
  at: v.number(),
  text: v.string(),
  /** A start / end stamp written by S3 (B10), not typed by the GM. */
  auto: v.boolean(),
});
export type SessionLogEntry = Infer<typeof sessionLogEntryValidator>;

/** The session log, newest first (B4), at most MAX_LOG_ENTRIES (the cap, so this is the whole log). */
export const log = gmQuery({
  args: { sessionId: v.string() },
  returns: v.array(sessionLogEntryValidator),
  handler: async (ctx, { sessionId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const rows = await ctx.db
      .query("sessionLog")
      .withIndex("by_session_at", (q) => q.eq("sessionId", session._id))
      .order("desc")
      .take(MAX_LOG_ENTRIES);
    return rows.map((r) => ({ _id: r._id, at: r.at, text: r.text, auto: r.auto }));
  },
});

/**
 * Adds one of the GM's log lines (B4: Enter adds): trimmed, 1..300 characters (INVALID otherwise), stamped now.
 * SESSION_LOG_LIMIT past MAX_LOG_ENTRIES. Retry-safe (the key).
 */
export const addLog = keyedGmMutation({
  args: { sessionId: v.string(), text: v.string() },
  returns: v.object({ logId: v.id("sessionLog") }),
  handler: async (ctx, { sessionId, text }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const line = cleanText("log", text);
    if (line === "") throw appError("INVALID", "Write what happened first.");
    return ctx.once("session_log_add", { sessionId: session._id, text: line }, async () => {
      await assertCanAddLog(ctx, session._id);
      const logId = await ctx.db.insert("sessionLog", {
        campaignId: ctx.campaign._id,
        sessionId: session._id,
        at: Date.now(),
        text: line,
        by: ctx.user._id,
        auto: false,
      });
      return { logId };
    });
  },
});

/** Removes one log line (the GM's or an automatic one, as on the board). A line not in this session's log is SESSION_LOG_NOT_FOUND. */
export const removeLog = gmMutation({
  args: { sessionId: v.string(), logId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, logId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const id = ctx.db.normalizeId("sessionLog", logId);
    const row = id === null ? null : await ctx.db.get("sessionLog", id);
    if (row === null || row.sessionId !== session._id) throw appError("SESSION_LOG_NOT_FOUND");
    // The Start/End lines are the session's record of what happened automatically (user 2026-10-20): kept.
    if (row.auto) throw appError("INVALID", "Automatic session lines can't be removed.");
    await ctx.db.delete("sessionLog", row._id);
    return null;
  },
});
