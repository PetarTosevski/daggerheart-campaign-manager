import { AdversariesScreen } from "../../../../src/features/adversaries";
import { DashboardScreen } from "../../../../src/features/dashboard";
import { CampaignScreen, useCampaign } from "../../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function AdversariesRoute() {
  return (
    <CampaignScreen>
      <AdversariesGate />
    </CampaignScreen>
  );
}

function AdversariesGate() {
  const campaign = useCampaign();
  if (campaign.role !== "gm") return <DashboardScreen />;
  return <AdversariesScreen />;
}
