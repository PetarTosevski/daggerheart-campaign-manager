// Plan finish-in-progress FP2 (rule switches WF, user 2026-11-10): the Encounter tab's destination pick for a "path"
// feature (Rampaging Fury, Trample: `featureAsk.pathMove`, `useFeature` `destination`). The Combat Map HUD's stat block
// does the same with its own square picker (hud/statblock/panel.tsx `startPath`); this is that logic for the classic
// panel, which picks the square on its live map pane (the classic `map-view/area-pick`). Pure; no React, no Convex calls.
//
// ```ts
// pathCrossed({ self, destination, tokens, instanceId: "i1", standing: ["i2"], anySide: false, skipUnconscious: true });
// // the character ids (and, for side "any", the standing adversaries' instance ids) the straight line crosses
// pathOutside(self, "close", { x: 9, y: 0 }, true);   // true: beyond Close range of the token
// ```

import { crossedBy } from "@/lib/domain/adversary-actions/path-targets";
import type { Range } from "@/lib/domain/card-effects/types";

import { outside, type Square } from "../../../combat-map/hud/pick-area/model";

/** A live-map token as the path pick reads it (`combatTokensReads.list`). */
export type PathToken = {
  _id: string;
  kind: string;
  characterId?: string;
  instanceId?: string;
  x: number;
  y: number;
  size: number;
  stats?: { conditions: readonly string[] } | null;
};

/**
 * Who starts targeted after the destination pick (the HUD's rule): the PCs whose squares the straight slide from the
 * token to `destination` crosses, and for side "any" also the other standing adversaries; unconscious PCs are left out
 * under C4 Book (CB p.106). Nearest first.
 */
export function pathCrossed({
  self,
  destination,
  tokens,
  instanceId,
  standing,
  anySide,
  skipUnconscious,
}: {
  self: PathToken;
  destination: Square;
  tokens: readonly PathToken[];
  instanceId: string;
  /** The encounter's adversaries still standing (instance ids). */
  standing: readonly string[];
  anySide: boolean;
  skipUnconscious: boolean;
}): string[] {
  const down = new Set<string>();
  const footprints = tokens.flatMap((t) => {
    if (t.kind === "pc" && t.characterId) {
      if (skipUnconscious && (t.stats?.conditions ?? []).some((c) => c.toLowerCase() === "unconscious")) down.add(t.characterId);
      return [{ id: t.characterId, x: t.x, y: t.y, size: t.size }];
    }
    if (anySide && t.instanceId && t.instanceId !== instanceId && standing.includes(t.instanceId)) return [{ id: t.instanceId, x: t.x, y: t.y, size: t.size }];
    return [];
  });
  return crossedBy(self, destination, footprints).filter((id) => !down.has(id));
}

/** Whether `square` is beyond the move's range of the token (the HUD picker's `outside`; never with Defined Ranges off). */
export function pathOutside(self: PathToken, within: Range, square: Square, definedRanges: boolean): boolean {
  return outside({ name: "", label: "", shape: "circle", count: 1, within, origin: self, definedRanges }, square);
}
