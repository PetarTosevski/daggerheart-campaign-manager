import { v, type Infer } from "convex/values";

import { generateFallbackLayout } from "../src/lib/combat-map/fallback-layout";
import { clean, mapSpecSchema, type MapSpec } from "../src/lib/domain/combat-map/spec";
import { appError } from "../src/lib/errors/app-error";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  CELL_LAYERS,
  combatAreaValidator,
  combatObjectKindValidator,
  combatTerrainValidator,
  pointValidator,
  sightModeValidator,
} from "./lib/validators/combatMaps";
import {
  CELL_TILE_ROWS,
  MAP_SIZES,
  MAX_COMBAT_OBJECTS,
  MAX_MAP_H,
  MAX_MAP_NAME,
  MAX_MAP_PROMPT,
  assertAreaCount,
  assertMapSize,
  loadCombatMap,
  objectsOnMap,
  tokensOnMap,
} from "./lib/combatMaps";
import { deleteOwnFile } from "./lib/files";
import { gmMutation, userAction } from "./lib/functions";
import { campaignAccess } from "./lib/permissions";
import { DEFAULT_MODEL } from "./photoImport";

/**
 * Claude lays out a combat map from the GM's description (D9 C4, plan `.omc/plans/d9-combat-map.yaml`; R2:
 * "Generated layouts can be edited by hand AND regenerated"). `generate` sends the board's scene prompt
 * (reference/designs/project/Combat.dc.html, `scenePrompt`) to the Messages API once, as convex/photoImport.ts
 * does (ANTHROPIC_API_KEY stays on the server), cleans the reply with C1's `clean()` and saves the areas and
 * objects through one internal mutation. Without the key, or when Claude's reply is unusable, C2's keyword
 * layout is drawn instead and the result says which. GM only; 10 generations per user per hour (Q5).
 *
 * Saving replaces the map's layout: areas, objects, painted cells (terrain, sight blockers, fog marks) and
 * explored areas go; tokens stay, moved inside the new size. "Stop" (`stop`) bumps the map's `updatedAt`, and a
 * generation whose map changed after it started is dropped, so a stopped or overtaken result never lands.
 */

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/** How long the Messages API may take before the keyword layout is drawn instead. */
const CLAUDE_TIMEOUT_MS = 120_000;
/** Room for 90 objects and 60 areas of JSON. */
const MAX_TOKENS = 16_000;
/** A reply with fewer areas plus objects than this is treated as unusable (the board's rule). */
const MIN_PARTS = 3;
/** Painted-cell tiles a map can hold (as convex/combatMaps.ts). */
const MAX_CELL_TILES = CELL_LAYERS.length * Math.ceil(MAX_MAP_H / CELL_TILE_ROWS);
/** Explored rows per map: one per character (as convex/combatMaps.ts). */
const MAX_EXPLORED_ROWS = 200;
/** The default name C3 gives a new map ("Map N"); such a map takes the layout's title when first generated. */
const DEFAULT_NAME = /^Map \d+$/;

/** The API key, read in the handler (CF19); undefined when unset or blank. */
function apiKey(): string | undefined {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? key : undefined;
}

// ---------------------------------------------------------------- the board's prompt

const PROMPT_TERRAINS = "grass,dirt,path,sand,water,deep,swamp,stone,cave,wall,wood,snow,lava,void";
const PROMPT_KINDS =
  "tree,bush,deadtree,rock,boulder,tent,campfire,log,crate,barrel,chest,table,pillar,statue,rubble,mast,mushroom,torch,walltorch,crystal,bones,hull";

/**
 * The board's `scenePrompt` (Combat.dc.html), with the variation line of "Another version". COMPOSITION changed 2026-10-21: the
 * frame and vegetation follow the setting, the GM's exclusions win, and towns get buildings (user: maps kept coming out as forest).
 */
export function scenePrompt(desc: string, w: number, h: number, variation?: number): string {
  return (
    "You design top-down tabletop battle maps (hand-painted style, square grid, each cell is one 5-foot square). Turn the GM's scene into a layout for a renderer.\n" +
    `GRID: ${w} columns x ${h} rows. Coordinates are in cells: x from 0 (left) to ${w}, y from 0 (top) to ${h}. Fractions are fine.\n` +
    `Reply with ONLY one JSON object: {"title": short scene name, "w": ${w}, "h": ${h}, "base": terrain filling the whole map, "plankV": true if wooden planks should run vertically, "areas": [...], "objects": [...]}\n` +
    `TERRAINS: ${PROMPT_TERRAINS}. ("wall" = solid rock/impassable, drawn dark with hatched edges; "cave" = cave floor; "stone" = flagstone floor; "wood" = planks; "deep" = deep water; "void" = black nothing).\n` +
    'AREAS are painted in order, later on top. Shapes: {"terrain","shape":"rect","x","y","w","h"} | {"terrain","shape":"ellipse","x","y","rx","ry"} (x,y = centre) | {"terrain","shape":"poly","points":[[x,y],...]} | {"terrain","shape":"path","points":[[x,y],...],"width"} for rivers, roads, corridors, tunnels | {"terrain","shape":"border","width"} for a frame around the edge.\n' +
    `OBJECTS: {"kind","x","y","r","rot","variant","sight"} with kind one of: ${PROMPT_KINDS}. x,y = centre in cells; r = radius in cells (tree 1.2-2.2, bush 0.7-1, rock 0.6-1.2, boulder 1-1.5, tent ~2, campfire ~1, pillar ~0.9, statue ~1.2, walltorch ~0.6 placed against walls); rot = radians (tents, logs, tables, crates); log also takes "len" (cells); tree/bush "variant": green, dark, olive, autumn, pine or pink; mast takes "span" (sail width in cells) and goes on a ship; hull takes "points" (a polygon like a poly area) and draws a whole ship deck with planks and a rim, put masts, crates and barrels on it. "sight" is optional: "block" (big enough to hide behind), "cover" (half cover, does not block sight) or "none".\n` +
    'COMPOSITION: make it look like a real painted battle map that matches the SCENE\'s setting. Frame it with edges that fit that setting (trees for a forest, cliffs for mountains, walls or buildings for a town or interior) and keep an open, readable fighting space with cover in the middle. Use organic shapes (paths and ellipses) outdoors, straight edges for architecture. 25-90 objects, nothing overlapping awkwardly. Only use trees, bushes and grass where the SCENE has vegetation, and never use anything the SCENE rules out (if it says "not in a forest", use few or no trees). Towns, villages and streets: base "dirt", "path" or "stone" streets and squares; each building is a "wall" rect with a smaller "wood" or "stone" floor rect inside it and a gap in the wall for a door; ruined buildings have broken walls ("rubble", gaps); fill with crates, barrels, tables, chests; a "statue" works as a well or fountain. Interiors: base "wall" or "void", rooms as stone/wood rects joined by path corridors, wall torches along the walls. Ships: base "deep", one hull object, 2-3 masts along it. Caves: base "wall", cave floor carved with paths and ellipses.\n' +
    `SCENE: ${desc}` +
    (variation === undefined ? "" : `\n(Variation #${variation}: make a different layout from before.)`)
  );
}

// ---------------------------------------------------------------- validators

const sizeValidator = v.union(v.literal("small"), v.literal("medium"), v.literal("large"));

const layoutObjectValidator = v.object({
  kind: combatObjectKindValidator,
  x: v.number(),
  y: v.number(),
  r: v.number(),
  rot: v.number(),
  variant: v.optional(v.string()),
  len: v.optional(v.number()),
  span: v.optional(v.number()),
  points: v.optional(v.array(pointValidator)),
  sight: v.optional(sightModeValidator),
  lit: v.optional(v.boolean()),
});

/** A cleaned layout as `save` stores it (C1's `MapSpec`, objects without empty point lists). */
const layoutValidator = v.object({
  w: v.number(),
  h: v.number(),
  base: combatTerrainValidator,
  plankV: v.boolean(),
  title: v.string(),
  areas: v.array(combatAreaValidator),
  objects: v.array(layoutObjectValidator),
});
type Layout = Infer<typeof layoutValidator>;

/**
 * What `generate` reports: whether the layout was saved (false when the GM pressed Stop or the map changed
 * meanwhile), who drew it, and why Claude did not (`unavailable`: no API key; `failed`: the request failed or
 * the reply was unusable, with a short reason such as an HTTP status).
 */
const generateResultValidator = v.object({
  mapId: v.id("combatMaps"),
  saved: v.boolean(),
  drawnBy: v.union(v.literal("claude"), v.literal("keywords")),
  claude: v.union(v.literal("ok"), v.literal("unavailable"), v.literal("failed")),
  reason: v.optional(v.string()),
});
export type GenerateResult = Infer<typeof generateResultValidator>;

// ---------------------------------------------------------------- layout

/** A trimmed description of 1..MAX_MAP_PROMPT characters, else INVALID. */
function description(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) throw appError("INVALID", "Describe the scene first: where the fight happens and what is there.");
  if (trimmed.length > MAX_MAP_PROMPT) throw appError("INVALID", `Keep the description under ${MAX_MAP_PROMPT} characters.`);
  return trimmed;
}

/**
 * `raw` (Claude's JSON or the keyword layout) as a storable layout of exactly `w` x `h` squares, or null when it
 * is not an object, fails C1's spec schema or has fewer than MIN_PARTS areas plus objects.
 */
export function toLayout(raw: unknown, w: number, h: number, seed: number): Layout | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const spec: MapSpec | null = clean({ ...(raw as Record<string, unknown>), w, h }, seed);
  if (spec === null || !mapSpecSchema.safeParse(spec).success) return null;
  if (spec.areas.length + spec.objects.length < MIN_PARTS) return null;
  return {
    w: spec.w,
    h: spec.h,
    base: spec.base,
    plankV: spec.plankV,
    title: spec.title.trim(),
    areas: spec.areas,
    objects: spec.objects.map(({ points, ...rest }) => (points.length > 0 ? { ...rest, points } : rest)),
  };
}

/** The first `{` to the last `}` of Claude's text, parsed; null when it is not JSON. */
function parseReply(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Thrown inside `askClaude` with a short reason for the GM ("timeout", "HTTP 529", "no JSON"...). */
class ClaudeFailure extends Error {}

/** One Messages API call; no retry. Returns the parsed JSON reply, or throws ClaudeFailure. */
async function askClaude(key: string, prompt: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(MESSAGES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    console.error("Combat map: the Messages API request failed.", error);
    throw new ClaudeFailure(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    console.error(`Combat map: the Messages API answered ${response.status}.`, (await response.text()).slice(0, 500));
    throw new ClaudeFailure(`HTTP ${response.status}`);
  }
  const answer = (await response.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
  const text = answer.content?.find((block) => block.type === "text")?.text;
  if (answer.stop_reason !== "end_turn" || text === undefined) {
    console.error(`Combat map: no complete answer (stop reason ${answer.stop_reason ?? "none"}).`);
    throw new ClaudeFailure(answer.stop_reason === "max_tokens" ? "too long" : "no answer");
  }
  const parsed = parseReply(text);
  if (parsed === null) throw new ClaudeFailure("no JSON");
  return parsed;
}

// ---------------------------------------------------------------- server side

/** The GM check for `generate` and `save` (the photo import's pattern): NOT_FOUND without access, FORBIDDEN for players. */
async function assertGm(ctx: QueryCtx, userId: Id<"users">, campaignId: Id<"campaigns">): Promise<void> {
  const user = await ctx.db.get("users", userId);
  const access = user === null ? null : await campaignAccess(ctx, user, campaignId, "owner");
  if (access === null) throw appError("NOT_FOUND");
  if (access.permission !== "owner") throw appError("FORBIDDEN");
}

/** For `generate`: the GM check and the map's `updatedAt` (the fence `save` compares), in one query (CF8). */
export const context = internalQuery({
  args: { userId: v.id("users"), campaignId: v.id("campaigns"), mapId: v.string() },
  returns: v.object({ mapId: v.id("combatMaps"), updatedAt: v.number() }),
  handler: async (ctx, { userId, campaignId, mapId }) => {
    await assertGm(ctx, userId, campaignId);
    const map = await loadCombatMap(ctx, campaignId, mapId);
    return { mapId: map._id, updatedAt: map.updatedAt };
  },
});

/** Deletes a map's objects, painted cells (all layers: terrain, sight blockers, fog marks) and explored areas. */
async function clearLayout(ctx: MutationCtx, mapId: Id<"combatMaps">): Promise<void> {
  for (const row of await objectsOnMap(ctx, mapId)) await ctx.db.delete("combatMapObjects", row._id);
  const cells = await ctx.db.query("combatMapCells").withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId)).take(MAX_CELL_TILES);
  for (const row of cells) await ctx.db.delete("combatMapCells", row._id);
  const explored = await ctx.db
    .query("combatExplored")
    .withIndex("by_map_character", (q) => q.eq("mapId", mapId))
    .take(MAX_EXPLORED_ROWS);
  for (const row of explored) await ctx.db.delete("combatExplored", row._id);
}

/** Moves tokens a smaller map left outside back onto its edge (a token keeps its size). */
async function clampTokens(ctx: MutationCtx, mapId: Id<"combatMaps">, w: number, h: number): Promise<void> {
  for (const token of await tokensOnMap(ctx, mapId)) {
    const x = Math.max(0, Math.min(w - token.size, token.x));
    const y = Math.max(0, Math.min(h - token.size, token.y));
    if (x !== token.x || y !== token.y) await ctx.db.patch("combatTokens", token._id, { x, y });
  }
}

/** Deletes an uploaded map's image file (a generated layout replaces the image). */
async function deleteImage(ctx: MutationCtx, map: Doc<"combatMaps">): Promise<void> {
  if (!map.image) return;
  const row = await ctx.db.get("files", map.image.fileId);
  if (row !== null && row.kind === "combatMap" && row.refId === map._id && row.campaignId === map.campaignId) {
    await deleteOwnFile(ctx, "combatMap", map._id, row.storageId);
  }
}

/**
 * For `generate`: saves a layout onto the map, unless the map changed since `updatedAt` (Stop, another
 * generation, a delete), in which case nothing is written and false is returned. Re-checks the GM.
 */
export const save = internalMutation({
  args: {
    userId: v.id("users"),
    campaignId: v.id("campaigns"),
    mapId: v.id("combatMaps"),
    updatedAt: v.number(),
    prompt: v.string(),
    seed: v.number(),
    layout: layoutValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, campaignId, mapId, updatedAt, prompt, seed, layout }) => {
    await assertGm(ctx, userId, campaignId);
    const map = await ctx.db.get("combatMaps", mapId);
    if (map === null || map.campaignId !== campaignId || map.updatedAt !== updatedAt) return false;
    assertMapSize(layout.w, layout.h);
    assertAreaCount(layout.areas.length);
    if (layout.objects.length > MAX_COMBAT_OBJECTS) throw appError("COMBAT_OBJECT_LIMIT");
    await deleteImage(ctx, map);
    await clearLayout(ctx, map._id);
    for (const object of layout.objects) await ctx.db.insert("combatMapObjects", { ...object, mapId: map._id });
    const renamed = map.source === "blank" && DEFAULT_NAME.test(map.name) && layout.title !== "";
    await ctx.db.patch("combatMaps", map._id, {
      source: "generated",
      w: layout.w,
      h: layout.h,
      base: layout.base,
      plankV: layout.plankV,
      areas: layout.areas,
      prompt,
      seed,
      image: undefined,
      updatedAt: Math.max(Date.now(), updatedAt + 1),
      ...(renamed ? { name: layout.title.slice(0, MAX_MAP_NAME) } : {}),
    });
    await clampTokens(ctx, map._id, layout.w, layout.h);
    return true;
  },
});

// ---------------------------------------------------------------- public

/**
 * GM: lays out `mapId` from `prompt` at `size` (Small 22x15, Medium 30x20, Large 40x27). Claude draws it when
 * ANTHROPIC_API_KEY is set (one Messages API call, no retry); otherwise, or when the call fails or the reply is
 * unusable, the keyword layout is drawn. `another` asks Claude for a different layout from before ("Another
 * version"); every call gets a fresh seed. Rate limit `combatMapGenerate` (10 per hour per user, Q5). The map
 * (from C3's `create` for a first map) keeps its tokens; see the module comment for what is replaced.
 */
export const generate = userAction({
  rateLimit: "combatMapGenerate",
  args: {
    campaignId: v.id("campaigns"),
    mapId: v.string(),
    prompt: v.string(),
    size: sizeValidator,
    another: v.optional(v.boolean()),
  },
  returns: generateResultValidator,
  handler: async (ctx, { campaignId, mapId, prompt, size, another }): Promise<GenerateResult> => {
    const fence = await ctx.runQuery(internal.combatMapGenerate.context, { userId: ctx.user._id, campaignId, mapId });
    const desc = description(prompt);
    const { w, h } = MAP_SIZES[size];
    const seed = 1 + Math.floor(Math.random() * 9999);
    const key = apiKey();
    let layout: Layout | null = null;
    let claude: GenerateResult["claude"] = key === undefined ? "unavailable" : "ok";
    let reason: string | undefined;
    if (key !== undefined) {
      try {
        layout = toLayout(await askClaude(key, scenePrompt(desc, w, h, another ? seed : undefined)), w, h, seed);
        if (layout === null) throw new ClaudeFailure("unusable layout");
      } catch (error) {
        if (!(error instanceof ClaudeFailure)) throw error;
        claude = "failed";
        reason = error.message;
      }
    }
    const drawnBy = layout === null ? "keywords" : "claude";
    layout ??= toLayout(generateFallbackLayout(desc, { seed, w, h }), w, h, seed);
    if (layout === null) throw appError("COMBAT_GENERATE_UNAVAILABLE");
    const saved: boolean = await ctx.runMutation(internal.combatMapGenerate.save, {
      userId: ctx.user._id,
      campaignId,
      mapId: fence.mapId,
      updatedAt: fence.updatedAt,
      prompt: desc,
      seed,
      layout,
    });
    return { mapId: fence.mapId, saved, drawnBy, claude, ...(reason === undefined ? {} : { reason }) };
  },
});

/**
 * GM: Stop. Marks the map as changed, so a generation still running for it is dropped when it finishes (the
 * board's Stop ignores the late result). Writes only `updatedAt`.
 */
export const stop = gmMutation({
  args: { mapId: v.string() },
  returns: v.null(),
  handler: async (ctx, { mapId }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    await ctx.db.patch("combatMaps", map._id, { updatedAt: Math.max(Date.now(), map.updatedAt + 1) });
    return null;
  },
});
