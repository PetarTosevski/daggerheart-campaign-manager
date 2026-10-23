"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useHandSharing } from "../actions/hand/sharing";

/**
 * The GM's campaign switch "Players can see each other's cards" (plan followups-7 H4, dcm-bxp.99.24; on by default). Off:
 * a player selecting another player's token sees no cards; on: they see that hand read only, unless its player hid it.
 * The GM always sees every hand. Mounted in the GM column (Play) above the selected PC's Hand.
 */
export function HandSharingSwitch({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const sharing = useHandSharing(campaignId);
  const set = useMutation(api.campaigns.setPlayersSeeHands).withOptimisticUpdate((store, { enabled }) => {
    const current = store.getQuery(api.combatCards.handSharing, { campaignId });
    if (current !== undefined) store.setQuery(api.combatCards.handSharing, { campaignId }, { ...current, playersSeeHands: enabled });
  });
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  if (sharing === undefined) return null;

  async function flip(enabled: boolean) {
    setError(null);
    try {
      await set({ campaignId, enabled });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section className="cm-card cma-card" aria-label="Hands" data-testid="combat-hand-sharing">
      <label className="cmh-switch" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={sharing.playersSeeHands} onChange={(e) => void flip(e.target.checked)} />
        <span className="cmh-switch-track" aria-hidden="true" />
        <span>Players can see each other&apos;s cards</span>
      </label>
      <p className="cm-muted cma-small cma-note">
        {sharing.playersSeeHands ? "Each player can still hide their own hand. You always see every hand." : "Players see only their own hand. You always see every hand."}
      </p>
      <p aria-live="polite" className="cma-error">
        {error}
      </p>
    </section>
  );
}
