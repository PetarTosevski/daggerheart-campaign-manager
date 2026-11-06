import { Redirect, useLocalSearchParams } from "expo-router";

import { journalHref } from "../../../../src/features/journal/tabs";
import { firstParam } from "../../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

/** A notes page moved into the Journal (as on the website): /notes/<id> opens it on the Journal's Notes sub-tab. */
export default function NotePageRoute() {
  const params = useLocalSearchParams<{ campaignId: string; pageId: string }>();
  return <Redirect href={journalHref(firstParam(params.campaignId), "notes", { page: firstParam(params.pageId) })} />;
}
