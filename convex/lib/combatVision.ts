import { v, type Infer } from "convex/values";

import { decodeCells } from "../../src/components/combat-map/map-view/cells";
import { getPhaseName, type CampaignPhaseName } from "../../src/lib/domain/campaign-time/index";
import {
  SAMPLES_PER_SQUARE,
  createView,
  decodeExplored,
  encodeExplored,
  exploredLength,
  lightOf,
  prepareMap,
  tokenVisibility,
  visibleSquares,
  type FogMark,
  type LightLevel,
  type PreparedMap,
  type ViewerView,
  type VisionGrid,
  type VisionObject,
  type VisionToken,
} from "../../src/lib/domain/combat-map/index";
import { appError } from "../../src/lib/errors/app-error";
import { frameHasMechanic } from "../../src/lib/frames/index";
import { CLASSES } from "../../src/lib/srd/classes";
import { pcPortrait, type TokenView } from "../combatTokens";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { readSheet } from "./characterSheet";
import { adversaryArtSrc } from "./encounters";
import { CELL_TILE_ROWS, MAX_MAP_H, objectsOnMap, tokensOnMap } from "./combatMaps";
import { atLeast, permissionFor } from "./permissions";
import { objectTraits, resolveRefs, type UploadedSprites } from "./spriteSources";
import { CELL_LAYERS, tokenSideValidator } from "./validators/combatMaps";

/**
 * Vision on the server (D9 C7, plan `.omc/plans/d9-combat-map.yaml`; R8–R12, Q1, Q3, Q4). A player's view is
 * computed here with C1's engine (src/lib/domain/combat-map), so the tokens a player receives are exactly the
 * ones their character can see: the map is prepared once per call (`loadScene`), one view per viewer
 * (`viewOf`), then `tokenVisibility` filters the tokens. Callers are campaign/GM wrappers; these helpers only
 * scope, compute and shape. Explored areas use C1's codec (`encodeExplored` / `decodeExplored`), stored per
 * (map, character) in `combatExplored.bits`.
 */

const CLASS_NAMES = new Map<string, string>(CLASSES.map((c) => [c.id, c.name]));

/** Painted-cell tiles a map can hold (every layer, every tile of the tallest map). */
const MAX_CELL_TILES = CELL_LAYERS.length * Math.ceil(MAX_MAP_H / CELL_TILE_ROWS);

// ---------------------------------------------------------------- validators

/** The campaign time's light (R8): day, dim (badge) or night (lights only). */
export const lightLevelValidator = v.union(v.literal("day"), v.literal("dim"), v.literal("night"));

/**
 * A token a player sees that is not a PC (adversary, ally, neutral, custom): name, size, side and facing only
 * (R4: never HP, Stress, Difficulty, conditions or anything else), plus an adversary's rulebook art; without art
 * the client draws initials from the name. `revealed`: in dim light at night and shown only because the GM revealed
 * it to this character (R10); the client marks it (the board's dashed outline).
 */
export const otherTokenValidator = v.object({
  _id: v.id("combatTokens"),
  name: v.string(),
  side: tokenSideValidator,
  x: v.number(),
  y: v.number(),
  size: v.number(),
  face: v.number(),
  revealed: v.boolean(),
  /**
   * Adversary tokens only: the rulebook art (an SRD adversary's, or a custom adversary's `basedOn` entry's) as an
   * image URL. Portraits are public under R4; stats never are. Sent only when there is art, so a row without art
   * (and every custom token's row) is exactly the D9 shape; `null` is accepted for the client's portrait type.
   */
  portrait: v.optional(v.union(v.object({ kind: v.literal("url"), url: v.string() }), v.null())),
});
export type OtherToken = Infer<typeof otherTokenValidator>;

/**
 * What the viewer's character sees now, as two masks in C1's explored codec (`decodeExplored(text,
 * exploredLength(w, h))`, `sw * sh` half-square samples, index `sy * sw + sx`): `seen` = dim or clear, `clear`
 * = clear. Computed on the server because hidden tokens' carried lights (Q3) light squares too, and the client
 * never learns where those tokens are.
 */
export const visionMaskValidator = v.object({
  sw: v.number(),
  sh: v.number(),
  scale: v.number(),
  seen: v.string(),
  clear: v.string(),
});

// ---------------------------------------------------------------- the scene

/** Everything vision needs from one map, read once per call. */
export type Scene = {
  readonly map: Doc<"combatMaps">;
  /** The map's object rows (map-movement M2: doors are listed from them). */
  readonly objects: readonly Doc<"combatMapObjects">[];
  /** The uploaded sprite rows the objects use (resolved once). */
  readonly uploaded: UploadedSprites;
  /** The objects as the engine read them, same order as `objects`. */
  readonly visionObjects: readonly VisionObject[];
  readonly prepared: PreparedMap;
  readonly fog: Record<string, FogMark>;
  readonly tokens: readonly Doc<"combatTokens">[];
  /** Same order as `tokens`. */
  readonly visionTokens: readonly VisionToken[];
  /** The campaign time phase, or null for a frame without campaign time (treated as day). */
  readonly phase: CampaignPhaseName | null;
  readonly light: LightLevel;
};

/**
 * The campaign's time phase (R8). Campaign time is a Witherwild mechanic: other frames have none and get null
 * (vision as by day). A Witherwild campaign without a time row is at the initial time (week 1, DAY day 1).
 */
export async function campaignPhase(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<CampaignPhaseName | null> {
  if (!frameHasMechanic(campaign.frameId, "campaignTime")) return null;
  const row = await ctx.db
    .query("campaignTime")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .unique();
  if (row === null) return getPhaseName("DAY", 1);
  try {
    return getPhaseName(row.cycle, row.cycleDay);
  } catch {
    return null;
  }
}

/** A token as the engine reads it. */
function visionTokenOf(token: Doc<"combatTokens">): VisionToken {
  return {
    x: token.x,
    y: token.y,
    size: token.size,
    face: token.face,
    light: token.light,
    side: token.side,
    characterId: token.ref.kind === "pc" ? token.ref.characterId : null,
    revealedTo: token.revealedTo,
  };
}

/**
 * The map's objects as the engine reads them (sprite packs P5): kind, position, radius, rotation, the GM's sight
 * override, the light switch, the door switch (map-movement M2: an open door blocks no sight) and, for a sprite object, its resolved traits (P1 catalog or uploaded row, D3, Q1), so
 * sight blocking, rect footprints (`rot` turns them) and sprite lights follow the manifest for every viewer and for
 * toggleLight's "has seen" check alike. An unknown or deleted sprite has no traits: its Classic kind decides (D1, D9).
 */
export async function visionObjects(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  objects: readonly Doc<"combatMapObjects">[],
): Promise<VisionObject[]> {
  return visionObjectsWith(objects, await resolveRefs(ctx, campaignId, objects.map((o) => o.sprite)));
}

/** `visionObjects` with the uploaded rows already resolved. */
function visionObjectsWith(objects: readonly Doc<"combatMapObjects">[], uploaded: UploadedSprites): VisionObject[] {
  return objects.map((o) => ({
    kind: o.kind,
    x: o.x,
    y: o.y,
    r: o.r,
    rot: o.rot,
    sight: o.sight ?? null,
    lit: o.lit ?? null,
    open: o.open ?? null,
    traits: objectTraits(o, uploaded),
  }));
}

/**
 * Reads a map's objects, painted cells, tokens and the campaign phase, and prepares the blocking grid once
 * (C1 `prepareMap`): terrain walls, painted sight blockers, sight-blocking objects (R7, with sprite traits) and lit
 * map lights (R9, sprite lights included).
 * An uploaded image ignores terrain.
 */
export async function loadScene(ctx: QueryCtx, campaign: Doc<"campaigns">, map: Doc<"combatMaps">): Promise<Scene> {
  const objects = await objectsOnMap(ctx, map._id);
  const tiles = await ctx.db
    .query("combatMapCells")
    .withIndex("by_map_layer_tile", (q) => q.eq("mapId", map._id))
    .take(MAX_CELL_TILES);
  const cells = decodeCells(tiles, map.w, map.h);
  const uploaded = await resolveRefs(ctx, campaign._id, objects.map((o) => o.sprite));
  const vision = visionObjectsWith(objects, uploaded);
  const prepared = prepareMap({
    w: map.w,
    h: map.h,
    base: map.base,
    areas: map.areas,
    objects: vision,
    paint: cells.paint,
    block: cells.block,
    image: map.source === "image",
  });
  const tokens = await tokensOnMap(ctx, map._id);
  const phase = await campaignPhase(ctx, campaign);
  return { map, objects, uploaded, visionObjects: vision, prepared, fog: cells.fog, tokens, visionTokens: tokens.map(visionTokenOf), phase, light: lightOf(phase ?? "") };
}

/** The character's Instinct (R6); an unreadable sheet counts as 0. */
function instinctOf(character: Doc<"characters">): number {
  try {
    return readSheet(character.sheet).traits.instinct;
  } catch {
    return 0;
  }
}

/** Index of the character's PC token in `scene.tokens`, or -1 when it is not on the map. */
function tokenIndexOf(scene: Scene, characterId: Id<"characters">): number {
  return scene.tokens.findIndex((t) => t.ref.kind === "pc" && t.ref.characterId === characterId);
}

export type Viewer = { readonly index: number; readonly instinct: number; readonly view: ViewerView };

/** The character's view (C1 `createView`): own cone and lights, every token's carried light, GM fog marks. Null off the map. */
export function viewOf(scene: Scene, character: Doc<"characters">): Viewer | null {
  const index = tokenIndexOf(scene, character._id);
  if (index < 0) return null;
  const instinct = instinctOf(character);
  const view = createView(
    scene.prepared,
    { token: scene.visionTokens[index]!, characterId: character._id, instinct },
    { phase: scene.phase ?? "", tokens: scene.visionTokens, fog: scene.fog },
  );
  return { index, instinct, view };
}

/** Explored-mask index of the sample holding point (x, y) in squares. */
export function sampleIndex(map: Pick<PreparedMap, "sw" | "sh">, x: number, y: number): number {
  const sx = Math.max(0, Math.min(map.sw - 1, Math.floor(x * SAMPLES_PER_SQUARE)));
  const sy = Math.max(0, Math.min(map.sh - 1, Math.floor(y * SAMPLES_PER_SQUARE)));
  return sy * map.sw + sx;
}

/** 1 where the grid shows anything (dim or clear). */
export function seenMask(grid: VisionGrid): Uint8Array {
  return grid.levels.map((l) => (l > 0 ? 1 : 0));
}

/**
 * A stored explored mask for a map of `w` x `h` squares. A row written for another size (an image map whose
 * grid changed since) cannot be read square by square and reads as empty.
 */
export function storedExplored(row: Doc<"combatExplored"> | null, w: number, h: number): Uint8Array {
  const length = exploredLength(w, h);
  if (row === null || row.bits.length !== Math.ceil(length / 6)) return new Uint8Array(length);
  return decodeExplored(row.bits, length);
}

/** The (map, character) explored row, or null. */
export function exploredRow(ctx: QueryCtx, mapId: Id<"combatMaps">, characterId: Id<"characters">) {
  return ctx.db
    .query("combatExplored")
    .withIndex("by_map_character", (q) => q.eq("mapId", mapId).eq("characterId", characterId))
    .unique();
}

const EXPLORED_CHARS = /^[A-Za-z0-9_-]*$/;

/** A client's explored delta for this map, or INVALID (wrong alphabet, longer than the map). */
export function parseExploredDelta(bits: string, w: number, h: number): Uint8Array {
  const length = exploredLength(w, h);
  if (!EXPLORED_CHARS.test(bits) || bits.length > Math.ceil(length / 6)) throw appError("INVALID", "That explored area doesn't fit this map.");
  return decodeExplored(bits, length);
}

// ---------------------------------------------------------------- one player's view

/**
 * A PC token as C6's `TokenView`, seen by `asUser` (Q4: every member reads every sheet, so other PCs' HP and
 * Stress are public). `canMove` follows C6's `move`: the character's edit permission (permissionFor, R4); `mine`
 * is the viewer's own token.
 * Never `revealedTo` (GM only).
 */
async function pcView(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  asUser: Doc<"users">,
  token: Doc<"combatTokens">,
  characterId: Id<"characters">,
  own: boolean,
): Promise<TokenView> {
  const base = { _id: token._id, kind: "pc" as const, characterId, side: token.side, x: token.x, y: token.y, size: token.size, face: token.face, light: token.light };
  const character = await ctx.db.get("characters", characterId);
  if (character === null || character.campaignId !== campaign._id) {
    return { ...base, name: "Missing character", sub: "", portrait: null, canMove: false, mine: own, stats: null };
  }
  // `mine` marks the viewer's own token (the gold glow); other PCs are never "mine" in a character's view.
  const mine = own;
  const canMove = atLeast(await permissionFor(ctx, asUser, { type: "character", campaign, character }, "edit"), "edit");
  let sheet: ReturnType<typeof readSheet>;
  try {
    sheet = readSheet(character.sheet);
  } catch {
    return { ...base, name: "Unreadable character", sub: "", portrait: null, canMove, mine, stats: null };
  }
  return {
    ...base,
    name: sheet.name,
    sub: `${CLASS_NAMES.get(sheet.classId) ?? sheet.classId} · level ${sheet.level}`,
    portrait: await pcPortrait(ctx, character._id, sheet),
    canMove,
    mine,
    stats: {
      hp: sheet.hp,
      hpMax: sheet.hpMax,
      stress: sheet.stress,
      stressMax: sheet.stressMax,
      conditions: sheet.conditions,
      down: character.status === "dead" || (sheet.hpMax > 0 && sheet.hp >= sheet.hpMax),
    },
  };
}

/**
 * A non-PC token's name (the tracker instance's label for an adversary, or the custom name) and, for an adversary,
 * its rulebook art (`adversaryArtSrc`). Nothing else is read (R4).
 */
async function otherIdentity(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  token: Doc<"combatTokens">,
): Promise<Pick<OtherToken, "name" | "portrait">> {
  if (token.ref.kind === "custom") return { name: token.ref.name };
  if (token.ref.kind === "adversary") {
    const instance = await ctx.db.get("encounterAdversaries", token.ref.adversaryId);
    if (instance === null || instance.campaignId !== campaign._id) return { name: "Unknown" };
    const url = await adversaryArtSrc(ctx, campaign._id, instance);
    return url === null ? { name: instance.label } : { name: instance.label, portrait: { kind: "url", url } };
  }
  return { name: "Unknown" };
}

export type ViewResult = {
  state: "ok";
  mapId: Id<"combatMaps">;
  characterId: Id<"characters">;
  tokenId: Id<"combatTokens">;
  phase: CampaignPhaseName | null;
  light: LightLevel;
  instinct: number;
  coneDeg: number;
  vision: Infer<typeof visionMaskValidator>;
  pcs: TokenView[];
  others: OtherToken[];
};

/**
 * What `character` sees on the scene's map, as `asUser` (the player; for the GM's preview, the character's
 * owner) would receive it: the viewer's own token and every other PC token always (Q4), other tokens only when
 * `tokenVisibility` allows (R10, R11) and with name, size, side and facing only (R4); hidden tokens are absent.
 * Null when the character has no token on the map.
 */
export async function buildView(
  ctx: QueryCtx,
  campaign: Doc<"campaigns">,
  scene: Scene,
  character: Doc<"characters">,
  asUser: Doc<"users">,
): Promise<ViewResult | null> {
  const viewer = viewOf(scene, character);
  if (viewer === null) return null;
  const grid = visibleSquares(viewer.view);
  const seen = seenMask(grid);
  const clear = grid.levels.map((l) => (l === 2 ? 1 : 0));
  const pcs: TokenView[] = [];
  const others: OtherToken[] = [];
  for (let i = 0; i < scene.tokens.length; i++) {
    const token = scene.tokens[i]!;
    const own = i === viewer.index;
    if (token.ref.kind === "pc") {
      // Q4: other PCs' tokens are always shown (their vision is not shared, R11).
      pcs.push(await pcView(ctx, campaign, asUser, token, token.ref.characterId, own));
      continue;
    }
    const seenAs = tokenVisibility(viewer.view, scene.visionTokens[i]!);
    if (seenAs === "hidden") continue;
    others.push({
      _id: token._id,
      ...(await otherIdentity(ctx, campaign, token)),
      side: token.side,
      x: token.x,
      y: token.y,
      size: token.size,
      face: token.face,
      revealed: seenAs === "dim",
    });
  }
  return {
    state: "ok",
    mapId: scene.map._id,
    characterId: character._id,
    tokenId: scene.tokens[viewer.index]!._id,
    phase: scene.phase,
    light: scene.light,
    instinct: viewer.instinct,
    coneDeg: viewer.view.coneDeg,
    vision: { sw: grid.sw, sh: grid.sh, scale: grid.scale, seen: encodeExplored(seen), clear: encodeExplored(clear) },
    pcs,
    others,
  };
}
