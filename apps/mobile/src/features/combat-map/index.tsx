import { useQuery } from "convex/react";

import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { sectionLabel } from "../../shell/sections";
import { Loading } from "../../ui/loading";
import { QueryBoundary } from "../sheet/query-boundary";

import { CombatBoard } from "./board";

export function CombatMapScreen() {
  return (
    <QueryBoundary>
      <CombatBody />
    </QueryBoundary>
  );
}

function CombatBody() {
  const campaign = useCampaign();
  const layout = useQuery(api.combatMaps.live, { campaignId: campaign._id });
  const view = useQuery(api.combatVision.playerView, { campaignId: campaign._id });

  if (layout === undefined || view === undefined) {
    return <Loading label={`Loading ${sectionLabel("combat-map").toLowerCase()}`} />;
  }

  return <CombatBoard layout={layout} view={view} />;
}
