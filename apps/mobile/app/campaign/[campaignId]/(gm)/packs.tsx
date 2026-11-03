import { DashboardScreen } from "../../../../src/features/dashboard";
import { PacksScreen } from "../../../../src/features/packs";
import { CampaignScreen, useCampaign } from "../../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function PacksRoute() {
  return (
    <CampaignScreen>
      <PacksGate />
    </CampaignScreen>
  );
}

function PacksGate() {
  const campaign = useCampaign();
  if (campaign.role !== "gm") return <DashboardScreen />;
  return <PacksScreen />;
}
