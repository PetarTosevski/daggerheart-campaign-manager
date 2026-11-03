import { EncounterScreen } from "../../../../../src/features/adversaries";
import { DashboardScreen } from "../../../../../src/features/dashboard";
import { CampaignScreen, useCampaign } from "../../../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../../src/shell/route-error";

export default function EncounterRoute() {
  return (
    <CampaignScreen>
      <EncounterGate />
    </CampaignScreen>
  );
}

function EncounterGate() {
  const campaign = useCampaign();
  if (campaign.role !== "gm") return <DashboardScreen />;
  return <EncounterScreen />;
}
