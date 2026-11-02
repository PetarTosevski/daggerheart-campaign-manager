import { DashboardScreen } from "../../../../../src/features/dashboard";
import { CampaignScreen, useCampaign } from "../../../../../src/shell/campaign-provider";
import { NotBuiltYet } from "../../../../../src/shell/not-built-yet";

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
  return <NotBuiltYet title="Encounter" />;
}
