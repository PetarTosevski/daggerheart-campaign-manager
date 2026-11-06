import { CombatMapScreen } from "../../../src/features/combat-map";
import { CampaignScreen } from "../../../src/shell/campaign-provider";
import { PhoneCombatMapGate } from "../../../src/shell/combat-map-gate";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function CombatMapRoute() {
  return (
    <CampaignScreen>
      <PhoneCombatMapGate>
        <CombatMapScreen />
      </PhoneCombatMapGate>
    </CampaignScreen>
  );
}
