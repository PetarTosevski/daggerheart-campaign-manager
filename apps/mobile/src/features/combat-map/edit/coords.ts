import type { CombatMapLayout } from "../contract";

/** A square position kept on the battlefield (the map view's `toSquare` can point past its edge). */
export function clampToMap(p: { x: number; y: number }, layout: Pick<CombatMapLayout, "w" | "h">): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(layout.w, p.x)),
    y: Math.max(0, Math.min(layout.h, p.y)),
  };
}
