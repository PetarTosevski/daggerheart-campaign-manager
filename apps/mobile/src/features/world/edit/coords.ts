import type { Point } from "../../../../../../src/lib/domain/travel";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Map a touch in the viewport to a percentage point on the map layer. */
export function touchToPct(locationX: number, locationY: number, view: { x: number; y: number; z: number; w: number }, aspect: number): Point {
  const mapW = view.w * view.z;
  const mapH = mapW * aspect;
  if (mapW <= 0 || mapH <= 0) return { x: 0, y: 0 };
  return {
    x: clamp(((locationX - view.x) / mapW) * 100),
    y: clamp(((locationY - view.y) / mapH) * 100),
  };
}
