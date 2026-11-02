import type { ReactNode } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { FearSpotlightTag } from "../spotlight";

/** The Fear banner's SPOTLIGHT tag (Main 'GM's turn' `.fb-spot`), from hud/spotlight (H1.S). */
export function FearSpotlightSlot({ campaignId }: { campaignId: Id<"campaigns">; gm: boolean }): ReactNode {
  return <FearSpotlightTag campaignId={campaignId} />;
}
