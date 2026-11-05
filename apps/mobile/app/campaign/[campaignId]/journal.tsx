import { useLocalSearchParams, useRouter } from "expo-router";

import { JournalScreen, parseJournalTab } from "../../../src/features/journal";
import { CampaignScreen, firstParam } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

/** Journal: `?tab=sessions|notes` picks the sub-tab (Sessions by default), as on the website. */
export default function JournalRoute() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const router = useRouter();
  const tab = parseJournalTab(firstParam(params.tab));
  return (
    <CampaignScreen>
      <JournalScreen onTab={(next) => router.setParams({ tab: next })} tab={tab} />
    </CampaignScreen>
  );
}
