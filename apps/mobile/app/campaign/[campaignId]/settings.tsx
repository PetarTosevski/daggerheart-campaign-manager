import { SettingsScreen } from "../../../src/features/settings";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function SettingsRoute() {
  return (
    <CampaignScreen>
      <SettingsScreen />
    </CampaignScreen>
  );
}
