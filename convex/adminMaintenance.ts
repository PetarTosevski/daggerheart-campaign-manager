import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { env } from "./_generated/server";
import { recordAdminChange } from "./lib/adminAudit";
import { appOwnerMutation, appOwnerQuery } from "./lib/functions";

/**
 * App admin, Maintenance (config AD10, Q29 a, Q31 a; docs/tasks/TASK-CONFIG-AD10.md). Owner-only (`appOwner*`
 * wrappers: FORBIDDEN for anyone else, UNAUTHENTICATED signed out).
 *
 * - `setReadOnly` turns read-only mode on or off, with an optional banner message; audited (`readOnly.set`). The
 *   owner's own writes are exempt from the mode, so the owner can always turn it off again.
 * - `keys` says which keys and connections are set, as booleans only: never a key, a value or a fragment of one.
 * - `backups` points at this deployment's Convex dashboard: functions have no backup API (Q29 a), so there is no
 *   "last backup" time to show.
 */

/** The banner message's maximum length (AD10). */
export const READ_ONLY_MESSAGE_MAX = 200;

/** Turns read-only mode on or off. `message` (trimmed, at most 200 characters) is the banner text while it is on. */
export const setReadOnly = appOwnerMutation({
  args: { on: v.boolean(), message: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { on, message }) => {
    const text = message?.trim() ?? "";
    if (text.length > READ_ONLY_MESSAGE_MAX) throw appError("INVALID", `The message can be at most ${READ_ONLY_MESSAGE_MAX} characters.`);
    const row = await ctx.db
      .query("appStatus")
      .withIndex("by_key", (q) => q.eq("key", "app"))
      .unique();
    const was = row?.readOnly === true;
    // The message only means something while the mode is on.
    const fields = { readOnly: on, message: on && text !== "" ? text : undefined, updatedAt: Date.now() };
    if (row === null) await ctx.db.insert("appStatus", { key: "app", ...fields });
    else await ctx.db.patch("appStatus", row._id, fields);
    await recordAdminChange(ctx, ctx.user._id, { action: "readOnly.set", field: "readOnly", from: was, to: on });
    return null;
  },
});

/** Whether an env var holds something (a blank value counts as missing). */
const isSet = (value: string | undefined) => value !== undefined && value.trim() !== "";

/**
 * Keys and connections, booleans only. `database` is true whenever this query runs. `resendKey` and `mailFrom` are
 * both needed to send email; `google` needs both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
 */
export const keys = appOwnerQuery({
  args: {},
  returns: v.object({
    database: v.boolean(),
    anthropicKey: v.boolean(),
    resendKey: v.boolean(),
    mailFrom: v.boolean(),
    siteUrl: v.boolean(),
    google: v.boolean(),
  }),
  handler: async () => ({
    database: true,
    anthropicKey: isSet(env.ANTHROPIC_API_KEY),
    resendKey: isSet(env.AUTH_RESEND_KEY),
    mailFrom: isSet(env.MAIL_FROM),
    siteUrl: isSet(env.SITE_URL),
    // Read by Convex Auth's Google provider, not declared in convex.config.ts, so not on the typed `env`.
    google: isSet(process.env.AUTH_GOOGLE_ID) && isSet(process.env.AUTH_GOOGLE_SECRET),
  }),
});

export const BACKUPS_NOTE = "Backups are managed in the Convex dashboard.";

/** This deployment's backups page in the Convex dashboard, from `CONVEX_CLOUD_URL`; null off Convex cloud (local). */
export function dashboardBackupsUrl(cloudUrl: string | undefined): string | null {
  if (cloudUrl === undefined) return null;
  try {
    const { hostname } = new URL(cloudUrl);
    if (!hostname.endsWith(".convex.cloud")) return null;
    const name = hostname.split(".")[0];
    return /^[a-z0-9-]+$/.test(name) ? `https://dashboard.convex.dev/d/${name}/settings/backups` : null;
  } catch {
    return null;
  }
}

/** Where backups live (Q29 a): the dashboard link and the note. No "last backup" time: functions can't read it. */
export const backups = appOwnerQuery({
  args: {},
  returns: v.object({ dashboardUrl: v.union(v.string(), v.null()), note: v.string() }),
  handler: async () => ({ dashboardUrl: dashboardBackupsUrl(env.CONVEX_CLOUD_URL), note: BACKUPS_NOTE }),
});
