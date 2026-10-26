import { describe, expect, it } from "vitest";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { runMatrix } from "./harness";
import area from "./world.entries";
import { allowWorldEmails, buildWorld } from "./world";

runMatrix(area);

/**
 * The players' view of hidden world data, for the reads whose filtered result an outcome cannot state (an object with
 * a filtered list inside): a player never receives a secret codex entry or a hidden map marker.
 */
describe("authz matrix: world, players' view of hidden data", () => {
  allowWorldEmails();

  it("codex: a player gets only known entries, without GM notes; the GM gets every entry", async () => {
    const w = await buildWorld();
    const gm = w.as("gm");
    const player = w.as("player");
    const all = await gm.query(api.codex.list, { campaignId: w.campaignId });
    expect(all.role).toBe("gm");
    expect(all.entries.length).toBeGreaterThan(1);

    // Every seeded entry starts secret.
    const hidden = await player.query(api.codex.list, { campaignId: w.campaignId });
    expect(hidden).toEqual({ role: "player", entries: [] });

    const [shown, secret] = all.entries.map((e) => e._id as Id<"codexEntries">);
    await gm.mutation(api.codex.update, { entryId: shown, patch: { known: true, pdesc: "Known", gmn: "GM only" } });
    await gm.mutation(api.codex.update, { entryId: secret, patch: { pdesc: "Secret", gmn: "GM only" } });

    const known = await player.query(api.codex.list, { campaignId: w.campaignId });
    expect(known.entries.map((e) => e._id)).toEqual([shown]);
    expect(await player.query(api.codex.entryText, { entryId: shown })).toEqual({ role: "player", pdesc: "Known" });
    expect(await player.query(api.codex.entryText, { entryId: secret })).toBeNull();
    expect(JSON.stringify(known)).not.toContain("GM only");
  });

  it("maps: a player's map and locations leave out hidden markers; the GM's keep them", async () => {
    const w = await buildWorld();
    const campaignId = w.campaignId;
    await w.t.run(async (ctx) => {
      const pin = { campaignId, type: "village", x: 50, y: 50, notes: "", location: true };
      await ctx.db.insert("mapTokens", { ...pin, tokenId: 1, name: "Open town", hidden: false });
      await ctx.db.insert("mapTokens", { ...pin, tokenId: 2, name: "Secret lair", hidden: true });
    });

    const gmMap = await w.as("gm").query(api.maps.get, { campaignId });
    expect(gmMap.role).toBe("gm");
    expect(JSON.stringify(gmMap.state)).toContain("Secret lair");
    expect((await w.as("gm").query(api.maps.locations, { campaignId })).map((l) => l.name)).toEqual(["Open town", "Secret lair"]);

    for (const role of ["player", "otherPlayer"] as const) {
      const map = await w.as(role).query(api.maps.get, { campaignId });
      expect(map.role).toBe("player");
      const text = JSON.stringify(map.state);
      expect(text).toContain("Open town");
      expect(text).not.toContain("Secret lair");
      expect((await w.as(role).query(api.maps.locations, { campaignId })).map((l) => l.name)).toEqual(["Open town"]);
    }
  });
});
