import { useLocalSearchParams, useRouter } from "expo-router";

import { JournalScreen, type JournalNavigate, type JournalParams } from "../../../src/features/journal";
import { CampaignScreen, firstParam } from "../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../src/shell/route-error";

const PARAMS = ["tab", "s", "sv", "view", "page"] as const;

/**
 * Journal: `?tab=sessions|notes` (Sessions by default), `&s=<session id>`, `&sv=plan|log`, and the Notes params `view`
 * and `page`, as on the website. The screen asks for changes; the route writes them into the URL.
 */
export default function JournalRoute() {
  const raw = useLocalSearchParams<Partial<Record<(typeof PARAMS)[number], string | string[]>>>();
  const router = useRouter();
  const params: JournalParams = {};
  for (const name of PARAMS) {
    const value = firstParam(raw[name]);
    if (value !== "") params[name] = value;
  }
  const navigate: JournalNavigate = (next) => {
    const update: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(next)) if (value !== undefined) update[name] = value ?? undefined;
    router.setParams(update);
  };
  return (
    <CampaignScreen>
      <JournalScreen onNavigate={navigate} params={params} />
    </CampaignScreen>
  );
}
