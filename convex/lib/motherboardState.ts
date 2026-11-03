/**
 * A character's Motherboard module (CB 301) as the reads outside `../characterExtras` need it: the HUD's Defense and the
 * rolls' augments. Split out of `../characterExtras` (dcm-uh6r) so those queries do not build every frame extra's schema;
 * `../characterExtras` re-exports both readers and reads rows with the same `EXTRA_SCHEMA_VERSION`.
 */
import { extraKey, FRAME_OF } from "../../src/lib/frames/extras/common";
import { motherboardStateSchema, type MotherboardState } from "../../src/lib/frames/extras/motherboard";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readVersioned } from "./blobs";
import { readTracker } from "./trackers";

/** The version every `characterExtras` row is written with (CD3); bumping it needs an upgrade step in `readRow`. */
export const EXTRA_SCHEMA_VERSION = 1;

/**
 * A character's Motherboard module (Ikonis, augments, scrap): its row, else
 * its old `frameTrackers` row (until the migration has run), else null; null
 * outside Motherboard.
 */
export async function motherboardState(ctx: QueryCtx, campaign: Doc<"campaigns">, characterId: Id<"characters">): Promise<MotherboardState | null> {
  if (campaign.frameId !== FRAME_OF.motherboard) return null;
  const row = await ctx.db
    .query("characterExtras")
    .withIndex("by_character_extra", (q) => q.eq("characterId", characterId).eq("extra", "motherboard"))
    .unique();
  if (row !== null) {
    const versioned = { ...row.data, schemaVersion: row.schemaVersion };
    return readVersioned({ [EXTRA_SCHEMA_VERSION]: { schema: motherboardStateSchema } }, versioned, "TRACKER_CORRUPT") as MotherboardState;
  }
  return readTracker(ctx, campaign._id, extraKey(characterId, "motherboard"), motherboardStateSchema);
}

/**
 * The Ikonis augments a character has installed (Motherboard only, CB 301);
 * `[]` in other frames. `derivedDefense` adds Guard, Deny and Block.
 */
export async function installedAugments(ctx: QueryCtx, campaign: Doc<"campaigns">, characterId: Id<"characters">): Promise<string[]> {
  return (await motherboardState(ctx, campaign, characterId))?.installed ?? [];
}
