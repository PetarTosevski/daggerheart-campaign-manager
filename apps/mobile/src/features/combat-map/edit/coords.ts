import type { CombatMapLayout } from "../contract";
import type { View as PanView } from "../../world/pan-zoom";
import { stageAspect } from "../paint-layout";

/** Map touch coordinates in the viewport to square coordinates on the battlefield. */
export function touchToSquare(
  locationX: number,
  locationY: number,
  view: PanView,
  layout: Pick<CombatMapLayout, "w" | "h">,
): { x: number; y: number } {
  const aspect = stageAspect(layout, false);
  const mapW = view.w * view.z;
  const mapH = mapW * aspect;
  if (mapW <= 0 || mapH <= 0) return { x: 0, y: 0 };
  const x = ((locationX - view.x) / mapW) * layout.w;
  const y = ((locationY - view.y) / mapH) * layout.h;
  return {
    x: Math.max(0, Math.min(layout.w, x)),
    y: Math.max(0, Math.min(layout.h, y)),
  };
}
