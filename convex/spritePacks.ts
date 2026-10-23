import { v, type Infer } from "convex/values";

import { classicAfterLight, classicFits, cleanName, slugOf, uniqueSlug } from "../src/components/combat-map/packs/labels";
import { isSettingId, SETTING_LABEL } from "../src/lib/sprite-packs/index";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { claimFile, deleteFilesOf, isAllowedImage, isClaimed } from "./lib/files";
import { gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import { gmSpriteOf, gmSpriteValidator } from "./lib/spriteSources";
import { combatObjectKindValidator, combatTerrainValidator, sightModeValidator } from "./lib/validators/combatMaps";
import {
  MAX_PACK_NAME,
  MAX_PACK_SPRITES,
  MAX_SPRITE_BYTES,
  MAX_SPRITE_NAME,
  MAX_SPRITE_PACKS,
  MAX_SPRITE_PX,
  MAX_SPRITE_SQUARES,
  MIN_SPRITE_SQUARES,
  spriteCategoryValidator,
  spriteFootprintValidator,
  spriteHeightValidator,
  spriteLightValidator,
  spritePxValidator,
} from "./lib/validators/spritePacks";

/**
 * The GM's own sprite packs (plan `.omc/plans/sprite-packs.yaml`, tracer P8): packs, uploaded sprites and their
 * labels. Every function is the GM's (`gmQuery` / `gmMutation` / `keyedGmMutation`: player FORBIDDEN, outsider
 * NOT_FOUND, anonymous UNAUTHENTICATED; D10). Sheets are cut in the browser (D9); only the cut sprites are uploaded,
 * one `files` row (kind "sprite", refId = the sprite) per `spritePackSprites` row (CF16, CF17).
 *
 * - `createPack` (keyed), `renamePack`, `setPackExtends`, `deletePack`: a pack is a setting of its own or adds to a
 *   built-in setting (Q3). Deleting a pack deletes its sprites and their files; map objects that used them stay
 *   and fall back to their Classic kind (D9).
 * - `spriteUploadUrl` (rate limit `spriteUpload`) and `attachSprite`: the upload is checked after the fact (size,
 *   png / jpeg / webp / gif, pixel size); a rejected file is deleted and `{ok: false, code}` returned (E7).
 * - `updateSprite` (one label field per call), `removeSprite`, `reorderSprite` (one step up or down).
 * - `packs`: the campaign's packs with their sprites, labels and image links.
 */

const now = () => Date.now();

// ---------------------------------------------------------------- validators

const packRowValidator = v.object({
  _id: v.id("spritePacks"),
  name: v.string(),
  /** The built-in setting it adds to; null = a setting of its own (Q3). */
  extends: v.union(v.object({ id: v.string(), label: v.string() }), v.null()),
  createdAt: v.number(),
  sprites: v.array(
    v.object({
      ...gmSpriteValidator.fields,
      slug: v.string(),
      order: v.number(),
    }),
  ),
});
export type PackRow = Infer<typeof packRowValidator>;
export type PackSpriteRow = PackRow["sprites"][number];

/** An upload's outcome; a rejected file is already deleted (CF16: returned, not thrown, so the delete sticks). */
const attachResultValidator = v.union(
  v.object({ ok: v.literal(true), spriteId: v.id("spritePackSprites") }),
  v.object({ ok: v.literal(false), code: v.union(v.literal("INVALID"), v.literal("SPRITE_LIMIT")), message: v.string() }),
);

/** The labels `attachSprite` stores with a new sprite. */
const labelArgs = {
  name: v.string(),
  category: spriteCategoryValidator,
  w: v.number(),
  h: v.number(),
  sight: sightModeValidator,
  light: spriteLightValidator,
  height: spriteHeightValidator,
  footprint: spriteFootprintValidator,
  classicKind: combatObjectKindValidator,
  /** Textures: the Classic terrain class (required for textures, ignored for objects). */
  terrain: v.optional(combatTerrainValidator),
  /** Textures: may be rotated / flipped per tile (D6). */
  rotatable: v.optional(v.boolean()),
  /** The encoded image's pixel size (at most MAX_SPRITE_PX per side). */
  px: spritePxValidator,
};

/** Exactly one label field (CL3: an intent, never the whole row). */
const spritePatchValidator = v.union(
  v.object({ name: v.string() }),
  v.object({ category: spriteCategoryValidator }),
  v.object({ w: v.number() }),
  v.object({ h: v.number() }),
  v.object({ sight: sightModeValidator }),
  v.object({ light: spriteLightValidator }),
  v.object({ height: spriteHeightValidator }),
  v.object({ footprint: spriteFootprintValidator }),
  v.object({ classicKind: combatObjectKindValidator }),
  v.object({ terrain: combatTerrainValidator }),
  v.object({ rotatable: v.boolean() }),
);
export type SpritePatch = Infer<typeof spritePatchValidator>;

// ---------------------------------------------------------------- helpers

const validSquares = (n: number) => Number.isInteger(n) && n >= MIN_SPRITE_SQUARES && n <= MAX_SPRITE_SQUARES;
const validPx = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SPRITE_PX;

function packName(name: string): string {
  const clean = cleanName(name, MAX_PACK_NAME);
  if (clean === null) throw appError("INVALID", `Pack names are 1 to ${MAX_PACK_NAME} characters.`);
  return clean;
}

function spriteName(name: string): string {
  const clean = cleanName(name, MAX_SPRITE_NAME);
  if (clean === null) throw appError("INVALID", `Sprite names are 1 to ${MAX_SPRITE_NAME} characters.`);
  return clean;
}

/** A built-in setting id a pack may add to (not `common`), or SPRITE_SETTING_UNKNOWN. */
function extendsId(id: string): string {
  if (!isSettingId(id)) throw appError("SPRITE_SETTING_UNKNOWN");
  return id;
}

/** The campaign's packs (at most MAX_SPRITE_PACKS; one more is read to tell a full campaign). */
function packsOf(ctx: QueryCtx, campaignId: Id<"campaigns">, limit = MAX_SPRITE_PACKS): Promise<Doc<"spritePacks">[]> {
  return ctx.db
    .query("spritePacks")
    .withIndex("by_campaign_updated", (q) => q.eq("campaignId", campaignId))
    .take(limit);
}

/** A pack's sprites in order (at most MAX_PACK_SPRITES). */
function spritesOf(ctx: QueryCtx, packId: Id<"spritePacks">): Promise<Doc<"spritePackSprites">[]> {
  return ctx.db
    .query("spritePackSprites")
    .withIndex("by_pack_order", (q) => q.eq("packId", packId))
    .take(MAX_PACK_SPRITES);
}

/** This campaign's pack, or SPRITE_PACK_NOT_FOUND (bad id, deleted, another campaign's). */
async function loadPack(ctx: QueryCtx & { campaign: Doc<"campaigns"> }, packId: string): Promise<Doc<"spritePacks">> {
  const id = ctx.db.normalizeId("spritePacks", packId);
  const pack = id === null ? null : await ctx.db.get("spritePacks", id);
  if (pack === null || pack.campaignId !== ctx.campaign._id) throw appError("SPRITE_PACK_NOT_FOUND");
  return pack;
}

/** This campaign's uploaded sprite, or SPRITE_NOT_FOUND. */
async function loadSprite(ctx: QueryCtx & { campaign: Doc<"campaigns"> }, spriteId: string): Promise<Doc<"spritePackSprites">> {
  const id = ctx.db.normalizeId("spritePackSprites", spriteId);
  const sprite = id === null ? null : await ctx.db.get("spritePackSprites", id);
  if (sprite === null || sprite.campaignId !== ctx.campaign._id) throw appError("SPRITE_NOT_FOUND");
  return sprite;
}

/** Deletes a sprite row and its image (its `files` rows of kind "sprite" and their blobs). */
async function deleteSprite(ctx: MutationCtx, sprite: Doc<"spritePackSprites">): Promise<void> {
  await deleteFilesOf(ctx, "sprite", sprite._id);
  await ctx.db.delete("spritePackSprites", sprite._id);
}

const touchPack = (ctx: MutationCtx, packId: Id<"spritePacks">) => ctx.db.patch("spritePacks", packId, { updatedAt: now() });

const extendsOption = (pack: Doc<"spritePacks">) =>
  pack.extends !== undefined && isSettingId(pack.extends) ? { id: pack.extends, label: SETTING_LABEL[pack.extends] } : null;

// ---------------------------------------------------------------- packs

/** GM: the campaign's packs (oldest first) with every sprite, its labels and image link. */
export const packs = gmQuery({
  args: {},
  returns: v.array(packRowValidator),
  handler: async (ctx) => {
    const rows = await packsOf(ctx, ctx.campaign._id);
    rows.sort((a, b) => a.createdAt - b.createdAt);
    const out: PackRow[] = [];
    for (const pack of rows) {
      const sprites: PackSpriteRow[] = [];
      for (const sprite of await spritesOf(ctx, pack._id)) {
        sprites.push({ ...(await gmSpriteOf(ctx, sprite)), slug: sprite.slug, order: sprite.order });
      }
      out.push({ _id: pack._id, name: pack.name, extends: extendsOption(pack), createdAt: pack.createdAt, sprites });
    }
    return out;
  },
});

/** GM: a new pack, a setting of its own or (with `extends`) added to a built-in setting (Q3). At most MAX_SPRITE_PACKS. */
export const createPack = keyedGmMutation({
  args: { name: v.string(), extends: v.optional(v.string()) },
  returns: v.object({ packId: v.id("spritePacks") }),
  handler: async (ctx, args) =>
    ctx.once("sprite_pack_create", { name: args.name, extends: args.extends ?? null }, async () => {
      const name = packName(args.name);
      const adds = args.extends === undefined ? {} : { extends: extendsId(args.extends) };
      const existing = await packsOf(ctx, ctx.campaign._id, MAX_SPRITE_PACKS + 1);
      if (existing.length >= MAX_SPRITE_PACKS) throw appError("SPRITE_PACK_LIMIT");
      const at = now();
      const packId = await ctx.db.insert("spritePacks", {
        campaignId: ctx.campaign._id,
        name,
        ...adds,
        createdBy: ctx.user._id,
        createdAt: at,
        updatedAt: at,
      });
      return { packId };
    }),
});

/** GM: renames a pack. */
export const renamePack = gmMutation({
  args: { packId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { packId, name }) => {
    const pack = await loadPack(ctx, packId);
    await ctx.db.patch("spritePacks", pack._id, { name: packName(name), updatedAt: now() });
    return null;
  },
});

/** GM: makes a pack a setting of its own (null) or adds it to a built-in setting (Q3). */
export const setPackExtends = gmMutation({
  args: { packId: v.string(), extends: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pack = await loadPack(ctx, args.packId);
    await ctx.db.patch("spritePacks", pack._id, { extends: args.extends === null ? undefined : extendsId(args.extends), updatedAt: now() });
    return null;
  },
});

/** GM: deletes a pack with its sprites and their files. Maps keep their objects, which fall back to Classic (D9). */
export const deletePack = gmMutation({
  args: { packId: v.string() },
  returns: v.null(),
  handler: async (ctx, { packId }) => {
    const pack = await loadPack(ctx, packId);
    for (const sprite of await spritesOf(ctx, pack._id)) await deleteSprite(ctx, sprite);
    await ctx.db.delete("spritePacks", pack._id);
    return null;
  },
});

// ---------------------------------------------------------------- uploads

/** GM: a one-time upload URL for one cut sprite (CF15, CF16: access-checked and rate-limited). */
export const spriteUploadUrl = gmMutation({
  rateLimit: "spriteUpload",
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

/**
 * GM: adds a just-uploaded sprite to a pack with its labels. The file must be unclaimed (else NOT_FOUND, thrown,
 * and the file is kept; a storage id is no proof of access, CF17). Then the labels must be valid (name, sizes,
 * texture terrain, D2 Classic look), the file a PNG, JPEG, WebP or GIF of at most MAX_SPRITE_BYTES, with a pixel
 * size of at most MAX_SPRITE_PX, and the pack must have room (MAX_PACK_SPRITES); otherwise the file is deleted and
 * `{ok: false, code}` is returned (E7, G12). The file is claimed as kind "sprite" with refId = the new sprite.
 */
export const attachSprite = gmMutation({
  args: { packId: v.string(), storageId: v.id("_storage"), ...labelArgs },
  returns: attachResultValidator,
  handler: async (ctx, { packId, storageId, ...labels }): Promise<Infer<typeof attachResultValidator>> => {
    const pack = await loadPack(ctx, packId);
    const meta = await ctx.db.system.get(storageId);
    // Only an unclaimed file may be attached, so the rejections below only ever delete unclaimed files.
    if (meta === null || (await isClaimed(ctx, storageId))) throw appError("NOT_FOUND");
    const name = cleanName(labels.name, MAX_SPRITE_NAME);
    const labelError =
      name === null
        ? `Sprite names are 1 to ${MAX_SPRITE_NAME} characters.`
        : !validSquares(labels.w) || !validSquares(labels.h)
          ? "Sprite sizes are 1 to 4 squares per side."
          : labels.category === "texture" && labels.terrain === undefined
            ? "A texture needs a terrain class."
            : !classicFits(labels.classicKind, labels.light)
              ? "The Classic look must give the same light as the sprite."
              : null;
    if (labelError !== null || name === null) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "INVALID", message: labelError ?? "" };
    }
    if (!isAllowedImage(meta, MAX_SPRITE_BYTES)) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "INVALID", message: "Sprites must be PNG, JPEG, WebP or GIF files of at most 1 MB." };
    }
    if (!validPx(labels.px.w) || !validPx(labels.px.h)) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "INVALID", message: `Sprites are at most ${MAX_SPRITE_PX} pixels per side.` };
    }
    const siblings = await spritesOf(ctx, pack._id);
    if (siblings.length >= MAX_PACK_SPRITES) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "SPRITE_LIMIT", message: `A pack holds at most ${MAX_PACK_SPRITES} sprites.` };
    }
    const fileId = await claimFile(ctx, { storageId, campaignId: ctx.campaign._id, uploadedBy: ctx.user._id, kind: "sprite", refId: "pending" });
    const texture = labels.category === "texture";
    const spriteId = await ctx.db.insert("spritePackSprites", {
      campaignId: ctx.campaign._id,
      packId: pack._id,
      fileId,
      name,
      slug: uniqueSlug(slugOf(name), new Set(siblings.map((s) => s.slug))),
      category: labels.category,
      w: labels.w,
      h: labels.h,
      sight: labels.sight,
      light: labels.light,
      height: labels.height,
      footprint: labels.footprint,
      classicKind: labels.classicKind,
      ...(texture && labels.terrain !== undefined ? { terrain: labels.terrain } : {}),
      ...(texture ? { rotatable: labels.rotatable ?? true } : {}),
      px: labels.px,
      order: siblings.reduce((max, s) => Math.max(max, s.order + 1), 0),
      createdAt: now(),
    });
    await ctx.db.patch("files", fileId, { refId: spriteId });
    await touchPack(ctx, pack._id);
    return { ok: true, spriteId };
  },
});

// ---------------------------------------------------------------- sprites

/**
 * GM: changes one label of an uploaded sprite (CL3). Sizes are 1..4 squares; a texture keeps a terrain class
 * (grass when it had none); a new light also moves the Classic look to one that lights the same way (D2), and a
 * Classic look that would light differently is refused (INVALID).
 */
export const updateSprite = gmMutation({
  args: { spriteId: v.string(), patch: spritePatchValidator },
  returns: v.null(),
  handler: async (ctx, { spriteId, patch }) => {
    const sprite = await loadSprite(ctx, spriteId);
    let change: Partial<Doc<"spritePackSprites">>;
    if ("name" in patch) {
      const name = spriteName(patch.name);
      const siblings = await spritesOf(ctx, sprite.packId);
      const taken = new Set(siblings.filter((s) => s._id !== sprite._id).map((s) => s.slug));
      change = { name, slug: uniqueSlug(slugOf(name), taken) };
    } else if ("w" in patch || "h" in patch) {
      const n = "w" in patch ? patch.w : patch.h;
      if (!validSquares(n)) throw appError("INVALID", "Sprite sizes are 1 to 4 squares per side.");
      change = patch;
    } else if ("category" in patch) {
      change = patch.category === "texture" ? { category: "texture", terrain: sprite.terrain ?? "grass", rotatable: sprite.rotatable ?? true } : patch;
    } else if ("light" in patch) {
      change = { light: patch.light, classicKind: classicAfterLight(sprite.classicKind, { ...sprite, light: patch.light }) };
    } else if ("classicKind" in patch) {
      if (!classicFits(patch.classicKind, sprite.light)) throw appError("INVALID", "The Classic look must give the same light as the sprite.");
      change = patch;
    } else {
      change = patch;
    }
    await ctx.db.patch("spritePackSprites", sprite._id, change);
    return null;
  },
});

/** GM: deletes an uploaded sprite and its file. Objects that used it fall back to their Classic kind (D9). */
export const removeSprite = gmMutation({
  args: { spriteId: v.string() },
  returns: v.null(),
  handler: async (ctx, { spriteId }) => {
    const sprite = await loadSprite(ctx, spriteId);
    await deleteSprite(ctx, sprite);
    await touchPack(ctx, sprite.packId);
    return null;
  },
});

/** GM: moves a sprite one place up or down in its pack (swaps `order` with its neighbour; no-op at either end). */
export const reorderSprite = gmMutation({
  args: { spriteId: v.string(), direction: v.union(v.literal("up"), v.literal("down")) },
  returns: v.null(),
  handler: async (ctx, { spriteId, direction }) => {
    const sprite = await loadSprite(ctx, spriteId);
    const siblings = await spritesOf(ctx, sprite.packId);
    const at = siblings.findIndex((s) => s._id === sprite._id);
    const other = siblings[direction === "up" ? at - 1 : at + 1];
    if (at < 0 || other === undefined) return null;
    // Equal orders (never written by attachSprite) still move apart.
    const [a, b] = other.order === sprite.order ? [other.order + (direction === "up" ? -1 : 1), sprite.order] : [other.order, sprite.order];
    await ctx.db.patch("spritePackSprites", sprite._id, { order: a });
    await ctx.db.patch("spritePackSprites", other._id, { order: b });
    return null;
  },
});
