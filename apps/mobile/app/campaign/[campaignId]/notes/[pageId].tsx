import { CampaignScreen } from "../../../../src/shell/campaign-provider";
import { NotBuiltYet } from "../../../../src/shell/not-built-yet";
import { sectionLabel } from "../../../../src/shell/sections";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function NotePageRoute() {
  return (
    <CampaignScreen>
      <NotBuiltYet title={sectionLabel("notes")} />
    </CampaignScreen>
  );
}
