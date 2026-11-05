import { SessionsScreen } from "../../../src/features/sessions";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function SessionsRoute() {
  return (
    <CampaignScreen>
      <SessionsScreen />
    </CampaignScreen>
  );
}
