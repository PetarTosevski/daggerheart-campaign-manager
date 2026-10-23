import { v, type Infer } from "convex/values";

import { generateFallbackLayout } from "../src/lib/combat-map/fallback-layout";
import { clean, mapSpecSchema, type MapSpec } from "../src/lib/domain/combat-map/spec";
import { appError } from "../src/lib/errors/app-error";
import { isSettingId, pickSetting, SETTING_LABEL, SETTINGS } from "../src/lib/sprite-packs/index";
import { fallbackDescription, spriteFallback } from "../src/lib/sprite-packs/sprite-fallback";
import { buildPalette, cleanSpriteLayout, spritePrompt, type SpritePalette } from "../src/lib/sprite-packs/sprite-layout";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  CELL_LAYERS,
  combatAreaValidator,
  combatObjectKindValidator,
  combatTerrainValidator,
  mapStyleValidator,
  pointValidator,
  settingRefValidator,
  sightModeValidator,
  spriteRefValidator,
  type SettingRef,
} from "./lib/validators/combatMaps";
import { MAX_PACK_SPRITES, MAX_SPRITE_PACKS, spriteCategoryValidator } from "./lib/validators/spritePacks";
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
import { apiKey, ClaudeFailure, messagesCreate } from "./lib/claude";
import { deleteOwnFile } from "./lib/files";
import { gmMutation, userAction } from "./lib/functions";
import { campaignAccess } from "./lib/permissions";

/**
 * Claude lays out a combat map from the GM's description (D9 C4, plan `.omc/plans/d9-combat-map.yaml`; R2:
 * "Generated layouts can be edited by hand AND regenerated"). `generate` sends the board's scene prompt
 * (reference/designs/project/Combat.dc.html, `scenePrompt`) to the Messages API once through convex/lib/claude.ts
 * (`messagesCreate`; ANTHROPIC_API_KEY stays on the server and is read only there), cleans the reply with C1's `clean()` and saves the areas and
 * objects through one internal mutation. Without the key, or when Claude's reply is unusable, C2's keyword
 * layout is drawn instead and the result says which. GM only; 10 generations per user per hour (Q5).
 *
 * Saving replaces the map's layout: areas, objects, painted cells (terrain, sight blockers, fog marks) and
 * explored areas go; tokens stay, moved inside the new size. "Stop" (`stop`) bumps the map's `updatedAt`, and a
 * generation whose map changed after it started is dropped, so a stopped or overtaken result never lands.
 *
 * Sprite packs (tracer P7, plan `.omc/plans/sprite-packs.yaml`): `generate` takes an optional `setting` (absent =
 * "Let Claude choose") and saves the resolved setting with the layout (D7). A Sprites map without a picked setting
 * first asks Claude a short classification call over the setting names (built-in + the campaign's own-setting packs),
 * then lays out with `spritePrompt` (that setting's and common's sprites and textures, plus the GM's uploaded sprites
 * of the setting, Q3); the pair is one `combatMapGenerate` use (Q2). A Classic map keeps today's `scenePrompt` (E6);
 * its setting is the GM's pick (whose label is added to the scene) or the keyword picker's. Without Claude, the
 * keyword layout is drawn as today and, on a Sprites map, mapped to the setting (`spriteFallback`).
 */

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
  /** Sprites maps: the sprite drawn; `kind` stays its Classic look (D1). */
  sprite: v.optional(spriteRefValidator),
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

/** Thrown inside `generate` when Claude answered but the reply is unusable ("no JSON", "unusable layout"). */
class UnusableReply extends Error {}

/** One Messages API call; no retry. Returns the parsed JSON reply, or throws ClaudeFailure / UnusableReply. */
async function askClaude(prompt: string): Promise<unknown> {
  const parsed = parseReply(await askClaudeText(prompt, MAX_TOKENS));
  if (parsed === null) throw new UnusableReply("no JSON");
  return parsed;
}

/** One Messages API call of at most `maxTokens` (convex/lib/claude.ts: 120 s timeout, no retry); the reply's text. */
async function askClaudeText(prompt: string, maxTokens: number): Promise<string> {
  const reply = await messagesCreate({ max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }, { label: "Combat map" });
  return reply.text;
}

// ---------------------------------------------------------------- setting (sprite packs P7)

/** Room for one setting id in the classification reply. */
const CLASSIFY_MAX_TOKENS = 40;

/** One choice of the classification call: what Claude answers (`token`), what is stored and its name. */
export type SettingOption = { token: string; ref: SettingRef; label: string };

/** The classification call's choices: the built-in settings, then the campaign's own-setting packs (`pack-1`...). */
export function settingOptions(packs: readonly { _id: Id<"spritePacks">; name: string; extends?: string }[]): SettingOption[] {
  const own = packs.filter((p) => p.extends === undefined || !isSettingId(p.extends));
  return [
    ...SETTINGS.map((s) => ({ token: s.id, ref: { builtin: s.id }, label: s.label })),
    ...own.map((p, i) => ({ token: `pack-${i + 1}`, ref: { pack: p._id }, label: p.name })),
  ];
}

/** The classification prompt (Q2): the scene and the setting names; the reply is one id. */
export function settingPrompt(desc: string, options: readonly SettingOption[]): string {
  return (
    "Pick the setting of a top-down tabletop battle map. Reply with ONLY the id of the one setting below that best fits the SCENE, nothing else.\n" +
    `SETTINGS:\n${options.map((o) => `${o.token} = ${o.label}`).join("\n")}\n` +
    `SCENE: ${desc}`
  );
}

/** The option Claude named: an exact id, else the longest id in its text; null when it named none. */
export function parseSetting(text: string, options: readonly SettingOption[]): SettingOption | null {
  const answer = text.trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const exact = options.find((o) => o.token === answer);
  if (exact) return exact;
  const byLength = [...options].sort((a, b) => b.token.length - a.token.length);
  return byLength.find((o) => new RegExp(`(^|[^a-z0-9-])${o.token}($|[^a-z0-9-])`).test(answer)) ?? null;
}

// ---------------------------------------------------------------- server side

/** The GM check for `generate` and `save` (the photo import's pattern): NOT_FOUND without access, FORBIDDEN for players. */
async function assertGm(ctx: QueryCtx, userId: Id<"users">, campaignId: Id<"campaigns">): Promise<void> {
  const user = await ctx.db.get("users", userId);
  const access = user === null ? null : await campaignAccess(ctx, user, campaignId, "owner");
  if (access === null) throw appError("NOT_FOUND");
  if (access.permission !== "owner") throw appError("FORBIDDEN");
}

const packRowValidator = v.object({ _id: v.id("spritePacks"), name: v.string(), extends: v.optional(v.string()) });

/** The fields of an uploaded sprite the layout palette reads (`buildPalette`). */
const paletteSpriteValidator = v.object({
  _id: v.id("spritePackSprites"),
  name: v.string(),
  category: spriteCategoryValidator,
  w: v.number(),
  h: v.number(),
  sight: sightModeValidator,
  classicKind: combatObjectKindValidator,
  classicVariant: v.optional(v.string()),
  terrain: v.optional(combatTerrainValidator),
});

/**
 * For `generate`: the GM check, the map's `updatedAt` (the fence `save` compares), its style and name, and the
 * campaign's packs (at most MAX_SPRITE_PACKS, for the setting choices), in one query (CF8). A picked `setting` must
 * be a built-in setting (SPRITE_SETTING_UNKNOWN) or a pack of this campaign (SPRITE_PACK_NOT_FOUND), as `setSetting`.
 */
export const context = internalQuery({
  args: { userId: v.id("users"), campaignId: v.id("campaigns"), mapId: v.string(), setting: v.optional(settingRefValidator) },
  returns: v.object({
    mapId: v.id("combatMaps"),
    updatedAt: v.number(),
    style: mapStyleValidator,
    name: v.string(),
    packs: v.array(packRowValidator),
  }),
  handler: async (ctx, { userId, campaignId, mapId, setting }) => {
    await assertGm(ctx, userId, campaignId);
    const map = await loadCombatMap(ctx, campaignId, mapId);
    if (setting !== undefined && "builtin" in setting && !isSettingId(setting.builtin)) throw appError("SPRITE_SETTING_UNKNOWN");
    const packs = await ctx.db
      .query("spritePacks")
      .withIndex("by_campaign_updated", (q) => q.eq("campaignId", campaignId))
      .take(MAX_SPRITE_PACKS);
    if (setting !== undefined && "pack" in setting && !packs.some((p) => p._id === setting.pack)) throw appError("SPRITE_PACK_NOT_FOUND");
    packs.sort((a, b) => a.name.localeCompare(b.name));
    return {
      mapId: map._id,
      updatedAt: map.updatedAt,
      style: map.style ?? "classic",
      name: map.name,
      packs: packs.map((p) => ({ _id: p._id, name: p.name, ...(p.extends === undefined ? {} : { extends: p.extends }) })),
    };
  },
});

/** For `generate` on a Sprites map: the uploaded sprites of the setting's packs (each at most MAX_PACK_SPRITES). */
export const packSprites = internalQuery({
  args: { userId: v.id("users"), campaignId: v.id("campaigns"), packIds: v.array(v.id("spritePacks")) },
  returns: v.array(paletteSpriteValidator),
  handler: async (ctx, { userId, campaignId, packIds }) => {
    await assertGm(ctx, userId, campaignId);
    const rows = [];
    for (const packId of packIds.slice(0, MAX_SPRITE_PACKS)) {
      const sprites = await ctx.db
        .query("spritePackSprites")
        .withIndex("by_pack_order", (q) => q.eq("packId", packId))
        .take(MAX_PACK_SPRITES);
      for (const s of sprites) {
        if (s.campaignId !== campaignId) continue;
        rows.push({
          _id: s._id,
          name: s.name,
          category: s.category,
          w: s.w,
          h: s.h,
          sight: s.sight,
          classicKind: s.classicKind,
          ...(s.classicVariant === undefined ? {} : { classicVariant: s.classicVariant }),
          ...(s.terrain === undefined ? {} : { terrain: s.terrain }),
        });
      }
    }
    return rows;
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
    /** The resolved setting and whether the GM picked it (D7, P7). */
    setting: settingRefValidator,
    settingPicked: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, campaignId, mapId, updatedAt, prompt, seed, layout, setting, settingPicked }) => {
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
      setting,
      settingPicked,
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
    /** Sprite packs P7: the GM's pick from the Setting picker; absent = "Let Claude choose" (Q2). */
    setting: v.optional(settingRefValidator),
  },
  returns: generateResultValidator,
  handler: async (ctx, { campaignId, mapId, prompt, size, another, setting: picked }): Promise<GenerateResult> => {
    const fence = await ctx.runQuery(internal.combatMapGenerate.context, {
      userId: ctx.user._id,
      campaignId,
      mapId,
      ...(picked === undefined ? {} : { setting: picked }),
    });
    const desc = description(prompt);
    const { w, h } = MAP_SIZES[size];
    const seed = 1 + Math.floor(Math.random() * 9999);
    const variation = another ? seed : undefined;
    const sprites = fence.style === "sprites";
    const hasKey = apiKey() !== undefined;
    let layout: Layout | null = null;
    let claude: GenerateResult["claude"] = !hasKey ? "unavailable" : "ok";
    let reason: string | undefined;
    const fail = (error: unknown) => {
      if (error instanceof ClaudeFailure) reason = error.reason;
      else if (error instanceof UnusableReply) reason = error.message;
      else throw error;
      claude = "failed";
    };

    // The setting (D7, Q2): the GM's pick; on a Sprites map Claude's classification; else the keyword picker.
    const options = settingOptions(fence.packs);
    let chosen: SettingRef | undefined = picked;
    if (chosen === undefined && sprites && hasKey) {
      try {
        chosen = parseSetting(await askClaudeText(settingPrompt(desc, options), CLASSIFY_MAX_TOKENS), options)?.ref;
      } catch (error) {
        fail(error);
      }
    }
    const setting: SettingRef = chosen ?? { builtin: pickSetting(desc, fence.name) };
    const pack = "pack" in setting ? (fence.packs.find((p) => p._id === setting.pack) ?? null) : null;
    // The built-in folder the setting draws on: itself, or the one a pack adds to; null for a pack of its own.
    const folder = "builtin" in setting ? setting.builtin : pack?.extends !== undefined && isSettingId(pack.extends) ? pack.extends : null;
    const label = "builtin" in setting ? (isSettingId(setting.builtin) ? SETTING_LABEL[setting.builtin] : setting.builtin) : (pack?.name ?? "custom");

    let palette: SpritePalette<Id<"spritePackSprites">> | null = null;
    if (sprites) {
      // The setting's uploaded sprites (Q3): its own pack, or the packs that add to the built-in setting.
      const packIds = pack !== null ? [pack._id] : fence.packs.filter((p) => folder !== null && p.extends === folder).map((p) => p._id);
      const uploaded = packIds.length === 0 ? [] : await ctx.runQuery(internal.combatMapGenerate.packSprites, { userId: ctx.user._id, campaignId, packIds });
      palette = buildPalette(folder, uploaded);
    }

    if (hasKey && claude === "ok") {
      try {
        if (palette !== null) {
          layout = cleanSpriteLayout(await askClaude(spritePrompt(desc, w, h, label, palette, variation)), palette, w, h, seed);
        } else {
          // A Classic map keeps the board's prompt (E6); a setting the GM picked is named in the scene.
          const scene = picked === undefined ? desc : `${desc}\nSetting: ${label}.`;
          layout = toLayout(await askClaude(scenePrompt(scene, w, h, variation)), w, h, seed);
        }
        if (layout === null) throw new UnusableReply("unusable layout");
      } catch (error) {
        fail(error);
      }
    }
    const drawnBy = layout === null ? "keywords" : "claude";
    if (layout === null) {
      // The keyword layout as today; steered by the setting when it was picked or on a Sprites map.
      const steer = picked !== undefined || sprites;
      const classic = toLayout(generateFallbackLayout(steer ? fallbackDescription(desc, folder) : desc, { seed, w, h }), w, h, seed);
      if (classic === null) throw appError("COMBAT_GENERATE_UNAVAILABLE");
      layout = palette !== null ? spriteFallback(classic, palette, folder, label, seed) : classic;
    }
    const saved: boolean = await ctx.runMutation(internal.combatMapGenerate.save, {
      userId: ctx.user._id,
      campaignId,
      mapId: fence.mapId,
      updatedAt: fence.updatedAt,
      prompt: desc,
      seed,
      layout,
      setting,
      settingPicked: picked !== undefined,
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
