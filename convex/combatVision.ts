import { v, type Infer } from "convex/values";

import { paintTile, isEmptyTile, squaresByTile } from "../src/components/combat-map/editor/edit-model";
import {
  boxSeen,
  encodeExplored,
  exploredGrows,
  givesLight,
  mergeExplored,
  objectSampleBox,
  pointLevel,
  sampleLevel,
  sightOf,
  visibleSquares,
  type VisionObject,
} from "../src/lib/domain/combat-map/index";
import { isDoor } from "../src/lib/domain/combat-map/movement";
import { spriteMove } from "../src/lib/sprite-packs/index";
import { appError } from "../src/lib/errors/app-error";
import { tokenViewValidator } from "./combatTokens";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  CELL_UNPAINTED,
  FOG_HIDE,
  FOG_REVEAL,
  MAX_COMBAT_REVEALS,
  MAX_MAP_H,
  MAX_MAP_W,
  liveCombatMap,
  loadCombatMap,
  loadCombatObject,
  loadCombatToken,
} from "./lib/combatMaps";
import {
  buildView,
  exploredRow,
  lightLevelValidator,
  loadScene,
  otherTokenValidator,
  parseExploredDelta,
  sampleIndex,
  seenMask,
  storedExplored,
  viewOf,
  visionMaskValidator,
  type Scene,
  type ViewResult,
} from "./lib/combatVision";
import { campaignMutation, campaignQuery, gmMutation, gmQuery } from "./lib/functions";
import { loadObjectTraits, resolveRefs, type UploadedSprites } from "./lib/spriteSources";
import { atLeast, permissionFor, type Permission } from "./lib/permissions";
import { carriedLightValidator } from "./lib/validators/combatMaps";

/**
 * Vision on the server (D9 C7, plan `.omc/plans/d9-combat-map.yaml`; R8–R12, Q1, Q3, Q4).
 *
 * - `playerView` (every member, for their own character on the live map) and `previewAs` (GM, any character):
 *   the tokens that character can see now under the campaign's time and the map's lights, filtered here with
 *   C1's engine so a hidden token never reaches the player (R10, R11); adversary, ally, neutral and custom
 *   tokens carry name, size, side and facing only (R4); every PC token is shown with its public sheet numbers
 *   (Q4); plus the character's vision masks for the fog (the client never learns where hidden torch-bearers
 *   stand, Q3). The layout itself stays C3's `combatMaps.live` (Q1).
 * - `revealTo` / `unrevealTo` (GM): a dim-light token shown to one character (R10).
 * - `setCarriedLight`: any token's light for the GM, a player's own PC token's (R9, Q3).
 * - `toggleLight`: a map light on or off; the GM always, a player only when one of their characters on the live
 *   map sees it now or has explored its square (COMBAT_LIGHT_NOT_SEEN, R9).
 * - `doors` / `toggleDoor` (map-movement M2, D7, D8): the doors the caller may switch, and a door opened or closed;
 *   the GM always, a player only on the live map and only a door one of their characters sees now or has explored
 *   (an unseen door answers COMBAT_OBJECT_NOT_FOUND, as if it were not there).
 * - `explored` / `markExplored`: a character's explored samples (R11), merged, written only when they grow.
 * - `paintFog` (GM): reveal / hide / erase marks on the fog layer (R12); they decide token visibility too (user
 *   2026-10-20: "reveal" squares are clear, "hide" squares unseen).
 */

/** Squares one fog stroke may touch: every square of the largest map. */
const MAX_STROKE_SQUARES = MAX_MAP_W * MAX_MAP_H;

type CampaignCtx<C> = C & { user: Doc<"users">; campaign: Doc<"campaigns">; permission: Permission };

// ---------------------------------------------------------------- validators

const viewOkValidator = v.object({
  state: v.literal("ok"),
  mapId: v.id("combatMaps"),
  characterId: v.id("characters"),
  /** The viewer's own token. */
  tokenId: v.id("combatTokens"),
  /** Campaign time phase (R8); null for a frame without campaign time (vision as by day). */
  phase: v.union(v.string(), v.null()),
  light: lightLevelValidator,
  instinct: v.number(),
  /** Vision cone width in degrees (R6). */
  coneDeg: v.number(),
  vision: visionMaskValidator,
  /** Every PC token on the map, the viewer's own included (`mine`), with public sheet numbers (Q4). */
  pcs: v.array(tokenViewValidator),
  /** Other tokens the character sees now (R10, R11), without stats (R4). */
  others: v.array(otherTokenValidator),
});

/** No live map (players) or no map at all; the character has no token on the map; or their view. */
const viewResultValidator = v.union(
  v.object({ state: v.literal("noMap") }),
  v.object({ state: v.literal("noCharacter"), mapId: v.id("combatMaps") }),
  viewOkValidator,
);

type ViewState = { state: "noMap" } | { state: "noCharacter"; mapId: Id<"combatMaps"> } | ViewResult;

const fogMarkValidator = v.union(v.literal("reveal"), v.literal("hide"), v.literal("erase"));

/**
 * A door the caller may switch (map-movement M2): where it stands (centre, radius and rotation, as the layout has
 * them), whether it is open, and whether it is solid (blocks sight while closed: the Classic door, the wooden door
 * sprite) or bars / a gate (see-through cover while closed, D7).
 */
const doorViewValidator = v.object({
  _id: v.id("combatMapObjects"),
  x: v.number(),
  y: v.number(),
  r: v.number(),
  rot: v.number(),
  open: v.boolean(),
  solid: v.boolean(),
});
export type DoorView = Infer<typeof doorViewValidator>;

const doorsResultValidator = v.union(v.null(), v.object({ mapId: v.id("combatMaps"), doors: v.array(doorViewValidator) }));

// ---------------------------------------------------------------- helpers

/** A character of this campaign, or NOT_FOUND. */
async function campaignCharacter(ctx: CampaignCtx<QueryCtx>, characterId: string): Promise<Doc<"characters">> {
  const id = ctx.db.normalizeId("characters", characterId);
  const character = id === null ? null : await ctx.db.get("characters", id);
  if (character === null || character.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
  return character;
}

/** Whether the caller may act for the character (its edit permission, as C6's `move`; R4). */
async function canActFor(ctx: CampaignCtx<QueryCtx>, character: Doc<"characters">): Promise<boolean> {
  return atLeast(await permissionFor(ctx, ctx.user, { type: "character", campaign: ctx.campaign, character }, "edit"), "edit");
}

/** The caller's own character (edit permission), else COMBAT_NOT_YOUR_TOKEN. */
async function ownCharacter(ctx: CampaignCtx<QueryCtx>, characterId: string): Promise<Doc<"characters">> {
  const character = await campaignCharacter(ctx, characterId);
  if (!(await canActFor(ctx, character))) throw appError("COMBAT_NOT_YOUR_TOKEN");
  return character;
}

/** The map a call is about: the GM any of the campaign's maps (default: the live one); a player only the live map. */
async function targetMap(ctx: CampaignCtx<QueryCtx>, mapId: string | undefined): Promise<Doc<"combatMaps"> | null> {
  const gm = atLeast(ctx.permission, "owner");
  if (gm && mapId !== undefined) return loadCombatMap(ctx, ctx.campaign._id, mapId);
  const live = await liveCombatMap(ctx, ctx.campaign._id);
  if (!gm && mapId !== undefined && (live === null || live._id !== mapId)) throw appError("COMBAT_MAP_NOT_FOUND");
  return live;
}

async function viewFor(ctx: CampaignCtx<QueryCtx>, map: Doc<"combatMaps">, character: Doc<"characters">, asUser: Doc<"users">): Promise<ViewState> {
  const scene = await loadScene(ctx, ctx.campaign, map);
  return (await buildView(ctx, ctx.campaign, scene, character, asUser)) ?? { state: "noCharacter", mapId: map._id };
}

/** The token when the caller may set its carried light: the GM any; a player their own PC's on the live map (Q3). */
async function lightableToken(ctx: CampaignCtx<MutationCtx>, tokenId: string): Promise<Doc<"combatTokens">> {
  const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
  if (atLeast(ctx.permission, "owner")) return token;
  const map = await loadCombatMap(ctx, ctx.campaign._id, token.mapId);
  if (!map.live) throw appError("COMBAT_MAP_NOT_FOUND");
  if (token.ref.kind !== "pc") throw appError("COMBAT_NOT_YOUR_TOKEN");
  const character = await ctx.db.get("characters", token.ref.characterId);
  if (character === null || character.campaignId !== ctx.campaign._id || !(await canActFor(ctx, character))) throw appError("COMBAT_NOT_YOUR_TOKEN");
  return token;
}

// ---------------------------------------------------------------- reads

/**
 * Every member: their character's view of the live map (R11). `characterId` picks one of the caller's
 * characters (edit permission, else COMBAT_NOT_YOUR_TOKEN); without it, the first PC token on the live map whose
 * character the caller owns. States: `noMap` (no live map), `noCharacter` (none of theirs is on it), `ok`.
 */
export const playerView = campaignQuery({
  need: "view",
  args: { characterId: v.optional(v.string()) },
  returns: viewResultValidator,
  handler: async (ctx, { characterId }): Promise<ViewState> => {
    const map = await liveCombatMap(ctx, ctx.campaign._id);
    if (map === null) return { state: "noMap" };
    const scene = await loadScene(ctx, ctx.campaign, map);
    let character: Doc<"characters"> | null = null;
    if (characterId !== undefined) {
      character = await ownCharacter(ctx, characterId);
    } else {
      for (const token of scene.tokens) {
        if (token.ref.kind !== "pc") continue;
        const row = await ctx.db.get("characters", token.ref.characterId);
        if (row !== null && row.campaignId === ctx.campaign._id && row.ownerId === ctx.user._id) {
          character = row;
          break;
        }
      }
    }
    if (character === null) return { state: "noCharacter", mapId: map._id };
    return (await buildView(ctx, ctx.campaign, scene, character, ctx.user)) ?? { state: "noCharacter", mapId: map._id };
  },
});

/**
 * GM: exactly what the character's player gets from `playerView` (R12), on the live map or on `mapId`. The view
 * is built as the character's owner sees it (their `canMove`).
 */
export const previewAs = gmQuery({
  args: { characterId: v.string(), mapId: v.optional(v.string()) },
  returns: viewResultValidator,
  handler: async (ctx, { characterId, mapId }): Promise<ViewState> => {
    const character = await campaignCharacter(ctx, characterId);
    const map = await targetMap(ctx, mapId);
    if (map === null) return { state: "noMap" };
    const owner = await ctx.db.get("users", character.ownerId);
    return viewFor(ctx, map, character, owner ?? ctx.user);
  },
});

/**
 * A character's explored samples (R11) in C1's codec: `decodeExplored(bits, length)`. A player reads their own
 * characters' on the live map; the GM any character's on any map (default: the live one). Null without a map.
 */
export const explored = campaignQuery({
  need: "view",
  enough: "owner",
  args: { characterId: v.string(), mapId: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({ mapId: v.id("combatMaps"), characterId: v.id("characters"), length: v.number(), bits: v.string() })),
  handler: async (ctx, { characterId, mapId }) => {
    const gm = atLeast(ctx.permission, "owner");
    const character = gm ? await campaignCharacter(ctx, characterId) : await ownCharacter(ctx, characterId);
    const map = await targetMap(ctx, mapId);
    if (map === null) return null;
    const mask = storedExplored(await exploredRow(ctx, map._id, character._id), map.w, map.h);
    return { mapId: map._id, characterId: character._id, length: mask.length, bits: encodeExplored(mask) };
  },
});

// ---------------------------------------------------------------- writes

/**
 * The caller's own character (edit permission) marks samples explored on the live map (the GM: any map). `bits`
 * is a delta in C1's codec for this map's size. Only samples the character sees now (server view) are kept, so
 * a client cannot explore what it never saw; the result is merged into the stored row (never overwritten) and
 * written only when it grows. COMBAT_NO_CHARACTER when the character has no token on the map.
 */
export const markExplored = campaignMutation({
  need: "view",
  enough: "owner",
  args: { mapId: v.string(), characterId: v.string(), bits: v.string() },
  returns: v.object({ grew: v.boolean() }),
  handler: async (ctx, { mapId, characterId, bits }) => {
    const character = await ownCharacter(ctx, characterId);
    const map = await targetMap(ctx, mapId);
    if (map === null) throw appError("COMBAT_MAP_NOT_FOUND");
    const delta = parseExploredDelta(bits, map.w, map.h);
    const scene = await loadScene(ctx, ctx.campaign, map);
    const viewer = viewOf(scene, character);
    if (viewer === null) throw appError("COMBAT_NO_CHARACTER");
    const seen = seenMask(visibleSquares(viewer.view));
    for (let i = 0; i < delta.length; i++) if (!seen[i]) delta[i] = 0;
    return { grew: await addExplored(ctx, map, character._id, delta) };
  },
});

/** Merges `delta` into the (map, character) explored row; writes only when it grows. True when it grew. */
async function addExplored(ctx: MutationCtx, map: Doc<"combatMaps">, characterId: Id<"characters">, delta: Uint8Array): Promise<boolean> {
  const row = await exploredRow(ctx, map._id, characterId);
  const prev = storedExplored(row, map.w, map.h);
  if (!exploredGrows(prev, delta)) return false;
  const next = encodeExplored(mergeExplored(prev, delta));
  const updatedAt = Date.now();
  if (row === null) await ctx.db.insert("combatExplored", { mapId: map._id, characterId, bits: next, updatedAt });
  else await ctx.db.patch("combatExplored", row._id, { bits: next, updatedAt });
  return true;
}

/** GM: shows a token in dim light to one character (R10, after a successful roll). Idempotent. */
export const revealTo = gmMutation({
  args: { tokenId: v.string(), characterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { tokenId, characterId }) => {
    const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
    const character = await campaignCharacter(ctx, characterId);
    if (token.revealedTo.includes(character._id)) return null;
    if (token.revealedTo.length >= MAX_COMBAT_REVEALS) throw appError("INVALID", "This token is already revealed to every character.");
    await ctx.db.patch("combatTokens", token._id, { revealedTo: [...token.revealedTo, character._id] });
    return null;
  },
});

/** GM: takes a reveal back (R10). Idempotent. */
export const unrevealTo = gmMutation({
  args: { tokenId: v.string(), characterId: v.string() },
  returns: v.null(),
  handler: async (ctx, { tokenId, characterId }) => {
    const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
    const id = ctx.db.normalizeId("characters", characterId);
    if (id === null || !token.revealedTo.includes(id)) return null;
    await ctx.db.patch("combatTokens", token._id, { revealedTo: token.revealedTo.filter((c) => c !== id) });
    return null;
  },
});

/**
 * A token's carried light (R9; Q2 lantern = torch; Q3 any token): the GM sets any token's, a player only their
 * own PC token's on the live map (COMBAT_NOT_YOUR_TOKEN otherwise).
 */
export const setCarriedLight = campaignMutation({
  need: "view",
  enough: "owner",
  args: { tokenId: v.string(), light: carriedLightValidator },
  returns: v.null(),
  handler: async (ctx, { tokenId, light }) => {
    const token = await lightableToken(ctx, tokenId);
    if (token.light !== light) await ctx.db.patch("combatTokens", token._id, { light });
    return null;
  },
});

/**
 * Switches a map light (campfire, wall torch, or a sprite whose light trait is not none: `givesLight`, sprite packs
 * Q1) on or off: `lit` is the wanted state, so a double click cannot
 * undo itself. The GM always; a player only on the live map and only when one of the characters they play has
 * the light in view now (C1 `pointLevel` > 0) or has explored its square (COMBAT_LIGHT_NOT_SEEN, R9).
 */
export const toggleLight = campaignMutation({
  need: "view",
  enough: "owner",
  args: { objectId: v.string(), lit: v.boolean() },
  returns: v.object({ lit: v.boolean() }),
  handler: async (ctx, { objectId, lit }) => {
    const { object, map } = await loadCombatObject(ctx, ctx.campaign._id, objectId);
    const traits = await loadObjectTraits(ctx, ctx.campaign._id, object);
    if (!givesLight({ kind: object.kind, lit: object.lit, traits })) throw appError("INVALID", "Only map lights can be lit.");
    if (!atLeast(ctx.permission, "owner")) {
      if (!map.live) throw appError("COMBAT_MAP_NOT_FOUND");
      if (!(await hasSeen(ctx, map, object))) throw appError("COMBAT_LIGHT_NOT_SEEN");
    }
    if ((object.lit !== false) !== lit) await ctx.db.patch("combatMapObjects", object._id, { lit });
    return { lit };
  },
});

/** The views of the characters the caller plays (edit permission) on the scene's map, with their explored masks. */
async function ownViewers(ctx: CampaignCtx<QueryCtx>, scene: Scene) {
  const out: { characterId: Id<"characters">; view: NonNullable<ReturnType<typeof viewOf>>["view"]; explored: Uint8Array }[] = [];
  for (const token of scene.tokens) {
    if (token.ref.kind !== "pc") continue;
    const character = await ctx.db.get("characters", token.ref.characterId);
    if (character === null || character.campaignId !== ctx.campaign._id || !(await canActFor(ctx, character))) continue;
    const viewer = viewOf(scene, character);
    if (viewer === null) continue;
    out.push({ characterId: character._id, view: viewer.view, explored: storedExplored(await exploredRow(ctx, scene.map._id, character._id), scene.map.w, scene.map.h) });
  }
  return out;
}

/** Whether a character the caller plays (edit permission) on this map sees the object now or has explored its square. */
async function hasSeen(ctx: CampaignCtx<MutationCtx>, map: Doc<"combatMaps">, object: Doc<"combatMapObjects">): Promise<boolean> {
  const scene = await loadScene(ctx, ctx.campaign, map);
  for (const { view, explored } of await ownViewers(ctx, scene)) {
    if (pointLevel(view, object.x, object.y) > 0) return true;
    if (explored[sampleIndex(scene.prepared, object.x, object.y)]) return true;
  }
  return false;
}

// ---------------------------------------------------------------- doors (map-movement M2)

/** Whether the row is a door (D7): its sprite's `move` is "door", or it has none and its Classic kind is `door`. */
function isDoorRow(object: Doc<"combatMapObjects">, uploaded: UploadedSprites): boolean {
  const move = object.sprite === undefined ? null : spriteMove(object.sprite, { uploaded: (id) => uploaded.get(id) });
  return isDoor({ kind: object.kind, move });
}

/** The doors on the scene's map, with their engine objects (index-aligned with `scene.objects`). */
function sceneDoors(scene: Scene): { row: Doc<"combatMapObjects">; vision: VisionObject }[] {
  const out: { row: Doc<"combatMapObjects">; vision: VisionObject }[] = [];
  scene.objects.forEach((row, i) => {
    const vision = scene.visionObjects[i];
    if (vision !== undefined && isDoorRow(row, scene.uploaded)) out.push({ row, vision });
  });
  return out;
}

/**
 * Whether any of the viewers sees any sample the door stands on now, or has explored one (D8, the toggleLight rule
 * over the door's footprint: a closed door hides its own centre from anyone looking at its face).
 */
function doorSeen(scene: Scene, viewers: Awaited<ReturnType<typeof ownViewers>>, door: VisionObject): boolean {
  const box = objectSampleBox(scene.prepared, door);
  return viewers.some(({ view, explored }) => boxSeen(view, box, explored));
}

/**
 * Stores the door's samples each viewer sees now as explored (dcm-bxp.121): the player who switches a door has seen it,
 * so it stays theirs to switch after they walk through and turn their back on it. The client's throttled explored
 * sync cannot promise that: it keeps only what the character sees when the write arrives, so a door looked at for
 * less than EXPLORED_THROTTLE_MS (open it, step through) was never stored and dropped out of `doors`.
 */
async function exploreDoor(ctx: CampaignCtx<MutationCtx>, scene: Scene, viewers: Awaited<ReturnType<typeof ownViewers>>, door: VisionObject) {
  const box = objectSampleBox(scene.prepared, door);
  const { sw } = scene.prepared;
  for (const { characterId, view, explored } of viewers) {
    const delta = new Uint8Array(explored.length);
    for (let sy = box.sy0; sy < box.sy1; sy++) for (let sx = box.sx0; sx < box.sx1; sx++) if (sampleLevel(view, sx, sy) > 0) delta[sy * sw + sx] = 1;
    await addExplored(ctx, scene.map, characterId, delta);
  }
}

function doorView(row: Doc<"combatMapObjects">, vision: VisionObject): DoorView {
  return {
    _id: row._id,
    x: row.x,
    y: row.y,
    r: row.r,
    rot: row.rot,
    open: row.open === true,
    solid: sightOf({ ...vision, open: false }) === "block",
  };
}

/**
 * The doors the caller may switch on a map (D8): the GM every door on `mapId` (default: the live map); a player the
 * live map's doors one of their characters sees now or has explored, and nothing else (a door they have not seen is
 * never sent). Null without a map.
 */
export const doors = campaignQuery({
  need: "view",
  enough: "owner",
  args: { mapId: v.optional(v.string()) },
  returns: doorsResultValidator,
  handler: async (ctx, { mapId }) => {
    const map = await targetMap(ctx, mapId);
    if (map === null) return null;
    const scene = await loadScene(ctx, ctx.campaign, map);
    const all = sceneDoors(scene);
    if (atLeast(ctx.permission, "owner")) return { mapId: map._id, doors: all.map(({ row, vision }) => doorView(row, vision)) };
    if (all.length === 0) return { mapId: map._id, doors: [] };
    const viewers = await ownViewers(ctx, scene);
    return {
      mapId: map._id,
      doors: all.filter(({ vision }) => doorSeen(scene, viewers, vision)).map(({ row, vision }) => doorView(row, vision)),
    };
  },
});

/**
 * Opens or closes a door (D7, D8): `open` is the wanted state, so a double click cannot undo itself. The GM always;
 * a player only on the live map (COMBAT_MAP_NOT_FOUND) and only a door one of their characters sees now or has
 * explored (else COMBAT_OBJECT_NOT_FOUND, exactly as for an object that is not there, so a refusal tells a player
 * nothing about doors they have not seen). INVALID for an object that is not a door. Closed is stored as an absent
 * `open`. A closed door blocks movement (M0 `movement.ts` reads `open`); a closed solid door blocks sight
 * (`sightOf`); an open door does neither.
 */
export const toggleDoor = campaignMutation({
  need: "view",
  enough: "owner",
  args: { objectId: v.string(), open: v.boolean() },
  returns: v.object({ open: v.boolean() }),
  handler: async (ctx, { objectId, open }) => {
    const { object, map } = await loadCombatObject(ctx, ctx.campaign._id, objectId);
    if (atLeast(ctx.permission, "owner")) {
      if (!isDoorRow(object, await resolveRefs(ctx, ctx.campaign._id, [object.sprite]))) throw appError("INVALID", "Only doors open and close.");
    } else {
      if (!map.live) throw appError("COMBAT_MAP_NOT_FOUND");
      const scene = await loadScene(ctx, ctx.campaign, map);
      const door = sceneDoors(scene).find(({ row }) => row._id === object._id);
      if (door === undefined) {
        // Not a door: INVALID once the player has seen the object, else as if it were not there.
        const i = scene.objects.findIndex((row) => row._id === object._id);
        const vision = scene.visionObjects[i];
        if (vision !== undefined && doorSeen(scene, await ownViewers(ctx, scene), vision)) throw appError("INVALID", "Only doors open and close.");
        throw appError("COMBAT_OBJECT_NOT_FOUND");
      }
      const viewers = await ownViewers(ctx, scene);
      if (!doorSeen(scene, viewers, door.vision)) throw appError("COMBAT_OBJECT_NOT_FOUND");
      await exploreDoor(ctx, scene, viewers, door.vision);
    }
    if ((object.open === true) !== open) await ctx.db.patch("combatMapObjects", object._id, { open: open ? true : undefined });
    return { open };
  },
});

/**
 * GM: one fog brush stroke (R12) on the map's fog layer: "reveal" (those squares are clear for every player,
 * tokens there shown), "hide" (unseen, tokens hidden) or "erase" (back to automatic vision). `squares` are
 * `y * w + x`; only the touched tiles are written, an emptied tile is deleted.
 */
export const paintFog = gmMutation({
  args: { mapId: v.string(), squares: v.array(v.number()), mark: fogMarkValidator },
  returns: v.null(),
  handler: async (ctx, { mapId, squares, mark }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    const size = map.w * map.h;
    if (squares.length > MAX_STROKE_SQUARES || squares.some((s) => !Number.isInteger(s) || s < 0 || s >= size)) {
      throw appError("INVALID", "A stroke touches squares inside the map only.");
    }
    const code = mark === "reveal" ? FOG_REVEAL : mark === "hide" ? FOG_HIDE : CELL_UNPAINTED;
    for (const [tile, positions] of squaresByTile([...new Set(squares)], map.w)) {
      const row = await ctx.db
        .query("combatMapCells")
        .withIndex("by_map_layer_tile", (q) => q.eq("mapId", map._id).eq("layer", "fog").eq("tile", tile))
        .first();
      if (row === null && code === CELL_UNPAINTED) continue;
      const cells = paintTile(row?.cells ?? null, map.w, positions, code);
      if (row !== null && cells === row.cells) continue;
      if (isEmptyTile(cells)) {
        if (row !== null) await ctx.db.delete("combatMapCells", row._id);
      } else if (row === null) {
        await ctx.db.insert("combatMapCells", { mapId: map._id, layer: "fog", tile, cells });
      } else {
        await ctx.db.patch("combatMapCells", row._id, { cells });
      }
    }
    return null;
  },
});
