/**
 * The one server path that ticks dashboard countdowns (plan countdowns-advanced, K0): it ticks, triggers, resets,
 * records history, writes the GM's trigger notice and reverts. Rolls (K1), the feed button (K1), manual ticks (K2) and
 * long rests (K4) all call `applyTick`; undo (`undoEntry`) calls `revertTicks`.
 *
 * Contract:
 * - The caller has authorized the campaign and passes a dashboard countdown of it (frame-owned rows are NOT_FOUND here,
 *   D4). Pass the amount from the pure domain (`rollTicks`, `chaseTicks`, 1 for a long rest); the rules run in
 *   `tickCountdown` (D6 clamp, D7 trigger / reset, R7 major event, D8 dice start reuse). A countdown that is not active
 *   is COUNTDOWN_RULE (pass `whilePaused` for a GM correction, E1).
 * - Call it AFTER the action's own effects (R2 "immediately after the last action roll is resolved", D6).
 * - `cause.entryId` (the actionLog row that caused it: the roll row, a Tag Team group's first result row, the rest's
 *   campaign row) records a `countdownTicks` row so undo can take the tick back (D11). A second tick of the same
 *   (row, countdown) pair is COUNTDOWN_RULE (D5). Without an entryId (manual ticks) nothing is recorded for undo.
 * - An amount of 0 changes nothing and writes nothing (`changed: false`).
 * - Each change writes one history row: action = cause.source, or "trigger" when it reached 0. A trigger also logs one
 *   GM-only, not undoable, groupless actionLog row of kind "countdown" ("Doom triggered (2nd time): The dam breaks").
 *
 * ```ts
 * const amount = rollTicks(countdown.mode, roll.outcome);
 * const result = await applyTick(ctx, countdown, amount, { source: "roll", entryId, actorId: ctx.user._id });
 * if (result.triggered) ...; // result.after.currentValue is the reset value for a loop
 * ```
 */
import {
  countdownNoticeText,
  tickCountdown,
  type CountdownTickState,
} from "../../src/lib/domain/countdowns/advanced";
import { CountdownRuleError } from "../../src/lib/domain/countdowns/index";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { recordHistory } from "../tables/history";
import { logAction } from "./actionLog";
import { applyRule } from "./mechanics";

/** Most countdowns one log row can have ticked (a campaign has few dashboard countdowns). */
const TICKS_PER_ENTRY = 100;

export type TickSource = "roll" | "feed" | "rest" | "advance" | "correction";

export type TickCause = {
  source: TickSource;
  /** The actionLog row that caused the tick; required for roll / feed / rest, so undo can revert it. */
  entryId?: Id<"actionLog">;
  /** Who did it (history `by`, the notice's actor). */
  actorId: Id<"users">;
};

/** The stored tick state: what `countdownTicks.before/after` hold and undo restores. */
export type StoredTickState = CountdownTickState & { completedAt?: number; lastTriggeredAt?: number };

export type ApplyTickResult = {
  changed: boolean;
  before: StoredTickState;
  after: StoredTickState;
  triggered: boolean;
  reset: boolean;
  finished: boolean;
  noticeId: Id<"actionLog"> | null;
  tickId: Id<"countdownTicks"> | null;
};

/** The countdown's tick state as stored (absent triggerCount = 0). */
export function tickStateOf(countdown: Doc<"countdowns">): StoredTickState {
  return {
    currentValue: countdown.currentValue,
    startingValue: countdown.startingValue,
    status: countdown.status,
    triggerCount: countdown.triggerCount ?? 0,
    ...(countdown.completedAt !== undefined ? { completedAt: countdown.completedAt } : {}),
    ...(countdown.lastTriggeredAt !== undefined ? { lastTriggeredAt: countdown.lastTriggeredAt } : {}),
  };
}

/** The (row, countdown) pair's tick that has not been taken back, or null (D5). */
export async function liveTick(ctx: MutationCtx, entryId: Id<"actionLog">, countdownId: Id<"countdowns">): Promise<Doc<"countdownTicks"> | null> {
  const rows = await ctx.db
    .query("countdownTicks")
    .withIndex("by_entry_countdown", (q) => q.eq("entryId", entryId).eq("countdownId", countdownId))
    .take(TICKS_PER_ENTRY);
  return rows.find((r) => r.revertedAt === undefined) ?? null;
}

/** Ticks one dashboard countdown by `amount` (see the module contract). */
export async function applyTick(
  ctx: MutationCtx,
  countdown: Doc<"countdowns">,
  amount: number,
  cause: TickCause,
  options: { whilePaused?: boolean } = {},
): Promise<ApplyTickResult> {
  if (countdown.ownerKey !== undefined) throw appError("NOT_FOUND");
  const logged = cause.source === "roll" || cause.source === "feed" || cause.source === "rest";
  if (logged !== (cause.entryId !== undefined)) throw new Error("applyTick: roll, feed and rest ticks need their entryId; others take none.");
  if (cause.entryId !== undefined && (await liveTick(ctx, cause.entryId, countdown._id)) !== null) {
    throw appError("COUNTDOWN_RULE", "That roll already ticked this countdown.");
  }

  const result = applyRule("COUNTDOWN_RULE", CountdownRuleError, () => tickCountdown(countdown, amount, options));
  const before = tickStateOf(countdown);
  const unchanged =
    result.next.currentValue === before.currentValue &&
    result.next.startingValue === before.startingValue &&
    result.next.status === before.status &&
    result.next.triggerCount === before.triggerCount;
  if (unchanged) return { changed: false, before, after: before, triggered: false, reset: false, finished: false, noticeId: null, tickId: null };

  const now = Date.now();
  const after: StoredTickState = {
    ...result.next,
    ...(result.finished ? { completedAt: now } : before.completedAt !== undefined ? { completedAt: before.completedAt } : {}),
    ...(result.triggered ? { lastTriggeredAt: now } : before.lastTriggeredAt !== undefined ? { lastTriggeredAt: before.lastTriggeredAt } : {}),
  };
  await ctx.db.patch("countdowns", countdown._id, {
    currentValue: after.currentValue,
    startingValue: after.startingValue,
    status: after.status,
    completedAt: after.completedAt,
    ...(result.triggered ? { triggerCount: after.triggerCount, lastTriggeredAt: now } : {}),
  });

  const startMoved = after.startingValue !== before.startingValue || result.reset;
  await recordHistory(ctx, cause.actorId, {
    campaignId: countdown.campaignId,
    kind: "countdown",
    action: result.triggered ? "trigger" : cause.source,
    countdownId: countdown._id,
    before: { currentValue: before.currentValue, status: before.status, ...(startMoved ? { startingValue: before.startingValue } : {}) },
    after: { currentValue: after.currentValue, status: after.status, ...(startMoved ? { startingValue: after.startingValue } : {}) },
  });

  let noticeId: Id<"actionLog"> | null = null;
  if (result.notice !== null) {
    // GM-only (D12), not undoable and without a groupId, so it never blocks or joins the undo of the roll's group.
    noticeId = await logAction(ctx, {
      campaignId: countdown.campaignId,
      actorId: cause.actorId,
      kind: "countdown",
      visibility: "gm",
      summary: countdownNoticeText(countdown.name, countdown.consequence, result.notice),
      undoable: false,
    });
  }

  let tickId: Id<"countdownTicks"> | null = null;
  if (cause.entryId !== undefined && (cause.source === "roll" || cause.source === "feed" || cause.source === "rest")) {
    tickId = await ctx.db.insert("countdownTicks", {
      campaignId: countdown.campaignId,
      countdownId: countdown._id,
      entryId: cause.entryId,
      source: cause.source,
      amount,
      before,
      after,
      ...(noticeId !== null ? { noticeId } : {}),
      at: now,
    });
  }
  return { changed: true, before, after, triggered: result.triggered, reset: result.reset, finished: result.finished, noticeId, tickId };
}

function sameState(countdown: Doc<"countdowns">, state: StoredTickState): boolean {
  return (
    countdown.currentValue === state.currentValue &&
    countdown.startingValue === state.startingValue &&
    countdown.status === state.status &&
    (countdown.triggerCount ?? 0) === state.triggerCount
  );
}

export type RevertResult = { reverted: Id<"countdowns">[]; kept: Id<"countdowns">[] };

/**
 * Takes back the ticks the given log rows caused (D11, Q5), newest first: a countdown that still equals the tick's
 * `after` goes back to `before` (value, start, status, trigger count, completion and trigger times), its trigger notice
 * is marked undone and one history "undo" row is written; a countdown changed since keeps its value (`kept`).
 */
export async function revertTicks(ctx: MutationCtx, entryIds: readonly Id<"actionLog">[], actorId: Id<"users">): Promise<RevertResult> {
  const ticks: Doc<"countdownTicks">[] = [];
  for (const entryId of entryIds) {
    const rows = await ctx.db
      .query("countdownTicks")
      .withIndex("by_entry_countdown", (q) => q.eq("entryId", entryId))
      .take(TICKS_PER_ENTRY);
    ticks.push(...rows.filter((r) => r.revertedAt === undefined));
  }
  ticks.sort((a, b) => b.at - a.at || b._creationTime - a._creationTime);

  const out: RevertResult = { reverted: [], kept: [] };
  const now = Date.now();
  for (const tick of ticks) {
    const countdown = await ctx.db.get("countdowns", tick.countdownId);
    if (countdown === null) continue;
    if (!sameState(countdown, tick.after)) {
      out.kept.push(countdown._id);
      continue;
    }
    const b = tick.before;
    await ctx.db.patch("countdowns", countdown._id, {
      currentValue: b.currentValue,
      startingValue: b.startingValue,
      status: b.status,
      completedAt: b.completedAt,
      lastTriggeredAt: b.lastTriggeredAt,
      // applyTick stores a count only once it triggered, so 0 means the field was absent.
      triggerCount: b.triggerCount === 0 ? undefined : b.triggerCount,
    });
    const startMoved = b.startingValue !== tick.after.startingValue;
    await recordHistory(ctx, actorId, {
      campaignId: countdown.campaignId,
      kind: "countdown",
      action: "undo",
      countdownId: countdown._id,
      before: { currentValue: countdown.currentValue, status: countdown.status, ...(startMoved ? { startingValue: countdown.startingValue } : {}) },
      after: { currentValue: b.currentValue, status: b.status, ...(startMoved ? { startingValue: b.startingValue } : {}) },
    });
    if (tick.noticeId !== undefined) {
      const notice = await ctx.db.get("actionLog", tick.noticeId);
      if (notice !== null && notice.undoneAt === undefined) await ctx.db.patch("actionLog", notice._id, { undoneAt: now, undoneBy: actorId });
    }
    await ctx.db.patch("countdownTicks", tick._id, { revertedAt: now });
    out.reverted.push(countdown._id);
  }
  return out;
}
