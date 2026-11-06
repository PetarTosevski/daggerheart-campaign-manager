import { Redirect, useLocalSearchParams } from "expo-router";

import { journalHref } from "../../../../src/features/journal/tabs";
import { firstParam } from "../../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

/** A session moved into the Journal (as on the website): /sessions/<id> opens it on the Journal's Sessions sub-tab. */
export default function SessionRoute() {
  const params = useLocalSearchParams<{ campaignId: string; sessionId: string }>();
  return <Redirect href={journalHref(firstParam(params.campaignId), "sessions", { s: firstParam(params.sessionId) })} />;
}
