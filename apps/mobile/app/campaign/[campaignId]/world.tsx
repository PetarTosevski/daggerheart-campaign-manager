import { WorldScreen } from "../../../src/features/world";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function WorldRoute() {
  return (
    <CampaignScreen>
      <WorldScreen />
    </CampaignScreen>
  );
}
