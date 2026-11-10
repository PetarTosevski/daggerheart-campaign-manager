import { Redirect, useLocalSearchParams } from "expo-router";

import { journalHref } from "../../../src/features/journal/tabs";
import { firstParam } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

/** Notes moved into the Journal (JX1, as on the website): /notes opens the Journal's Notes sub-tab. */
export default function NotesRoute() {
  const params = useLocalSearchParams<{ campaignId: string }>();
  return <Redirect href={journalHref(firstParam(params.campaignId), "notes")} />;
}
