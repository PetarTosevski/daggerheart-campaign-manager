import type { ReactNode } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The Fear banner's SPOTLIGHT tag slot (plan combat-hud H1.2; Main 'GM's turn' `.fb-spot`). H1.S builds the tag in
 * `hud/spotlight/**` in the same wave; until it is merged this renders nothing. Merge-time action (orchestrator):
 * return H1.S's Fear banner tag here, e.g. `<FearSpotlightTag campaignId={campaignId} gm={gm} />` (its GM hand-back
 * lives in the tag too). The banner keeps this one mount point under the pips and − / +.
 */
export function FearSpotlightSlot(props: { campaignId: Id<"campaigns">; gm: boolean }): ReactNode {
  void props;
  return null;
}
