import { z } from "zod";

import { migrations } from "../lib/migrations";

/**
 * F8-I1 (dcm-bxp.99.27): moves hand sharing out of the places F7-H4 stored it into typed fields (CD6), widen ->
 * migrate -> narrow. The schema already has `campaigns.playersSeeHands` and `characters.handHidden` (widen), and the
 * code reads only them (narrow: neither old place has a validator of its own to tighten). Run both once per
 * deployment, right after the deploy that adds the fields (see `run.ts`); until they run, a switch the GM turned off
 * and hands players hid read as on / shared. Both are idempotent, so `reset: true` is safe.
 *   npx convex run migrations/run:run '{fn: "migrations/handSharing:moveSwitch", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/handSharing:moveSwitch"}'
 *   npx convex run migrations/run:run '{fn: "migrations/handSharing:moveHidden", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/handSharing:moveHidden"}'
 */

/** The `options` key F7-H4 kept the GM's switch in. */
export const OLD_SWITCH_KEY = "playersSeeHands";
/** The `frameTrackers` key F7-H4 kept the hidden hands in. */
export const OLD_PRIVACY_KEY = "handPrivacy";

/**
 * `campaigns.options.playersSeeHands` -> `campaigns.playersSeeHands`, and the key leaves `options` (an emptied
 * `options` is unset). A field already set (the GM flipped the switch after the deploy) wins over the old key.
 */
export const moveSwitch = migrations.define({
  table: "campaigns",
  migrateOne: (_ctx, row) => {
    const options = row.options;
    if (options === undefined || !(OLD_SWITCH_KEY in options)) return;
    const { [OLD_SWITCH_KEY]: old, ...rest } = options;
    return {
      options: Object.keys(rest).length > 0 ? rest : undefined,
      ...(row.playersSeeHands === undefined ? { playersSeeHands: old } : {}),
    };
  },
});

const privacySchema = z.object({ hidden: z.array(z.string()) });

/**
 * Each campaign's `handPrivacy` tracker -> `handHidden: true` on each listed character of that campaign, then the row is
 * deleted. Ids that are not characters of the row's campaign (removed since) are dropped. A blob that fails its schema
 * is left as it is (and logged) for a manual repair.
 */
export const moveHidden = migrations.define({
  table: "frameTrackers",
  migrateOne: async (ctx, row) => {
    if (row.key !== OLD_PRIVACY_KEY) return;
    const parsed = privacySchema.safeParse(row.data);
    if (!parsed.success) {
      console.warn(`Tracker ${row._id} (${row.key}) does not match its schema; left unmigrated.`);
      return;
    }
    for (const raw of parsed.data.hidden) {
      const id = ctx.db.normalizeId("characters", raw);
      const character = id === null ? null : await ctx.db.get("characters", id);
      if (character === null || character.campaignId !== row.campaignId || character.handHidden === true) continue;
      await ctx.db.patch("characters", character._id, { handHidden: true });
    }
    await ctx.db.delete("frameTrackers", row._id);
  },
});
