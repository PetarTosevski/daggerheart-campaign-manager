/**
 * Starting and ending a session (D5 T5, decision 12; since D10 S3 per session on the Sessions board's live card,
 * plan `.omc/plans/d10-sessions.yaml`).
 *
 * - `start`: puts a session live (B6-B8) and runs the class hook `onSessionStart` for every active PC. With a
 *   `sessionId`, that session; without one, the newest planned session, created when there is none (B8). Pressing
 *   it for the live session does nothing (`alreadyStarted`, E1). Another live session is ended first with every end
 *   effect (B6); a played session starts again and its start effects run again (B7).
 * - `end`: ends the live session (status played, `endedAt`, its tally window added to `sessions.tally`, Q3) and, for
 *   every PC, clears session effects (`expire(sheet, "session")`), runs `onSessionEnd`, and turns Wither tokens into Fear (unless the GM keeps them: `convertWither`, house rule `witherPersists`);
 *   the tokens become GM Fear capped at 12, the rest reported as lost (CB 261; decision). Ending with nothing to
 *   change writes nothing, so a second End is a no-op; with no live session it still clears session effects (E2).
 * - Both stamp the session's log with the board's auto lines (B10) and report the session features that are not
 *   automated (Q8) and, in Journey to Horizon, the Doom Track reminder (Q6).
 * - `current`: the started session, for every member, and whether extra characters are allowed in it.
 * - `allowExtraCharacters` (XC1, user 2026-10-18): while a session runs, the GM lifts the one-active-character rule
 *   for it (INVALID with no session). `end` switches it off; characters made active meanwhile stay active.
 * Each start and end writes one undoable `actionLog` group: a row per changed PC plus a campaign row carrying the
 * Fear. Undo restores the sheets and the Fear; the session's status and times and `sessionStartedAt` keep their
 * values (Q7, E6). `campaignState.sessionStartedAt` / `liveSessionId` are written with the session in the same
 * mutation: they stay the cached "live since" that XC1 and SS3 read.
 */
import { v, type Infer } from "convex/values";

import { expire } from "../src/lib/domain/characters/expiry";
import { onSessionEnd, onSessionStart } from "../src/lib/domain/class-features/hooks";
import { addTally, windowTally } from "../src/lib/domain/sessions";
import { appError } from "../src/lib/errors/app-error";
import { resolveOptions } from "../src/lib/frames/options";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { campaignFearState, gainFear } from "./lib/fear";
import { campaignQuery, keyedGmMutation } from "./lib/functions";
import { insertSession, liveSession, loadSession, newestPlannedSession, tallyRows } from "./lib/sessions";
import { MAX_LOG_ENTRIES, SESSION_TEXT_MAX } from "./lib/validators/sessions";

/** One party: a handful of characters (a group holds at most 50 rows, one is the campaign's). */
const PARTY_MAX = 49;

type Member = { character: Doc<"characters">; sheet: CharacterSheet };

/** The campaign's characters with readable sheets; a corrupt sheet is left alone. More than PARTY_MAX is INVALID, never a silent skip (review M5). */
async function party(ctx: MutationCtx, campaignId: Id<"campaigns">): Promise<Member[]> {
  const rows = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(PARTY_MAX + 1);
  if (rows.length > PARTY_MAX) throw appError("INVALID", `A session can update at most ${PARTY_MAX} characters; remove some from the campaign.`);
  return rows.flatMap((character) => {
    try {
      return [{ character, sheet: readSheet(character.sheet) }];
    } catch {
      return [];
    }
  });
}

const same = (a: CharacterSheet, b: CharacterSheet) => JSON.stringify(a) === JSON.stringify(b);

/** Saves each changed sheet with its row in `groupId`; returns how many changed. */
async function saveChanged(
  ctx: MutationCtx,
  { campaignId, actorId, groupId, summary }: { campaignId: Id<"campaigns">; actorId: Id<"users">; groupId: string; summary: string },
  changes: { character: Doc<"characters">; sheet: CharacterSheet; next: CharacterSheet }[],
): Promise<number> {
  let count = 0;
  for (const { character, sheet, next } of changes) {
    if (same(sheet, next)) continue;
    await saveSheet(ctx, character._id, next);
    await logAction(ctx, { campaignId, characterId: character._id, actorId, kind: "session", visibility: "public", summary: `${sheet.name}: ${summary}`, groupId, before: sheet, undoable: true });
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------- log stamps (B10) and reports (Q6, Q8)

/**
 * Writes one auto line ('Session started.' / 'Session ended.' plus what the party sync did, B10) into the session's
 * log. A full log (MAX_LOG_ENTRIES) gets no stamp rather than failing the start or end; a line past the log cap is
 * shortened with an ellipsis.
 */
async function stampLog(ctx: MutationCtx, session: Doc<"sessions">, by: Id<"users">, text: string): Promise<void> {
  const rows = await ctx.db
    .query("sessionLog")
    .withIndex("by_session_at", (q) => q.eq("sessionId", session._id))
    .take(MAX_LOG_ENTRIES);
  if (rows.length >= MAX_LOG_ENTRIES) return;
  const max = SESSION_TEXT_MAX.log;
  const line = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  await ctx.db.insert("sessionLog", { campaignId: session.campaignId, sessionId: session._id, at: Date.now(), text: line, by, auto: true });
}

/** The board's log line: the stamp, then the notes joined by '; ' and closed with a full stop. */
function logLine(stamp: string, notes: string[]): string {
  return notes.length === 0 ? stamp : `${stamp} ${notes.join("; ")}.`;
}

const isSeraph = (sheet: CharacterSheet) => sheet.classId === "seraph" || sheet.multiclass?.classId === "seraph";

/** 'Ash rolled Prayer Dice: 3, 1' for each Seraph (or Seraph multiclass) after the start (K3, Spellcast trait). */
function prayerNotes(changes: { sheet: CharacterSheet; next: CharacterSheet }[]): string[] {
  return changes.flatMap(({ sheet, next }) => {
    if (!isSeraph(next)) return [];
    const values = next.heldDice.filter((d) => d.kind === "prayer").map((d) => String(d.value ?? "?"));
    return [`${sheet.name} rolled Prayer Dice: ${values.length > 0 ? values.join(", ") : "none"}`];
  });
}

/** 'Ash lost 2 unspent dice' for each PC whose held dice (Rally, Prayer) the end cleared (K3). */
function lostDiceNotes(changes: { sheet: CharacterSheet; next: CharacterSheet }[]): string[] {
  return changes.flatMap(({ sheet, next }) => {
    const lost = sheet.heldDice.filter((d) => !next.heldDice.some((n) => n.id === d.id)).length;
    return lost > 0 ? [`${sheet.name} lost ${lost} unspent ${lost === 1 ? "die" : "dice"}`] : [];
  });
}

/** The Wither conversion as the log and report say it: '3 Wither tokens → +3 Fear (1 Fear lost)'. */
function witherNote(tokens: number, gained: number, lost: number): string {
  return `${tokens} Wither token${tokens === 1 ? "" : "s"} → +${gained} Fear${lost > 0 ? ` (${lost} Fear lost)` : ""}`;
}

const holdsAncestryFeature = (sheet: CharacterSheet, ancestryId: string) =>
  (sheet.ancestry.kind === "single" && sheet.ancestry.id === ancestryId) || (sheet.ancestry.kind === "mixed" && sheet.ancestry.first === ancestryId);

const holdsSubclass = (sheet: CharacterSheet, subclassId: string, rank: "foundation" | "mastery") =>
  (sheet.subclassId === subclassId && (rank === "foundation" || sheet.subclassRank === "mastery")) ||
  (rank === "foundation" && sheet.multiclass?.subclassId === subclassId);

/**
 * Session features the app does not automate (Q8; D5 decision 11: subclass and heritage features are text), as one
 * reminder per PC who has one. Start: Luckbringer (Halfling, CB p.64) and Lunar Phases (Moon mastery, HF p.17). End:
 * Slayer Dice (Call of the Slayer, CB p.48) and Know the Tide (Seaborne, CB p.77).
 */
export function sessionReminders(sheets: readonly CharacterSheet[], when: "start" | "end"): string[] {
  return sheets.flatMap((sheet) => {
    const out: string[] = [];
    if (when === "start") {
      if (holdsAncestryFeature(sheet, "halfling")) out.push(`Luckbringer (${sheet.name}): everyone in the party gains a Hope.`);
      if (holdsSubclass(sheet, "moon", "mastery")) out.push(`Lunar Phases (${sheet.name}): roll a d6 and place it on the card.`);
    } else {
      if (holdsSubclass(sheet, "call-of-the-slayer", "foundation")) out.push(`Slayer Dice (${sheet.name}): clear unspent Slayer Dice and gain a Hope per die cleared.`);
      if (sheet.communityId === "seaborne") out.push(`Know the Tide (${sheet.name}): clear all unspent tokens.`);
    }
    return out;
  });
}

// ---------------------------------------------------------------- end (shared by `end` and `start`, B6)

const endResult = v.object({
  /** Wither tokens cleared from every PC and turned into Fear. */
  tokens: v.number(),
  /** Wither tokens left on the sheets because this End didn't convert them (house rule `witherPersists`). */
  witherKept: v.optional(v.number()),
  fearGained: v.number(),
  /** Tokens past GM Fear's cap of 12: "N Fear lost". */
  fearLost: v.number(),
  /** PCs whose last Hope slot is scarred (CB 106): the GM ends their journey. */
  journeyEnds: v.array(v.object({ characterId: v.id("characters"), name: v.string() })),
  /** The campaign row of the group (undo it to undo the whole End), or null when nothing changed. */
  entryId: v.union(v.id("actionLog"), v.null()),
  /** The session that was live and is now played (absent when none was live). */
  sessionId: v.optional(v.id("sessions")),
  n: v.optional(v.number()),
  /** 'Ash lost 2 unspent dice' per PC (B10). */
  lostDice: v.optional(v.array(v.string())),
  /** Q8 reminders: Slayer Dice, Know the Tide. */
  reminders: v.optional(v.array(v.string())),
  /** Journey to Horizon (Q6, HF p.177): mark a Doom Track box in this tier or below. */
  doomTier: v.optional(v.number()),
});
type EndResult = Infer<typeof endResult>;

type GmCtx = MutationCtx & { campaign: Doc<"campaigns">; user: Doc<"users"> };

/** The live session row (by `liveSessionId`, else the index), or null; a stale marker is ignored. */
async function currentLive(ctx: MutationCtx, campaignId: Id<"campaigns">, state: Doc<"campaignState">): Promise<Doc<"sessions"> | null> {
  if (state.liveSessionId !== undefined) {
    const row = await ctx.db.get("sessions", state.liveSessionId);
    if (row !== null && row.status === "live" && row.campaignId === campaignId) return row;
  }
  return liveSession(ctx, campaignId);
}

/**
 * Whether an End turns Wither tokens into Fear (CB p.261): yes, unless the GM asked otherwise or the campaign's house rule
 * `witherPersists` keeps them across sessions (user 2026-10-20). Outside Witherwild there are no tokens either way.
 */
function convertsWither(campaign: Doc<"campaigns">, convertWither: boolean | undefined): boolean {
  return convertWither ?? !resolveOptions(campaign.frameId, campaign.options).witherPersists;
}

async function runEnd(ctx: GmCtx, convertWither?: boolean): Promise<EndResult> {
  const campaignId = ctx.campaign._id;
  const state = await campaignFearState(ctx, campaignId);
  const live = await currentLive(ctx, campaignId, state);
  const members = await party(ctx, campaignId);
  const onSheets = members.reduce((sum, { sheet }) => sum + sheet.wither, 0);
  const convert = convertsWither(ctx.campaign, convertWither);
  const tokens = convert ? onSheets : 0;
  const kept = convert ? 0 : onSheets;
  const changes = members.map((c) => {
    const next = onSessionEnd(expire(c.sheet, "session"));
    return { ...c, next: convert ? { ...next, wither: 0 } : next };
  });
  const journeyEnds = members
    .filter(({ character, sheet }) => sheet.journeyEnds && character.status !== "dead" && character.status !== "retired")
    .map(({ character, sheet }) => ({ characterId: character._id, name: sheet.name }));

  const started = state.sessionStartedAt !== undefined || live !== null;
  if (!started && changes.every(({ sheet, next }) => same(sheet, next))) {
    return { tokens: 0, fearGained: 0, fearLost: 0, journeyEnds, entryId: null };
  }
  if (started) await ctx.db.patch("campaignState", state._id, { sessionStartedAt: undefined, extraCharactersSession: undefined, liveSessionId: undefined });

  const groupId = newGroupId();
  await saveChanged(ctx, { campaignId, actorId: ctx.user._id, groupId, summary: "session end" }, changes);
  const { gained, lost } = tokens > 0 ? await gainFear(ctx, campaignId, tokens) : { gained: 0, lost: 0 };
  const fearText =
    tokens > 0 ? `; ${tokens} Wither → +${gained} Fear${lost > 0 ? ` (${lost} Fear lost)` : ""}` : kept > 0 ? `; ${kept} Wither kept` : "";
  const entryId = await logAction(ctx, {
    campaignId,
    actorId: ctx.user._id,
    kind: "session",
    visibility: "public",
    summary: `Session ended${fearText}`,
    groupId,
    ...(gained > 0 ? { fearDelta: gained } : {}),
    undoable: true,
  });

  const lostDice = lostDiceNotes(changes);
  const active = members.filter(({ character }) => character.status === "active").map(({ sheet }) => sheet);
  const report: EndResult = {
    tokens,
    fearGained: gained,
    fearLost: lost,
    journeyEnds,
    entryId,
    ...(kept > 0 ? { witherKept: kept } : {}),
    lostDice,
    reminders: sessionReminders(active, "end"),
    ...(ctx.campaign.frameId === "journey-to-horizon" ? { doomTier: ctx.campaign.tier } : {}),
  };
  if (live === null) return report;

  // The session goes Played; its window's tally (Fear history and finished rests, Q3) adds to the stored one (B7).
  const endedAt = Date.now();
  const from = live.startedAt ?? endedAt;
  const rows = await tallyRows(ctx, campaignId, from, endedAt);
  const tally = addTally(live.tally, windowTally(rows.fear, rows.rests, { from, to: endedAt }));
  await ctx.db.patch("sessions", live._id, { status: "played", endedAt, tally, updatedAt: endedAt });
  await stampLog(ctx, live, ctx.user._id, logLine("Session ended.", [
      ...lostDice,
      ...(tokens > 0 ? [witherNote(tokens, gained, lost)] : []),
      ...(kept > 0 ? [`${kept} Wither token${kept === 1 ? "" : "s"} kept on the sheets`] : []),
    ]));
  return { ...report, sessionId: live._id, n: live.n };
}

// ---------------------------------------------------------------- functions

export const current = campaignQuery({
  need: "view",
  args: {},
  returns: v.object({
    startedAt: v.union(v.number(), v.null()),
    extraCharacters: v.boolean(),
    /** The live session's id and number (D10; absent when no session row is live). */
    sessionId: v.optional(v.id("sessions")),
    n: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const state = await campaignFearState(ctx, ctx.campaign._id);
    const startedAt = state.sessionStartedAt ?? null;
    const live = startedAt === null || state.liveSessionId === undefined ? null : await ctx.db.get("sessions", state.liveSessionId);
    return {
      startedAt,
      extraCharacters: state.sessionStartedAt !== undefined && state.extraCharactersSession === state.sessionStartedAt,
      ...(live !== null && live.status === "live" ? { sessionId: live._id, n: live.n } : {}),
    };
  },
});

export const allowExtraCharacters = keyedGmMutation({
  args: { allow: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { allow }) =>
    ctx.once("session_extra_characters", { allow }, async () => {
      const state = await campaignFearState(ctx, ctx.campaign._id);
      if (state.sessionStartedAt === undefined) throw appError("INVALID", "Start a session first.");
      const on = state.extraCharactersSession === state.sessionStartedAt;
      if (on === allow) return null;
      await ctx.db.patch("campaignState", state._id, { extraCharactersSession: allow ? state.sessionStartedAt : undefined });
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        actorId: ctx.user._id,
        kind: "session",
        visibility: "public",
        summary: allow ? "Extra characters allowed this session" : "Extra characters no longer allowed",
        undoable: false,
      });
      return null;
    }),
});

const startResult = v.object({
  startedAt: v.number(),
  alreadyStarted: v.boolean(),
  sessionId: v.optional(v.id("sessions")),
  n: v.optional(v.number()),
  /** 'Ash rolled Prayer Dice: 3, 1' per Seraph (B10). */
  notes: v.optional(v.array(v.string())),
  /** Q8 reminders: Luckbringer, Lunar Phases. */
  reminders: v.optional(v.array(v.string())),
  /** The session that was live and was ended first (B6), with its End report. */
  ended: v.optional(endResult),
});
type StartResult = Infer<typeof startResult>;

export const start = keyedGmMutation({
  /** The session to start (D10); without it, the newest planned one, created when there is none (B8). */
  args: { sessionId: v.optional(v.string()) },
  returns: startResult,
  handler: async (ctx, { sessionId }) =>
    ctx.once("session_start", sessionId === undefined ? {} : { sessionId }, async (): Promise<StartResult> => {
      const campaignId = ctx.campaign._id;
      const state = await campaignFearState(ctx, campaignId);
      let target: Doc<"sessions">;
      if (sessionId === undefined) {
        if (state.sessionStartedAt !== undefined) return { startedAt: state.sessionStartedAt, alreadyStarted: true };
        const planned = await newestPlannedSession(ctx, campaignId);
        target = planned ?? (await ctx.db.get("sessions", (await insertSession(ctx, campaignId)).sessionId))!;
      } else {
        target = await loadSession(ctx, campaignId, sessionId);
        if (target.status === "live") return { startedAt: state.sessionStartedAt ?? target.startedAt ?? target.updatedAt, alreadyStarted: true };
      }

      // B6: one live session per campaign; the running one ends first, with every end effect.
      const ended = state.sessionStartedAt !== undefined || (await liveSession(ctx, campaignId)) !== null ? await runEnd(ctx) : undefined;

      const startedAt = Date.now();
      const fresh = await campaignFearState(ctx, campaignId);
      await ctx.db.patch("campaignState", fresh._id, { sessionStartedAt: startedAt, extraCharactersSession: undefined, liveSessionId: target._id });
      await ctx.db.patch("sessions", target._id, { status: "live", startedAt, updatedAt: startedAt });
      const groupId = newGroupId();
      const active = (await party(ctx, campaignId)).filter(({ character }) => character.status === "active");
      const changes = active.map((c) => ({ ...c, next: onSessionStart(c.sheet, rollDie) }));
      await saveChanged(ctx, { campaignId, actorId: ctx.user._id, groupId, summary: "session start" }, changes);
      await logAction(ctx, { campaignId, actorId: ctx.user._id, kind: "session", visibility: "public", summary: "Session started", groupId, undoable: true });

      const notes = prayerNotes(changes);
      await stampLog(ctx, target, ctx.user._id, logLine("Session started.", notes));
      return {
        startedAt,
        alreadyStarted: false,
        sessionId: target._id,
        n: target.n,
        notes,
        reminders: sessionReminders(
          changes.map(({ next }) => next),
          "start",
        ),
        ...(ended === undefined ? {} : { ended }),
      };
    }),
});

export const end = keyedGmMutation({
  /** `convertWither`: turn Wither tokens into Fear (CB p.261); unset = the campaign's rule (on unless `witherPersists`). */
  args: { convertWither: v.optional(v.boolean()) },
  returns: endResult,
  handler: async (ctx, { convertWither }) =>
    ctx.once("session_end", convertWither === undefined ? {} : { convertWither }, () => runEnd(ctx, convertWither)),
});
