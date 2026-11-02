import { NotesScreen } from "../../../src/features/notes";
import { CampaignScreen } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

export default function NotesRoute() {
  return (
    <CampaignScreen>
      <NotesScreen />
    </CampaignScreen>
  );
}
