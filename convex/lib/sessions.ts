import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN } from "./characterSheet";
import { MAX_LOG_ENTRIES, MAX_SESSIONS, SESSION_TEXT_MAX, type SessionTextField } from "./validators/sessions";

/**
 * Shared helpers of the D10 session functions (S2-S8, plan `.omc/plans/d10-sessions.yaml`): loaders that keep every
 * row inside the caller's campaign, the session number and cap, the child-row delete used by S2's remove, the text
 * and date checks, and the rows a tally window counts (Q3). Callers are campaign/GM wrappers, so authorization is
 * done; these only scope and bound. Codes come from `src/lib/errors/sessions.ts`.
 */

// ---------------------------------------------------------------- loaders

/** The session when the id is one of this campaign's sessions, else SESSION_NOT_FOUND (bad id, other campaign, deleted). */
export async function loadSession(ctx: QueryCtx, campaignId: Id<"campaigns">, sessionId: string): Promise<Doc<"sessions">> {
  const id = ctx.db.normalizeId("sessions", sessionId);
  const session = id === null ? null : await ctx.db.get("sessions", id);
  if (session === null || session.campaignId !== campaignId) throw appError("SESSION_NOT_FOUND");
  return session;
}

/** The campaign's live session (B6: at most one), or null. Reads the `sessions` rows, the source of truth. */
export async function liveSession(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"sessions"> | null> {
  return ctx.db
    .query("sessions")
    .withIndex("by_campaign_status_n", (q) => q.eq("campaignId", campaignId).eq("status", "live"))
    .first();
}

/** The newest planned session (highest number; B8, B11), or null. */
export async function newestPlannedSession(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"sessions"> | null> {
  return ctx.db
    .query("sessions")
    .withIndex("by_campaign_status_n", (q) => q.eq("campaignId", campaignId).eq("status", "planned"))
    .order("desc")
    .first();
}

/** The last played session (highest number; B9), or null. */
export async function lastPlayedSession(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"sessions"> | null> {
  return ctx.db
    .query("sessions")
    .withIndex("by_campaign_status_n", (q) => q.eq("campaignId", campaignId).eq("status", "played"))
    .order("desc")
    .first();
}

/** The campaign's sessions, newest first (at most MAX_SESSIONS, so provably bounded). */
export async function sessionsNewestFirst(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"sessions">[]> {
  return ctx.db
    .query("sessions")
    .withIndex("by_campaign_n", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .take(MAX_SESSIONS);
}

/** A session's prep row (one per session, created by the first prep write), or null. */
export async function sessionPrepOf(ctx: QueryCtx, sessionId: Id<"sessions">): Promise<Doc<"sessionPrep"> | null> {
  return ctx.db
    .query("sessionPrep")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .unique();
}

/**
 * The live session, else the newest planned one (B11), with its linked D8 encounter when that still exists in this
 * campaign; null without such a session or link (a dangling link reads as none). Used by the Combat Map's
 * '+ Session encounter' (S8) and the Sessions hub's tracker chip (`sessionPrep.current`).
 */
export async function currentSessionEncounter(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
): Promise<{ session: Doc<"sessions">; encounter: Doc<"encounters"> } | null> {
  const session = (await liveSession(ctx, campaignId)) ?? (await newestPlannedSession(ctx, campaignId));
  if (session === null) return null;
  const encounterId = (await sessionPrepOf(ctx, session._id))?.encounterId;
  const encounter = encounterId === undefined ? null : await ctx.db.get("encounters", encounterId);
  return encounter !== null && encounter.campaignId === campaignId ? { session, encounter } : null;
}

// ---------------------------------------------------------------- numbers and caps

/** The number a new session gets: the highest + 1, or 1 (B1; gaps after a delete are kept). */
export async function nextNumber(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<number> {
  const highest = await ctx.db
    .query("sessions")
    .withIndex("by_campaign_n", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .first();
  return (highest?.n ?? 0) + 1;
}

/**
 * Inserts a planned session numbered `nextNumber` (B1) and returns its id and number. SESSION_LIMIT when the
 * campaign already has MAX_SESSIONS. `fields` may set the title or date (S2 create) or another status (S3: the
 * migration's backfilled Played sessions, the dashboard's Start creating one, B8).
 */
export async function insertSession(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  fields: Partial<Pick<Doc<"sessions">, "title" | "date" | "status" | "startedAt" | "endedAt">> = {},
): Promise<{ sessionId: Id<"sessions">; n: number }> {
  const existing = await ctx.db
    .query("sessions")
    .withIndex("by_campaign_n", (q) => q.eq("campaignId", campaignId))
    .take(MAX_SESSIONS);
  if (existing.length >= MAX_SESSIONS) throw appError("SESSION_LIMIT");
  const n = existing.reduce((max, s) => Math.max(max, s.n), 0) + 1;
  const now = Date.now();
  const sessionId = await ctx.db.insert("sessions", { status: "planned", ...fields, campaignId, n, createdAt: now, updatedAt: now });
  return { sessionId, n };
}

/** Refuses (SESSION_LOG_LIMIT) one more log line when the session already has MAX_LOG_ENTRIES. */
export async function assertCanAddLog(ctx: QueryCtx, sessionId: Id<"sessions">): Promise<void> {
  const rows = await ctx.db
    .query("sessionLog")
    .withIndex("by_session_at", (q) => q.eq("sessionId", sessionId))
    .take(MAX_LOG_ENTRIES);
  if (rows.length >= MAX_LOG_ENTRIES) throw appError("SESSION_LOG_LIMIT");
}

// ---------------------------------------------------------------- text and dates

/**
 * The trimmed text, or INVALID when it is longer than the field's cap (SESSION_TEXT_MAX). An empty result is
 * allowed; callers that need text (a log line, 1..300) check `length > 0` themselves.
 */
export function cleanText(field: SessionTextField, value: string): string {
  const text = value.trim();
  if (text.length > SESSION_TEXT_MAX[field]) throw appError("INVALID", `That is longer than ${SESSION_TEXT_MAX[field]} characters.`);
  return text;
}

/** Whether `value` is a real calendar date written 'YYYY-MM-DD' (B1: date only, no time). */
export function isSessionDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Refuses (INVALID) a date that is not 'YYYY-MM-DD'. */
export function assertSessionDate(value: string): void {
  if (!isSessionDate(value)) throw appError("INVALID", "Choose a date.");
}

// ---------------------------------------------------------------- deleting

/**
 * Deletes a session's prep, log and spotlight rows (bounded by MAX_LOG_ENTRIES and the campaign's character cap)
 * and returns how many it deleted. The session row is the caller's (S2 remove deletes it after this); a linked D8
 * encounter stays (Q1: the link lives on the prep row only).
 */
export async function deleteSessionRows(ctx: MutationCtx, sessionId: Id<"sessions">): Promise<number> {
  let deleted = 0;
  const prep = await ctx.db
    .query("sessionPrep")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .take(2);
  for (const row of prep) await ctx.db.delete("sessionPrep", row._id);
  deleted += prep.length;
  const log = await ctx.db
    .query("sessionLog")
    .withIndex("by_session_at", (q) => q.eq("sessionId", sessionId))
    .take(MAX_LOG_ENTRIES + 1);
  for (const row of log) await ctx.db.delete("sessionLog", row._id);
  deleted += log.length;
  const spotlights = await ctx.db
    .query("sessionSpotlights")
    .withIndex("by_session_character", (q) => q.eq("sessionId", sessionId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);
  for (const row of spotlights) await ctx.db.delete("sessionSpotlights", row._id);
  return deleted + spotlights.length;
}

// ---------------------------------------------------------------- tally (Q3)

/** The most history rows (of any kind) and rests one tally window reads; more marks the result `truncated`. */
export const MAX_TALLY_ROWS = 2000;

/** A Fear row of `history` (the `kind: "fear"` member of the union). */
export type FearHistoryRow = Extract<Doc<"history">, { kind: "fear" }>;

/**
 * The rows a tally window counts (Q3): the campaign's Fear history rows with `from <= at <= to` (index
 * `by_campaign_at`; countdown and time rows are skipped in memory) and the rests started in that window (index
 * `by_campaign_started`, every status: S1's tally counts only the finished ones). `to` undefined means the window is
 * still open. Each read takes at most MAX_TALLY_ROWS; `truncated` says one hit it (the counts are then a floor).
 * S1 (src/lib/domain/sessions/tally.ts) turns these into fearGained / fearSpent / shortRests / longRests.
 */
export async function tallyRows(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  from: number,
  to?: number,
): Promise<{ fear: FearHistoryRow[]; rests: Doc<"rests">[]; truncated: boolean }> {
  const history = await ctx.db
    .query("history")
    .withIndex("by_campaign_at", (q) => (to === undefined ? q.eq("campaignId", campaignId).gte("at", from) : q.eq("campaignId", campaignId).gte("at", from).lte("at", to)))
    .take(MAX_TALLY_ROWS + 1);
  const rests = await ctx.db
    .query("rests")
    .withIndex("by_campaign_started", (q) =>
      to === undefined ? q.eq("campaignId", campaignId).gte("startedAt", from) : q.eq("campaignId", campaignId).gte("startedAt", from).lte("startedAt", to),
    )
    .take(MAX_TALLY_ROWS + 1);
  const truncated = history.length > MAX_TALLY_ROWS || rests.length > MAX_TALLY_ROWS;
  const fear = history.slice(0, MAX_TALLY_ROWS).filter((row): row is FearHistoryRow => row.kind === "fear");
  return { fear, rests: rests.slice(0, MAX_TALLY_ROWS), truncated };
}
