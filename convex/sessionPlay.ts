import { v, type Infer } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN } from "./lib/characterSheet";
import { gmMutation, keyedGmMutation } from "./lib/functions";
import { assertCanAddLog, cleanText, loadSession } from "./lib/sessions";

/**
 * The Play stage's writes (D10 S5, plan `.omc/plans/d10-sessions.yaml`, rule B4) that the Journal still uses: reset
 * the spotlight, add and remove the GM's session log lines. Everything here is GM-only (K10, Q4): the wrappers refuse
 * players with FORBIDDEN, outsiders with NOT_FOUND. The Journal reads the spotlight, tally and log through
 * convex/journalTally.ts and convex/journalLog.ts; the old Play-stage reads (`spotlight`, `tally`, `log`) and
 * `bumpSpotlight` went with their screen (JF3, user 2026-11-06). `spotlightEntryValidator` stays: journalTally's
 * spotlight returns it.
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

/** The session's spotlight rows (one per character, so bounded by the campaign's character cap). */
function spotlightRows(ctx: QueryCtx, sessionId: Id<"sessions">) {
  return ctx.db
    .query("sessionSpotlights")
    .withIndex("by_session_character", (q) => q.eq("sessionId", sessionId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
}

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

// ---------------------------------------------------------------- log (B4, B10)

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
