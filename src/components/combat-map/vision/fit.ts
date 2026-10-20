"use client";

import { useMemo } from "react";

import type { CombatMapSummary, CombatPageState } from "../slots";
import { exploredFrame, unionMask, type SquareRect } from "./fog";
import { okView, useFogMasks, useStoredExplored, useViewing } from "./use-vision";

/**
 * What a player's Fit frames (Q1), in stage squares (padding included): the squares their character has explored
 * or sees now, plus a margin. Null for the GM, and for a player with nothing explored yet (Fit then frames the
 * padded area). Never the map's own bounds. The queries are the ones the vision layer already holds.
 */
export function usePlayerFitArea(
  { campaignId, role }: Pick<CombatPageState, "campaignId" | "role">,
  map: CombatMapSummary,
  pad: number,
): SquareRect | null {
  const viewing = useViewing({ campaignId, role, mode: "play", map, previewCharacterId: null });
  const view = role === "player" ? okView(viewing) : null;
  const stored = useStoredExplored(campaignId, viewing);
  const masks = useFogMasks(view, stored.mask);
  return useMemo(() => {
    if (!masks) return null;
    const mask = unionMask(masks.explored, masks.seen);
    return mask ? exploredFrame(mask, masks.sw, masks.sh, masks.scale, pad) : null;
  }, [masks, pad]);
}
