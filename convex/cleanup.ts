import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { deleteMapChildren } from "./lib/combatMaps";

/**
 * Retention for the tables that only grow (CD17, CD18), run by `crons.ts`.
 * Every job is internal, deletes at most `BATCH` rows per run and reschedules
 * itself until nothing is left.
 */

/** The most rows (and blobs) one run deletes. */
export const BATCH = 500;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** `operations` is an idempotency cache; the trail of Fear, countdowns and time is `history`. */
export const OPERATIONS_TTL_MS = 7 * DAY;
/** A deleted campaign can be restored for this long, then it is purged with all its data. */
export const PURGE_AFTER_MS = 30 * DAY;
/** An upload that nothing claimed after this long is abandoned (claims happen within minutes). */
export const ORPHAN_AGE_MS = 2 * HOUR;
/** Photo-import photos are deleted once read; ones never read expire after this long (D5 T7). */
export const PHOTO_IMPORT_TTL_MS = HOUR;

/** Deletes a blob. A failure (already gone) is logged, not thrown, so the rest of the batch still runs. */
async function deleteBlob(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch (error) {
    console.error(`Couldn't delete file ${storageId}.`, error);
  }
}

/** Expires idempotency records older than `OPERATIONS_TTL_MS`. */
export const expireOperations = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - OPERATIONS_TTL_MS;
    const rows = await ctx.db
      .query("operations")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(BATCH);
    for (const row of rows) await ctx.db.delete("operations", row._id);
    if (rows.length === BATCH) await ctx.scheduler.runAfter(0, internal.cleanup.expireOperations, {});
    return null;
  },
});

/**
 * Starts purging the oldest campaign deleted more than `PURGE_AFTER_MS` ago.
 * `purgeCampaign` calls this again when it is done, so campaigns are purged
 * one after another until none is due.
 */
export const purgeDeletedCampaigns = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - PURGE_AFTER_MS;
    // `deletedAt` is a timestamp, so `gte 0` skips the live campaigns (undefined sorts first).
    const due = await ctx.db
      .query("campaigns")
      .withIndex("by_deletedAt", (q) => q.gte("deletedAt", 0).lte("deletedAt", cutoff))
      .first();
    if (due !== null) await ctx.scheduler.runAfter(0, internal.cleanup.purgeCampaign, { campaignId: due._id });
    return null;
  },
});

/** How many more rows this run may delete. */
type Budget = { left: number };

/** Deletes rows (and the blob each one names), counting them against the budget. */
async function deleteRows<T extends TableNames>(
  ctx: MutationCtx,
  budget: Budget,
  table: T,
  rows: Doc<T>[],
  blob?: (row: Doc<T>) => Id<"_storage">,
): Promise<void> {
  for (const row of rows) {
    await ctx.db.delete(table, row._id);
    if (blob) await deleteBlob(ctx, blob(row));
    budget.left--;
  }
}

/** Grants on one resource, to anyone. */
function grantsOn(ctx: MutationCtx, resourceType: Doc<"grants">["resourceType"], resourceId: string, n: number) {
  return ctx.db
    .query("grants")
    .withIndex("by_resource_principal", (q) => q.eq("resourceType", resourceType).eq("resourceId", resourceId))
    .take(n);
}

/**
 * One purge step per table reachable from a campaign, each deleting until it
 * is empty or the budget is spent. `tests/convex/cleanup.test.ts` checks that
 * every table with a `campaignId` field is covered.
 */
const PURGE_STEPS: ((ctx: MutationCtx, c: Id<"campaigns">, budget: Budget) => Promise<void>)[] = [
  // A codex entry's text and grants go before the entry; its image is a `files` row (kind "codexImage").
  async (ctx, c, budget) => {
    const entries = await ctx.db
      .query("codexEntries")
      .withIndex("by_campaign_kind", (q) => q.eq("campaignId", c))
      .take(budget.left);
    for (const entry of entries) {
      const text = await ctx.db
        .query("codexEntryText")
        .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
        .take(budget.left);
      await deleteRows(ctx, budget, "codexEntryText", text);
      await deleteRows(ctx, budget, "grants", await grantsOn(ctx, "codexEntry", entry._id, budget.left));
      // Out of budget: the entry may still have children; the next run finishes it.
      if (budget.left <= 0) return;
      await deleteRows(ctx, budget, "codexEntries", [entry]);
    }
  },
  // A character's grants go before the character; its portrait is a `files` row (kind "portrait").
  async (ctx, c, budget) => {
    const characters = await ctx.db
      .query("characters")
      .withIndex("by_campaign", (q) => q.eq("campaignId", c))
      .take(budget.left);
    for (const character of characters) {
      await deleteRows(ctx, budget, "grants", await grantsOn(ctx, "character", character._id, budget.left));
      if (budget.left <= 0) return;
      await deleteRows(ctx, budget, "characters", [character]);
    }
  },
  async (ctx, c, budget) => {
    await deleteRows(ctx, budget, "grants", await grantsOn(ctx, "campaign", c, budget.left));
    await deleteRows(ctx, budget, "grants", await grantsOn(ctx, "map", c, budget.left));
    const toCampaign = await ctx.db
      .query("grants")
      .withIndex("by_principal_type", (q) => q.eq("principalKind", "campaign").eq("principalId", c))
      .take(budget.left);
    await deleteRows(ctx, budget, "grants", toCampaign);
  },
  // A combat map's objects, painted cells, tokens and explored areas go before the map (D9); its image is a
  // `files` row of this campaign (kind "combatMap"), deleted with the campaign's files below.
  async (ctx, c, budget) => {
    const maps = await ctx.db
      .query("combatMaps")
      .withIndex("by_campaign_updated", (q) => q.eq("campaignId", c))
      .take(budget.left);
    for (const map of maps) {
      budget.left -= await deleteMapChildren(ctx, map._id, budget.left);
      // Out of budget: the map may still have children; the next run finishes it.
      if (budget.left <= 0) return;
      await deleteRows(ctx, budget, "combatMaps", [map]);
    }
  },
  // GM sprite packs (sprite packs P0): sprites before their packs; each sprite's image is a `files` row of this
  // campaign (kind "sprite"), deleted with the campaign's files below.
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("spritePackSprites").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "spritePackSprites", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("spritePacks").withIndex("by_campaign_updated", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "spritePacks", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("files").withIndex("by_campaign_kind", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "files", rows, (row) => row.storageId);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("characterExtras").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "characterExtras", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("campaignMembers").withIndex("by_campaign_user", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "campaignMembers", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("campaignInvites").withIndex("by_campaign_email", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "campaignInvites", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("campaignState").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "campaignState", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("countdowns").withIndex("by_campaign_owner", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "countdowns", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("campaignTime").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "campaignTime", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("history").withIndex("by_campaign_at", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "history", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("actionLog").withIndex("by_campaign_at", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "actionLog", rows);
  },
  async (ctx, c, budget) => {
    // The undo record of countdown ticks (countdowns-advanced): goes with its campaign, like actionLog.
    const rows = await ctx.db.query("countdownTicks").withIndex("by_campaign_at", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "countdownTicks", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("restChoices").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "restChoices", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("rests").withIndex("by_campaign_started", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "rests", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("frameTrackers").withIndex("by_campaign_key", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "frameTrackers", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("maps").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "maps", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("mapTokens").withIndex("by_campaign_token", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "mapTokens", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("mapHexes").withIndex("by_campaign_q_r", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "mapHexes", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("mapTerrain").withIndex("by_campaign_tile", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "mapTerrain", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("codexCounters").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "codexCounters", rows);
  },
  // Adversary instances go before the encounters and custom adversaries they reference.
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("encounterAdversaries").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "encounterAdversaries", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db
      .query("encounters")
      .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", c))
      .take(budget.left);
    await deleteRows(ctx, budget, "encounters", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("customAdversaries").withIndex("by_campaign_name", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "customAdversaries", rows);
  },
  // Sessions (D10): every sessions table carries the campaignId, so each goes by its own index.
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("sessionLog").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "sessionLog", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("sessionSpotlights").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "sessionSpotlights", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("sessionPrep").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "sessionPrep", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("sessions").withIndex("by_campaign_n", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "sessions", rows);
  },
  // Notes (D11): entries and recipients before their pages, pages before their journals. Each table goes by the
  // campaign prefix of one of its indexes.
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("journalEntries").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "journalEntries", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db
      .query("journalPageRecipients")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", c))
      .take(budget.left);
    await deleteRows(ctx, budget, "journalPageRecipients", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db
      .query("journalPages")
      .withIndex("by_campaign_visibility_binned", (q) => q.eq("campaignId", c))
      .take(budget.left);
    await deleteRows(ctx, budget, "journalPages", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("journals").withIndex("by_campaign_user", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "journals", rows);
  },
  async (ctx, c, budget) => {
    const rows = await ctx.db.query("operations").withIndex("by_campaign", (q) => q.eq("campaignId", c)).take(budget.left);
    await deleteRows(ctx, budget, "operations", rows);
  },
];

/**
 * Deletes a campaign due for purge and everything in it, `BATCH` rows per
 * run: first every indexed step, then a paged scan of `campaignOpens` (it has
 * no campaign index, and players who left keep their rows), then the
 * campaign itself. Stops if the campaign is gone or was restored.
 */
export const purgeCampaign = internalMutation({
  args: { campaignId: v.id("campaigns"), opensCursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { campaignId, opensCursor }) => {
    const campaign = await ctx.db.get("campaigns", campaignId);
    if (campaign?.deletedAt === undefined || campaign.deletedAt > Date.now() - PURGE_AFTER_MS) return null;
    const budget: Budget = { left: BATCH };
    for (const step of PURGE_STEPS) {
      await step(ctx, campaignId, budget);
      if (budget.left <= 0) break;
    }
    if (budget.left <= 0) {
      await ctx.scheduler.runAfter(0, internal.cleanup.purgeCampaign, { campaignId, opensCursor });
      return null;
    }
    const page = await ctx.db.query("campaignOpens").paginate({ numItems: budget.left, cursor: opensCursor ?? null });
    await deleteRows(
      ctx,
      budget,
      "campaignOpens",
      page.page.filter((row) => row.campaignId === campaignId),
    );
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.cleanup.purgeCampaign, { campaignId, opensCursor: page.continueCursor });
      return null;
    }
    await ctx.db.delete("campaigns", campaignId);
    await ctx.scheduler.runAfter(0, internal.cleanup.purgeDeletedCampaigns, {});
    return null;
  },
});

/** Whether a `files` row claims the blob. */
async function isClaimedByFile(ctx: MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  const row = await ctx.db
    .query("files")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  return row !== null;
}

/**
 * Deletes photo-import files (rows and blobs) older than `PHOTO_IMPORT_TTL_MS`:
 * photos uploaded but never read. Hourly (`crons.ts`), oldest first, `BATCH`
 * per run, rescheduling itself while a full batch was deleted.
 */
export const expirePhotoImports = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - PHOTO_IMPORT_TTL_MS;
    const rows = await ctx.db
      .query("files")
      .withIndex("by_kind_created", (q) => q.eq("kind", "photoImport").lt("createdAt", cutoff))
      .take(BATCH);
    await deleteRows(ctx, { left: BATCH }, "files", rows, (row) => row.storageId);
    if (rows.length === BATCH) await ctx.scheduler.runAfter(0, internal.cleanup.expirePhotoImports, {});
    return null;
  },
});

/**
 * Deletes uploads older than `ORPHAN_AGE_MS` that nothing claims (an upload
 * URL used but never attached), a page of `BATCH` blobs per run. `cutoff` is
 * fixed on the first run so the cursor stays valid.
 */
export const sweepOrphanUploads = internalMutation({
  args: { cutoff: v.optional(v.number()), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const cutoff = args.cutoff ?? Date.now() - ORPHAN_AGE_MS;
    const page = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .paginate({ numItems: BATCH, cursor: args.cursor ?? null });
    for (const blob of page.page) {
      if (!(await isClaimedByFile(ctx, blob._id))) await deleteBlob(ctx, blob._id);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.cleanup.sweepOrphanUploads, { cutoff, cursor: page.continueCursor });
    return null;
  },
});
