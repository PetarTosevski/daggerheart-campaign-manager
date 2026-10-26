import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { migrations } from "../lib/migrations";
import { insertSession } from "../lib/sessions";

/**
 * Backfills the `sessions` table from the sessions played before D10 (plan `.omc/plans/d10-sessions.yaml`, Q11,
 * dcm-bxp.48): they exist only as the campaign rows 'Session started' / 'Session ended…' of `actionLog` (written by
 * `convex/sessions.ts`) and, for a session running now, as `campaignState.sessionStartedAt`. Afterwards SS3
 * (`convex/levelUp.ts`) reads session boundaries from the table, and S9 removes its log-summary fallback.
 *
 * Run once per deployment, dry run first (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/sessions:backfillFromLog", dryRun: true}'
 *   npx convex run migrations/sessions:backfillSessions
 *
 * Both steps are idempotent, so `reset: true` is safe:
 * - `backfillFromLog` walks `actionLog` in creation (= time) order. A start row becomes an untitled Played session
 *   with `startedAt` = the row's time, numbered highest + 1 (so in order), unless a session with that `startedAt`
 *   exists. An end row sets `endedAt` on the latest session that started at or before it and has no end yet; an end
 *   with nothing open (an End pressed with no session running, E2) changes nothing. Rows written by the D10 code are
 *   skipped: every D10 start stamps the session log (B10), so a boundary row at or after the campaign's first
 *   `sessionLog` row is the D10 code's own and its session already exists.
 * - `backfillLive` turns a campaign's running pre-D10 session (`sessionStartedAt` without `liveSessionId`) into the
 *   Live session: the backfilled row with that `startedAt` goes live, or a new untitled one is created, and
 *   `liveSessionId` points at it.
 */

/**
 * How far apart one pre-D10 start's `campaignState.sessionStartedAt` and its 'Session started' row may be (the old
 * `start` stamped the state, then wrote the row, in one mutation). Two real starts are practically never this close:
 * the session has to end in between.
 */
const SAME_START_MS = 2000;

/** A real session start or end row (scene ends share kind "session" but are no boundary, E5). */
function boundary(row: Doc<"actionLog">): "start" | "end" | null {
  if (row.kind !== "session" || row.characterId !== undefined) return null;
  if (row.summary === "Session started") return "start";
  if (row.summary.startsWith("Session ended")) return "end";
  return null;
}

/** Whether the D10 code wrote this row: the campaign's session log (D10 only) began at or before it. */
async function writtenByD10(ctx: MutationCtx, row: Doc<"actionLog">): Promise<boolean> {
  const first = await ctx.db
    .query("sessionLog")
    .withIndex("by_campaign", (q) => q.eq("campaignId", row.campaignId))
    .first();
  return first !== null && first.at <= row.at;
}

export const backfillFromLog = migrations.define({
  table: "actionLog",
  migrateOne: async (ctx, row) => {
    const kind = boundary(row);
    if (kind === null || (await writtenByD10(ctx, row))) return;
    const { campaignId, at } = row;
    if (kind === "start") {
      // Already backfilled: by this step (same `startedAt`) or by `backfillLive` (`sessionStartedAt`, stamped just before the row).
      const existing = await ctx.db
        .query("sessions")
        .withIndex("by_campaign_started", (q) => q.eq("campaignId", campaignId).gte("startedAt", at - SAME_START_MS).lte("startedAt", at))
        .first();
      if (existing !== null) return;
      const { sessionId } = await insertSession(ctx, campaignId, { status: "played", startedAt: at });
      await ctx.db.patch("sessions", sessionId, { createdAt: at, updatedAt: at });
      return;
    }
    const open = await ctx.db
      .query("sessions")
      .withIndex("by_campaign_started", (q) => q.eq("campaignId", campaignId).lte("startedAt", at))
      .order("desc")
      .first();
    if (open === null || open.startedAt === undefined || open.endedAt !== undefined || open.status !== "played") return;
    await ctx.db.patch("sessions", open._id, { endedAt: at, updatedAt: at });
  },
});

export const backfillLive = migrations.define({
  table: "campaignState",
  migrateOne: async (ctx, state) => {
    const startedAt = state.sessionStartedAt;
    if (startedAt === undefined || state.liveSessionId !== undefined) return;
    // The start row's session (its row is written just after `sessionStartedAt` is stamped), still without an end.
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_campaign_started", (q) => q.eq("campaignId", state.campaignId).gte("startedAt", startedAt).lte("startedAt", startedAt + SAME_START_MS))
      .first();
    let sessionId = existing?._id;
    if (existing && existing.endedAt === undefined) {
      await ctx.db.patch("sessions", existing._id, { status: "live", endedAt: undefined, updatedAt: startedAt });
    } else {
      sessionId = (await insertSession(ctx, state.campaignId, { status: "live", startedAt })).sessionId;
      await ctx.db.patch("sessions", sessionId, { createdAt: startedAt, updatedAt: startedAt });
    }
    return { liveSessionId: sessionId };
  },
});

/** Both steps in order (the log first, so the live session keeps its place in the numbering). */
export const backfillSessions = migrations.runner([internal.migrations.sessions.backfillFromLog, internal.migrations.sessions.backfillLive]);
