import { useMutation, useQuery } from "convex/react";
import { Text, View } from "react-native";

import { api, type Id } from "../../../convex";
import { useCampaign } from "../../../shell/campaign-provider";
import { Button } from "../../../ui/button";
import { useIntent } from "../../adversaries/intent";

import { asCampaignId } from "./campaign-id";
import { gmStyles } from "./styles";

const SIZES = [
  { key: "small" as const, label: "Small" },
  { key: "medium" as const, label: "Medium" },
  { key: "large" as const, label: "Large" },
];

/** A GM with nothing live can create a blank map or publish one they already saved. */
export function EmptyGmMaps() {
  const campaign = useCampaign();
  const campaignId = asCampaignId(campaign._id);
  const maps = useQuery(api.combatMaps.list, { campaignId });
  const create = useIntent(api.combatMaps.create);
  const setLive = useMutation(api.combatMaps.setLive);

  async function makeLive(mapId: Id<"combatMaps">) {
    await setLive({ campaignId, mapId });
  }

  return (
    <View style={gmStyles.stack} testID="combat-empty-gm">
      <Text style={gmStyles.muted}>No battlefield is live. Start a blank map, or show one you already saved.</Text>
      <View style={gmStyles.row}>
        {SIZES.map((size) => (
          <Button
            disabled={create.pending}
            key={size.key}
            onPress={() => void create.fire({ campaignId, size: size.key })}
            variant="outline"
          >
            {`New ${size.label} map`}
          </Button>
        ))}
      </View>
      {create.error ? <Text style={gmStyles.muted}>{create.error}</Text> : null}
      {maps === undefined ? (
        <Text style={gmStyles.muted}>Loading saved maps…</Text>
      ) : maps.length === 0 ? (
        <Text style={gmStyles.muted}>No saved maps yet.</Text>
      ) : (
        maps.map((map) => (
          <View key={map._id} style={gmStyles.row}>
            <Text style={gmStyles.chipText}>
              {map.name} · {map.w}×{map.h}
            </Text>
            <Button onPress={() => void makeLive(map._id)} variant="solid">
              Make live
            </Button>
          </View>
        ))
      )}
    </View>
  );
}
