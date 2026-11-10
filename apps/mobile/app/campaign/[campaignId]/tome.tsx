import { TomeScreen } from "../../../src/features/tome";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function TomeRoute() {
  return (
    <CampaignScreen>
      <TomeScreen />
    </CampaignScreen>
  );
}
