import { CampaignScreen } from "../../../../src/shell/campaign-provider";
import { NotBuiltYet } from "../../../../src/shell/not-built-yet";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function CharacterRoute() {
  return (
    <CampaignScreen>
      <NotBuiltYet title="Character" />
    </CampaignScreen>
  );
}
