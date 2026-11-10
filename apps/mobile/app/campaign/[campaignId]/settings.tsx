import { CampaignSettingsScreen } from "../../../src/features/settings/campaign-settings";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function SettingsRoute() {
  return (
    <CampaignScreen>
      <CampaignSettingsScreen />
    </CampaignScreen>
  );
}
