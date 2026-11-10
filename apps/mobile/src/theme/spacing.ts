/** A 4-point spacing scale. Every value is a multiple of 4. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/** Touch targets. Both heights sit on the 4-point scale and clear 44 points. */
export const hit = {
  minHeight: 44,
  lg: 52,
} as const;

export const radius = {
  md: 12,
  lg: 16,
  pill: 999,
} as const;
