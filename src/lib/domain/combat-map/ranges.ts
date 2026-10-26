/**
 * Range bands on the square battle grid (1 square = 5 ft).
 *
 * Core Book p.103, "Optional Rule: Defined Ranges": Melee 1 square,
 * Very Close 3, Close 6, Far 12, Very Far 13+, Out of Range = off the map.
 */

export type RangeBandKey = "melee" | "veryClose" | "close" | "far";

export type RangeBand = {
  readonly key: RangeBandKey;
  readonly label: string;
  /** Reach in squares (inclusive). */
  readonly squares: number;
};

/** Melee 1, Very Close 3, Close 6, Far 12 squares (CB p.103). R3 rings. */
export const RANGE_BANDS: readonly RangeBand[] = [
  { key: "melee", label: "Melee", squares: 1 },
  { key: "veryClose", label: "Very Close", squares: 3 },
  { key: "close", label: "Close", squares: 6 },
  { key: "far", label: "Far", squares: 12 },
] as const;

/** Squares per band, for code that needs one number (light radii, rings). */
export const RANGE_SQUARES = {
  melee: 1,
  veryClose: 3,
  close: 6,
  far: 12,
} as const satisfies Record<RangeBandKey, number>;

/** Very Far starts at 13 squares (CB p.103). */
export const VERY_FAR_MIN_SQUARES = 13;

/**
 * The band a distance in squares falls in; "veryFar" beyond Far. Negative or
 * non-finite input is treated as Melee / Very Far respectively.
 */
export function rangeBandOf(squares: number): RangeBandKey | "veryFar" {
  if (!Number.isFinite(squares)) return "veryFar";
  for (const band of RANGE_BANDS) {
    if (squares <= band.squares) return band.key;
  }
  return "veryFar";
}
