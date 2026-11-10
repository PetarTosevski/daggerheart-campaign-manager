import { DashboardScreen } from "../../../src/features/dashboard";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

/** The campaign's banners (archived, owner view, read-only mode) are the campaign layout's, on every page (src/shell/read-only.tsx). */
export default function DashboardRoute() {
  return (
    <CampaignScreen>
      <DashboardScreen />
    </CampaignScreen>
  );
}
