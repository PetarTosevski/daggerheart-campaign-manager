import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { hexToPixel, pixelToHex, remapHex } from "../../src/lib/world/hex";
import { LEGACY_DEFAULT_GRID, PRINTED_HEX_GRIDS } from "../../src/lib/world/printed-grids";
import { errorCode, key, useAllowlist } from "./helpers";
import { makeTest } from "./setup";

const GM = "gm@example.com";
const PRINTED = PRINTED_HEX_GRIDS["journey-to-horizon"]!;
const IMAGE = { width: 3400, height: 2228 };
const MIGRATION = "migrations/worldHex:printedGrid";

describe("World map hex grid (dcm-kggd)", () => {
  useAllowlist(GM);

  async function setup(frameId: "journey-to-horizon" | "witherwild" = "journey-to-horizon") {
    const t = makeTest();
    const gmId = await t.run((ctx) => ctx.db.insert("users", { email: GM, emailVerificationTime: 1 }));
    const gm = t.withIdentity({ subject: `${gmId}|s` });
    const { campaignId } = await gm.mutation(api.campaigns.create, { frameId, name: "Hex test", idempotencyKey: key() });
    return { t, gm, campaignId };
  }
  type T = Awaited<ReturnType<typeof setup>>["t"];

  /** Pretends the GM uploaded a map (the file itself plays no part here). */
  async function withUpload(t: T, campaignId: Id<"campaigns">) {
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("maps")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .unique();
      await ctx.db.patch("maps", row!._id, { data: { ...(row!.data as object), customMap: { storageId: "upload", width: 2000, height: 1500 } } });
    });
  }

  const gridOf = async (gm: Awaited<ReturnType<typeof setup>>["gm"], campaignId: Id<"campaigns">) => (await gm.query(api.maps.get, { campaignId })).state.hexCrawl!.grid;

  it("a new crawl is on the printed grid, and the party marker sits on its printed hex's centre", async () => {
    const { gm, campaignId } = await setup();
    await gm.mutation(api.maps.placePartyHex, { campaignId, q: 40, r: 5 });
    const view = await gm.query(api.maps.get, { campaignId });
    expect(view.state.hexCrawl!.grid).toEqual(PRINTED);
    const c = hexToPixel({ q: 40, r: 5 }, PRINTED);
    expect(view.state.party.x).toBeCloseTo((c.x / IMAGE.width) * 100, 2);
    expect(view.state.party.y).toBeCloseTo((c.y / IMAGE.height) * 100, 2);
  });

  it("over the frame's own art the grid stays printed; over an upload the GM calibrates one field at a time", async () => {
    const { t, gm, campaignId } = await setup();
    await gm.mutation(api.maps.placePartyHex, { campaignId, q: 1, r: 1 });
    const refused = await gm.mutation(api.maps.calibrateHexGrid, { campaignId, change: { field: "size", value: 30 } }).catch((e: unknown) => e);
    expect(errorCode(refused)).toBe("INVALID");

    await withUpload(t, campaignId);
    await gm.mutation(api.maps.calibrateHexGrid, { campaignId, change: { field: "originX", value: 12 } });
    expect(await gridOf(gm, campaignId)).toEqual({ ...PRINTED, originX: 12 });
    // A new size makes the hexes regular again.
    await gm.mutation(api.maps.calibrateHexGrid, { campaignId, change: { field: "size", value: 30 } });
    expect(await gridOf(gm, campaignId)).toEqual({ originX: 12, originY: PRINTED.originY, size: 30, orientation: "flat" });
    await gm.mutation(api.maps.calibrateHexGrid, { campaignId, change: { field: "orientation", value: "pointy" } });
    expect((await gridOf(gm, campaignId)).orientation).toBe("pointy");
    const tooSmall = await gm.mutation(api.maps.calibrateHexGrid, { campaignId, change: { field: "size", value: 2 } }).catch((e: unknown) => e);
    expect(errorCode(tooSmall)).toBe("INVALID");

    // Back to the frame's art: the printed grid returns, and the party marker moves onto it.
    await gm.mutation(api.maps.removeMapImage, { campaignId });
    const view = await gm.query(api.maps.get, { campaignId });
    expect(view.state.hexCrawl!.grid).toEqual(PRINTED);
    expect(view.state.party.x).toBeCloseTo((hexToPixel({ q: 1, r: 1 }, PRINTED).x / IMAGE.width) * 100, 2);
  });

  it("the printed reset works from a hand calibration; other frames have no crawl", async () => {
    const { gm, campaignId } = await setup();
    await gm.mutation(api.maps.setHexGrid, { campaignId, grid: LEGACY_DEFAULT_GRID });
    await gm.mutation(api.maps.calibrateHexGrid, { campaignId, change: { field: "printed" } });
    expect(await gridOf(gm, campaignId)).toEqual(PRINTED);

    const other = await setup("witherwild");
    const e = await other.gm.mutation(api.maps.calibrateHexGrid, { campaignId: other.campaignId, change: { field: "printed" } }).catch((x: unknown) => x);
    expect(errorCode(e)).toBe("MECHANIC_DISABLED");
  });

  describe(MIGRATION, () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function migrate(t: T, opts: { reset?: boolean; dryRun?: boolean } = {}) {
      const run = t.mutation(internal.migrations.run.run, { fn: MIGRATION, batchSize: 1, ...opts });
      if (opts.dryRun) return run.catch(() => undefined);
      await run;
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    }

    it("moves a crawl on the old default grid onto the printed grid, keeping each hex's spot on the map", async () => {
      const { t, gm, campaignId } = await setup();
      const old = LEGACY_DEFAULT_GRID;
      await gm.mutation(api.maps.setHexGrid, { campaignId, grid: old });
      await gm.mutation(api.maps.placePartyHex, { campaignId, q: 20, r: 2 });
      await gm.mutation(api.maps.updateHex, { campaignId, q: 21, r: 2, patch: { terrain: 3, region: "Ashen Vale", poi: { text: "Shrine", hidden: true } } });
      const c = hexToPixel({ q: 21, r: 2 }, old);
      const token = await gm.mutation(api.maps.addToken, { campaignId, type: "temple", x: (c.x / IMAGE.width) * 100, y: (c.y / IMAGE.height) * 100, idempotencyKey: key() });
      const before = await gm.query(api.maps.get, { campaignId });

      // A dry run changes nothing.
      await migrate(t, { dryRun: true });
      expect(await gm.query(api.maps.get, { campaignId })).toEqual(before);

      await migrate(t);
      const after = await gm.query(api.maps.get, { campaignId });
      const crawl = after.state.hexCrawl!;
      expect(crawl.grid).toEqual(PRINTED);
      const party = remapHex({ q: 20, r: 2 }, old, PRINTED);
      const region = remapHex({ q: 21, r: 2 }, old, PRINTED);
      expect(crawl.party).toEqual(party);
      expect(crawl.hexes).toHaveLength(2);
      expect(crawl.hexes.find((h) => h.q === party.q && h.r === party.r)).toMatchObject({ explored: true });
      expect(crawl.hexes.find((h) => h.q === region.q && h.r === region.r)).toMatchObject({ terrain: 3, region: "Ashen Vale", poi: { text: "Shrine", hidden: true } });
      // The marker moved to the centre of the printed hex holding its old spot.
      const moved = after.state.tokens.find((x) => x.id === token.id)!;
      expect(pixelToHex((moved.x / 100) * IMAGE.width, (moved.y / 100) * IMAGE.height, PRINTED)).toEqual(region);
      const centre = hexToPixel(region, PRINTED);
      expect(moved.x).toBeCloseTo((centre.x / IMAGE.width) * 100, 1);
      expect(after.state.party.x).toBeCloseTo((hexToPixel(party, PRINTED).x / IMAGE.width) * 100, 1);

      // Idempotent: a reset run leaves it as it is.
      await migrate(t, { reset: true });
      expect(await gm.query(api.maps.get, { campaignId })).toEqual(after);
    });

    it("leaves a crawl over an uploaded map alone", async () => {
      const { t, gm, campaignId } = await setup();
      await gm.mutation(api.maps.setHexGrid, { campaignId, grid: LEGACY_DEFAULT_GRID });
      await gm.mutation(api.maps.placePartyHex, { campaignId, q: 3, r: 3 });
      await withUpload(t, campaignId);
      const before = await gm.query(api.maps.get, { campaignId });
      await migrate(t);
      expect(await gm.query(api.maps.get, { campaignId })).toEqual(before);
    });
  });
});
