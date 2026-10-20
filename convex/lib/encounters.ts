import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Shared helpers of the D8 adversary and encounter functions: caps the validators cannot express, loaders that
 * keep every row inside the caller's campaign, and the running check. Every caller is a GM wrapper
 * (gmQuery / gmMutation / keyedGmMutation), so authorization is already done; these only scope and bound.
 */

/** Instances in one encounter (`.take(MAX_INSTANCES + 1)` checks it). */
export const MAX_INSTANCES = 60;
/** Encounters in one campaign, checked with an index `.take`; a counter row is unnecessary at this size. */
export const MAX_ENCOUNTERS = 200;
/** Custom adversaries in one campaign. */
export const MAX_CUSTOM = 100;

export const MAX_ENCOUNTER_NAME = 80;
export const MAX_ENCOUNTER_NOTES = 2000;
export const MIN_PCS = 1;
export const MAX_PCS = 12;
export const MAX_LABEL = 60;
export const MAX_TAG = 30;
export const MAX_TAGS = 6;
export const MAX_INSTANCE_NOTE = 500;
export const MAX_MINIONS = 30;
export const MAX_CUSTOM_NAME = 80;
export const MAX_CUSTOM_TEXT = 2000;
export const MAX_EXPERIENCES = 6;
export const MAX_FEATURES = 20;
export const MAX_FEATURE_TEXT = 1500;

/** Refuses (ENCOUNTER_RULE) a text longer than `max` characters. `what` names the field in the message. */
export function assertTextLength(text: string, max: number, what: string): void {
  if (text.length > max) throw appError("ENCOUNTER_RULE", `${what} can be at most ${max} characters.`);
}

/** Refuses (ENCOUNTER_RULE) a value that is not a whole number from `min` to `max`. */
export function assertWholeInRange(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw appError("ENCOUNTER_RULE", `${what} must be a whole number from ${min} to ${max}.`);
  }
}

/** The campaign's encounter, or NOT_FOUND when the id is malformed, the row is gone or it is another campaign's (CD7). */
export async function loadEncounter(ctx: QueryCtx, campaignId: Id<"campaigns">, encounterId: string): Promise<Doc<"encounters">> {
  const id = ctx.db.normalizeId("encounters", encounterId);
  const encounter = id === null ? null : await ctx.db.get("encounters", id);
  if (encounter === null || encounter.campaignId !== campaignId) throw appError("NOT_FOUND");
  return encounter;
}

/** The campaign's adversary instance, or NOT_FOUND when the id is malformed, the row is gone or it is another campaign's (CD7). */
export async function loadInstance(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  instanceId: string,
): Promise<Doc<"encounterAdversaries">> {
  const id = ctx.db.normalizeId("encounterAdversaries", instanceId);
  const instance = id === null ? null : await ctx.db.get("encounterAdversaries", id);
  if (instance === null || instance.campaignId !== campaignId) throw appError("NOT_FOUND");
  return instance;
}

/** Refuses (ENCOUNTER_NOT_RUNNING) a tracker action on an encounter that is not running. */
export function assertRunning(encounter: Doc<"encounters">): void {
  if (encounter.status !== "running") throw appError("ENCOUNTER_NOT_RUNNING");
}

/**
 * Starts `encounter` (D8 `encounters.start`; reused by D10 S8's `combatTokens.placeSessionEncounter`): a running
 * encounter is left alone; a draft or ended one starts unless another encounter of the campaign is running
 * (ENCOUNTER_RUNNING, with `runningMessage` when given). Returns whether it started the encounter.
 */
export async function startEncounter(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  encounter: Doc<"encounters">,
  runningMessage?: string,
): Promise<boolean> {
  if (encounter.status === "running") return false;
  const running = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId).eq("status", "running"))
    .first();
  if (running !== null) throw appError("ENCOUNTER_RUNNING", runningMessage);
  const now = Date.now();
  await ctx.db.patch("encounters", encounter._id, { status: "running", startedAt: now, endedAt: undefined, updatedAt: now });
  return true;
}

/** How many instances the encounter holds, reading at most MAX_INSTANCES + 1 rows (a result above the cap means full). */
export async function countInstances(ctx: QueryCtx, encounterId: Id<"encounters">): Promise<number> {
  const rows = await ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounterId))
    .take(MAX_INSTANCES + 1);
  return rows.length;
}
