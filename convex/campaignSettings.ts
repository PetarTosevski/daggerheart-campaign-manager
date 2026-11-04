import { v, type Infer } from "convex/values";

import { resolveTableSettings } from "../src/lib/config/campaign-settings";
import { gmMutation } from "./lib/functions";
import {
  fearAtStartValidator,
  lorekeeperAskValidator,
  outOfRangeValidator,
  sessionOpensOnValidator,
} from "./lib/validators/campaigns";

/**
 * Campaign settings, server side (plan config S2; the Table, Lorekeeper and Sessions rows of the Campaign settings
 * slide-over). Every member reads the resolved settings from `campaigns.get`, so a change here reaches everyone at once.
 */

/**
 * One table setting and its new value (rule 12: an intent, one field per call). A new setting adds a member here and
 * an optional field to `storedTableSettingsValidator`.
 */
export const tableSettingChangeValidator = v.union(
  v.object({ key: v.literal("playersSeeFear"), value: v.boolean() }),
  v.object({ key: v.literal("outOfRange"), value: outOfRangeValidator }),
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
