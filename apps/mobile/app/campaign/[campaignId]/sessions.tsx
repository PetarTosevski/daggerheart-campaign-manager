import { Redirect, useLocalSearchParams } from "expo-router";

import { journalHref } from "../../../src/features/journal/tabs";
import { firstParam } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

/** Sessions moved into the Journal (JX1, as on the website): /sessions opens the Journal's Sessions sub-tab. */
export default function SessionsRoute() {
  const params = useLocalSearchParams<{ campaignId: string }>();
  return <Redirect href={journalHref(firstParam(params.campaignId), "sessions")} />;
}
