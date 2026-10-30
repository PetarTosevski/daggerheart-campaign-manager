import { ZodError, type z } from "zod";

import { appError, RuleError, type AppErrorCode } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { readVersioned } from "./blobs";
import type { Once } from "./functions";

/**
 * The version every tracker blob is written with (CD3). A blob written before
 * versioning has none and reads as version 1. Bumping it means a second entry
 * in `readTracker`'s version map plus a migration test (TE5).
 */
export const TRACKER_SCHEMA_VERSION = 1;

/** One frame tracker: its frame, its `frameTrackers` key and the schema of its stored state. */
export type FrameTracker<S extends z.ZodType<object>> = {
  frameId: string;
  key: string;
  schema: S;
  /** The state of a campaign that never saved any. */
  initial: () => z.output<S>;
  /** The rule family's code (the tracker module throws `RuleError` with it). Documentation only. */
  ruleCode: AppErrorCode;
};

async function trackerRow(ctx: QueryCtx, campaignId: Id<"campaigns">, key: string) {
  return ctx.db
    .query("frameTrackers")
    .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).eq("key", key))
    .unique();
}

/**
 * Reads a frame tracker's state through `schema` (CD2): null when it was never
 * written, `TRACKER_CORRUPT` when the stored blob or its `schemaVersion` does
 * not match.
 */
export async function readTracker<S extends z.ZodType>(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  key: string,
  schema: S,
): Promise<z.output<S> | null> {
  const row = await trackerRow(ctx, campaignId, key);
  if (row === null) return null;
  return readVersioned({ [TRACKER_SCHEMA_VERSION]: { schema } }, row.data, "TRACKER_CORRUPT");
}

/**
 * Replaces a frame tracker's state (validated by the caller). With
 * `schemaVersion`, the stored blob carries it (every tracker in
 * `convex/trackers/` passes `TRACKER_SCHEMA_VERSION`).
 */
export async function writeTracker<T extends object>(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  key: string,
  data: T,
  schemaVersion?: number,
): Promise<void> {
  const stored = schemaVersion === undefined ? data : { ...data, schemaVersion };
  const row = await trackerRow(ctx, campaignId, key);
  if (row) await ctx.db.patch("frameTrackers", row._id, { data: stored, updatedAt: Date.now() });
  else await ctx.db.insert("frameTrackers", { campaignId, key, data: stored, updatedAt: Date.now() });
}

/** Frame-exclusive trackers are enforced on the server, not only hidden in the UI. */
export function assertTrackerFrame(campaign: Doc<"campaigns">, tracker: { frameId: string }): void {
  if (campaign.frameId !== tracker.frameId) throw appError("MECHANIC_DISABLED");
}

/** The tracker's validated state, or its initial state when it was never written. */
export async function loadTracker<S extends z.ZodType<object>>(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  tracker: FrameTracker<S>,
): Promise<z.output<S>> {
  return (await readTracker(ctx, campaignId, tracker.key, tracker.schema)) ?? tracker.initial();
}

/**
 * Legacy shim for callers outside the frame trackers (`convex/characterExtras.ts`):
 * `RuleError` and `ZodError` pass through to the wrapper, which converts them
 * (CF14); an error whose class is exactly `Error` becomes a `RuleError` with
 * `code`; any subclass is a bug and is rethrown unchanged. The frame tracker
 * modules in `src/lib/frames/trackers/` throw `RuleError` themselves
 * (dcm-bxp.27), so `frameTrackerMutation` and `convex/trackers/*` no longer
 * call this. Delete it once `characterExtras.ts` stops calling it.
 */
export async function applyTrackerRule<T>(code: AppErrorCode, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RuleError || error instanceof ZodError) throw error;
    if (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype) throw new RuleError(code, error.message);
    throw error;
  }
}

/**
 * The one scaffold for a tracker change (CH7), called from a handler built on
 * a keyed campaign wrapper (`keyedGmMutation`, or `keyedCampaignMutation` for
 * changes players may make): checks the frame, then, once per idempotency key,
 * reads the validated state, applies `run` and writes the new state with its
 * `schemaVersion`. Returns `run`'s result (the stored one on a replay).
 */
export async function frameTrackerMutation<S extends z.ZodType<object>, R>(
  ctx: MutationCtx & { campaign: Doc<"campaigns">; once: Once },
  tracker: FrameTracker<S>,
  op: { kind: string; request: unknown },
  run: (state: z.output<S>) => { state: z.output<S>; result: R } | Promise<{ state: z.output<S>; result: R }>,
): Promise<R> {
  assertTrackerFrame(ctx.campaign, tracker);
  const campaignId = ctx.campaign._id;
  return ctx.once(op.kind, op.request, async () => {
    const current = await loadTracker(ctx, campaignId, tracker);
    const next = await run(current);
    await writeTracker(ctx, campaignId, tracker.key, next.state, TRACKER_SCHEMA_VERSION);
    return next.result;
  });
}

/**
 * The rows whose key starts with `prefix` (one row per item of a tracker's
 * growing collection, e.g. Horizon regions `horizonRegion:000001`), in key
 * order, at most `limit`. Each is read through `schema` (TRACKER_CORRUPT on a bad blob).
 */
export async function readTrackerRows<S extends z.ZodType>(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  prefix: string,
  schema: S,
  limit: number,
): Promise<z.output<S>[]> {
  // Every key with the prefix sorts below the prefix followed by U+FFFF.
  const rows = await ctx.db
    .query("frameTrackers")
    .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).gte("key", prefix).lt("key", `${prefix}￿`))
    .take(limit);
  return rows.map((row) => readVersioned({ [TRACKER_SCHEMA_VERSION]: { schema } }, row.data, "TRACKER_CORRUPT"));
}

/** Deletes a tracker row (already gone is fine). */
export async function deleteTracker(ctx: MutationCtx, campaignId: Id<"campaigns">, key: string): Promise<void> {
  const row = await trackerRow(ctx, campaignId, key);
  if (row) await ctx.db.delete("frameTrackers", row._id);
}
