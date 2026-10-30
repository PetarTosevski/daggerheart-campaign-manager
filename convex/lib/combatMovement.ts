import { decodeCells } from "../../src/components/combat-map/map-view/cells";
import { buildMovementGrid, type MovementGrid, type MovementObject } from "../../src/lib/domain/combat-map/movement";
import { spriteMove } from "../../src/lib/sprite-packs/index";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { lineOfSight } from "../../src/lib/domain/combat-actions/index";
import { createView, tokenVisibility, VISION_BASE_DEG, VISION_MAX_DEG, VISION_STEP_DEG, type VisionToken } from "../../src/lib/domain/combat-map/index";
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

// ---------------------------------------------------------------- Cloaked ends on a move in sight (SD5, DA3)

/** Instinct that gives the widest vision cone (180 degrees, R6): an adversary's sight has no cone (DA3). */
const WIDE_INSTINCT = Math.ceil((VISION_MAX_DEG - VISION_BASE_DEG) / VISION_STEP_DEG);

const sizeOf = (t: Pick<Doc<"combatTokens">, "size">) => Math.max(1, Math.min(3, Math.trunc(t.size) || 1));

/** A token as the vision engine reads it (as convex/lib/combatVision.ts `visionTokenOf`). */
function visionToken(t: Doc<"combatTokens">): VisionToken {
  return { x: t.x, y: t.y, size: t.size, face: t.face, light: t.light, side: t.side, characterId: t.ref.kind === "pc" ? t.ref.characterId : null, revealedTo: t.revealedTo };
}

/**
 * DA3 (user 2026-10-30): whether the enemy token `enemy` can see the token `at` under the map's light. Day and dim phases
 * light everything (R8: dim is "full vision"); at night `at` must be clear (level 2) from the enemy's eye under the enemy's
 * own night vision or carried light, every other token's carried light (the rogue's own torch too), the map's lit lights
 * and glowing terrain (R9). A dim square does not count (R10: dim light hides a token unless the GM reveals it, and
 * nothing reveals a PC to an adversary; docs/tasks/TASK-DA-DA3.md QUESTIONS). The enemy looks straight at `at` with the
 * widest cone, so facing never decides. GM fog marks are the players' view and are not applied.
 */
export function enemySees(scene: Pick<Scene, "prepared" | "tokens" | "phase">, enemy: Doc<"combatTokens">, at: Doc<"combatTokens">): boolean {
  const ez = sizeOf(enemy);
  const az = sizeOf(at);
  const face = Math.atan2(at.y + az / 2 - (enemy.y + ez / 2), at.x + az / 2 - (enemy.x + ez / 2));
  const view = createView(
    scene.prepared,
    { token: { ...visionToken(enemy), face }, characterId: `token:${enemy._id}`, instinct: WIDE_INSTINCT },
    { phase: scene.phase ?? "", tokens: scene.tokens.filter((t) => t._id !== enemy._id).map(visionToken) },
  );
  // Read as a non-PC token, so its light decides (tokenVisibility always shows a PC token, Q4).
  return tokenVisibility(view, { ...visionToken(at), side: "neutral", revealedTo: [] }) === "clear";
}

/**
 * Q9 (a), CB p.42 (Rogue, "Cloaked"): "After you make an attack or end a move within line of sight of an adversary, you are
 * no longer Cloaked." DA3 (user 2026-10-30): only a revealed enemy token counts (none in `hidden`: the Hidden condition,
 * a defeated adversary), and only when it has a clear line to `at` (walls and closed doors block it; cover does not) AND
 * can see it under the map's light (`enemySees`).
 */
export function inSightOfAdversary(
  scene: Pick<Scene, "prepared" | "tokens" | "visionObjects" | "phase">,
  at: Doc<"combatTokens">,
  hidden: ReadonlySet<Id<"combatTokens">> = new Set(),
): boolean {
  return scene.tokens.some(
    (t) =>
      t._id !== at._id &&
      t.side === "enemy" &&
      !hidden.has(t._id) &&
      lineOfSight(scene.prepared, t, at, scene.visionObjects).lineOfSight &&
      enemySees(scene, t, at),
  );
}

/**
 * The enemy tokens that see nothing (DA3): an adversary with the Hidden condition, defeated or gone, and a custom token
 * with the Hidden condition. One `get` per adversary token (a map holds at most MAX_COMBAT_TOKENS).
 */
async function unseeingEnemies(ctx: QueryCtx, campaignId: Id<"campaigns">, tokens: readonly Doc<"combatTokens">[]): Promise<Set<Id<"combatTokens">>> {
  const out = new Set<Id<"combatTokens">>();
  for (const t of tokens) {
    if (t.side !== "enemy") continue;
    if (t.ref.kind === "custom") {
      if (t.ref.conditions.includes("hidden")) out.add(t._id);
    } else if (t.ref.kind === "adversary") {
      const instance = await ctx.db.get("encounterAdversaries", t.ref.adversaryId);
      if (instance === null || instance.campaignId !== campaignId || instance.defeated || instance.conditions.includes("hidden")) out.add(t._id);
    }
  }
  return out;
}

/** The feature whose Cloaked a move never ends (pin dcm-bxp.99.19.42). */
const VANISHING_ACT = "Vanishing Act";
/** Feed rows `cloakedByVanishingAct` reads back. */
const CLOAK_SOURCE_ROWS = 20;

/**
 * Whether the character's Cloaked comes from Vanishing Act (CB p.42: "You remain Cloaked in this way until you roll with
 * Fear or until your next rest."; pin dcm-bxp.99.19.42). The sheet stores Cloaked as a bare condition, so the source is
 * read from the character's newest feed rows (`by_character_at`, at most CLOAK_SOURCE_ROWS, undone rows skipped): a
 * Vanishing Act use (the feature runner's row "<name> uses Vanishing Act") newer than the row that turned Cloaked on
 * (its `before` without it). Stop-gap until the runner records a condition's source (docs/tasks/TASK-DA-DA3.md).
 */
export async function cloakedByVanishingAct(ctx: QueryCtx, characterId: Id<"characters">, name: string): Promise<boolean> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(CLOAK_SOURCE_ROWS);
  for (const row of rows) {
    if (row.undoneAt !== undefined) continue;
    if (row.summary.startsWith(`${name} uses ${VANISHING_ACT}`)) return true;
    if (row.before === undefined) continue;
    let before: ReturnType<typeof readSheet>;
    try {
      before = readSheet(row.before);
    } catch {
      continue;
    }
    if (!before.conditions.includes("cloaked")) return false;
  }
  return false;
}

/**
 * Ends the Cloaked condition of the character whose PC token just ended a move at its new square, when a revealed
 * adversary token sees it (`inSightOfAdversary`); Vanishing Act's Cloaked stays (`cloakedByVanishingAct`). Returns
 * whether it ended. `combatTokens.move` calls it after patching the token; the change is a public, undoable feed row.
 */
export async function uncloakAfterMove(ctx: MutationCtx, campaign: Doc<"campaigns">, map: Doc<"combatMaps">, token: Doc<"combatTokens">, actorId: Id<"users">): Promise<boolean> {
  if (token.ref.kind !== "pc" || !map.live) return false;
  const character = await ctx.db.get("characters", token.ref.characterId);
  if (character === null || character.campaignId !== campaign._id) return false;
  const sheet = readSheet(character.sheet);
  if (!sheet.conditions.includes("cloaked")) return false;
  const scene = await loadScene(ctx, campaign, map);
  const moved = scene.tokens.find((t) => t._id === token._id) ?? token;
  const hidden = await unseeingEnemies(ctx, campaign._id, scene.tokens);
  if (!inSightOfAdversary(scene, moved, hidden)) return false;
  if (await cloakedByVanishingAct(ctx, character._id, sheet.name)) return false;
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
