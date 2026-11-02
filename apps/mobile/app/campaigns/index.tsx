import { CampaignListScreen } from "../../src/features/account/campaign-list";

export { RouteErrorBoundary as ErrorBoundary } from "../../src/shell/route-error";

export default function CampaignsRoute() {
  return <CampaignListScreen />;
}
