import { CampaignScreen } from "../../../../src/shell/campaign-provider";
import { CodexEntryRoute } from "../../../../src/features/codex";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function CodexEntryPage() {
  return (
    <CampaignScreen>
      <CodexEntryRoute />
    </CampaignScreen>
  );
}
