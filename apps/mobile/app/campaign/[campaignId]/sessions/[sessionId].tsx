import { CampaignScreen } from "../../../../src/shell/campaign-provider";
import { NotBuiltYet } from "../../../../src/shell/not-built-yet";
import { sectionLabel } from "../../../../src/shell/sections";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function SessionRoute() {
  return (
    <CampaignScreen>
      <NotBuiltYet title={sectionLabel("sessions")} />
    </CampaignScreen>
  );
}
