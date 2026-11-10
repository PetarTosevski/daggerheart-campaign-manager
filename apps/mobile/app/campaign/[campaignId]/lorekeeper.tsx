import { LorekeeperScreen } from "../../../src/features/lorekeeper";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function LorekeeperRoute() {
  return (
    <CampaignScreen>
      <LorekeeperScreen />
    </CampaignScreen>
  );
}
