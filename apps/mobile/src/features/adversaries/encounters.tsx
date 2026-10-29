import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { api, type Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";

import { ErrorLine, Notice, SlotBoundary } from "./controls";
import { EncounterDetail } from "./detail";
import { useIntent } from "./intent";
import { advStyles } from "./styles";
import { Tracker } from "./tracker";
import { STATUS_LABEL, type EncounterList, type EncounterSummary } from "./types";

const MAX_PCS = 12;

function EncounterItem({ encounter, current, onPick }: { encounter: EncounterSummary; current: boolean; onPick: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: current }}
      onPress={onPick}
      style={[advStyles.listRow, current ? advStyles.listRowOn : null]}
    >
      <View style={advStyles.grow}>
        <Text style={advStyles.rowName}>{encounter.name}</Text>
        <Text style={advStyles.muted}>
          {encounter.pcs} {encounter.pcs === 1 ? "player character" : "player characters"}
        </Text>
      </View>
      <View style={advStyles.badge}>
        <Text style={advStyles.badgeText}>{STATUS_LABEL[encounter.status]}</Text>
      </View>
    </Pressable>
  );
}

/** The selected encounter: builder detail, then the tracker when it is running. One `encounters.get` for both. */
function SelectedEncounter({
  campaignId,
  encounterId,
  encounters,
  fear,
  onDeleted,
}: {
  campaignId: Id<"campaigns">;
  encounterId: string;
  encounters: EncounterList;
  fear: number | undefined;
  onDeleted: () => void;
}) {
  const campaign = useCampaign();
  const router = useRouter();
  const view = useQuery(api.encounters.get, { campaignId, encounterId });
  if (view === undefined) return <Loading label="Loading the encounter" />;
  if (view === null) return <Notice title="Encounter">That encounter no longer exists. Pick another one.</Notice>;
  return (
    <View style={advStyles.section}>
      <EncounterDetail
        campaignId={campaignId}
        encounters={encounters}
        key={view.encounter._id}
        onDeleted={onDeleted}
        onOpenTracker={() => router.push(`/campaign/${campaignId}/adversaries/${view.encounter._id}`)}
        view={view}
      />
      {view.encounter.status === "running" ? (
        fear === undefined ? (
          <Loading label="Loading Fear" />
        ) : (
          <SlotBoundary label="The encounter tracker">
            <Tracker campaignId={campaignId} fear={fear} partyTier={campaign.tier} view={view} />
          </SlotBoundary>
        )
      ) : (
        <Notice title="Encounter tracker">
          {view.encounter.status === "draft"
            ? "This encounter is a draft. Start it to track HP, Stress, conditions and the spotlight."
            : "This encounter has ended. Start it again to keep tracking it."}
        </Notice>
      )}
    </View>
  );
}

/**
 * The Encounters tab (D8 A3/A4): "+ New encounter" (party size from the active characters), the running and draft
 * encounters, then ended ones 20 at a time, and the selected encounter's builder with its tracker inline.
 */
export function EncountersTab({
  campaignId,
  encounters,
  onMoreEnded,
}: {
  campaignId: Id<"campaigns">;
  encounters: EncounterList;
  onMoreEnded: () => void;
}) {
  const writes = useWritesEnabled();
  const party = useQuery(api.charactersReads.listByCampaign, { campaignId });
  const fear = useQuery(api.campaigns.fear, { campaignId });
  const create = useIntent(api.encounters.create);
  const [selected, setSelected] = useState<string | null>(null);
  const known = [...encounters.active, ...encounters.ended].some((e) => e._id === selected);
  const current = (known ? selected : null) ?? encounters.active[0]?._id ?? null;
  const activePcs = party?.filter((c) => c.status === "active").length ?? 0;

  async function newEncounter() {
    const created = await create.fire({ campaignId, name: "New encounter", ...(activePcs > 0 ? { pcs: Math.min(MAX_PCS, activePcs) } : {}) });
    if (created) setSelected(created.encounterId);
  }

  return (
    <View style={advStyles.section}>
      <Button
        accessibilityLabel="New encounter"
        disabled={!writes || create.pending || party === undefined}
        onPress={() => void newEncounter()}
        variant="solid"
      >
        + New encounter
      </Button>
      <ErrorLine message={create.error} />
      <Text style={advStyles.label}>Encounters</Text>
      {encounters.active.length === 0 ? <Text style={advStyles.muted}>No encounters yet. Create one to start building a fight.</Text> : null}
      {encounters.active.map((e) => (
        <EncounterItem current={e._id === current} encounter={e} key={e._id} onPick={() => setSelected(e._id)} />
      ))}
      {encounters.ended.length > 0 ? <Text style={advStyles.label}>Ended</Text> : null}
      {encounters.ended.map((e) => (
        <EncounterItem current={e._id === current} encounter={e} key={e._id} onPick={() => setSelected(e._id)} />
      ))}
      {encounters.moreEnded ? (
        <Button onPress={onMoreEnded} variant="outline">
          Show more ended encounters
        </Button>
      ) : null}
      {current === null ? (
        <Notice title="No encounter selected">
          Create an encounter, then add adversaries here or from a stat block in the Catalogue. The Battle Points budget shows how hard the fight is for
          your party.
        </Notice>
      ) : (
        <SlotBoundary label="Encounter">
          <SelectedEncounter
            campaignId={campaignId}
            encounterId={current}
            encounters={encounters}
            fear={fear}
            key={current}
            onDeleted={() => setSelected(null)}
          />
        </SlotBoundary>
      )}
    </View>
  );
}
