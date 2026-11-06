import { v, type Infer } from "convex/values";

import { resolveTableSettings } from "../src/lib/config/campaign-settings";
import { appError } from "../src/lib/errors/app-error";
import { defeatsInWindows, type InstanceSnapshot, type TallyEncounter } from "../src/lib/domain/journal/tally";
import type { LiveWindow } from "../src/lib/domain/journal/windows";
import { addTally, EMPTY_TALLY, spotlight as spotlightEntries, windowTally, type SessionTally } from "../src/lib/domain/sessions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN, partyOf, readSheet } from "./lib/characterSheet";
import { MAX_ENCOUNTERS, MAX_INSTANCES } from "./lib/encounters";
import { campaignQuery } from "./lib/functions";
import { atLeast, type CampaignPermission } from "./lib/permissions";
import { liveWindows, loadSession, MAX_SESSION_CHARACTER_STATS, tallyRows } from "./lib/sessions";
import { seesFear } from "./campaigns";
import { spotlightEntryValidator, type SpotlightEntry } from "./sessionPlay";

/**
 * The Journal's session tally (plan `.omc/plans/journal.yaml`, tracer JD3a; board "Log & recap"): the six numbers the
 * design shows. Every member reads it (dcm-z9rz.25, user 2026-11-05: players' Log & recap shows the tally too); a
 * player gets live and played sessions only (a planned one is SESSION_NOT_FOUND, as in `journalLog.list`) and no Fear
 * numbers while "Players see the GM's Fear" is off (`fearHidden`, config R1). Read-only.
 * `spotlight` below (config JO3) is the Journal's spotlight bars: GM and co-GMs always, players with the setting on.
 *
 * Every "during the session" read uses J0's `liveWindows` (a played session can start again, D10 B7):
 * - Fear gained / spent: the stored `sessions.tally` of the finished windows (S3 adds each at End, as
 *   `sessionPlay.tally`) plus the open window counted from the Fear history (`tallyRows` / `windowTally`). A session
 *   with finished windows but no stored tally (played before the tally existed) counts those windows from history.
 *   Rests are no longer shown (design) but stay in the stored tally.
 * - Critical successes: `actionLog` rows in the windows whose roll came out `critical`, not undone (a row the GM
 *   removed from the feed still counts: removal is display only).
 * - Adversaries defeated: every adversary defeated during the windows, also in a fight started in an earlier session
 *   (dcm-z9rz.26, `defeatsInWindows` in src/lib/domain/journal/tally.ts); a Minion group counts its defeated Minions
 *   (one HP each, CB p.201: its marked HP, the whole group when defeated).
 * - Hope spent / HP marked: the sum of the session's `sessionCharacterStats` rows (JD3b writes them, user Q8).
 */

/** The most action-log rows the criticals read across all windows; more marks the result `truncated`. */
export const MAX_TALLY_FEED_ROWS = 1000;
/** The most action-log rows read after a played session's last window, for a fight that ran on past it. */
export const MAX_TALLY_AFTER_ROWS = 200;

const count = v.union(v.number(), v.null());

export const journalTallyValidator = v.object({
  /**
   * Each count is null before the session was ever live (the tiles show '-'); all six are null or none is, except the
   * two Fear counts, which are also null for a player while `fearHidden`.
   */
  fearGained: count,
  fearSpent: count,
  hopeSpent: count,
  hpMarked: count,
  adversariesDefeated: count,
  criticals: count,
  /** The session is live: its open window counts up to now. */
  live: v.boolean(),
  /** A read hit its cap (Fear history, rests or the action log): the counts are a floor. */
  truncated: v.boolean(),
  /** A player while "Players see the GM's Fear" is off (config R1): no Fear counts, the Fear tiles are left out. */
  fearHidden: v.boolean(),
});
export type JournalTally = Infer<typeof journalTallyValidator>;

/** Fear gained / spent over the windows: the stored tally for finished windows (else history), history for the open one. */
async function fearOf(ctx: QueryCtx, campaignId: Id<"campaigns">, session: Doc<"sessions">, windows: readonly LiveWindow[]) {
  let tally: SessionTally = session.tally ?? EMPTY_TALLY;
  let truncated = false;
  for (const w of windows) {
    if (!w.open && session.tally !== undefined) continue;
    const rows = await tallyRows(ctx, campaignId, w.from, w.open ? undefined : w.to);
    tally = addTally(tally, windowTally(rows.fear, rows.rests, w.open ? { from: w.from } : { from: w.from, to: w.to }));
    truncated ||= rows.truncated;
  }
  return { fearGained: tally.fearGained, fearSpent: tally.fearSpent, truncated };
}

/**
 * The index range's upper end for one window. The open window of a live session ends at the `Date.now()` the query ran
 * at, so bounding by it would leave later rows outside the read range and the tally would not update live (Convex
 * re-runs a query only when a write lands in a range it read). Closed windows end at their `to`. Same rule as `upTo`
 * in `convex/journalLog.ts`.
 */
function upTo<Q extends { lte: (field: "at", value: number) => unknown }>(q: Q, w: LiveWindow): Q {
  return w.open ? q : (q.lte("at", w.to) as Q);
}

/** The action-log rows in the windows (criticals and adversary snapshots); at most MAX_TALLY_FEED_ROWS rows read in all. */
async function feedOf(ctx: QueryCtx, campaignId: Id<"campaigns">, windows: readonly LiveWindow[]) {
  let left = MAX_TALLY_FEED_ROWS;
  const rows: Doc<"actionLog">[] = [];
  let truncated = false;
  for (const w of windows) {
    if (left <= 0) {
      truncated = true;
      break;
    }
    const got = await ctx.db
      .query("actionLog")
      .withIndex("by_campaign_at", (q) => upTo(q.eq("campaignId", campaignId).gte("at", w.from), w))
      .take(left + 1);
    if (got.length > left) truncated = true;
    rows.push(...got.slice(0, left));
    left -= Math.min(got.length, left);
  }
  return { rows, truncated };
}

/** Critical rolls among the rows, not undone (a row the GM removed from the feed still counts: removal is display only). */
function criticalsIn(rows: readonly Doc<"actionLog">[]): number {
  return rows.filter((row) => row.roll?.outcome === "critical" && row.undoneAt === undefined).length;
}

/** Each row's `adversaryBefore` entries as snapshots (an instance's state just before the row's action). */
function snapshotsIn(rows: readonly Doc<"actionLog">[]): InstanceSnapshot[] {
  return rows.flatMap((row) => (row.adversaryBefore ?? []).map((b) => ({ instanceId: b.instanceId, hp: b.hp, defeated: b.defeated, at: row.at })));
}

/**
 * Adversaries defeated during the windows (dcm-z9rz.26, `defeatsInWindows`): every instance of an encounter that ran in
 * a window, also one started in an earlier session. A closed window's end state is the first snapshot after it, so
 * when a fight ran on past the session's last window this reads at most MAX_TALLY_AFTER_ROWS rows after it. The
 * campaign's encounters and their instances are capped.
 */
async function defeatsOf(ctx: QueryCtx, campaignId: Id<"campaigns">, windows: readonly LiveWindow[], feed: readonly Doc<"actionLog">[]) {
  const all = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId))
    .take(MAX_ENCOUNTERS);
  const first = windows[0]!;
  const last = windows[windows.length - 1]!;
  const encounters: TallyEncounter[] = [];
  for (const encounter of all) {
    const { startedAt, endedAt } = encounter;
    if (startedAt === undefined || startedAt > last.to) continue;
    if (endedAt !== undefined && endedAt >= startedAt && endedAt < first.from) continue;
    const instances = await ctx.db
      .query("encounterAdversaries")
      .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
      .take(MAX_INSTANCES);
    encounters.push({
      startedAt,
      endedAt,
      instances: instances.map((i) => ({
        id: i._id,
        hp: i.hp,
        defeated: i.defeated,
        hpMax: i.stats.hpMax,
        ...(i.minionCount !== undefined ? { minionCount: i.minionCount } : {}),
      })),
    });
  }
  const snapshots = snapshotsIn(feed);
  const ranOn = (e: TallyEncounter) => e.endedAt === undefined || e.startedAt === undefined || e.endedAt < e.startedAt || e.endedAt > last.to;
  if (!last.open && encounters.some(ranOn)) {
    const after = await ctx.db
      .query("actionLog")
      .withIndex("by_campaign_at", (q) => q.eq("campaignId", campaignId).gt("at", last.to))
      .take(MAX_TALLY_AFTER_ROWS);
    snapshots.push(...snapshotsIn(after));
  }
  return defeatsInWindows(encounters, snapshots, windows);
}

/** The session's per-PC Hope spent and HP marked, summed (one row per PC, so the character cap bounds it). */
async function characterStatsOf(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const rows = await ctx.db
    .query("sessionCharacterStats")
    .withIndex("by_session_character", (q) => q.eq("sessionId", sessionId))
    .take(MAX_SESSION_CHARACTER_STATS);
  return rows.reduce((sum, r) => ({ hopeSpent: sum.hopeSpent + r.hopeSpent, hpMarked: sum.hpMarked + r.hpMarked }), { hopeSpent: 0, hpMarked: 0 });
}

/** The six tally numbers of one session (JD3a); null counts before the session was ever live. */
export const tally = campaignQuery({
  need: "view",
  enough: "owner",
  args: { sessionId: v.string() },
  returns: journalTallyValidator,
  handler: async (ctx, { sessionId }): Promise<JournalTally> => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    if (ctx.permission !== "owner" && session.status === "planned") throw appError("SESSION_NOT_FOUND");
    const fearHidden = !seesFear(ctx.campaign, ctx.permission);
    const live = session.status === "live";
    const windows = await liveWindows(ctx, session);
    if (windows.length === 0) {
      return { fearGained: null, fearSpent: null, hopeSpent: null, hpMarked: null, adversariesDefeated: null, criticals: null, live, truncated: false, fearHidden };
    }
    const fear = await fearOf(ctx, ctx.campaign._id, session, windows);
    const feed = await feedOf(ctx, ctx.campaign._id, windows);
    const adversariesDefeated = await defeatsOf(ctx, ctx.campaign._id, windows, feed.rows);
    const stats = await characterStatsOf(ctx, session._id);
    return {
      fearGained: fearHidden ? null : fear.fearGained,
      fearSpent: fearHidden ? null : fear.fearSpent,
      hopeSpent: stats.hopeSpent,
      hpMarked: stats.hpMarked,
      adversariesDefeated,
      criticals: criticalsIn(feed.rows),
      live,
      truncated: fear.truncated || feed.truncated,
      fearHidden,
    };
  },
});

// ---------------------------------------------------------------- spotlight (config JO3, Q5 a)

/** The Journal's spotlight bars: one entry per active PC, or null when the caller may not see them. */
export const journalSpotlightValidator = v.union(v.array(spotlightEntryValidator), v.null());
export type JournalSpotlight = Infer<typeof journalSpotlightValidator>;

/**
 * Whether the caller sees the spotlight balance (config Q5 a): the GM and every co-GM (`owner` permission) always, a
 * player only with the table setting `spotlightToPlayers` on (default off). The tally tiles are every member's (`tally`).
 */
export function seesSpotlight(campaign: Pick<Doc<"campaigns">, "tableSettings">, permission: CampaignPermission | null): boolean {
  return atLeast(permission, "owner") || resolveTableSettings(campaign.tableSettings).spotlightToPlayers;
}

/** The name a bar shows; an unreadable sheet still gets a bar (same rule as `sessionPlay.spotlight`). */
function characterName(character: Doc<"characters">): string {
  try {
    return readSheet(character.sheet).name.trim() || "Unnamed character";
  } catch {
    return "Unnamed character";
  }
}

/**
 * The Journal's spotlight read (JT's bars and least-spotlight line, Log & recap): the session's active PCs with their
 * counts and who is due, as `sessionPlay.spotlight`. Any member may call it; a player gets null unless the GM turned on
 * "Show spotlight balance to players" (`seesSpotlight`).
 */
export const spotlight = campaignQuery({
  need: "view",
  args: { sessionId: v.string() },
  returns: journalSpotlightValidator,
  handler: async (ctx, { sessionId }): Promise<SpotlightEntry[] | null> => {
    if (!seesSpotlight(ctx.campaign, ctx.permission)) return null;
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const active = (await partyOf(ctx, ctx.campaign._id)).filter((c) => c.status === "active");
    const names = new Map(active.map((c) => [c._id, characterName(c)]));
    const rows = await ctx.db
      .query("sessionSpotlights")
      .withIndex("by_session_character", (q) => q.eq("sessionId", session._id))
      .take(MAX_CHARACTERS_PER_CAMPAIGN);
    return spotlightEntries(
      active.map((c) => c._id),
      rows,
    ).map((e) => ({ ...e, name: names.get(e.characterId) ?? "Unnamed character" }));
  },
});
