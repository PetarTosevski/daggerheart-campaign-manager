import { hasTether, NETWORK_TETHER } from "../../src/lib/domain/motherboard/index";
import { extraKey, FRAME_OF } from "../../src/lib/frames/extras/common";
import { INITIAL_MOTHERBOARD } from "../../src/lib/frames/extras/motherboard";
import { seedMotherboard } from "../characterExtras";
import { readSheet, saveSheet } from "../lib/characterSheet";
import { migrations } from "../lib/migrations";

/**
 * RF4, Motherboard economy (CB 301-302) for characters made before it:
 * - "Each PC adds a Network tether to their inventory at character creation":
 *   adds one unless the inventory already holds a Network tether.
 * - "All PCs start with 5 quantum": a character with no Ikonis module row
 *   (and no legacy `frameTrackers` row) gets one with the starting 5 quantum.
 *   A character whose module already exists keeps its quantum, which started
 *   at 5 (`INITIAL_MOTHERBOARD`).
 * Gold already on the sheet is left as it is (hidden in Motherboard).
 * Characters in other frames are untouched. Idempotent, so `reset: true` is safe.
 *   npx convex run migrations/run:run '{fn: "migrations/motherboardEconomy:addTetherAndQuantum", dryRun: true}'
 */
export const addTetherAndQuantum = migrations.define({
  table: "characters",
  migrateOne: async (ctx, character) => {
    const campaign = await ctx.db.get("campaigns", character.campaignId);
    if (campaign === null || campaign.frameId !== FRAME_OF.motherboard) return;
    const sheet = readSheet(character.sheet);
    if (!hasTether(sheet.inventory)) {
      await saveSheet(ctx, character._id, { ...sheet, inventory: [...sheet.inventory, { id: crypto.randomUUID(), name: NETWORK_TETHER }] });
    }
    const row = await ctx.db
      .query("characterExtras")
      .withIndex("by_character_extra", (q) => q.eq("characterId", character._id).eq("extra", "motherboard"))
      .unique();
    if (row !== null) return;
    const legacy = await ctx.db
      .query("frameTrackers")
      .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaign._id).eq("key", extraKey(character._id, "motherboard")))
      .unique();
    if (legacy !== null) return;
    await seedMotherboard(ctx, campaign._id, character._id, INITIAL_MOTHERBOARD);
  },
});
