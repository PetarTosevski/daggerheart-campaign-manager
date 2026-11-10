import { PlayersScreen } from "../../../src/features/players";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function PlayersRoute() {
  return (
    <CampaignScreen>
      <PlayersScreen />
    </CampaignScreen>
  );
}
