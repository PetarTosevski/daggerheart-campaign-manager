"use client";

import { capRangeRings } from "@/lib/config/preferences";
import { useUiState } from "@/lib/use-ui-state";

/**
 * Range circles per token (R3): which tokens show their Melee / Very Close / Close / Far rings. Each viewer's own
 * choice, stored on their account (plan config U6e, Q15 b: `uiState` key `rangeRings`), so the GM and each player
 * switch their own and it follows them to every device. None while the account's state loads.
 * At most `RANGE_RINGS_MAX` (50) tokens are remembered; the oldest drop first (`capRangeRings`).
 */

export type Rings = {
  /** Whether this token shows its range circles. */
  on: (tokenId: string) => boolean;
  toggle: (tokenId: string) => void;
  /** Switches every token's circles off ("Hide all circles"). */
  hideAll: (tokenIds: readonly string[]) => void;
};

/** The list after toggling `tokenId`: removed if it was on, else added as the newest (capped). */
export function toggledRings(current: readonly string[], tokenId: string): string[] {
  return current.includes(tokenId) ? current.filter((id) => id !== tokenId) : capRangeRings([...current, tokenId]);
}

export function useRings(): Rings {
  const [list, setList] = useUiState("rangeRings");
  const ids = new Set(list);
  return {
    on: (tokenId) => ids.has(tokenId),
    toggle: (tokenId) => setList(toggledRings(list, tokenId)),
    hideAll: (tokenIds) => {
      const off = new Set(tokenIds);
      const next = list.filter((id) => !off.has(id));
      if (next.length !== list.length) setList(next);
    },
  };
}
