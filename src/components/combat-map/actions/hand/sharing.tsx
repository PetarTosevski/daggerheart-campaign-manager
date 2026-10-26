"use client";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Who sees whose hand (plan followups-7 H4, dcm-bxp.99.24; user answer 2026-10-22): "hiding hands = BOTH - a GM campaign
 * switch 'Players can see each other's cards' (on by default) and, when allowed, each player can hide their own hand.
 * The GM always sees every hand." `combatCards.handSharing` is the one subscription; the server decides in
 * `combatCards.hand` (FORBIDDEN for a hidden hand), this only keeps the client from asking.
 */

export type HandSharing = { playersSeeHands: boolean; hidden: readonly Id<"characters">[] };

/** Whether another player may read this character's hand. */
export function handShared(sharing: HandSharing, characterId: Id<"characters">): boolean {
  return sharing.playersSeeHands && !sharing.hidden.includes(characterId);
}

/** The campaign's hand sharing (undefined while loading). */
export function useHandSharing(campaignId: Id<"campaigns">): HandSharing | undefined {
  return useQuery(api.combatCards.handSharing, { campaignId });
}

/** The player's switch under their own Hand: "Hide my hand from the other players" (only while the GM allows sharing). */
export function HideHandSwitch({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> }) {
  const sharing = useHandSharing(campaignId);
  const setHidden = useMutation(api.combatCards.setHandHidden).withOptimisticUpdate((store, { characterId: id, hidden }) => {
    const current = store.getQuery(api.combatCards.handSharing, { campaignId });
    if (current === undefined) return;
    const rest = current.hidden.filter((c) => c !== id);
    store.setQuery(api.combatCards.handSharing, { campaignId }, { ...current, hidden: hidden ? [...rest, id] : rest });
  });
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  if (sharing === undefined || !sharing.playersSeeHands) return null;
  const hidden = sharing.hidden.includes(characterId);

  async function flip(on: boolean) {
    setError(null);
    try {
      await setHidden({ campaignId, characterId, hidden: on });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="cmh-share">
      <label className="cmh-switch" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={hidden} onChange={(e) => void flip(e.target.checked)} />
        <span className="cmh-switch-track" aria-hidden="true" />
        <span>Hide my hand from the other players</span>
      </label>
      <p aria-live="polite" className="cma-error">
        {error}
      </p>
    </div>
  );
}
