import { v, type Infer } from "convex/values";

import { resolveTableSettings } from "../src/lib/config/campaign-settings";
import { appError } from "../src/lib/errors/app-error";
import { assertCampaignCaps } from "./campaigns";
import { creatorMutation, gmMutation } from "./lib/functions";
import { liveSession } from "./lib/sessions";
import {
  fearAtStartValidator,
  lorekeeperAskValidator,
  sessionOpensOnValidator,
} from "./lib/validators/campaigns";

/**
 * Campaign settings, server side (plan config S2; the Table, Lorekeeper and Sessions rows of the Campaign settings
 * slide-over). Every member reads the resolved settings from `campaigns.get`, so a change here reaches everyone at once.
 */

/**
 * One table setting and its new value (rule 12: an intent, one field per call). A new setting adds a member here and
 * an optional field to `storedTableSettingsValidator`. Plan rule-switches WF (M4, Q12 a): `outOfRange` is no longer set
 * here (House rules `ruleModes.outOfRange`); the stored field stays until the migration ran on every deployment.
 */
export const tableSettingChangeValidator = v.union(
  v.object({ key: v.literal("playersSeeFear"), value: v.boolean() }),
  v.object({ key: v.literal("spotlightToPlayers"), value: v.boolean() }),
  v.object({ key: v.literal("lorekeeperWeb"), value: v.boolean() }),
  v.object({ key: v.literal("lorekeeperAsk"), value: lorekeeperAskValidator }),
  v.object({ key: v.literal("fearAtStart"), value: fearAtStartValidator }),
  v.object({ key: v.literal("sessionOpensOn"), value: sessionOpensOnValidator }),
  v.object({ key: v.literal("autoSessionLog"), value: v.boolean() }),
);

export type TableSettingChange = Infer<typeof tableSettingChangeValidator>;

/**
 * The GM (and, once config G1 lands, a co-GM) changes one table setting. Patches only that field of
 * `campaigns.tableSettings`; a value equal to the resolved one (the stored value, or the default when unset) writes
 * nothing. An archived campaign is refused by G1's wrapper guard (CAMPAIGN_ARCHIVED).
 */
export const set = gmMutation({
  args: { change: tableSettingChangeValidator },
  returns: v.null(),
  handler: async (ctx, { change }) => {
    const campaign = ctx.campaign;
    const stored = campaign.tableSettings ?? {};
    if (resolveTableSettings(stored)[change.key] === change.value) return null;
    await ctx.db.patch("campaigns", campaign._id, { tableSettings: { ...stored, [change.key]: change.value } });
    return null;
  },
});

/** Why archiving waits while a session is live (Q9 a): ending the session is a write, which an archive would refuse. */
export const ARCHIVE_LIVE_MESSAGE = "End the session first.";

/**
 * The creator archives the campaign (plan config S3; Q9 a, Q7 a): it becomes read-only for everyone (G1's wrapper guard
 * refuses every other campaign mutation with CAMPAIGN_ARCHIVED) until the creator restores it. Refused with INVALID
 * while a session is live. Idempotent: archiving an archived campaign keeps its first `archivedAt` and writes nothing.
 */
export const archive = creatorMutation({
  args: {},
  returns: v.null(),
  archived: "allow",
  handler: async (ctx) => {
    const campaign = ctx.campaign;
    if (campaign.archivedAt !== undefined) return null;
    if ((await liveSession(ctx, campaign._id)) !== null) throw appError("INVALID", ARCHIVE_LIVE_MESSAGE);
    await ctx.db.patch("campaigns", campaign._id, { archivedAt: Date.now() });
    return null;
  },
});

/** The creator restores an archived campaign (S3): writes open again. Idempotent: a campaign not archived writes nothing. */
export const unarchive = creatorMutation({
  args: {},
  returns: v.null(),
  archived: "allow",
  handler: async (ctx) => {
    const campaign = ctx.campaign;
    if (campaign.archivedAt === undefined) return null;
    await assertCampaignCaps(ctx, campaign.ownerId); // AD5a: archived didn't count toward the caps; restored, it does
    await ctx.db.patch("campaigns", campaign._id, { archivedAt: undefined });
    return null;
  },
});
