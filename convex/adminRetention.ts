import { v } from "convex/values";

import { ADMIN_AUDIT_TTL_DAYS, ADMIN_EXPORT_TTL_MINUTES, LIMIT_REQUEST_TTL_DAYS } from "../src/lib/admin/config";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * Retention of the app admin tables (config AD0, rule 8 / CD17), run by `crons.ts`. Each job is internal, handles at
 * most `BATCH` rows per run, oldest first, and reschedules itself while a full batch was handled.
 */

export const BATCH = 200;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Audit rows are kept for a year (Q26 a). */
export const AUDIT_TTL_MS = ADMIN_AUDIT_TTL_DAYS * DAY;
/** An export file lives an hour (Q30 a). */
export const EXPORT_TTL_MS = ADMIN_EXPORT_TTL_MINUTES * MINUTE;
/** Approved and declined limit requests are kept for a year (pending ones wait for the owner). */
export const LIMIT_REQUEST_TTL_MS = LIMIT_REQUEST_TTL_DAYS * DAY;

/** Deletes audit rows older than `AUDIT_TTL_MS`. */
export const expireAudit = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - AUDIT_TTL_MS;
    const rows = await ctx.db
      .query("adminAudit")
      .withIndex("by_at", (q) => q.lt("at", cutoff))
      .take(BATCH);
    for (const row of rows) await ctx.db.delete("adminAudit", row._id);
    if (rows.length === BATCH) await ctx.scheduler.runAfter(0, internal.adminRetention.expireAudit, {});
    return null;
  },
});

/** Deletes exports older than `EXPORT_TTL_MS` together with their storage file. */
export const expireExports = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - EXPORT_TTL_MS;
    const rows = await ctx.db
      .query("adminExports")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(BATCH);
    for (const row of rows) {
      if (row.fileId !== undefined && (await ctx.db.system.get("_storage", row.fileId)) !== null) await ctx.storage.delete(row.fileId);
      await ctx.db.delete("adminExports", row._id);
    }
    if (rows.length === BATCH) await ctx.scheduler.runAfter(0, internal.adminRetention.expireExports, {});
    return null;
  },
});

/**
 * Deletes approved and declined limit requests created over `LIMIT_REQUEST_TTL_MS` ago (by `by_status_createdAt`).
 * Pending requests are never expired: they wait for the owner's answer.
 */
export const expireLimitRequests = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - LIMIT_REQUEST_TTL_MS;
    let handled = 0;
    for (const status of ["approved", "declined"] as const) {
      const rows = await ctx.db
        .query("lorekeeperLimitRequests")
        .withIndex("by_status_createdAt", (q) => q.eq("status", status).lt("createdAt", cutoff))
        .take(BATCH - handled);
      for (const row of rows) await ctx.db.delete("lorekeeperLimitRequests", row._id);
      handled += rows.length;
      if (handled >= BATCH) break;
    }
    if (handled >= BATCH) await ctx.scheduler.runAfter(0, internal.adminRetention.expireLimitRequests, {});
    return null;
  },
});
