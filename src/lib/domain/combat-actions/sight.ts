// Line of sight and cover between an attacker and a target token (plan combat-actions, tracer CA1; user answer Q2).
// Pure: the server refuses a target without line of sight (COMBAT_NO_LINE_OF_SIGHT) and adds disadvantage for cover.
//
// CB p.104, "Cover, Line of Sight, and Darkness": "When you take cover behind something that makes attacking you more
//   difficult (but not impossible), attack rolls against you are made with disadvantage. You usually can't be targeted if
//   you're entirely behind a substantial structure like a wall … You have line of sight if you can see the target."
// Q2 (default a, accepted): line of sight is required for every attack and card; cover gives disadvantage.
//
// How: `los` (combat-map/vision.ts) from the attacker's centre to the centre of the target, then to the centre of every
// vision sample (half-square) of its footprint. The target is in sight when any line is clear. It is in cover when every
// clear line crosses an object whose sight mode is "cover" (`sightOf`, combat-map/sight.ts): if the attacker can see part
// of it past the cover, there is no cover. Walls and "block" objects are already in the prepared map.
//
// ```ts
// const map = prepareMap({ w: 20, h: 20, objects });
// lineOfSight(map, { x: 2, y: 2 }, { x: 9, y: 2 }, objects); // { lineOfSight: true, cover: true } behind a crate
// ```

import { blockRadiusFactor, sightOf } from "../combat-map/sight";
import { defaultTraitRadius } from "../combat-map/traits";
import { SAMPLES_PER_SQUARE, los, type PreparedMap, type VisionObject } from "../combat-map/vision";
import type { Footprint } from "./distance";

export interface SightResult {
  /** Any clear line from the attacker's centre to the target's footprint (Q2: required). */
  lineOfSight: boolean;
  /** Every clear line crosses a cover object: attack rolls against the target have disadvantage (CB p.104). */
  cover: boolean;
}

const sizeOf = (t: Footprint) => Math.max(1, Math.min(3, Math.trunc(t.size ?? 1) || 1));

/** The cover radius of a circle-footprint object, as vision measures its blocking circle. */
function coverRadius(o: VisionObject): number {
  const r = o.r || (o.traits ? defaultTraitRadius(o.traits) : 1);
  return r * blockRadiusFactor(o.kind);
}

/** Shortest distance from point (px, py) to the segment a-b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const inside = (o: VisionObject, t: Footprint) => {
  const s = sizeOf(t);
  return o.x >= t.x && o.x <= t.x + s && o.y >= t.y && o.y <= t.y + s;
};

/** Points the lines aim at: the footprint's centre, then every sample centre. */
function aimPoints(target: Footprint): [number, number][] {
  const s = sizeOf(target);
  const points: [number, number][] = [[target.x + s / 2, target.y + s / 2]];
  const n = s * SAMPLES_PER_SQUARE;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) points.push([target.x + (i + 0.5) / SAMPLES_PER_SQUARE, target.y + (j + 0.5) / SAMPLES_PER_SQUARE]);
  }
  return points;
}

/**
 * Line of sight and cover from `attacker` to `target` (CB p.104, Q2). `objects` are the map's objects; only those whose
 * sight mode is "cover" and that do not stand inside the attacker's or the target's footprint count as cover.
 */
export function lineOfSight(map: PreparedMap, attacker: Footprint, target: Footprint, objects: readonly VisionObject[] = []): SightResult {
  const sa = sizeOf(attacker);
  const ax = attacker.x + sa / 2;
  const ay = attacker.y + sa / 2;
  const covers = objects.filter((o) => sightOf(o) === "cover" && !inside(o, attacker) && !inside(o, target));
  let seen = false;
  for (const [px, py] of aimPoints(target)) {
    if (!los(map, ax, ay, px, py)) continue;
    seen = true;
    const covered = covers.some((o) => segmentDistance(o.x, o.y, ax, ay, px, py) <= coverRadius(o));
    if (!covered) return { lineOfSight: true, cover: false };
  }
  return { lineOfSight: seen, cover: seen };
}
