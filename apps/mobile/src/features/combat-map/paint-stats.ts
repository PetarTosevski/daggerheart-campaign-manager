/**
 * Paint instrumentation (dcm-gdzi.14): how often the expensive steps run and how long the last one took. Tests assert
 * the counts stay bounded across gestures and live updates; on a device, `paintStats` can be logged from the debugger
 * to read real paint times.
 */
export type PaintStats = {
  /** Base map paints (the painter run over the whole map). */
  base: number;
  /** Fog image builds. */
  fog: number;
  /** Sprite files fetched and decoded (cached by URL across paints). */
  spriteDecodes: number;
  /** Milliseconds of the last base paint and fog build. */
  lastBaseMs: number;
  lastFogMs: number;
};

export const paintStats: PaintStats = { base: 0, fog: 0, spriteDecodes: 0, lastBaseMs: 0, lastFogMs: 0 };

export function resetPaintStats(): void {
  paintStats.base = 0;
  paintStats.fog = 0;
  paintStats.spriteDecodes = 0;
  paintStats.lastBaseMs = 0;
  paintStats.lastFogMs = 0;
}
