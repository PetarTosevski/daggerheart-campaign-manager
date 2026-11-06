import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { logAction } from "./lib/actionLog";
import { activeAreasOnMap, damageArea, endArea } from "./lib/combatAreas";
import { loadCombatMap } from "./lib/combatMaps";
import { campaignMutation, campaignQuery, gmMutation } from "./lib/functions";
import { atLeast, permissionFor } from "./lib/permissions";
import { AREA_RADII, areaCentreValidator, pointValidator } from "./lib/validators/combatMaps";

/**
 * Live map areas, the public API (plan lanes-2 E4, dcm-lqnt server half): `list` (the map overlay: the live areas of a
 * map), `remove` (the GM, or the caster's player), `damage` (the GM marks a damageable area's HP). The area runtime the
 * card and feature mutations use is convex/lib/combatAreas.ts (moved there by dcm-uh6r, so that this module, the
 * overlay's subscription, does not load the move and card runners at every call).
 */

/** One live area as the map overlay draws it (aoe-sprites spec: the overlay picks the art by `label`). */
const areaViewValidator = v.object({
  _id: v.id("combatAreas"),
  label: v.string(),
  shape: v.union(v.literal("circle"), v.literal("wall")),
  /** A token centre is drawn around the token where the viewer sees it; no position is sent for it. */
  centre: areaCentreValidator,
  radius: v.union(...AREA_RADII.map((r) => v.literal(r))),
  wall: v.optional(v.object({ a: pointValidator, b: pointValidator })),
  blocksSight: v.boolean(),
  /** A damageable area's HP (Wild Fortress). */
  damage: v.optional(v.object({ hp: v.number(), hpMax: v.number() })),
  characterId: v.id("characters"),
});

/**
 * The live areas on a map (the overlay, dcm-lqnt). Players read the live map only (another map reads as empty, R2); the
 * GM any of the campaign's maps. An unknown map reads as empty. A token centre is sent as its token id, never a position,
 * so an area around a token the player can't see shows nothing new.
 */
export const list = campaignQuery({
  need: "view",
  enough: "owner",
  args: { mapId: v.string() },
  returns: v.array(areaViewValidator),
  handler: async (ctx, { mapId }) => {
    const id = ctx.db.normalizeId("combatMaps", mapId);
    const map = id === null ? null : await ctx.db.get("combatMaps", id);
    if (map === null || map.campaignId !== ctx.campaign._id) return [];
    if (!map.live && !atLeast(ctx.permission, "owner")) return [];
    return (await activeAreasOnMap(ctx, map._id)).map((a) => ({
      _id: a._id,
      label: a.label,
      shape: a.shape,
      centre: a.centre,
      radius: a.radius,
      ...(a.wall ? { wall: a.wall } : {}),
      blocksSight: a.blocksSight,
      ...(a.damage ? { damage: { hp: a.damage.hp, hpMax: a.damage.hpMax } } : {}),
      characterId: a.characterId,
    }));
  },
});

/** The area when the id is one of this campaign's live areas, else NOT_FOUND. */
async function loadArea(ctx: QueryCtx, campaignId: Id<"campaigns">, areaId: string): Promise<Doc<"combatAreas">> {
  const id = ctx.db.normalizeId("combatAreas", areaId);
  const area = id === null ? null : await ctx.db.get("combatAreas", id);
  if (area === null || area.campaignId !== campaignId || area.status !== "active") throw appError("NOT_FOUND");
  return area;
}

/**
 * Ends a live area (the GM's Remove; the caster's player dismissing their own spell on the live map). Anyone else:
 * FORBIDDEN. Ended rows are swept by the retention cron.
 */
export const remove = campaignMutation({
  need: "view",
  enough: "owner",
  args: { areaId: v.string() },
  returns: v.null(),
  handler: async (ctx, { areaId }) => {
    const area = await loadArea(ctx, ctx.campaign._id, areaId);
    if (!atLeast(ctx.permission, "owner")) {
      const character = await ctx.db.get("characters", area.characterId);
      const permission = character === null ? null : await permissionFor(ctx, ctx.user, { type: "character", campaign: ctx.campaign, character }, "edit");
      if (permission === null || !atLeast(permission, "edit")) throw appError("FORBIDDEN");
      const map = await loadCombatMap(ctx, ctx.campaign._id, area.mapId);
      if (!map.live) throw appError("FORBIDDEN");
    }
    await endArea(ctx, area);
    return null;
  },
});

/**
 * The GM marks a damageable area with an attack's damage (Wild Fortress, CB p.339: thresholds 15/30, "lasts until it
 * marks 3 Hit Points"; dcm-cj8): 1 / 2 / 3 HP by its thresholds; at its last HP it ends. Public feed row.
 */
export const damage = gmMutation({
  args: { areaId: v.string(), amount: v.number() },
  returns: v.object({ marked: v.number(), hp: v.number(), ended: v.boolean() }),
  handler: async (ctx, { areaId, amount }) => {
    if (!Number.isInteger(amount) || amount < 0 || amount > 999) throw appError("INVALID", "Damage is a whole number from 0 to 999.");
    const area = await loadArea(ctx, ctx.campaign._id, areaId);
    const out = await damageArea(ctx, area, amount);
    await logAction(ctx, {
      campaignId: ctx.campaign._id,
      characterId: area.characterId,
      actorId: ctx.user._id,
      kind: "combat",
      visibility: "public",
      summary: `${area.label} takes ${amount} damage and marks ${out.marked} HP (${out.hp}/${area.damage?.hpMax ?? out.hp})${out.ended ? "; it falls" : ""}`,
      undoable: false,
    });
    return out;
  },
});
