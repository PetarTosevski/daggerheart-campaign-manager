/**
 * Area-effect art (plan lanes-2 wave 9, tracer AO; dcm-lqnt; .omc/plans/aoe-sprites.md): the kinds of art a live map
 * area can be drawn with, where each kind sits on the generated sheets (docs/sprite-packs/area-effects-prompts.md), how
 * the overlay draws it, and which kind an area's label maps to (`generic` when none).
 *
 * Pure data and functions: the offline cutter (scripts/sprite-packs/cut-areas.ts) reads the sheet layout, the map
 * overlay (src/components/combat-map/map-view/area-overlay.tsx) reads the rest.
 */

/** The fill swatches, by sheet (2 x 2 each, reading order: top left, top right, bottom left, bottom right). */
export const FILL_SHEETS = {
  "fills-1": ["darkness", "fog", "smoke", "shadow"],
  "fills-2": ["ink", "acid", "brambles", "generic"],
  "fills-3": ["aura-fire", "aura-earth", "aura-water", "aura-air"],
  "fills-4": ["storm-hurricane", "storm-blizzard", "storm-sandstorm", "suppressing-fire"],
} as const;

/** The circle decals (sheet `decals`, 3 x 3, reading order). */
export const DECAL_KINDS = ["rune-circle", "radiant-circle", "moonlight", "healing-barrier", "silence", "fortress", "ritual-dark", "frost-glyph", "shadow-pool"] as const;

/** The wall strips (sheet `walls`, 4 rows, top to bottom). */
export const WALL_KINDS = ["fire-wall", "force-wall", "hunger-wall", "shadow-line"] as const;

export type FillKind = (typeof FILL_SHEETS)[keyof typeof FILL_SHEETS][number];
export type DecalKind = (typeof DECAL_KINDS)[number];
export type WallKind = (typeof WALL_KINDS)[number];
export type AreaKind = FillKind | DecalKind | WallKind;

export const FILL_KINDS: readonly FillKind[] = Object.values(FILL_SHEETS).flat();
export const AREA_KINDS: readonly AreaKind[] = [...FILL_KINDS, ...DECAL_KINDS, ...WALL_KINDS];

/** The sheet file names (without extension) under the sheets folder. */
export const AREA_SHEETS = [...Object.keys(FILL_SHEETS), "decals", "walls"] as const;
export type AreaSheet = (typeof AREA_SHEETS)[number];

/**
 * Fills whose art is one swirl around a centre (a spiral, a plume): drawn scaled to the circle, not tiled, and not
 * seam-fixed by the cutter (the half offset of the seam fix would move the swirl's centre to the corners).
 */
export const SCALED_FILLS: ReadonlySet<FillKind> = new Set<FillKind>(["aura-earth", "aura-air", "ink"]);

/** Decals drawn faint (the user's brief: moonlight and silence at low opacity, so tokens under them stay clear). */
export const FAINT_DECALS: ReadonlySet<DecalKind> = new Set<DecalKind>(["moonlight", "silence"]);

/**
 * How the overlay draws a kind:
 * - `tile`: a fill repeated across the circle, see-through, clipped to it;
 * - `scale`: a fill drawn once over the circle's square, see-through, clipped to it;
 * - `decal`: a cut-out ring drawn over the circle's square (`opacity` lower for the faint ones);
 * - `wall`: a strip repeated along the wall's line.
 */
export type DrawMode = "tile" | "scale" | "decal" | "wall";

export type KindStyle = { mode: DrawMode; opacity: number };

/** See-through fills: thick enough to read the effect, thin enough to see the map and tokens under it. */
export const FILL_OPACITY = 0.6;
export const FAINT_OPACITY = 0.45;

const FILL_SET: ReadonlySet<string> = new Set(FILL_KINDS);
const DECAL_SET: ReadonlySet<string> = new Set(DECAL_KINDS);
const WALL_SET: ReadonlySet<string> = new Set(WALL_KINDS);

export const isAreaKind = (s: string): s is AreaKind => FILL_SET.has(s) || DECAL_SET.has(s) || WALL_SET.has(s);
export const isWallKind = (s: string): s is WallKind => WALL_SET.has(s);
export const isDecalKind = (s: string): s is DecalKind => DECAL_SET.has(s);
export const isFillKind = (s: string): s is FillKind => FILL_SET.has(s);

export function kindStyle(kind: AreaKind): KindStyle {
  if (isWallKind(kind)) return { mode: "wall", opacity: 1 };
  if (isDecalKind(kind)) return { mode: "decal", opacity: FAINT_DECALS.has(kind) ? FAINT_OPACITY : 1 };
  return { mode: SCALED_FILLS.has(kind) ? "scale" : "tile", opacity: FILL_OPACITY };
}

/**
 * Label -> kind, first match wins (the effect names of .omc/plans/aoe-sprites.md and the SRD area labels). Matched on
 * the lower-cased label, so "Elemental Aura (Fire)" and a GM's "dark cloud" both find their art.
 */
const LABEL_KINDS: ReadonlyArray<readonly [RegExp, AreaKind]> = [
  [/elemental aura \(fire\)|\baura of fire\b/, "aura-fire"],
  [/elemental aura \(earth\)|\baura of earth\b/, "aura-earth"],
  [/elemental aura \(water\)|\baura of water\b/, "aura-water"],
  [/elemental aura \(air\)|\baura of air\b/, "aura-air"],
  [/wall of flame|fire wall|flame wall/, "fire-wall"],
  [/manifest wall|force wall/, "force-wall"],
  [/wall of hunger|hunger wall/, "hunger-wall"],
  [/veil of night|shadow line|shadow wall/, "shadow-line"],
  [/dark cloud|cloud of darkness|eclipse|veil of night|darkness/, "darkness"],
  [/mysterious mist|misty cloud|\bmist\b|\bfog\b/, "fog"],
  [/\bink\b/, "ink"],
  [/\bsmoke\b/, "smoke"],
  [/shadow pool/, "shadow-pool"],
  [/\bshadows?\b/, "shadow"],
  [/\bhush\b|silence/, "silence"],
  [/circle of power|radiant/, "radiant-circle"],
  [/moonbeam|moonlight/, "moonlight"],
  [/rejuvenation barrier|healing/, "healing-barrier"],
  [/rune circle|\brunes?\b/, "rune-circle"],
  [/wild fortress|fortress/, "fortress"],
  [/defilement|ritual/, "ritual-dark"],
  [/frost|\bice\b/, "frost-glyph"],
  [/\bacid/, "acid"],
  [/suppressing fire|arrows|volley/, "suppressing-fire"],
  [/bramble|thorns?\b|vines/, "brambles"],
  [/hurricane/, "storm-hurricane"],
  [/blizzard/, "storm-blizzard"],
  [/sandstorm/, "storm-sandstorm"],
];

/**
 * The art kind of an area: its label's kind when the shape fits (a wall kind only for a wall, a circle kind only for a
 * circle), else `generic` (a wall without wall art draws as a plain line, see the overlay).
 */
export function areaKindOf(label: string, shape: "circle" | "wall"): AreaKind {
  const text = label.toLowerCase();
  for (const [pattern, kind] of LABEL_KINDS) {
    if (!pattern.test(text)) continue;
    if (isWallKind(kind) === (shape === "wall")) return kind;
  }
  return "generic";
}
