import { useQuery } from "convex/react";

import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { NotBuiltYet } from "../../shell/not-built-yet";
import { sectionLabel } from "../../shell/sections";

/**
 * GM encounters list. The route renders this only after `campaigns.get` says
 * the caller is the GM, so a player never subscribes.
 */
export function AdversariesScreen() {
  const campaign = useCampaign();
  useQuery(api.encounters.list, { campaignId: campaign._id });
  return <NotBuiltYet title={sectionLabel("adversaries")} />;
}
