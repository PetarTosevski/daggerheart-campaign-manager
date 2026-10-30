import { decodeCells } from "../../src/components/combat-map/map-view/cells";
import { buildMovementGrid, type MovementGrid, type MovementObject } from "../../src/lib/domain/combat-map/movement";
import { spriteMove } from "../../src/lib/sprite-packs/index";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { lineOfSight } from "../../src/lib/domain/combat-actions/index";
import { logAction } from "./actionLog";
import { readSheet, saveSheet } from "./characterSheet";
import { loadScene, type Scene } from "./combatVision";
import { CELL_TILE_ROWS, MAX_MAP_H, objectsOnMap } from "./combatMaps";
import { objectTraits, resolveRefs } from "./spriteSources";

/**
 * Movement on the server (plan `.omc/plans/map-movement.yaml`, tracer M0; D1-D4, D6): the map's blocking and
 * difficult squares, built with the pure rules in src/lib/domain/combat-map/movement.ts from the map's areas, its
 * painted terrain and sight-blocker tiles, its objects and their sprites' `move` traits. Callers are campaign / GM
 * wrappers.
 *
 * Reads (all indexed and bounded): the map's objects (`by_map`, at most MAX_COMBAT_OBJECTS = 300), its painted
 * "terrain" tiles (`by_map_layer_tile`, at most ceil(MAX_MAP_H / CELL_TILE_ROWS) = 4; none for an image map), its
 * painted "block" tiles (same index, at most 4) and one `get` per distinct uploaded sprite the objects use (built-in
 * sprites read nothing).
 */

/** Tiles one layer of one map can hold (the tallest map). */
const MAX_LAYER_TILES = Math.ceil(MAX_MAP_H / CELL_TILE_ROWS);

type Uploaded = Awaited<ReturnType<typeof resolveRefs>>;

/** An object as movement reads it: footprint traits, its sprite's `move` (null = its Classic kind's), door state, hull outline. */
function movementObject(object: Doc<"combatMapObjects">, uploaded: Uploaded): MovementObject {
  const move = object.sprite === undefined ? null : spriteMove(object.sprite, { uploaded: (id) => uploaded.get(id) });
  // Doors (user answer 2026-10-21): M2 adds `open` to map objects; until then it is absent and every door is closed.
  const open = (object as { open?: boolean }).open;
  return {
    kind: object.kind,
    x: object.x,
    y: object.y,
    r: object.r,
    rot: object.rot,
    traits: objectTraits(object, uploaded),
    move,
    open: open === true,
    ...(object.points === undefined ? {} : { points: object.points }),
  };
}

function layerTiles(ctx: QueryCtx, mapId: Id<"combatMaps">, layer: "terrain" | "block") {
  return ctx.db
    .query("combatMapCells")
    .withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId).eq("layer", layer))
    .take(MAX_LAYER_TILES);
}

/**
 * The map's movement grid (D1, D2). An uploaded image ignores terrain (as vision does): its painted sight blockers and
 * its objects still stop tokens.
 */
export async function movementGrid(ctx: QueryCtx, campaignId: Id<"campaigns">, map: Doc<"combatMaps">): Promise<MovementGrid> {
  const image = map.source === "image";
  const objects = await objectsOnMap(ctx, map._id);
  const terrain = image ? [] : await layerTiles(ctx, map._id, "terrain");
  const blockers = await layerTiles(ctx, map._id, "block");
  const cells = decodeCells([...terrain, ...blockers], map.w, map.h);
  const uploaded = await resolveRefs(ctx, campaignId, objects.map((o) => o.sprite));
  return buildMovementGrid({
    w: map.w,
    h: map.h,
    base: map.base,
    areas: map.areas,
    paint: cells.paint,
    block: cells.block,
    objects: objects.map((o) => movementObject(o, uploaded)),
    image,
  });
}

// ---------------------------------------------------------------- Cloaked ends on a move in sight (plan sheet-drawer SD5)

/**
 * Q9 (a), CB p.42 (Rogue, "Cloaked"): "After you make an attack or end a move within line of sight of an adversary, you are
 * no longer Cloaked." Whether a token standing where `at` says has a clear line of sight (walls and closed doors block it;
 * cover does not) to an enemy token of the map: adversaries don't carry a vision cone of their own, so the line is the
 * map's geometry both ways (the task doc's QUESTIONS).
 */
export function inSightOfAdversary(scene: Pick<Scene, "prepared" | "tokens" | "visionObjects">, at: Doc<"combatTokens">): boolean {
  return scene.tokens.some((t) => t._id !== at._id && t.side === "enemy" && lineOfSight(scene.prepared, t, at, scene.visionObjects).lineOfSight);
}

/**
 * Ends the Cloaked condition of the character whose PC token just ended a move at its new square, when an adversary token
 * has it in line of sight (`inSightOfAdversary`). Returns whether it ended. The move mutation (convex/combatTokens.ts
 * `move`, not owned by SD5) calls it after patching the token; the change is logged as a public, undoable feed row.
 */
export async function uncloakAfterMove(ctx: MutationCtx, campaign: Doc<"campaigns">, map: Doc<"combatMaps">, token: Doc<"combatTokens">, actorId: Id<"users">): Promise<boolean> {
  if (token.ref.kind !== "pc" || !map.live) return false;
  const character = await ctx.db.get("characters", token.ref.characterId);
  if (character === null || character.campaignId !== campaign._id) return false;
  const sheet = readSheet(character.sheet);
  if (!sheet.conditions.includes("cloaked")) return false;
  const scene = await loadScene(ctx, campaign, map);
  const moved = scene.tokens.find((t) => t._id === token._id) ?? token;
  if (!inSightOfAdversary(scene, moved)) return false;
  await saveSheet(ctx, character._id, { ...sheet, conditions: sheet.conditions.filter((c) => c !== "cloaked") });
  await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId,
    kind: "feature",
    visibility: "public",
    summary: `${sheet.name} ends a move in sight of an adversary and is no longer Cloaked`,
    before: sheet,
    undoable: true,
  });
  return true;
}
