import { useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text } from "react-native";

import { api } from "../../convex";
import { firstParam, useCampaign } from "../../shell/campaign-provider";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";

import { ErrorLine, Notice } from "./controls";
import { useAct } from "./intent";
import { advStyles } from "./styles";
import { Tracker } from "./tracker";

/**
 * One encounter's tracker, full screen (`/campaign/<id>/adversaries/<encounterId>`). GM only: the route gates on
 * the campaign role before this mounts. A draft or ended encounter offers Start.
 */
export function EncounterView() {
  const campaign = useCampaign();
  const campaignId = campaign._id;
  const router = useRouter();
  const writes = useWritesEnabled();
  const params = useLocalSearchParams<{ encounterId: string | string[] }>();
  const encounterId = firstParam(params.encounterId);
  const view = useQuery(api.encounters.get, encounterId ? { campaignId, encounterId } : "skip");
  const fear = useQuery(api.campaigns.fear, { campaignId });
  const start = useAct(api.encounters.start);

  const back = (
    <Button onPress={() => router.push(`/campaign/${campaignId}/adversaries`)} variant="outline">
      ‹ Adversaries
    </Button>
  );

  if (!encounterId) {
    return (
      <ScrollView contentContainerStyle={advStyles.stack}>
        {back}
        <Notice title="Encounter">No encounter was named.</Notice>
      </ScrollView>
    );
  }
  if (view === undefined || fear === undefined) return <Loading label="Loading the encounter" />;
  if (view === null) {
    return (
      <ScrollView contentContainerStyle={advStyles.stack}>
        {back}
        <Notice title="Encounter">That encounter no longer exists.</Notice>
      </ScrollView>
    );
  }
  const running = view.encounter.status === "running";
  return (
    <ScrollView contentContainerStyle={advStyles.stack} keyboardShouldPersistTaps="handled">
      {back}
      {running ? (
        <Tracker campaignId={campaignId} fear={fear} partyTier={campaign.tier} view={view} />
      ) : (
        <Notice title={view.encounter.name}>
          <Text style={advStyles.body}>
            {view.encounter.status === "draft"
              ? "This encounter is a draft. Start it to track HP, Stress, conditions and the spotlight."
              : "This encounter has ended. Start it again to keep tracking it."}
          </Text>
          <Button disabled={!writes || start.pending} onPress={() => void start.act({ campaignId, encounterId })} variant="solid">
            {view.encounter.status === "ended" ? "Start again" : "Start encounter"}
          </Button>
          <ErrorLine message={start.error} />
        </Notice>
      )}
    </ScrollView>
  );
}
