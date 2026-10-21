import { v, type Infer } from "convex/values";

import { encounterConditionValidator } from "./encounters";

/**
 * Validators of the combat map tables (D9, `convex/tables/combatMaps.ts`), defined once (CD19). Every field is
 * typed; `combatMaps` still carries `schemaVersion` because its `areas` come from Claude's layout and may change
 * shape (CD3). Counts and ranges the validators cannot express (caps, grid bounds, string lengths) are checked by
 * the helpers in `convex/lib/combatMaps.ts`. Client code derives its types from these with `Infer<>`.
 *
 * The layout shape follows the board's spec (reference/designs/project/Combat.dc.html, `CMAP.clean`), so the
 * output of C1's `clean()` (src/lib/domain/combat-map/spec.ts) can be stored as is: an area keeps every numeric
 * field the board fills in, all optional here.
 */

const literals = <T extends string>(values: readonly T[]) => v.union(...values.map((value) => v.literal(value)));

/** Terrains of the painter (board `TER`), in this order: the order also gives each terrain's cell code (`TERRAIN_CODES`). */
export const COMBAT_TERRAINS = [
  "grass",
  "dirt",
  "path",
  "sand",
  "water",
  "deep",
  "swamp",
  "stone",
  "cave",
  "wall",
  "wood",
  "snow",
  "lava",
  "void",
] as const;
export type CombatTerrain = (typeof COMBAT_TERRAINS)[number];
export const combatTerrainValidator = literals(COMBAT_TERRAINS);

/** Area shapes (board prompt): rect x,y,w,h · ellipse x,y (centre),rx,ry · poly points · path points,width · border width. */
export const AREA_SHAPES = ["rect", "ellipse", "poly", "path", "border"] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

/** A point in squares, as the board writes it: `[x, y]`. Arrays hold at most MAX_AREA_POINTS points. */
export const pointValidator = v.array(v.number());

// ---------------------------------------------------------------- sprite packs (plan .omc/plans/sprite-packs.yaml, P0)

/**
 * A sprite of a sprite pack (sprite packs D1, D8): a built-in catalog key `<setting>/<slug>` (e.g. "forest/oak-tree",
 * resolved against the static manifest in src/lib/sprite-packs; an unknown key is SPRITE_UNKNOWN on write and
 * draws Classic on read) or a GM-uploaded sprite (`spritePackSprites` id, CD6; a deleted one draws Classic, D9).
 */
export const spriteRefValidator = v.union(v.object({ builtin: v.string() }), v.object({ uploaded: v.id("spritePackSprites") }));
export type SpriteRef = Infer<typeof spriteRefValidator>;

/** A map's setting (D7): a built-in setting id (a sprite-sheets folder name, never "common") or a GM pack (Q3). */
export const settingRefValidator = v.union(v.object({ builtin: v.string() }), v.object({ pack: v.id("spritePacks") }));
export type SettingRef = Infer<typeof settingRefValidator>;

/** How a map is drawn (sprite packs P3): today's procedural painter or pack sprites. Absent `style` = "classic" (Q4, E3). */
export const MAP_STYLES = ["classic", "sprites"] as const;
export type MapStyle = (typeof MAP_STYLES)[number];
export const mapStyleValidator = literals(MAP_STYLES);

/** One painted terrain area of a layout, painted in order (later on top). Unused fields for a shape may be absent. */
export const combatAreaValidator = v.object({
  terrain: combatTerrainValidator,
  /** Sprites style only: the texture drawn for this area (D1). Classic ignores it and paints `terrain`. */
  texture: v.optional(spriteRefValidator),
  shape: literals(AREA_SHAPES),
  x: v.optional(v.number()),
  y: v.optional(v.number()),
  w: v.optional(v.number()),
  h: v.optional(v.number()),
  rx: v.optional(v.number()),
  ry: v.optional(v.number()),
  width: v.optional(v.number()),
  points: v.optional(v.array(pointValidator)),
});
export type CombatArea = Infer<typeof combatAreaValidator>;

/** How a map was made (R2): an empty grid, Claude's (or the keyword fallback's) layout, or the GM's uploaded image. */
export const COMBAT_MAP_SOURCES = ["blank", "generated", "image"] as const;
export type CombatMapSource = (typeof COMBAT_MAP_SOURCES)[number];
export const combatMapSourceValidator = literals(COMBAT_MAP_SOURCES);

/** The square grid over an uploaded image (R1): square size in image pixels and the grid's offset in image pixels. */
export const combatGridValidator = v.object({ cell: v.number(), offsetX: v.number(), offsetY: v.number() });
export type CombatGrid = Infer<typeof combatGridValidator>;

/** An uploaded map image: its `files` row (kind "combatMap", refId = the map id; CF17) and the grid over it. */
export const combatMapImageValidator = v.object({ fileId: v.id("files"), grid: combatGridValidator });

/** A combat map's stored fields (`combatMaps`). `w`/`h` are in squares (1 square = 5 ft, R1). */
export const combatMapFields = {
  campaignId: v.id("campaigns"),
  name: v.string(),
  /** The map the players see (R2). At most one per campaign, kept by C3's `setLive`. */
  live: v.boolean(),
  source: combatMapSourceValidator,
  w: v.number(),
  h: v.number(),
  /** Base terrain under every area (board `spec.base`). */
  base: combatTerrainValidator,
  /** Planks run vertically (board `spec.plankV`, set by the bridge layout). */
  plankV: v.optional(v.boolean()),
  /** Claude's layout areas, at most MAX_COMBAT_AREAS. Hand painting goes to `combatMapCells`, not here. */
  areas: v.array(combatAreaValidator),
  /** The GM's description the layout was generated from (C4). */
  prompt: v.optional(v.string()),
  /** The painter's noise seed; "Another version" bumps it (C4). */
  seed: v.number(),
  image: v.optional(combatMapImageValidator),
  schemaVersion: v.number(),
  updatedAt: v.number(),
  /** Sprite packs P3: how the map is drawn. Absent = "classic" (Q4); `setStyle` (P5) writes only this field (D1). */
  style: v.optional(mapStyleValidator),
  /** The resolved setting (D7). Absent on D9 maps: resolved at paint time by the keyword picker, stored on a switch to Sprites. */
  setting: v.optional(settingRefValidator),
  /** Whether the GM picked `setting` (true) or Claude / the keyword picker chose it (false), D7. */
  settingPicked: v.optional(v.boolean()),
  /**
   * Textures hand-painted on the "texture" cell layer (P9), at most MAX_TEXTURE_PALETTE
   * (convex/lib/validators/spritePacks.ts). Cell code `TEXTURE_CODES[i]` paints `texturePalette[i]`.
   */
  texturePalette: v.optional(v.array(spriteRefValidator)),
};

/** Object kinds of the painter (board `CMAP.KINDS`). Lights: `campfire`, `walltorch` and the board's older `torch` (lit like a wall torch, R9). */
export const COMBAT_OBJECT_KINDS = [
  "tree",
  "bush",
  "deadtree",
  "rock",
  "boulder",
  "tent",
  "campfire",
  "log",
  "crate",
  "barrel",
  "chest",
  "table",
  "pillar",
  "statue",
  "rubble",
  "mast",
  "mushroom",
  "torch",
  "walltorch",
  "crystal",
  "bones",
  "hull",
] as const;
export type CombatObjectKind = (typeof COMBAT_OBJECT_KINDS)[number];
export const combatObjectKindValidator = literals(COMBAT_OBJECT_KINDS);

/** Per-object sight override (R7). Absent = the kind's default (C1 `sight.ts`). */
export const SIGHT_MODES = ["block", "cover", "none"] as const;
export type SightMode = (typeof SIGHT_MODES)[number];
export const sightModeValidator = literals(SIGHT_MODES);

/** A map object's stored fields (`combatMapObjects`), one row each so one edit or light switch writes one row. */
export const combatObjectFields = {
  mapId: v.id("combatMaps"),
  kind: combatObjectKindValidator,
  /** Centre, in squares. */
  x: v.number(),
  y: v.number(),
  /** Radius in squares (board clamps it to 0.3..4). */
  r: v.number(),
  /** Rotation in radians. */
  rot: v.number(),
  /** Foliage colour (tree, bush): green, dark, olive, autumn, pine or pink. */
  variant: v.optional(v.string()),
  /** Log length in squares. */
  len: v.optional(v.number()),
  /** Mast sail width in squares. */
  span: v.optional(v.number()),
  /** Hull outline, like a poly area. */
  points: v.optional(v.array(pointValidator)),
  sight: v.optional(sightModeValidator),
  /** Lights only (campfire, walltorch): false = switched off. Absent = lit, as on the board. */
  lit: v.optional(v.boolean()),
  /**
   * Sprites style only: the sprite drawn for this object (D1). `kind` stays its Classic fallback (D2: a light
   * sprite's kind is a light kind of the same reach) and `sight` stays the GM's override (D3).
   */
  sprite: v.optional(spriteRefValidator),
};

/**
 * Layers of painted cells (`combatMapCells`): `terrain` = hand-painted terrain (C5), `block` = painted sight
 * blockers for images (C5, R7), `fog` = the GM's reveal/hide marks (C7, R12), `texture` = hand-painted textures
 * of a Sprites map (sprite packs P9: `TEXTURE_CODES[i]` paints `texturePalette[i]`, "." none; painting a texture
 * also paints its terrain class on `terrain`, so vision and Classic stay right). Encodings: `CELL_CODES` in
 * `convex/lib/combatMaps.ts` and `TEXTURE_CODES` below.
 */
export const CELL_LAYERS = ["terrain", "block", "fog", "texture"] as const;
export type CellLayer = (typeof CELL_LAYERS)[number];
export const cellLayerValidator = literals(CELL_LAYERS);

/**
 * Cell codes of the "texture" layer: code i = the map's `texturePalette[i]`. Uppercase, so a texture cell can
 * never read as a terrain ("a".."n"), block ("#") or fog ("r", "h") code. Its length is MAX_TEXTURE_PALETTE.
 */
export const TEXTURE_CODES = "ABCDEFGHIJKLMNOP";

export const combatCellFields = {
  mapId: v.id("combatMaps"),
  layer: cellLayerValidator,
  /** Tile index: rows `tile * CELL_TILE_ROWS` up to the next tile. */
  tile: v.number(),
  /** `CELL_TILE_ROWS * w` characters, row by row; see `CELL_CODES`. */
  cells: v.string(),
};

/** Token sides (board colours): the party, enemies, allies and neutral figures. */
export const TOKEN_SIDES = ["pc", "enemy", "ally", "neutral"] as const;
export type TokenSide = (typeof TOKEN_SIDES)[number];
export const tokenSideValidator = literals(TOKEN_SIDES);

/** A light a token carries (R9, Q2: lantern = torch; Q3: any token). */
export const CARRIED_LIGHTS = ["none", "torch", "lantern", "alistair"] as const;
export type CarriedLight = (typeof CARRIED_LIGHTS)[number];
export const carriedLightValidator = literals(CARRIED_LIGHTS);

/**
 * What a token stands for (R4). A PC or an encounter adversary keeps its numbers on its own row (character sheet,
 * `encounterAdversaries`): one source of truth, no copies here. A custom token keeps its own numbers.
 */
export const tokenRefValidator = v.union(
  v.object({ kind: v.literal("pc"), characterId: v.id("characters") }),
  v.object({ kind: v.literal("adversary"), adversaryId: v.id("encounterAdversaries") }),
  v.object({
    kind: v.literal("custom"),
    name: v.string(),
    hp: v.number(),
    hpMax: v.number(),
    stress: v.number(),
    stressMax: v.number(),
    conditions: v.array(encounterConditionValidator),
  }),
);
export type TokenRef = Infer<typeof tokenRefValidator>;

/** A token's stored fields (`combatTokens`). */
export const combatTokenFields = {
  campaignId: v.id("campaigns"),
  mapId: v.id("combatMaps"),
  ref: tokenRefValidator,
  side: tokenSideValidator,
  /** Top-left square. */
  x: v.number(),
  y: v.number(),
  /** Squares per side, 1..3 (solo adversaries 2). */
  size: v.number(),
  /** Facing in radians, 0 = east, clockwise (screen y down), R5. */
  face: v.number(),
  light: carriedLightValidator,
  /** Characters this token was revealed to while in dim light (R10), at most MAX_COMBAT_REVEALS. */
  revealedTo: v.array(v.id("characters")),
};

/** One row per (map, character): the half-squares the character has seen (R11). Own table: it changes on every move. */
export const combatExploredFields = {
  mapId: v.id("combatMaps"),
  characterId: v.id("characters"),
  /** Explored half-squares as a bitmap string; the encoding is C7's (convex/lib/combatVision.ts). */
  bits: v.string(),
  updatedAt: v.number(),
};
