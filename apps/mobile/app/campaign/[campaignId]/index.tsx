import { DashboardScreen } from "../../../src/features/dashboard";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function DashboardRoute() {
  return (
    <CampaignScreen>
      <DashboardScreen />
    </CampaignScreen>
  );
}
