import { v, type Infer } from "convex/values";

import { combatObjectKindValidator, combatTerrainValidator, sightModeValidator } from "./combatMaps";

/**
 * Validators and caps of the sprite-pack tables (plan `.omc/plans/sprite-packs.yaml`, tracer P0;
 * `convex/tables/spritePacks.ts`), defined once (CD19). Every field is typed (no blob, so no schemaVersion).
 * Counts and ranges a validator cannot express are checked by the functions with these constants: caps with an
 * index `.take(cap + 1)`, sizes and name lengths in the handler. Client code derives its types with `Infer<>`.
 *
 * The sprite and setting references stored on maps, areas and objects (`spriteRefValidator`,
 * `settingRefValidator`, `mapStyleValidator`) live with the map validators in `./combatMaps.ts`.
 */

const literals = <T extends string>(values: readonly T[]) => v.union(...values.map((value) => v.literal(value)));

// ---------------------------------------------------------------- caps

/** GM packs per campaign (SPRITE_PACK_LIMIT past it). */
export const MAX_SPRITE_PACKS = 20;
/** Uploaded sprites per pack (SPRITE_LIMIT past it). One 4 x 4 props sheet is 16. */
export const MAX_PACK_SPRITES = 64;
/** Distinct textures hand-painted on one map's "texture" layer (SPRITE_PALETTE_FULL past it); = TEXTURE_CODES.length. */
export const MAX_TEXTURE_PALETTE = 16;
/** An uploaded sprite's file size after the browser's re-encode (larger: the upload is rejected, CF16). */
export const MAX_SPRITE_BYTES = 1024 * 1024;
/** An uploaded sprite's longest side in pixels (the browser resizes to this before upload). */
export const MAX_SPRITE_PX = 1024;
/** Pack and sprite names: 1..60 characters after trimming (INVALID otherwise). */
export const MAX_PACK_NAME = 60;
export const MAX_SPRITE_NAME = 60;
/** A sprite's footprint in squares per side (D4): 1..4. */
export const MIN_SPRITE_SQUARES = 1;
export const MAX_SPRITE_SQUARES = 4;

// ---------------------------------------------------------------- traits

/** Whether an uploaded sprite is placed as an object or tiled as a terrain texture. */
export const SPRITE_CATEGORIES = ["object", "texture"] as const;
export type SpriteCategory = (typeof SPRITE_CATEGORIES)[number];
export const spriteCategoryValidator = literals(SPRITE_CATEGORIES);

/**
 * Light a sprite gives (Q1 = b): none, a faint glow (FAINT_GLOW_REACH: clear 1, dim 3 squares; candles, crystals,
 * glowing moss), torch-like or campfire-like (R9's MAP_LIGHT_REACH). Spelled like the Classic kinds ("walltorch").
 */
export const SPRITE_LIGHTS = ["none", "faintglow", "torch", "campfire"] as const;
export type SpriteLight = (typeof SPRITE_LIGHTS)[number];
export const spriteLightValidator = literals(SPRITE_LIGHTS);

/** Shadow height (D5): flat things cast none, low and tall ones a shorter or longer shadow to the bottom-right. */
export const SPRITE_HEIGHTS = ["flat", "low", "tall"] as const;
export type SpriteHeight = (typeof SPRITE_HEIGHTS)[number];
export const spriteHeightValidator = literals(SPRITE_HEIGHTS);

/** What blocks sight on the grid (P3): a circle of radius r, or a w x h rectangle rotated by `rot` (wall sections). */
export const SPRITE_FOOTPRINTS = ["circle", "rect"] as const;
export type SpriteFootprint = (typeof SPRITE_FOOTPRINTS)[number];
export const spriteFootprintValidator = literals(SPRITE_FOOTPRINTS);

/** A sprite's size in pixels as stored (after trimming and resizing). */
export const spritePxValidator = v.object({ w: v.number(), h: v.number() });

// ---------------------------------------------------------------- tables

/** One GM sprite pack (`spritePacks`). */
export const spritePackFields = {
  campaignId: v.id("campaigns"),
  name: v.string(),
  /**
   * Q3: absent = the pack is a setting of its own in the Setting picker (with `common` added); a built-in setting
   * id = its sprites are added to that setting.
   */
  extends: v.optional(v.string()),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/** One uploaded sprite (`spritePackSprites`); its image is a `files` row of kind "sprite" with refId = this row's id. */
export const spritePackSpriteFields = {
  campaignId: v.id("campaigns"),
  packId: v.id("spritePacks"),
  /** The claimed `files` row (kind "sprite"; CF16, CF17). */
  fileId: v.id("files"),
  name: v.string(),
  /** URL-safe slug of `name`, unique within the pack (for layout prompts and keys). */
  slug: v.string(),
  category: spriteCategoryValidator,
  /** Size in squares per side, MIN_SPRITE_SQUARES..MAX_SPRITE_SQUARES (D4). */
  w: v.number(),
  h: v.number(),
  /** Default sight (D3); a placed object's own `sight` overrides it. */
  sight: sightModeValidator,
  light: spriteLightValidator,
  height: spriteHeightValidator,
  footprint: spriteFootprintValidator,
  /** Classic fallback (D1, D2): the kind drawn in the Classic style or when the image cannot load. */
  classicKind: combatObjectKindValidator,
  classicVariant: v.optional(v.string()),
  /** Textures: the Classic terrain class it paints (vision and the Classic painter use it). */
  terrain: v.optional(combatTerrainValidator),
  /** Textures: may be rotated / flipped per tile when tiling (D6; not planks, tiles or paths). */
  rotatable: v.optional(v.boolean()),
  px: spritePxValidator,
  /** Position in the pack's list (by_pack_order). */
  order: v.number(),
  createdAt: v.number(),
};

export const spritePackSpriteValidator = v.object(spritePackSpriteFields);
export type SpritePackSpriteFields = Infer<typeof spritePackSpriteValidator>;
