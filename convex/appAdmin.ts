import { v } from "convex/values";

import { recordAdminChange } from "./lib/adminAudit";
import { readAppConfig } from "./lib/appConfig";
import { isAppOwner } from "./lib/appOwner";
import { appOwnerMutation, appOwnerQuery, maybeUserQuery } from "./lib/functions";
import { liveCampaign } from "./lib/permissions";
import { appSettingsValidator } from "./lib/validators/admin";

/**
 * App admin, the owner's page (config AD0). Everything here but `me` is owner-only (`appOwner*` wrappers, FORBIDDEN
 * for anyone else). The client's owner check (`me`) is UX only (CF22): the functions are the gate.
 */

/**
 * Whether the caller is the app owner: decides only whether the client shows the App admin link and page. Answers
 * for the caller alone (never who the owner is or whether one is set); null when signed out.
 */
export const me = maybeUserQuery({
  args: {},
  returns: v.union(v.null(), v.object({ isOwner: v.boolean() })),
  handler: async (ctx) => (ctx.user === null ? null : { isOwner: await isAppOwner(ctx, ctx.user) }),
});

/**
 * The app's effective settings (saved values over the defaults and today's env-var numbers), for the admin pages.
 * Settings only: never a key, a secret, the owner id or any env value other than the Lorekeeper numbers.
 */
export const settings = appOwnerQuery({
  args: {},
  returns: appSettingsValidator,
  handler: async (ctx) => readAppConfig(ctx),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's audit rows read to find an earlier open of the same campaign (Recent changes holds few rows a day). */
export const OPEN_DEDUPE_SCAN = 500;

/**
 * Logs that the owner opened a campaign read-only (config AD13, Q27 b): one `campaign.view` audit row per campaign per
 * UTC day, so reopening it does not flood Recent changes. A query can't write, so the Overview's Open calls this
 * before it navigates; the view itself is the campaign query wrappers' (`permissionFor`'s owner view), which this does
 * not grant. NOT_FOUND for a missing or deleted campaign. Returns whether a row was written.
 */
export const openCampaign = appOwnerMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.object({ logged: v.boolean() }),
  handler: async (ctx, { campaignId }) => {
    const campaign = await liveCampaign(ctx, campaignId);
    const now = Date.now();
    const dayStart = now - (now % DAY_MS);
    const today = await ctx.db
      .query("adminAudit")
      .withIndex("by_at", (q) => q.gte("at", dayStart))
      .order("desc")
      .take(OPEN_DEDUPE_SCAN);
    // More rows than the scan today: log again rather than miss a visit.
    const seen = today.some((row) => row.action === "campaign.view" && row.actorId === ctx.user._id && row.target === campaign._id);
    if (seen) return { logged: false };
    await recordAdminChange(ctx, ctx.user._id, { action: "campaign.view", target: campaign._id });
    return { logged: true };
  },
});
