import { v } from "convex/values";

import { frameHasMechanic } from "../src/lib/frames/index";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { hudPartyMemberValidator, partyMemberOf, type HudPartyMember } from "./lib/combatHud";
import { liveCombatMap, tokensOnMap } from "./lib/combatMaps";
import { campaignLight, lightLevelValidator } from "./lib/combatVision";
import { campaignFearState } from "./lib/fear";
import { campaignQuery } from "./lib/functions";
import { atLeast } from "./lib/permissions";

/**
 * Combat HUD reads (plan `.omc/plans/combat-hud.yaml`, tracer HD1; Main, CmpTokens, GMDesktop boards). Each is one
 * small query so a banner's HP tick or a Fear click re-sends only its own slice.
 *
 * - `party` (every member): one row per PC token on the map, what the banners and the tokens' Hope chips show (HP,
 *   Stress, Armor, Hope, conditions, class, level, portrait, death move due). Players read the live map only (any
 *   other map reads as empty, as `combatTokens.party`); the GM any map. Never an adversary, ally, neutral or custom
 *   token: their numbers stay the GM's (R4, HANDOFF hard rule 2).
 * - `scene` (every member): Fear, the campaign's light and time phase, the campaign day (frames with campaign time
 *   only), and what the caller may change: the light (`canSetLight`, edit access without campaign time, as
 *   `campaigns.timeOfDay`) and the time arc (`canOpenTimeArc`, the GM in a frame with campaign time).
 */

/** The map a caller's banners follow: `mapId` when given (players: only the live one), else the live map. */
async function partyMap(ctx: QueryCtx, campaignId: Doc<"campaigns">["_id"], gm: boolean, mapId: string | undefined) {
  if (mapId === undefined) return liveCombatMap(ctx, campaignId);
  const id = ctx.db.normalizeId("combatMaps", mapId);
  const map = id === null ? null : await ctx.db.get("combatMaps", id);
  if (map === null || map.campaignId !== campaignId) return null;
  return gm || map.live ? map : null;
}

export const party = campaignQuery({
  need: "view",
  enough: "owner",
  args: { mapId: v.optional(v.string()) },
  returns: v.array(hudPartyMemberValidator),
  handler: async (ctx, { mapId }) => {
    const gm = atLeast(ctx.permission, "owner");
    const map = await partyMap(ctx, ctx.campaign._id, gm, mapId);
    if (map === null) return [];
    const rows: HudPartyMember[] = [];
    for (const token of await tokensOnMap(ctx, map._id)) {
      if (token.ref.kind !== "pc") continue;
      const row = await partyMemberOf(ctx, ctx.campaign, ctx.user, gm, token._id, token.ref.characterId);
      if (row !== null) rows.push(row);
    }
    return rows;
  },
});

const sceneValidator = v.object({
  /** GM Fear, 0-12. */
  fear: v.number(),
  /** The light every map follows (dcm-bxp.54). */
  light: lightLevelValidator,
  /** The campaign time phase ("Nightfall"), or null in a frame without campaign time. */
  phase: v.union(v.string(), v.null()),
  /** The campaign day (week, day of the week, Day / Night cycle); null in a frame without campaign time. */
  day: v.union(
    v.null(),
    v.object({ week: v.number(), day: v.number(), cycle: v.union(v.literal("DAY"), v.literal("NIGHT")) }),
  ),
  /** The caller may set Day / Dim / Night (edit access, no campaign time: `campaigns.setTimeOfDay`). */
  canSetLight: v.boolean(),
  /** The GM's disc opens the time arc / End day (the GM, in a frame with campaign time). */
  canOpenTimeArc: v.boolean(),
});

export const scene = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: sceneValidator,
  handler: async (ctx) => {
    const { campaign } = ctx;
    const timed = frameHasMechanic(campaign.frameId, "campaignTime");
    const { phase, light } = await campaignLight(ctx, campaign);
    const fear = (await campaignFearState(ctx, campaign._id)).fear;
    let day: { week: number; day: number; cycle: "DAY" | "NIGHT" } | null = null;
    if (timed) {
      const row = await ctx.db
        .query("campaignTime")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
        .unique();
      // A campaign whose first day has not ended is at the initial time (week 1, Day, day 1).
      day = row === null ? { week: 1, day: 1, cycle: "DAY" } : { week: row.week, day: row.cycleDay, cycle: row.cycle };
    }
    return {
      fear,
      light,
      phase,
      day,
      canSetLight: atLeast(ctx.permission, "edit") && !timed,
      canOpenTimeArc: atLeast(ctx.permission, "owner") && timed,
    };
  },
});
