import { CampaignScreen } from "../../../../src/shell/campaign-provider";
import { SessionDetailRoute } from "../../../../src/features/sessions";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function SessionRoute() {
  return (
    <CampaignScreen>
      <SessionDetailRoute />
    </CampaignScreen>
  );
}
