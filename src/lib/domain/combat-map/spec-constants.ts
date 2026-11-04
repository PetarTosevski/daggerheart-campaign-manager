/**
 * The map layout's terrains, object kinds, shapes and limits, without zod. Split out of `./spec` (which re-exports
 * them, dcm-uh6r) so the map renderer and the Convex vision code load without the layout schemas.
 */

/** Terrains the painter knows (the board's TER table, in its order). */
export const TERRAINS = [
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
export type Terrain = (typeof TERRAINS)[number];

/** Terrains that block sight (the board's WALLISH). */
export const SIGHT_BLOCKING_TERRAINS: ReadonlySet<Terrain> = new Set<Terrain>(["wall", "void"]);

/** Object kinds (the board's CMAP.KINDS, incl. walltorch and hull; map-movement M2 adds `door`). */
export const OBJECT_KINDS = [
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
  "door",
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const AREA_SHAPES = ["rect", "ellipse", "poly", "path", "border"] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

/** Tree and bush colour variants named in the board's layout prompt. */
export const OBJECT_VARIANTS = ["green", "dark", "olive", "autumn", "pine", "pink"] as const;
export type ObjectVariant = (typeof OBJECT_VARIANTS)[number];

export const MAP_W_MIN = 12;
export const MAP_W_MAX = 44;
export const MAP_H_MIN = 10;
export const MAP_H_MAX = 32;
export const MAX_AREAS = 60;
export const MAX_OBJECTS = 300;
export const MAX_POINTS = 40;
export const MAX_TITLE = 80;
export const OBJECT_R_MIN = 0.3;
export const OBJECT_R_MAX = 4;
/** Coordinates may sit a little outside the map (paths start at -1). */
export const COORD_MARGIN = 4;
