import { sameGrid } from "../../src/lib/world/hex";
import { HORIZON_FRAME, mapImageSize, mapScalarsSchema, type MapScalars } from "../../src/lib/world/map-state";
import { printedHexGrid } from "../../src/lib/world/printed-grids";
import { remapCrawlScalars, remapHexes, remapToken } from "../../src/lib/world/recalibrate";
import { splitMapRow, storedMap, toHex, toToken, valid, writeHex } from "../lib/maps";
import { migrations } from "../lib/migrations";

/**
 * dcm-kggd: puts every Journey to Horizon hex crawl drawn over the frame's own
 * art onto the grid printed on that art (`PRINTED_HEX_GRIDS`). Crawls started
 * before it were on a default grid larger than the printed hexes and off
 * their lines (or on the GM's hand calibration). Each stored hex, the party's
 * hex and the last move keep the spot on the map their old hex centre marked,
 * renamed to the printed hex holding that spot; markers and the party marker
 * move to that printed hex's centre. Old hexes are at least as large as the
 * printed ones in every crawl seen so far, so no two land on one printed hex;
 * if they do (a hand calibration with smaller hexes), they merge (the first
 * keeps its fields, explored if either was). A crawl over an uploaded map
 * keeps the GM's calibration. Idempotent: a crawl already on the printed grid
 * is skipped, so `reset: true` is safe. One map per batch (up to ~4,500
 * rows). A version 1 map is split into rows first. Run once per deployment
 * (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/worldHex:printedGrid", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/worldHex:printedGrid"}'
 */
export const printedGrid = migrations.define({
  table: "maps",
  batchSize: 1,
  migrateOne: async (ctx, original) => {
    const campaign = await ctx.db.get("campaigns", original.campaignId);
    if (!campaign || campaign.frameId !== HORIZON_FRAME) return;
    const printed = printedHexGrid(campaign.frameId);
    if (!printed) return;
    // Cheap check before any split: nothing to do without a crawl off the printed grid over the frame's art.
    const raw = original.data as { hexCrawl?: { grid?: unknown }; customMap?: unknown } | null;
    if (!raw?.hexCrawl || raw.customMap) return;
    let row = original;
    if (storedMap(row.data).version === 1) {
      await splitMapRow(ctx, row);
      const split = await ctx.db.get("maps", row._id);
      if (!split) return;
      row = split;
    }
    const stored = storedMap(row.data);
    if (stored.version !== 2) return;
    const scalars: MapScalars = stored.scalars;
    const crawl = scalars.hexCrawl;
    if (!crawl || scalars.customMap || sameGrid(crawl.grid, printed)) return;
    const image = mapImageSize(campaign.frameId, scalars);
    const from = crawl.grid;

    // At most MAX_HEXES rows per campaign.
    const hexRows = await ctx.db
      .query("mapHexes")
      .withIndex("by_campaign_q_r", (q) => q.eq("campaignId", campaign._id))
      .collect();
    const hexes = remapHexes(hexRows.map(toHex), from, printed);
    for (const h of hexRows) await ctx.db.delete("mapHexes", h._id);
    for (const h of hexes) await writeHex(ctx, campaign._id, null, h);

    // At most MAX_TOKENS rows per campaign.
    const tokenRows = await ctx.db
      .query("mapTokens")
      .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaign._id))
      .collect();
    for (const t of tokenRows) {
      const moved = remapToken(toToken(t), printed, image);
      if (moved.x !== t.x || moved.y !== t.y) await ctx.db.patch("mapTokens", t._id, { x: moved.x, y: moved.y });
    }

    const next = remapCrawlScalars(crawl, scalars.party, printed, image);
    const data = valid(mapScalarsSchema, {
      ...scalars,
      party: { ...scalars.party, ...next.party },
      hexCrawl: { ...next.crawl, hexCount: hexes.length },
    });
    await ctx.db.patch("maps", row._id, { data, updatedAt: Date.now() });
  },
});
