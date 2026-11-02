import { CombatMapScreen } from "../../../src/features/combat-map";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function CombatMapRoute() {
  return (
    <CampaignScreen>
      <CombatMapScreen />
    </CampaignScreen>
  );
}
