/**
 * Rolls tick countdowns (plan countdowns-advanced, K1).
 *
 * - `tickArmedCountdowns` (called by convex/rolls.ts after a counted roll resolves): every armed, active dashboard
 *   countdown that is not long-term ticks by the roll's outcome through K0's `applyTick` (source "roll", the roll row as
 *   entryId), so `actionLog.undo` takes the ticks back (D11, Q5). A chase pair moves both rows by `chaseTicks`, computed
 *   from the pair before either moves, and not at all once `chaseEnded` (R8, D9).
 * - `preview` / `applyRoll`: the GM's "Tick countdowns" button on a counted roll row of the feed (Q1 (c)): which
 *   countdowns the roll would tick and by how much, then ticks the chosen ones with source "feed" (armed or not). A
 *   (roll row, countdown) pair ticks at most once, automatically or by the button (D5).
 * - `countedRows`: which feed rows carry the button (a Tag Team counts once, on its group's first result row, R10).
 *
 * Counted rolls (D2, D3, `countsAsActionRoll`): a PC's action roll as recorded (no Difficulty = a success), and an
 * applied Tag Team result once for the pair. Never reaction rolls (CB p.99), damage rolls, GM free rolls, Tag Team
 * rolls (pending or picked from), or undone rows.
 *
 * Core Book p.162 (standard countdown): "ticks down every time a player makes an action roll, regardless of the result.
 *   When the countdown die reaches 0, the countdown's effect triggers immediately after the last action roll is resolved."
 * Core Book p.163: the Dynamic Countdown Advancement table and Chase Countdowns.
 * Core Book p.97: "A Tag Team Roll counts as a single action roll for the purposes of any countdowns or features that
 *   track action rolls."
 */
import { v } from "convex/values";

import { chaseTicks, countsAsActionRoll, rollTicks, type ChasePair } from "../src/lib/domain/countdowns/advanced";
import type { RollOutcome } from "../src/lib/domain/duality";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { applyTick } from "./lib/countdownTicks";
import { gmQuery, keyedGmMutation } from "./lib/functions";
import { countdownModeValidator } from "./tables/countdowns";
import { rollValidator } from "./lib/validators/actionLog";

/** A campaign has few dashboard countdowns; reads stop here. */
const COUNTDOWN_SCAN = 100;
/** A Tag Team group holds at most 4 rows (two rolls, two results). */
const GROUP_SCAN = 5;
/** Most countdowns one apply or rows one countedRows call may name. */
const MAX_IDS = 100;

// ---------------------------------------------------------------- shared reads

/** The rows of a roll's group, in log order (as rolls.ts reads a Tag Team group). */
async function groupOf(ctx: QueryCtx, row: Doc<"actionLog">): Promise<Doc<"actionLog">[]> {
  if (row.groupId === undefined) return [row];
  return (
    await ctx.db
      .query("actionLog")
      .withIndex("by_campaign_group", (q) => q.eq("campaignId", row.campaignId).eq("groupId", row.groupId))
      .take(GROUP_SCAN)
  ).sort((a, b) => a.at - b.at || a._creationTime - b._creationTime);
}

/**
 * Whether a log row is a counted roll (D2): a plain action roll row, or the first result row of an applied Tag Team
 * (four action-roll rows: the two rolls, then the two results; R10 keys the pair on the first result).
 */
async function countedRow(ctx: QueryCtx, row: Doc<"actionLog">): Promise<boolean> {
  const undone = row.undoneAt !== undefined;
  if (row.groupId === undefined) return countsAsActionRoll(row.roll, { logKind: row.kind, undone });
  const group = await groupOf(ctx, row);
  const tagTeam = group.length >= 2 && group.length <= 4 && group.every((r) => r.kind === "roll" && r.roll?.kind === "action");
  if (!tagTeam) return false;
  if (group.length === 4 && group[2]!._id === row._id) return countsAsActionRoll(row.roll, { logKind: row.kind, undone, tagTeam: "result" });
  return false;
}

/** The campaign's dashboard countdowns (ownerKey unset), oldest first. */
async function dashboardCountdowns(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"countdowns">[]> {
  return ctx.db
    .query("countdowns")
    .withIndex("by_campaign_owner", (q) => q.eq("campaignId", campaignId).eq("ownerKey", undefined))
    .take(COUNTDOWN_SCAN);
}

/**
 * How far `outcome` ticks a countdown (D1, R4): `rollTicks` by its mode, or for a chase row its side of `chaseTicks`
 * from the pair as it stands (0 once the chase has ended, D9). `partners` caches rows already read.
 */
async function amountFor(ctx: QueryCtx, countdown: Doc<"countdowns">, outcome: RollOutcome, partners: Map<string, Doc<"countdowns"> | null>): Promise<number> {
  const chase = countdown.chase;
  if (chase === undefined) return rollTicks(countdown.mode, outcome);
  if (!partners.has(chase.partnerId)) partners.set(chase.partnerId, await ctx.db.get("countdowns", chase.partnerId));
  const partner = partners.get(chase.partnerId) ?? null;
  if (partner === null) return rollTicks(countdown.mode, outcome);
  const self = { currentValue: countdown.currentValue, status: countdown.status };
  const other = { currentValue: partner.currentValue, status: partner.status };
  const pair: ChasePair = chase.side === "party" ? { party: self, rivals: other } : { party: other, rivals: self };
  return chaseTicks(pair, outcome)[chase.side];
}

/** The (row, countdown) pairs of a row that ticked and were not taken back (D5), read in a query. */
async function tickedBy(ctx: QueryCtx, entryId: Id<"actionLog">): Promise<Set<string>> {
  const rows = await ctx.db
    .query("countdownTicks")
    .withIndex("by_entry_countdown", (q) => q.eq("entryId", entryId))
    .take(COUNTDOWN_SCAN);
  return new Set(rows.filter((r) => r.revertedAt === undefined).map((r) => r.countdownId));
}

/** A roll row of this campaign, or NOT_FOUND. */
async function campaignRow(ctx: QueryCtx, campaignId: Id<"campaigns">, entryId: Id<"actionLog">): Promise<Doc<"actionLog">> {
  const row = await ctx.db.get("actionLog", entryId);
  if (row === null || row.campaignId !== campaignId || row.removedAt !== undefined) throw appError("NOT_FOUND");
  return row;
}

// ---------------------------------------------------------------- the automatic tick

/**
 * Ticks the campaign's armed countdowns for one counted roll (Q1, D4, D6): call it after the roll's Hope, Stress and
 * Fear are applied and its row is logged. `entryId` is the roll row (a Tag Team: its group's first result row).
 * Paused, completed, cancelled, unarmed, long-term and frame-owned countdowns are skipped. Amounts are computed before
 * any row moves, so both sides of a chase read the pair as it stood before the roll.
 */
export async function tickArmedCountdowns(
  ctx: MutationCtx,
  roll: { campaignId: Id<"campaigns">; entryId: Id<"actionLog">; outcome: RollOutcome; actorId: Id<"users"> },
): Promise<void> {
  const armed = await ctx.db
    .query("countdowns")
    .withIndex("by_campaign_armed", (q) => q.eq("campaignId", roll.campaignId).eq("armed", true))
    .take(COUNTDOWN_SCAN);
  const live = armed.filter((c) => c.ownerKey === undefined && c.status === "active" && c.mode !== "longTerm");
  if (live.length === 0) return;
  const partners = new Map<string, Doc<"countdowns"> | null>(live.map((c) => [c._id, c]));
  const plan: { id: Id<"countdowns">; amount: number }[] = [];
  for (const c of live) plan.push({ id: c._id, amount: await amountFor(ctx, c, roll.outcome, partners) });
  for (const { id, amount } of plan) {
    if (amount === 0) continue;
    const countdown = await ctx.db.get("countdowns", id);
    if (countdown === null) continue;
    await applyTick(ctx, countdown, amount, { source: "roll", entryId: roll.entryId, actorId: roll.actorId });
  }
}

// ---------------------------------------------------------------- the feed button

const previewRow = v.object({
  countdownId: v.id("countdowns"),
  name: v.string(),
  mode: countdownModeValidator,
  armed: v.boolean(),
  currentValue: v.number(),
  /** How far this roll ticks it now (R4; a chase row by chaseTicks). */
  amount: v.number(),
  /** This roll already ticked it (automatically or from the feed, D5). */
  ticked: v.boolean(),
});

/**
 * The countdowns a counted roll row can tick (GM only): each active dashboard countdown that is not long-term, with
 * the amount this roll would tick it and whether it already did. NOT_FOUND for another campaign's row; INVALID for a
 * row that is not a counted roll (D2) or was undone.
 */
export const preview = gmQuery({
  args: { entryId: v.id("actionLog") },
  returns: v.object({ outcome: rollValidator.fields.outcome, countdowns: v.array(previewRow) }),
  handler: async (ctx, { entryId }) => {
    const row = await campaignRow(ctx, ctx.campaign._id, entryId);
    if (row.roll === undefined || !(await countedRow(ctx, row))) throw appError("INVALID", "That roll doesn't count toward countdowns.");
    const outcome = row.roll.outcome;
    const all = await dashboardCountdowns(ctx, ctx.campaign._id);
    const partners = new Map<string, Doc<"countdowns"> | null>(all.map((c) => [c._id, c]));
    const ticked = await tickedBy(ctx, entryId);
    const countdowns = [];
    for (const c of all) {
      if (c.status !== "active" || c.mode === "longTerm") continue;
      countdowns.push({
        countdownId: c._id,
        name: c.name,
        mode: c.mode ?? "standard",
        armed: c.armed ?? false,
        currentValue: c.currentValue,
        amount: await amountFor(ctx, c, outcome, partners),
        ticked: ticked.has(c._id),
      });
    }
    return { outcome, countdowns };
  },
});

/**
 * Ticks the chosen countdowns by a counted roll's outcome (GM only, source "feed"), armed or not; each pair at most
 * once (D5). Refusals: NOT_FOUND (a row or countdown of another campaign, a frame-owned countdown), INVALID (an undone
 * or not counted row), COUNTDOWN_RULE (a pair already ticked, a countdown that is not active, a long-term countdown).
 * All or nothing. Returns each countdown's value after the tick and whether it triggered.
 */
export const applyRoll = keyedGmMutation({
  rateLimit: "roll",
  args: { entryId: v.id("actionLog"), countdownIds: v.array(v.id("countdowns")) },
  returns: v.array(v.object({ countdownId: v.id("countdowns"), currentValue: v.number(), triggered: v.boolean() })),
  handler: async (ctx, { entryId, countdownIds }) =>
    ctx.once("countdown_apply_roll", { entryId, countdownIds }, async () => {
      if (countdownIds.length === 0 || countdownIds.length > MAX_IDS) throw appError("INVALID", "Pick at least one countdown.");
      const row = await campaignRow(ctx, ctx.campaign._id, entryId);
      if (row.roll === undefined || !(await countedRow(ctx, row))) throw appError("INVALID", "That roll doesn't count toward countdowns.");
      const outcome = row.roll.outcome;
      const ids = [...new Set(countdownIds)];
      const rows: Doc<"countdowns">[] = [];
      for (const id of ids) {
        const c = await ctx.db.get("countdowns", id);
        if (c === null || c.campaignId !== ctx.campaign._id || c.ownerKey !== undefined) throw appError("NOT_FOUND");
        if (c.mode === "longTerm") throw appError("COUNTDOWN_RULE", "Long-term countdowns don't tick on rolls.");
        rows.push(c);
      }
      // Amounts from the countdowns as they stand before any moves (a chase pair reads the same pair for both sides).
      const partners = new Map<string, Doc<"countdowns"> | null>(rows.map((c) => [c._id, c]));
      const plan: { id: Id<"countdowns">; amount: number }[] = [];
      for (const c of rows) plan.push({ id: c._id, amount: await amountFor(ctx, c, outcome, partners) });
      const out = [];
      for (const { id, amount } of plan) {
        const countdown = (await ctx.db.get("countdowns", id))!;
        const result = await applyTick(ctx, countdown, amount, { source: "feed", entryId, actorId: ctx.user._id });
        out.push({ countdownId: id, currentValue: result.after.currentValue, triggered: result.triggered });
      }
      return out;
    }),
});

/** Which of the given feed rows are counted rolls of this campaign (GM only): the rows that show "Tick countdowns". */
export const countedRows = gmQuery({
  args: { entryIds: v.array(v.id("actionLog")) },
  returns: v.array(v.id("actionLog")),
  handler: async (ctx, { entryIds }) => {
    if (entryIds.length > MAX_IDS) throw appError("INVALID", "Too many rows.");
    const out: Id<"actionLog">[] = [];
    for (const id of new Set(entryIds)) {
      const row = await ctx.db.get("actionLog", id);
      if (row === null || row.campaignId !== ctx.campaign._id || row.kind !== "roll" || row.roll?.kind !== "action") continue;
      if (await countedRow(ctx, row)) out.push(row._id);
    }
    return out;
  },
});
