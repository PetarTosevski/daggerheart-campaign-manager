/**
 * Plan lanes-2 wave 9, tracer AO (docs/tasks/TASK-LN3-AO.md): the GM draws, moves and resizes live map areas
 * (convex/combatAreaEdits.ts), and combatAreas.list shows the result (players: the live map only).
 *
 * Book and answers: CB p.42 (Dark Cloud): "create a temporary dark cloud that covers any area within Close range";
 * user answer 2026-10-31 (dcm-bxp.99.19.39): radius Close by default, the GM can draw or adjust the area by hand.
 * CB p.103 Defined Ranges (Close 6 squares). CB p.332 (Wall of Flame): a wall between two points.
 */
import { describe, expect, it } from "vitest";

import { api } from "../../convex/_generated/api";
import { HAND_FEATURE, MAX_LIVE_AREAS } from "../../convex/combatAreaEdits";
import { activeAreasOnMap, sightBlockers } from "../../convex/lib/combatAreas";
import { allowWorldEmails, buildWorld } from "./authz/world";
import { key } from "./helpers";

async function arena() {
  const w = await buildWorld();
  const { t, campaignId } = w;
  const gm = w.as("gm");
  const player = w.as("player");
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  const other = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", idempotencyKey: key() });
  await t.run(async (ctx) => {
    await ctx.db.patch("combatMaps", mapId, { live: true });
    await ctx.db.patch("combatMaps", other.mapId, { live: false });
  });
  const areas = () => t.run((ctx) => activeAreasOnMap(ctx, mapId));
  return { w, t, campaignId, mapId, otherMapId: other.mapId, gm, player, areas };
}

function code(e: unknown): string | undefined {
  return (e as { data?: { code?: string } }).data?.code;
}

async function refused(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return code(e);
  }
  return "ok";
}

describe("GM area edits (combatAreaEdits.ts)", () => {
  allowWorldEmails();

  it("draws a Dark Cloud by hand: a Close circle by default that blocks sight; players see it on the live map", async () => {
    const a = await arena();
    const id = await a.gm.mutation(api.combatAreaEdits.draw, { campaignId: a.campaignId, mapId: a.mapId, characterId: a.w.characterA, label: " Dark Cloud ", shape: "circle", at: { x: 6.7, y: 10 }, blocksSight: true });
    const [row] = await a.areas();
    expect(row).toMatchObject({ _id: id, featureId: HAND_FEATURE, label: "Dark Cloud", shape: "circle", centre: { kind: "square", x: 6, y: 10 }, radius: "close", blocksSight: true, expires: "scene", characterId: a.w.characterA });
    // Close = 6 squares (CB p.103); the disc reaches half a square past it (stored divided by the vision engine's 0.55 factor).
    const tokens = await a.t.run((ctx) => ctx.db.query("combatTokens").collect());
    expect(sightBlockers(await a.areas(), tokens)).toEqual([{ kind: "area", x: 6.5, y: 10.5, r: 6.5 / 0.55, sight: "block" }]);
    const seen = await a.player.query(api.combatAreas.list, { campaignId: a.campaignId, mapId: a.mapId });
    expect(seen).toMatchObject([{ _id: id, label: "Dark Cloud", radius: "close" }]);
  });

  it("an area on a map that is not live is the GM's only", async () => {
    const a = await arena();
    await a.gm.mutation(api.combatAreaEdits.draw, { campaignId: a.campaignId, mapId: a.otherMapId, characterId: a.w.characterA, label: "Fog", shape: "circle", at: { x: 2, y: 2 } });
    expect(await a.player.query(api.combatAreas.list, { campaignId: a.campaignId, mapId: a.otherMapId })).toEqual([]);
    expect(await a.gm.query(api.combatAreas.list, { campaignId: a.campaignId, mapId: a.otherMapId })).toHaveLength(1);
  });

  it("moves and resizes a circle; a token-centred one stops following its token", async () => {
    const a = await arena();
    const tokenId = await a.t.run((ctx) =>
      ctx.db.insert("combatTokens", { campaignId: a.campaignId, mapId: a.mapId, size: 1, light: "none", revealedTo: [], ref: { kind: "pc", characterId: a.w.characterA }, side: "pc", x: 3, y: 3, face: 0 }),
    );
    const areaId = await a.t.run((ctx) =>
      ctx.db.insert("combatAreas", { campaignId: a.campaignId, mapId: a.mapId, featureId: "subclass:nightwalker:dark-cloud", characterId: a.w.characterA, label: "Dark Cloud", shape: "circle", centre: { kind: "token", tokenId }, radius: "veryClose", blocksSight: true, expires: "scene", status: "active", createdAt: Date.now() }),
    );
    await a.gm.mutation(api.combatAreaEdits.resize, { campaignId: a.campaignId, areaId, radius: "close" });
    await a.gm.mutation(api.combatAreaEdits.move, { campaignId: a.campaignId, areaId, at: { x: 12, y: 9 } });
    expect((await a.areas())[0]).toMatchObject({ radius: "close", centre: { kind: "square", x: 12, y: 9 } });
    expect(await refused(a.gm.mutation(api.combatAreaEdits.move, { campaignId: a.campaignId, areaId, at: { x: 12, y: 9 }, to: { x: 13, y: 9 } }))).toBe("INVALID");
  });

  it("draws a wall between two squares, moves it whole or by its ends, refuses a radius", async () => {
    const a = await arena();
    const args = { campaignId: a.campaignId, mapId: a.mapId, characterId: a.w.characterA, label: "Wall of Flame", shape: "wall" as const, at: { x: 4, y: 4 } };
    expect(await refused(a.gm.mutation(api.combatAreaEdits.draw, args))).toBe("INVALID");
    expect(await refused(a.gm.mutation(api.combatAreaEdits.draw, { ...args, to: { x: 4, y: 4 } }))).toBe("INVALID");
    const areaId = await a.gm.mutation(api.combatAreaEdits.draw, { ...args, to: { x: 4, y: 8 } });
    expect((await a.areas())[0]).toMatchObject({ shape: "wall", wall: { a: [4, 4], b: [4, 8] } });
    await a.gm.mutation(api.combatAreaEdits.move, { campaignId: a.campaignId, areaId, at: { x: 6, y: 5 } });
    expect((await a.areas())[0]).toMatchObject({ wall: { a: [6, 5], b: [6, 9] }, centre: { kind: "square", x: 6, y: 5 } });
    await a.gm.mutation(api.combatAreaEdits.move, { campaignId: a.campaignId, areaId, at: { x: 1, y: 1 }, to: { x: 5, y: 1 } });
    expect((await a.areas())[0]).toMatchObject({ wall: { a: [1, 1], b: [5, 1] } });
    expect(await refused(a.gm.mutation(api.combatAreaEdits.resize, { campaignId: a.campaignId, areaId, radius: "far" }))).toBe("INVALID");
  });

  it("refuses squares off the map, another campaign's character, an ended area, and a full map", async () => {
    const a = await arena();
    const base = { campaignId: a.campaignId, mapId: a.mapId, characterId: a.w.characterA, label: "Fog", shape: "circle" as const };
    expect(await refused(a.gm.mutation(api.combatAreaEdits.draw, { ...base, at: { x: -1, y: 3 } }))).toBe("COMBAT_TARGET_INVALID");
    expect(await refused(a.gm.mutation(api.combatAreaEdits.draw, { ...base, at: { x: 999, y: 3 } }))).toBe("COMBAT_TARGET_INVALID");
    expect(await refused(a.gm.mutation(api.combatAreaEdits.draw, { ...base, label: "  ", at: { x: 3, y: 3 } }))).toBe("INVALID");
    expect(await refused(a.gm.mutation(api.combatAreaEdits.draw, { ...base, characterId: "nope", at: { x: 3, y: 3 } }))).toBe("NOT_FOUND");
    const areaId = await a.gm.mutation(api.combatAreaEdits.draw, { ...base, at: { x: 3, y: 3 } });
    await a.gm.mutation(api.combatAreas.remove, { campaignId: a.campaignId, areaId });
    expect(await refused(a.gm.mutation(api.combatAreaEdits.resize, { campaignId: a.campaignId, areaId, radius: "far" }))).toBe("NOT_FOUND");
    await a.t.run(async (ctx) => {
      for (let i = 0; i < MAX_LIVE_AREAS; i++)
        await ctx.db.insert("combatAreas", { campaignId: a.campaignId, mapId: a.mapId, featureId: HAND_FEATURE, characterId: a.w.characterA, label: `A${i}`, shape: "circle", centre: { kind: "square", x: 1, y: 1 }, radius: "melee", blocksSight: false, expires: "scene", status: "active", createdAt: Date.now() });
    });
    expect(await refused(a.gm.mutation(api.combatAreaEdits.draw, { ...base, at: { x: 3, y: 3 } }))).toBe("COMBAT_AREA_LIMIT");
  });

  it("a player cannot draw, move or resize (FORBIDDEN)", async () => {
    const a = await arena();
    const areaId = await a.gm.mutation(api.combatAreaEdits.draw, { campaignId: a.campaignId, mapId: a.mapId, characterId: a.w.characterA, label: "Fog", shape: "circle", at: { x: 3, y: 3 } });
    expect(await refused(a.player.mutation(api.combatAreaEdits.draw, { campaignId: a.campaignId, mapId: a.mapId, characterId: a.w.characterA, label: "Fog", shape: "circle", at: { x: 3, y: 3 } }))).toBe("FORBIDDEN");
    expect(await refused(a.player.mutation(api.combatAreaEdits.move, { campaignId: a.campaignId, areaId, at: { x: 4, y: 3 } }))).toBe("FORBIDDEN");
    expect(await refused(a.player.mutation(api.combatAreaEdits.resize, { campaignId: a.campaignId, areaId, radius: "far" }))).toBe("FORBIDDEN");
  });
});
