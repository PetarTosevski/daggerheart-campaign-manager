import { useLocalSearchParams } from "expo-router";

import { NotesScreen } from "../../../../src/features/notes";
import { CampaignScreen, firstParam } from "../../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function NotePageRoute() {
  const params = useLocalSearchParams<{ pageId: string }>();
  const pageId = firstParam(params.pageId);
  return (
    <CampaignScreen>
      <NotesScreen initialPageId={pageId.length > 0 ? pageId : null} />
    </CampaignScreen>
  );
}
