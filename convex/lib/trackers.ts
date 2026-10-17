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
  /** The code an expected domain rule violation is sent with. */
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
): Promise<z.output<S> | null>;
/**
 * @deprecated Unvalidated read, kept only for the character extras
 * (`convex/characterExtras.ts`, which parse the result themselves) until they
 * move to their own table (H14).
 */
export async function readTracker(ctx: QueryCtx, campaignId: Id<"campaigns">, key: string): Promise<unknown>;
export async function readTracker(ctx: QueryCtx, campaignId: Id<"campaigns">, key: string, schema?: z.ZodType): Promise<unknown> {
  const row = await trackerRow(ctx, campaignId, key);
  if (row === null) return null;
  const data: unknown = row.data;
  if (schema === undefined) return data;
  return readVersioned({ [TRACKER_SCHEMA_VERSION]: { schema } }, data, "TRACKER_CORRUPT");
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
 * Runs a pure tracker rule. `RuleError` and `ZodError` pass through to the
 * wrapper, which converts them (CF14). The tracker modules in
 * `src/lib/frames/trackers/` still throw a plain `Error` for an expected
 * violation, so an error whose class is exactly `Error` becomes a `RuleError`
 * with `code`; any subclass (`TypeError`, `RangeError`…) is a bug and is
 * rethrown unchanged.
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
    const next = await applyTrackerRule(tracker.ruleCode, () => run(current));
    await writeTracker(ctx, campaignId, tracker.key, next.state, TRACKER_SCHEMA_VERSION);
    return next.result;
  });
}
