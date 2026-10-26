import { v } from "convex/values";

import { isSettingId, SETTING_LABEL, SETTINGS } from "../src/lib/sprite-packs/index";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { liveCombatMap, loadCombatMap, objectsOnMap } from "./lib/combatMaps";
import { campaignQuery, gmMutation, gmQuery } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import {
  gmSpriteOf,
  gmSpriteValidator,
  keywordSetting,
  mapSpriteRefs,
  playerSpriteOf,
  playerSpriteValidator,
  resolveRefs,
  resolveSetting,
  type GmSprite,
} from "./lib/spriteSources";
import { mapStyleValidator, settingRefValidator, type SettingRef } from "./lib/validators/combatMaps";
import { MAX_PACK_SPRITES, MAX_SPRITE_PACKS } from "./lib/validators/spritePacks";

/**
 * A map's drawing style and setting, and the sprites the client draws it with (plan `.omc/plans/sprite-packs.yaml`,
 * tracer P5).
 *
 * - `setStyle` (GM): Classic or Sprites, one intent (D1: only the map's `style`; a first switch to Sprites also
 *   stores the keyword-picked setting, D7). Maps without `style` are Classic (Q4, E3).
 * - `setSetting` (GM): a built-in setting, a pack of this campaign, or null = "Let Claude choose" (D7, Q3).
 * - `settings` (GM): the Setting picker's options: the built-in settings, the packs that are settings of their own,
 *   and for each pack that extends a built-in setting, that setting (Q3).
 * - `spriteSources` (every member): style, resolved setting and the uploaded sprites the map is drawn with. The GM
 *   gets any map with the setting's packs and every uploaded ref on the map, labelled; a player only the live map
 *   and only the uploaded sprites it references, unlabelled (D10). Built-in sprites come from the static manifest.
 */

const now = () => Date.now();

// ---------------------------------------------------------------- validators

/** One Setting picker option for a GM pack: `extends` = the built-in setting it adds to, null = a setting of its own. */
const packSettingValidator = v.object({
  _id: v.id("spritePacks"),
  name: v.string(),
  extends: v.union(v.object({ id: v.string(), label: v.string() }), v.null()),
});

const settingsValidator = v.object({
  builtin: v.array(v.object({ id: v.string(), label: v.string() })),
  packs: v.array(packSettingValidator),
});

const styleOf = (map: Doc<"combatMaps">) => map.style ?? "classic";

const gmSourcesValidator = v.object({
  view: v.literal("gm"),
  mapId: v.id("combatMaps"),
  style: mapStyleValidator,
  /** The setting the map is drawn in (D7): the stored one, else the keyword picker's. */
  setting: settingRefValidator,
  /** Whether the GM picked it (false: Claude or the keyword picker chose, or nothing is stored yet). */
  settingPicked: v.boolean(),
  /** The setting's uploaded sprites (its own pack, or the packs extending the built-in setting) and every uploaded ref on the map. */
  sprites: v.array(gmSpriteValidator),
});

const playerSourcesValidator = v.object({
  view: v.literal("player"),
  mapId: v.id("combatMaps"),
  style: mapStyleValidator,
  setting: settingRefValidator,
  /** Only the uploaded sprites the live map references (D10). */
  sprites: v.array(playerSpriteValidator),
});

// ---------------------------------------------------------------- helpers

/** The campaign's packs (at most MAX_SPRITE_PACKS). */
function packsOf(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"spritePacks">[]> {
  return ctx.db
    .query("spritePacks")
    .withIndex("by_campaign_updated", (q) => q.eq("campaignId", campaignId))
    .take(MAX_SPRITE_PACKS);
}

/** A pack's sprites in order (at most MAX_PACK_SPRITES). */
function spritesOfPack(ctx: QueryCtx, packId: Id<"spritePacks">): Promise<Doc<"spritePackSprites">[]> {
  return ctx.db
    .query("spritePackSprites")
    .withIndex("by_pack_order", (q) => q.eq("packId", packId))
    .take(MAX_PACK_SPRITES);
}

/** A setting ref the GM may store: a built-in setting (not `common`) or a pack of this campaign. */
async function checkSetting(ctx: QueryCtx, campaignId: Id<"campaigns">, setting: SettingRef): Promise<void> {
  if ("builtin" in setting) {
    if (!isSettingId(setting.builtin)) throw appError("SPRITE_SETTING_UNKNOWN");
    return;
  }
  const pack = await ctx.db.get("spritePacks", setting.pack);
  if (pack === null || pack.campaignId !== campaignId) throw appError("SPRITE_PACK_NOT_FOUND");
}

// ---------------------------------------------------------------- mutations

/** GM: draws a map Classic or with Sprites (D1, P3). A first switch to Sprites stores the keyword-picked setting (D7). */
export const setStyle = gmMutation({
  args: { mapId: v.string(), style: mapStyleValidator },
  returns: v.null(),
  handler: async (ctx, { mapId, style }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    if (styleOf(map) === style && (style === "classic" || map.setting !== undefined)) return null;
    const setting = style === "sprites" && map.setting === undefined ? { setting: keywordSetting(map), settingPicked: false } : {};
    await ctx.db.patch("combatMaps", map._id, { style, ...setting, updatedAt: now() });
    return null;
  },
});

/**
 * GM: the map's setting (D7). A built-in id must be a setting (SPRITE_SETTING_UNKNOWN; `common` is not one), a pack
 * must be this campaign's (SPRITE_PACK_NOT_FOUND). `null` = "Let Claude choose": the keyword picker's setting is
 * stored with `settingPicked: false`, so the map draws at once and the next generation may let Claude choose (P7).
 */
export const setSetting = gmMutation({
  args: { mapId: v.string(), setting: v.union(settingRefValidator, v.null()) },
  returns: v.null(),
  handler: async (ctx, { mapId, setting }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    if (setting !== null) await checkSetting(ctx, ctx.campaign._id, setting);
    const next = setting === null ? { setting: keywordSetting(map), settingPicked: false } : { setting, settingPicked: true };
    await ctx.db.patch("combatMaps", map._id, { ...next, updatedAt: now() });
    return null;
  },
});

// ---------------------------------------------------------------- queries

/** GM: the Setting picker's options (Q3). */
export const settings = gmQuery({
  args: {},
  returns: settingsValidator,
  handler: async (ctx) => {
    const packs = await packsOf(ctx, ctx.campaign._id);
    packs.sort((a, b) => a.name.localeCompare(b.name));
    return {
      builtin: SETTINGS.map((s) => ({ id: s.id, label: s.label })),
      packs: packs.map((pack) => ({
        _id: pack._id,
        name: pack.name,
        extends: pack.extends !== undefined && isSettingId(pack.extends) ? { id: pack.extends, label: SETTING_LABEL[pack.extends] } : null,
      })),
    };
  },
});

/**
 * Everyone in the campaign: what the client needs to draw a map's sprites. The GM may ask for any map of the
 * campaign; a player only for the live map (COMBAT_MAP_NOT_FOUND otherwise, as for a deleted map) and gets only
 * the uploaded sprites that map references, without labels or packs (D10).
 */
export const spriteSources = campaignQuery({
  need: "view",
  enough: "owner",
  args: { mapId: v.string() },
  returns: v.union(gmSourcesValidator, playerSourcesValidator),
  handler: async (ctx, { mapId }) => {
    const gm = atLeast(ctx.permission, "owner");
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    if (!gm) {
      const live = await liveCombatMap(ctx, ctx.campaign._id);
      if (live === null || live._id !== map._id) throw appError("COMBAT_MAP_NOT_FOUND");
    }
    const objects = await objectsOnMap(ctx, map._id);
    const referenced = await resolveRefs(ctx, ctx.campaign._id, mapSpriteRefs(map, objects));
    const { setting, pack, stored } = await resolveSetting(ctx, map);
    if (!gm) {
      const sprites = [];
      for (const row of referenced.values()) sprites.push(await playerSpriteOf(ctx, row));
      return { view: "player" as const, mapId: map._id, style: styleOf(map), setting, sprites };
    }
    // The setting's packs: a pack setting is its own pack; a built-in setting gathers the packs that extend it (Q3).
    const packs = pack !== null ? [pack] : (await packsOf(ctx, ctx.campaign._id)).filter((p) => "builtin" in setting && p.extends === setting.builtin);
    const rows = new Map(referenced);
    for (const p of packs) for (const row of await spritesOfPack(ctx, p._id)) rows.set(row._id, row);
    const sprites: GmSprite[] = [];
    for (const row of rows.values()) sprites.push(await gmSpriteOf(ctx, row));
    return {
      view: "gm" as const,
      mapId: map._id,
      style: styleOf(map),
      setting,
      settingPicked: stored && map.settingPicked === true,
      sprites,
    };
  },
});
