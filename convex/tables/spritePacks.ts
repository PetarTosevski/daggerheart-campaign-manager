import { defineTable } from "convex/server";

import { spritePackFields, spritePackSpriteFields } from "../lib/validators/spritePacks";

/**
 * GM sprite packs (plan `.omc/plans/sprite-packs.yaml`, P0 creates the tables; P8 adds the functions). Built-in
 * packs are static files plus a committed manifest (src/lib/sprite-packs/builtin), not rows. Caps (MAX_SPRITE_PACKS,
 * MAX_PACK_SPRITES in convex/lib/validators/spritePacks.ts) are checked with an index `.take`. Both tables are
 * campaign-scoped and go with the campaign's purge (convex/cleanup.ts); their images are `files` rows of kind
 * "sprite", purged with the campaign's files.
 */
export const spritePackTables = {
  /** One row per GM pack, at most MAX_SPRITE_PACKS per campaign; `by_campaign_updated` lists them newest last. */
  spritePacks: defineTable(spritePackFields).index("by_campaign_updated", ["campaignId", "updatedAt"]),

  /**
   * One row per uploaded sprite (own table, CD8: a pack grows to MAX_PACK_SPRITES rows). `by_pack_order` lists a
   * pack in order; `by_campaign` reaches every sprite of a campaign (purge, sprite sources).
   */
  spritePackSprites: defineTable(spritePackSpriteFields)
    .index("by_pack_order", ["packId", "order"])
    .index("by_campaign", ["campaignId"]),
};
