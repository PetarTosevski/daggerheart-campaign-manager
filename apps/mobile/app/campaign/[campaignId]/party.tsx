import { PartyScreen } from "../../../src/features/party";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function PartyRoute() {
  return (
    <CampaignScreen>
      <PartyScreen />
    </CampaignScreen>
  );
}
