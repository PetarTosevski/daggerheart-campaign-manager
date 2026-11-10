// dcm-y3mf: who names the creatures of an adversary feature's "all targets" list. Pure; relative imports only (bundled
// into Convex and the client).
//
// ```ts
// namedByGm({ count: { kind: "all" }, area: "front", ... });     // true: "all targets in front of the Ogre" (Hail of Boulders)
// fillsFromMap({ count: { kind: "all" }, range: "close", ... });  // true: every target within Close, read off the map
// areaWords("front", "far", "the Cave Ogre");                     // "in front of the Cave Ogre within Far range"
// ```

import type { TargetSpec } from "../card-effects/types";

type Spec = Pick<TargetSpec, "count" | "area" | "side" | "range">;
type Area = NonNullable<TargetSpec["area"]>;

/**
 * An "all targets" list whose shape the map can't measure: in front of the adversary (it has no facing the GM set), its
 * path (Rampaging Fury, Trample: where it moves is the GM's), a line, between it and a target, or around a point or a
 * target it doesn't name. The GM names the creatures; the server never guesses them.
 */
export function namedByGm(spec: Pick<Spec, "count" | "area">): boolean {
  return spec.count.kind === "all" && spec.area !== undefined && spec.area !== "aroundSelf";
}

/** "All targets within Close range" (around the adversary): with none named, every creature in range on the live map. */
export function fillsFromMap(spec: Spec): boolean {
  return spec.count.kind === "all" && (spec.area === undefined || spec.area === "aroundSelf") && (spec.side === "enemy" || spec.side === "any") && spec.range !== "weapon";
}

const RANGE_WORDS: Record<string, string> = { melee: "Melee", veryClose: "Very Close", close: "Close", far: "Far", veryFar: "Very Far" };

/** The area as the stat block says it, for the GM's picker and notes ("in front of the Ogre within Far range"). */
export function areaWords(area: Area | string | undefined, range: string, who: string): string {
  const within = RANGE_WORDS[range] ? ` within ${RANGE_WORDS[range]} range` : "";
  switch (area) {
    case "front":
      return `in front of ${who}${within}`;
    case "path":
      return `in ${who}’s path`;
    case "line":
      return `in a line from ${who}${within}`;
    case "between":
      return `between ${who} and the target`;
    case "aroundPoint":
      return `around a point${within}`;
    case "aroundTarget":
      return `around the target${within}`;
    default:
      return within ? within.trim() : "in range";
  }
}
