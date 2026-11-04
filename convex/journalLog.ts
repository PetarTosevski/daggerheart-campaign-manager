import { v, type Infer } from "convex/values";

import { inWindows, logMark, mergeLog, type LiveWindow } from "../src/lib/domain/journal";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { readSheet } from "./lib/characterSheet";
import { MAX_ENCOUNTERS } from "./lib/encounters";
import { campaignQuery, gmMutation } from "./lib/functions";
import { cleanText, liveWindows, loadSession } from "./lib/sessions";
import { actionKindValidator, type ActionKind, type StoredRoll } from "./lib/validators/actionLog";
import { MAX_LOG_ENTRIES, MAX_LOG_OVERRIDES, sessionLogSourceValidator, type SessionLogSource } from "./lib/validators/sessions";
import { seesFear } from "./campaigns";
import { hideFearNumbers } from "./feed";

/**
 * The Journal's session log (plan `.omc/plans/journal.yaml`, JD2; user answer 'Session log = automatic from the action
 * feed during the session plus GM add / edit / hide. Hiding never deletes feed rows'). One list per session, merged
 * oldest first from:
 *
 * - `feed`: the action log rows inside the session's live windows (`by_campaign_at`); undone rows are left out, rows
 *   the GM removed from the feed stay (hide them here). GM-only rows (hidden GM free rolls) reach only the GM.
 * - `fear`: the Fear history rows inside the windows ('The GM spent 1 Fear', 'Fear 3 → 5').
 * - `encounter`: encounters whose `startedAt` / `endedAt` fall inside a window ('Combat began: Ambush').
 * - `auto` / `gm`: the session's own `sessionLog` lines (start / end / scene stamps, the GM's typed lines).
 *
 * The GM hides or re-words any line through `sessionLogOverrides` (`hide`, `unhide`, `setText`); a GM line's text is
 * edited in place. Adding and deleting GM lines stay `sessionPlay.addLog` / `removeLog`. Every "during the session"
 * read goes through `liveWindows` (a played session can be started again, D10 B7).
 *
 * Who reads it (user Q5): every member. Players get the log of live and played sessions without the GM-hidden lines
 * and without GM-only feed rows; a planned session is SESSION_NOT_FOUND for them, as it is missing from their list.
 * Writes are the GM's.
 */

// ---------------------------------------------------------------- caps

/** Feed rows one log reads across all windows; more marks the result `truncated`. */
export const MAX_LOG_FEED_ROWS = 1000;
/** Fear history rows one log reads across all windows; more marks the result `truncated`. */
export const MAX_LOG_FEAR_ROWS = 500;

// ---------------------------------------------------------------- shapes

/** Where a line comes from: an override source, or 'gm' (the GM's typed `sessionLog` line, edited in place). */
export const JOURNAL_LOG_SOURCES = ["feed", "fear", "encounter", "auto", "gm"] as const;
export type JournalLogSource = (typeof JOURNAL_LOG_SOURCES)[number];
export const journalLogSourceValidator = v.union(...JOURNAL_LOG_SOURCES.map((s) => v.literal(s)));

/**
 * The icon a line shows: a feed row's action kind, or one of the log's own kinds (Fear change, combat began / ended,
 * session start / end, scene began, another automatic line, the GM's note).
 */
export const journalLogIconValidator = v.union(
  actionKindValidator,
  v.literal("fear"),
  v.literal("combatBegan"),
  v.literal("combatEnded"),
  v.literal("start"),
  v.literal("end"),
  v.literal("scene"),
  v.literal("auto"),
  v.literal("note"),
);
export type JournalLogIcon = Infer<typeof journalLogIconValidator>;

export const journalLogLineValidator = v.object({
  /** `${source}:${sourceId}`, unique in the list. */
  key: v.string(),
  source: journalLogSourceValidator,
  /** What `hide` / `unhide` / `setText` name: an actionLog, history or sessionLog id, or '<encounterId>:began|ended'. */
  sourceId: v.string(),
  at: v.number(),
  /** The GM's text when re-worded, else the generated one. */
  title: v.string(),
  sub: v.optional(v.string()),
  icon: journalLogIconValidator,
  /** Hidden by the GM (players never receive hidden lines). */
  hidden: v.boolean(),
  /** Re-worded by the GM (an override text, or a GM line edited in place). */
  edited: v.boolean(),
  /** A GM line: x deletes it (`sessionPlay.removeLog`); every other line is hidden instead. Always false for players. */
  removable: v.boolean(),
});
export type JournalLogLine = Infer<typeof journalLogLineValidator>;

export const journalLogValidator = v.object({
  lines: v.array(journalLogLineValidator),
  /** A source hit its read cap (MAX_LOG_FEED_ROWS, MAX_LOG_FEAR_ROWS, MAX_ENCOUNTERS): the oldest lines are there, later ones are not. */
  truncated: v.boolean(),
});
export type JournalLog = Infer<typeof journalLogValidator>;

// ---------------------------------------------------------------- text (pure)

const ENCOUNTER_EVENTS = { began: "Combat began", ended: "Combat ended" } as const;
type EncounterEvent = keyof typeof ENCOUNTER_EVENTS;

/** "with Hope" / "with Fear" / "· critical success" after a roll's total; nothing for a roll without an outcome. */
function outcomeWords(outcome: StoredRoll["outcome"]): string {
  switch (outcome) {
    case "critical":
      return " · critical success";
    case "successHope":
    case "failHope":
      return " with Hope";
    case "successFear":
    case "failFear":
      return " with Fear";
    case "none":
      return "";
  }
}

/** A roll row's second line: 'Vex rolled 16 with Hope'; the GM's own rolls read 'The GM rolled 12'. */
export function rollSub(who: string | null, roll: StoredRoll): string {
  return `${who ?? "The GM"} rolled ${roll.total}${outcomeWords(roll.outcome)}`;
}

/** A Fear history row's title and sub: 'The GM spent 1 Fear' / 'Fear 4 → 3'; a set or adjust reads 'Fear 3 → 5'. */
export function fearText(row: { action: string; before: number; after: number }): { title: string; sub?: string } {
  const delta = row.after - row.before;
  const change = `Fear ${row.before} → ${row.after}`;
  if (row.action === "spend" && delta < 0) return { title: `The GM spent ${-delta} Fear`, sub: change };
  if (row.action === "gain" && delta > 0) return { title: `The GM gained ${delta} Fear`, sub: change };
  return { title: change };
}

/** A Fear history line as a player reads it while "Players see the GM's Fear" is off (config R1): no numbers. */
export const HIDDEN_FEAR_TITLE = "Fear changed";

/** 'Combat began: Ambush at the Forest Camp'. */
export function encounterTitle(event: EncounterEvent, name: string): string {
  return `${ENCOUNTER_EVENTS[event]}: ${name.trim() || "Unnamed encounter"}`;
}

/** The icon of a `sessionLog` line: its event, a legacy start / end stamp by its text, another auto line, or a GM note. */
function sessionLineIcon(row: Doc<"sessionLog">): JournalLogIcon {
  if (!row.auto) return "note";
  if (row.event !== undefined) return row.event;
  return logMark(row)?.kind ?? "auto";
}

/** Parses an encounter line's source id, '<encounterId>:began' or '<encounterId>:ended'. */
function parseEncounterSourceId(sourceId: string): { id: string; event: EncounterEvent } | null {
  const match = /^(.+):(began|ended)$/.exec(sourceId);
  return match === null ? null : { id: match[1], event: match[2] as EncounterEvent };
}

// ---------------------------------------------------------------- reads

type Line = Omit<JournalLogLine, "key" | "hidden" | "edited" | "removable"> & { removable: boolean; edited: boolean };

/** Each window's rows of one index range, oldest first, at most `cap` in all; `truncated` when there were more. */
async function perWindow<T>(windows: readonly LiveWindow[], cap: number, read: (w: LiveWindow, take: number) => Promise<T[]>) {
  const rows: T[] = [];
  for (const w of windows) {
    const got = await read(w, cap - rows.length + 1);
    rows.push(...got);
    if (rows.length > cap) return { rows: rows.slice(0, cap), truncated: true };
  }
  return { rows, truncated: false };
}

/** A character's name for a roll's sub, or null for an unreadable sheet or a missing character. */
async function namesOf(ctx: QueryCtx, ids: Iterable<Id<"characters">>): Promise<Map<Id<"characters">, string>> {
  const names = new Map<Id<"characters">, string>();
  for (const id of new Set(ids)) {
    const character = await ctx.db.get("characters", id);
    if (character === null) continue;
    try {
      const name = readSheet(character.sheet).name.trim();
      if (name !== "") names.set(id, name);
    } catch {
      // An unreadable sheet gets no name; the summary still names the character.
    }
  }
  return names;
}

/**
 * The upper bound of a window's index range. A live session's open window has no upper bound: its `to` is the `now`
 * the query ran at, so bounding by it would leave later rows outside the read range and the log would not update
 * live (Convex re-runs a query only when its read ranges change). Closed windows end at their `to`.
 */
function upTo<Q extends { lte: (field: "at", value: number) => unknown }>(q: Q, w: LiveWindow): Q {
  return w.open ? q : (q.lte("at", w.to) as Q);
}

async function feedLines(ctx: QueryCtx, campaignId: Id<"campaigns">, windows: readonly LiveWindow[], isGm: boolean) {
  const { rows, truncated } = await perWindow(windows, MAX_LOG_FEED_ROWS, (w, take) =>
    isGm
      ? ctx.db
          .query("actionLog")
          .withIndex("by_campaign_at", (q) => upTo(q.eq("campaignId", campaignId).gte("at", w.from), w))
          .take(take)
      : ctx.db
          .query("actionLog")
          .withIndex("by_campaign_visibility_at", (q) => upTo(q.eq("campaignId", campaignId).eq("visibility", "public").gte("at", w.from), w))
          .take(take),
  );
  const live = rows.filter((row) => row.undoneAt === undefined);
  const names = await namesOf(
    ctx,
    live.flatMap((row) => (row.roll !== undefined && row.characterId !== undefined ? [row.characterId] : [])),
  );
  const lines: Line[] = live.map((row) => ({
    source: "feed",
    sourceId: row._id,
    at: row.at,
    title: row.summary,
    ...(row.roll !== undefined && row.roll.kind !== "damage"
      ? { sub: rollSub(row.characterId === undefined ? null : (names.get(row.characterId) ?? "A character"), row.roll) }
      : {}),
    icon: row.kind satisfies ActionKind,
    removable: false,
    edited: false,
  }));
  return { lines, truncated };
}

async function fearLines(ctx: QueryCtx, campaignId: Id<"campaigns">, windows: readonly LiveWindow[]) {
  const { rows, truncated } = await perWindow(windows, MAX_LOG_FEAR_ROWS, (w, take) =>
    ctx.db
      .query("history")
      .withIndex("by_campaign_at", (q) => upTo(q.eq("campaignId", campaignId).gte("at", w.from), w))
      .take(take),
  );
  const lines: Line[] = rows.flatMap((row) =>
    row.kind === "fear" && row.before !== row.after
      ? [{ source: "fear" as const, sourceId: row._id, at: row.at, ...fearText(row), icon: "fear" as const, removable: false, edited: false }]
      : [],
  );
  return { lines, truncated };
}

/** A campaign's encounters (at most MAX_ENCOUNTERS, the create cap). */
function campaignEncounters(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId))
    .take(MAX_ENCOUNTERS + 1);
}

async function encounterLines(ctx: QueryCtx, campaignId: Id<"campaigns">, windows: readonly LiveWindow[]) {
  const rows = await campaignEncounters(ctx, campaignId);
  const lines: Line[] = [];
  for (const row of rows.slice(0, MAX_ENCOUNTERS)) {
    for (const [event, at] of [
      ["began", row.startedAt],
      ["ended", row.endedAt],
    ] as const) {
      if (at === undefined || !inWindows(windows, at)) continue;
      lines.push({
        source: "encounter",
        sourceId: `${row._id}:${event}`,
        at,
        title: encounterTitle(event, row.name),
        icon: event === "began" ? "combatBegan" : "combatEnded",
        removable: false,
        edited: false,
      });
    }
  }
  return { lines: lines.sort((a, b) => a.at - b.at), truncated: rows.length > MAX_ENCOUNTERS };
}

function sessionLogRows(ctx: QueryCtx, sessionId: Id<"sessions">) {
  return ctx.db
    .query("sessionLog")
    .withIndex("by_session_at", (q) => q.eq("sessionId", sessionId))
    .take(MAX_LOG_ENTRIES);
}

async function ownLines(ctx: QueryCtx, sessionId: Id<"sessions">): Promise<Line[]> {
  return (await sessionLogRows(ctx, sessionId)).map((row) => ({
    source: row.auto ? "auto" : "gm",
    sourceId: row._id,
    at: row.at,
    title: row.text,
    icon: sessionLineIcon(row),
    removable: !row.auto,
    edited: !row.auto && row.editedAt !== undefined,
  }));
}

function sessionOverrides(ctx: QueryCtx, sessionId: Id<"sessions">) {
  return ctx.db
    .query("sessionLogOverrides")
    .withIndex("by_session_source", (q) => q.eq("sessionId", sessionId))
    .take(MAX_LOG_OVERRIDES);
}

/**
 * The session log, oldest first (JD2, user Q5). The GM gets every line with its `hidden` flag; players get live and
 * played sessions only (a planned one is SESSION_NOT_FOUND), without hidden lines and GM-only feed rows. Each source is
 * read with a bounded take; `truncated` says one hit its cap.
 */
export const list = campaignQuery({
  need: "view",
  enough: "owner",
  args: { sessionId: v.string() },
  returns: journalLogValidator,
  handler: async (ctx, { sessionId }) => {
    const isGm = ctx.permission === "owner";
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    if (!isGm && session.status === "planned") throw appError("SESSION_NOT_FOUND");
    const campaignId = ctx.campaign._id;
    const windows = await liveWindows(ctx, session);
    const [feed, fear, encounters, own, overrides] = await Promise.all([
      feedLines(ctx, campaignId, windows, isGm),
      fearLines(ctx, campaignId, windows),
      encounterLines(ctx, campaignId, windows),
      ownLines(ctx, session._id),
      sessionOverrides(ctx, session._id),
    ]);
    const byKey = new Map(overrides.map((o) => [`${o.source}:${o.sourceId}`, o]));
    // R1: with "Players see the GM's Fear" off, a player's Fear lines read 'Fear changed' and the feed and automatic
    // lines lose their Fear numbers. The GM's own words (typed lines, re-wordings) are theirs to share.
    const fearShown = seesFear(ctx.campaign, ctx.permission);
    const playerView = (line: Line): Line => {
      if (fearShown) return line;
      if (line.source === "fear") return { ...line, title: HIDDEN_FEAR_TITLE, sub: undefined };
      if (line.source === "feed" || line.source === "auto") return { ...line, title: hideFearNumbers(line.title) };
      return line;
    };
    const lines = mergeLog([own, feed.lines, fear.lines, encounters.lines]).flatMap((merged): JournalLogLine[] => {
      const line = playerView(merged);
      const key = `${line.source}:${line.sourceId}`;
      const override = line.source === "gm" ? undefined : byKey.get(key);
      const hidden = override?.hidden ?? false;
      if (hidden && !isGm) return [];
      const { sub, ...rest } = line;
      return [
        {
          ...rest,
          ...(sub !== undefined ? { sub } : {}),
          key,
          title: override?.text ?? line.title,
          hidden,
          edited: line.edited || override?.text !== undefined,
          removable: isGm && line.removable,
        },
      ];
    });
    return { lines, truncated: feed.truncated || fear.truncated || encounters.truncated };
  },
});

// ---------------------------------------------------------------- writes

/**
 * SESSION_LOG_SOURCE_NOT_FOUND unless (source, sourceId) is a line of this session's log: a feed or Fear row of the
 * campaign inside a live window (a feed row not undone), an encounter that began / ended inside one, or one of the
 * session's automatic lines.
 */
async function assertSourceInSession(ctx: QueryCtx, session: Doc<"sessions">, source: SessionLogSource, sourceId: string): Promise<void> {
  const notFound = () => appError("SESSION_LOG_SOURCE_NOT_FOUND");
  if (source === "auto") {
    const id = ctx.db.normalizeId("sessionLog", sourceId);
    const row = id === null ? null : await ctx.db.get("sessionLog", id);
    if (row === null || row.sessionId !== session._id || !row.auto) throw notFound();
    return;
  }
  let at: number | undefined;
  if (source === "feed") {
    const id = ctx.db.normalizeId("actionLog", sourceId);
    const row = id === null ? null : await ctx.db.get("actionLog", id);
    if (row !== null && row.campaignId === session.campaignId && row.undoneAt === undefined) at = row.at;
  } else if (source === "fear") {
    const id = ctx.db.normalizeId("history", sourceId);
    const row = id === null ? null : await ctx.db.get("history", id);
    if (row !== null && row.campaignId === session.campaignId && row.kind === "fear") at = row.at;
  } else {
    const parsed = parseEncounterSourceId(sourceId);
    const id = parsed === null ? null : ctx.db.normalizeId("encounters", parsed.id);
    const row = id === null ? null : await ctx.db.get("encounters", id);
    if (row !== null && parsed !== null && row.campaignId === session.campaignId) at = parsed.event === "began" ? row.startedAt : row.endedAt;
  }
  if (at === undefined || !inWindows(await liveWindows(ctx, session), at)) throw notFound();
}

/**
 * Writes one line's override: `hidden` and / or `text` (null clears the text) over what is stored. An override left
 * neither hidden nor re-worded is deleted, so it no longer counts toward MAX_LOG_OVERRIDES. A new row past the cap is
 * SESSION_LOG_OVERRIDE_LIMIT. Only `sessionLogOverrides` is written: feed, Fear and encounter rows are never touched.
 */
async function writeOverride(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  source: SessionLogSource,
  sourceId: string,
  change: { hidden?: boolean; text?: string | null },
): Promise<void> {
  const existing = await ctx.db
    .query("sessionLogOverrides")
    .withIndex("by_session_source", (q) => q.eq("sessionId", session._id).eq("source", source).eq("sourceId", sourceId))
    .unique();
  const hidden = change.hidden ?? existing?.hidden ?? false;
  const text = change.text === undefined ? existing?.text : (change.text ?? undefined);
  if (!hidden && text === undefined) {
    if (existing !== null) await ctx.db.delete("sessionLogOverrides", existing._id);
    return;
  }
  const now = Date.now();
  if (existing !== null) {
    await ctx.db.patch("sessionLogOverrides", existing._id, { hidden, text, updatedAt: now });
    return;
  }
  const rows = await sessionOverrides(ctx, session._id);
  if (rows.length >= MAX_LOG_OVERRIDES) throw appError("SESSION_LOG_OVERRIDE_LIMIT");
  await ctx.db.insert("sessionLogOverrides", {
    campaignId: session.campaignId,
    sessionId: session._id,
    source,
    sourceId,
    hidden,
    ...(text !== undefined ? { text } : {}),
    updatedAt: now,
  });
}

const lineArgs = { sessionId: v.string(), source: sessionLogSourceValidator, sourceId: v.string() };

/** Hides a feed / Fear / encounter / automatic line from the session log (the feed row itself stays). GM lines are deleted instead. */
export const hide = gmMutation({
  args: lineArgs,
  returns: v.null(),
  handler: async (ctx, { sessionId, source, sourceId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    await assertSourceInSession(ctx, session, source, sourceId);
    await writeOverride(ctx, session, source, sourceId, { hidden: true });
    return null;
  },
});

/** 'Show N hidden': shows a hidden line again (its re-wording, if any, is kept). */
export const unhide = gmMutation({
  args: lineArgs,
  returns: v.null(),
  handler: async (ctx, { sessionId, source, sourceId }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    await assertSourceInSession(ctx, session, source, sourceId);
    await writeOverride(ctx, session, source, sourceId, { hidden: false });
    return null;
  },
});

/**
 * Re-words a line (trimmed, at most 300 characters, INVALID past it). A GM line's own text is patched (`editedAt`;
 * empty is INVALID). Any other line gets an override text; an empty text drops it, so the generated title shows again.
 */
export const setText = gmMutation({
  args: { sessionId: v.string(), source: journalLogSourceValidator, sourceId: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId, source, sourceId, text }) => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const line = cleanText("log", text);
    if (source === "gm") {
      const id = ctx.db.normalizeId("sessionLog", sourceId);
      const row = id === null ? null : await ctx.db.get("sessionLog", id);
      if (row === null || row.sessionId !== session._id || row.auto) throw appError("SESSION_LOG_SOURCE_NOT_FOUND");
      if (line === "") throw appError("INVALID", "Write what happened first.");
      if (line !== row.text) await ctx.db.patch("sessionLog", row._id, { text: line, editedAt: Date.now() });
      return null;
    }
    await assertSourceInSession(ctx, session, source, sourceId);
    await writeOverride(ctx, session, source, sourceId, { text: line === "" ? null : line });
    return null;
  },
});
