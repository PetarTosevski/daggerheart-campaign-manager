import { CodexScreen } from "../../../src/features/codex";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function CodexRoute() {
  return (
    <CampaignScreen>
      <CodexScreen />
    </CampaignScreen>
  );
}
