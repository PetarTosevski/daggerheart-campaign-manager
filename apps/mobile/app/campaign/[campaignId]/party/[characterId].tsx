import { useLocalSearchParams, useRouter } from "expo-router";

import { CharacterSheet } from "../../../../src/features/sheet";
import { CampaignScreen, firstParam } from "../../../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

export default function CharacterRoute() {
  const params = useLocalSearchParams<{ characterId: string | string[] }>();
  const router = useRouter();
  const characterId = firstParam(params.characterId);
  return (
    <CampaignScreen>
      <CharacterSheet characterId={characterId} onClose={() => router.back()} />
    </CampaignScreen>
  );
}
