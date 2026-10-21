import { v, type Infer } from "convex/values";

import type { VisionTraits } from "../../src/lib/domain/combat-map/index";
import { isSettingId, pickSetting, spriteTraits, type SpriteTraits } from "../../src/lib/sprite-packs/index";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { MAX_COMBAT_AREAS, MAX_COMBAT_OBJECTS } from "./combatMaps";
import {
  combatObjectKindValidator,
  combatTerrainValidator,
  sightModeValidator,
  type SettingRef,
  type SpriteRef,
} from "./validators/combatMaps";
import {
  MAX_TEXTURE_PALETTE,
  spriteCategoryValidator,
  spriteFootprintValidator,
  spriteHeightValidator,
  spriteLightValidator,
  spritePxValidator,
} from "./validators/spritePacks";

/**
 * Sprite sources on the server (plan `.omc/plans/sprite-packs.yaml`, tracer P5): resolving a map's uploaded sprite
 * refs to their `spritePackSprites` rows (D9: an unknown, deleted or other campaign's sprite resolves to null and
 * the object falls back to its Classic kind), the traits the vision engine reads (D3, Q1, P3), the map's resolved
 * setting (D7) and the uploaded-sprite rows the client draws with. Built-in sprites never touch the database: their
 * traits come from P1's catalog and their files from the static manifest. Callers are campaign / GM wrappers.
 */

// ---------------------------------------------------------------- traits

/**
 * Compile-time check (P5 acceptance): P1's `SpriteTraits` is assignable to P3's `VisionTraits`, so a catalog or
 * uploaded sprite's traits go into `prepareMap` without a conversion that could drift.
 */
export function visionTraitsOf(traits: SpriteTraits): VisionTraits {
  return traits;
}

/** Distinct uploaded sprite ids a map can reference: every object, every area and the whole texture palette. */
export const MAX_MAP_SPRITE_REFS = MAX_COMBAT_OBJECTS + MAX_COMBAT_AREAS + MAX_TEXTURE_PALETTE;

/** Uploaded rows by id; a missing id is a deleted (or foreign) sprite. */
export type UploadedSprites = ReadonlyMap<string, Doc<"spritePackSprites">>;

/**
 * Loads the uploaded rows behind `refs` (built-in refs are skipped), one `get` per distinct id, at most
 * MAX_MAP_SPRITE_REFS of them. A row of another campaign is treated as deleted (D9).
 */
export async function resolveRefs(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  refs: Iterable<SpriteRef | undefined>,
): Promise<UploadedSprites> {
  const ids = new Set<Id<"spritePackSprites">>();
  for (const ref of refs) {
    if (ref !== undefined && "uploaded" in ref) ids.add(ref.uploaded);
    if (ids.size >= MAX_MAP_SPRITE_REFS) break;
  }
  const rows = new Map<string, Doc<"spritePackSprites">>();
  for (const id of ids) {
    const row = await ctx.db.get("spritePackSprites", id);
    if (row !== null && row.campaignId === campaignId) rows.set(id, row);
  }
  return rows;
}

/** The vision traits of an object's sprite (catalog or uploaded row), or null: no sprite, unknown key, deleted row (D1, D9). */
export function objectTraits(object: { sprite?: SpriteRef }, uploaded: UploadedSprites): VisionTraits | null {
  if (object.sprite === undefined) return null;
  const traits = spriteTraits(object.sprite, { uploaded: (id) => uploaded.get(id) });
  return traits === null ? null : visionTraitsOf(traits);
}

/** One object's sprite traits, reading its uploaded row if it has one (toggleLight; scenes use `resolveRefs`). */
export async function loadObjectTraits(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  object: { sprite?: SpriteRef },
): Promise<VisionTraits | null> {
  return objectTraits(object, await resolveRefs(ctx, campaignId, [object.sprite]));
}

/** Every sprite ref a map holds: object sprites, area textures and the texture palette. */
export function mapSpriteRefs(map: Doc<"combatMaps">, objects: readonly Doc<"combatMapObjects">[]): SpriteRef[] {
  const refs: SpriteRef[] = [];
  for (const object of objects) if (object.sprite !== undefined) refs.push(object.sprite);
  for (const area of map.areas) if (area.texture !== undefined) refs.push(area.texture);
  for (const ref of map.texturePalette ?? []) refs.push(ref);
  return refs;
}

// ---------------------------------------------------------------- setting

/** The keyword picker's setting for a map without a stored one (D7): its scene prompt and name, else the default. */
export function keywordSetting(map: Pick<Doc<"combatMaps">, "prompt" | "name">): SettingRef {
  return { builtin: pickSetting(map.prompt ?? "", map.name) };
}

/**
 * The map's setting as it is drawn (D7): the stored one when it still resolves (a built-in id the catalog knows, or
 * a pack of this campaign), else the keyword picker's (a deleted pack falls back too, D9). Returns the pack row for a
 * pack setting and whether the stored setting was used.
 */
export async function resolveSetting(
  ctx: QueryCtx,
  map: Doc<"combatMaps">,
): Promise<{ setting: SettingRef; pack: Doc<"spritePacks"> | null; stored: boolean }> {
  const stored = map.setting;
  if (stored !== undefined) {
    if ("builtin" in stored) {
      if (isSettingId(stored.builtin)) return { setting: stored, pack: null, stored: true };
    } else {
      const pack = await ctx.db.get("spritePacks", stored.pack);
      if (pack !== null && pack.campaignId === map.campaignId) return { setting: stored, pack, stored: true };
    }
  }
  return { setting: keywordSetting(map), pack: null, stored: false };
}

// ---------------------------------------------------------------- client rows

/** An uploaded sprite as a player's client draws it: traits, Classic fallback, pixel size and image link. */
const spriteDrawFields = {
  _id: v.id("spritePackSprites"),
  category: spriteCategoryValidator,
  w: v.number(),
  h: v.number(),
  sight: sightModeValidator,
  light: spriteLightValidator,
  height: spriteHeightValidator,
  footprint: spriteFootprintValidator,
  classicKind: combatObjectKindValidator,
  classicVariant: v.optional(v.string()),
  terrain: v.optional(combatTerrainValidator),
  rotatable: v.optional(v.boolean()),
  px: spritePxValidator,
  /** `getUrl` link of its `files` row (CF18: a bearer link); null when the file is gone (the object draws Classic). */
  url: v.union(v.string(), v.null()),
};
export const playerSpriteValidator = v.object(spriteDrawFields);
export type PlayerSprite = Infer<typeof playerSpriteValidator>;

/** The GM's row adds the label and the pack (D10: labels and packs are GM-only). */
export const gmSpriteValidator = v.object({ ...spriteDrawFields, name: v.string(), packId: v.id("spritePacks") });
export type GmSprite = Infer<typeof gmSpriteValidator>;

/** The image link of a sprite, resolved through its `files` row (CF17: kind "sprite", refId = the sprite). */
async function spriteUrl(ctx: QueryCtx, sprite: Doc<"spritePackSprites">): Promise<string | null> {
  const file = await ctx.db.get("files", sprite.fileId);
  if (file === null || file.kind !== "sprite" || file.refId !== sprite._id || file.campaignId !== sprite.campaignId) return null;
  return ctx.storage.getUrl(file.storageId).catch(() => null);
}

export async function playerSpriteOf(ctx: QueryCtx, sprite: Doc<"spritePackSprites">): Promise<PlayerSprite> {
  return {
    _id: sprite._id,
    category: sprite.category,
    w: sprite.w,
    h: sprite.h,
    sight: sprite.sight,
    light: sprite.light,
    height: sprite.height,
    footprint: sprite.footprint,
    classicKind: sprite.classicKind,
    ...(sprite.classicVariant === undefined ? {} : { classicVariant: sprite.classicVariant }),
    ...(sprite.terrain === undefined ? {} : { terrain: sprite.terrain }),
    ...(sprite.rotatable === undefined ? {} : { rotatable: sprite.rotatable }),
    px: sprite.px,
    url: await spriteUrl(ctx, sprite),
  };
}

export async function gmSpriteOf(ctx: QueryCtx, sprite: Doc<"spritePackSprites">): Promise<GmSprite> {
  return { ...(await playerSpriteOf(ctx, sprite)), name: sprite.name, packId: sprite.packId };
}
