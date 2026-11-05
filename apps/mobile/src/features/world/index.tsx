import { useQuery } from "convex/react";

import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { sectionLabel } from "../../shell/sections";
import { Loading } from "../../ui/loading";
import { QueryBoundary } from "../sheet/query-boundary";
import { WorldBoard } from "./board";

export function WorldScreen() {
  return (
    <QueryBoundary>
      <WorldBody />
    </QueryBoundary>
  );
}

function WorldBody() {
  const campaign = useCampaign();
  const data = useQuery(api.maps.get, { campaignId: campaign._id });
  if (data === undefined) return <Loading label={`Unrolling ${sectionLabel("world").toLowerCase()}`} />;
  return <WorldBoard campaignName={campaign.name} data={data} />;
}
