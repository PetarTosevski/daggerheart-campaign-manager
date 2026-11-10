import { useLocalSearchParams } from "expo-router";

import { CharacterWizard } from "../../../../src/features/party/create/wizard";
import { CampaignProvider, CampaignScreen, firstParam } from "../../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function NewCharacterRoute() {
  const params = useLocalSearchParams<{ campaignId?: string | string[] }>();
  const campaignId = firstParam(params.campaignId);
  return (
    <CampaignProvider campaignId={campaignId}>
      <CampaignScreen>
        <CharacterWizard />
      </CampaignScreen>
    </CampaignProvider>
  );
}
