import { sceneEncounterId } from "../../src/lib/domain/journal/scenes";
import { logMark, windowsFromMarks, type LiveWindow } from "../../src/lib/domain/journal/windows";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN } from "./characterLimits";
import { MAX_LOG_ENTRIES, MAX_LOG_OVERRIDES, MAX_SESSIONS, SESSION_TEXT_MAX, type SessionTextField } from "./validators/sessions";

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

/** The encounter when the id names one of this campaign's encounters; a dangling or foreign id reads as null (S0). */
export async function campaignEncounter(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  id: Id<"encounters"> | undefined,
): Promise<Doc<"encounters"> | null> {
  if (id === undefined) return null;
  const encounter = await ctx.db.get("encounters", id);
  return encounter !== null && encounter.campaignId === campaignId ? encounter : null;
}

/**
 * The encounter the session plays now (Journal JD4, Q6 / Q7) and the scene it belongs to: the playing Combat scene's
 * encounter; else the first Combat scene after it (from the top without a playing scene) that is not done and has
 * one; else the legacy session encounter (`sessionPrep.encounterId`, no `sceneId`). A scene's encounter is
 * `sceneEncounterId` (its own, or the legacy one on the first Combat scene). Dangling links are skipped. Reads at
 * most MAX_SCENES + 1 encounters.
 */
export async function sessionPlayEncounter(
  ctx: QueryCtx,
  session: Doc<"sessions">,
  prep: Doc<"sessionPrep"> | null,
): Promise<{ encounter: Doc<"encounters">; sceneId?: string } | null> {
  if (prep === null) return null;
  const playing = prep.scenes.findIndex((s) => s.state === "playing");
  for (const [i, scene] of prep.scenes.entries()) {
    if (scene.type !== "combat") continue;
    if (i !== playing && (i < playing || scene.state === "done")) continue;
    const encounter = await campaignEncounter(ctx, session.campaignId, sceneEncounterId(scene, i, prep));
    if (encounter !== null) return { encounter, sceneId: scene.id };
  }
  const legacy = await campaignEncounter(ctx, session.campaignId, prep.encounterId);
  return legacy === null ? null : { encounter: legacy };
}

/**
 * The live session, else the newest planned one (B11), with the encounter it plays now (`sessionPlayEncounter`: the
 * playing or next Combat scene's, else the legacy session encounter) and that scene's id; null without such a
 * session or encounter. Used by the Combat Map's '+ Session encounter' (S8) and the Sessions hub's tracker chip
 * (`sessionPrep.current`).
 */
export async function currentSessionEncounter(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
): Promise<{ session: Doc<"sessions">; encounter: Doc<"encounters">; sceneId?: string } | null> {
  const session = (await liveSession(ctx, campaignId)) ?? (await newestPlannedSession(ctx, campaignId));
  if (session === null) return null;
  const found = await sessionPlayEncounter(ctx, session, await sessionPrepOf(ctx, session._id));
  return found === null ? null : { session, ...found };
}

// ---------------------------------------------------------------- scene progress (Journal JD4, Q7)

/** 'Scene N began · <title>' (N counts every scene from 1; without a title 'Scene N began'), cut to the log cap. */
export function sceneBeganLine(n: number, title: string | undefined): string {
  const text = title ? `Scene ${n} began · ${title}` : `Scene ${n} began`;
  const max = SESSION_TEXT_MAX.log;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Marks the scene at `index` Playing now (Q7); the scene that was playing becomes Done. While the session is live it
 * writes one auto log line, event 'scene', 'Scene N began · <title>' (a full log gets no line rather than failing the
 * change; `liveWindows` ignores scene lines). A scene already playing is left alone and writes no second line, so a
 * retry changes nothing. Returns whether the scene changed.
 */
export async function playScene(ctx: MutationCtx, session: Doc<"sessions">, prep: Doc<"sessionPrep">, index: number, by: Id<"users">): Promise<boolean> {
  const scene = prep.scenes[index];
  if (scene === undefined || scene.state === "playing") return false;
  const now = Date.now();
  const scenes = prep.scenes.map((s, i) => {
    if (i === index) return { ...s, state: "playing" as const };
    return s.state === "playing" ? { ...s, state: "done" as const } : s;
  });
  await ctx.db.patch("sessionPrep", prep._id, { scenes, updatedAt: now });
  if (session.status !== "live") return true;
  const rows = await ctx.db
    .query("sessionLog")
    .withIndex("by_session_at", (q) => q.eq("sessionId", session._id))
    .take(MAX_LOG_ENTRIES);
  if (rows.length >= MAX_LOG_ENTRIES) return true;
  await ctx.db.insert("sessionLog", {
    campaignId: session.campaignId,
    sessionId: session._id,
    at: now,
    text: sceneBeganLine(index + 1, scene.title),
    by,
    auto: true,
    event: "scene",
  });
  return true;
}

/**
 * The Combat Map hook (user Q7: scene progress is automatic from the Combat Map). After '+ Session encounter'
 * (`combatTokens.placeSessionEncounter`) starts or places `found`'s encounter, that encounter's scene becomes
 * Playing now (`playScene`). Only while the session is live; a legacy encounter with no scene, or a scene already
 * playing, changes nothing.
 */
export async function playCurrentScene(ctx: MutationCtx, found: { session: Doc<"sessions">; sceneId?: string }, by: Id<"users">): Promise<void> {
  if (found.sceneId === undefined || found.session.status !== "live") return;
  const prep = await sessionPrepOf(ctx, found.session._id);
  if (prep === null) return;
  const index = prep.scenes.findIndex((s) => s.id === found.sceneId);
  if (index === -1) return;
  await playScene(ctx, found.session, prep, index, by);
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
 * Deletes a session's prep, log, spotlight, log override and per-PC stats rows (bounded by MAX_LOG_ENTRIES,
 * MAX_LOG_OVERRIDES and the campaign's character cap) and returns how many it deleted. The session row is the caller's (S2 remove deletes it after this); a linked D8
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
  deleted += spotlights.length;
  // Journal J0: the GM's log overrides and the per-PC tally counters go with the session.
  const overrides = await ctx.db
    .query("sessionLogOverrides")
    .withIndex("by_session_source", (q) => q.eq("sessionId", sessionId))
    .take(MAX_LOG_OVERRIDES + 1);
  for (const row of overrides) await ctx.db.delete("sessionLogOverrides", row._id);
  deleted += overrides.length;
  const stats = await ctx.db
    .query("sessionCharacterStats")
    .withIndex("by_session_character", (q) => q.eq("sessionId", sessionId))
    .take(MAX_SESSION_CHARACTER_STATS);
  for (const row of stats) await ctx.db.delete("sessionCharacterStats", row._id);
  return deleted + stats.length;
}

// ---------------------------------------------------------------- live windows (Journal J0)

/** `sessionCharacterStats` rows per session: one per PC, so the campaign's character cap. */
export const MAX_SESSION_CHARACTER_STATS = MAX_CHARACTERS_PER_CAMPAIGN;

/**
 * The session's live windows, oldest first (D10 B7: a played session can start again). Read from the session's auto
 * start / end log lines (`event`, or the 'Session started' / 'Session ended' text of lines written before Journal J0;
 * GM-typed lines never count), else [startedAt, endedAt ?? now]; a live session's last window is open and ends at
 * `now`. Every "during the session" read of the Journal uses this, never `startedAt` alone. Reads at most
 * MAX_LOG_ENTRIES lines (the log's cap). See `windowsFromMarks` (src/lib/domain/journal/windows.ts).
 */
export async function liveWindows(ctx: QueryCtx, session: Doc<"sessions">, now: number = Date.now()): Promise<LiveWindow[]> {
  const rows = await ctx.db
    .query("sessionLog")
    .withIndex("by_session_at", (q) => q.eq("sessionId", session._id))
    .take(MAX_LOG_ENTRIES);
  const marks = rows.flatMap((row) => {
    const mark = logMark(row);
    return mark === null ? [] : [mark];
  });
  return windowsFromMarks(marks, session, now);
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
