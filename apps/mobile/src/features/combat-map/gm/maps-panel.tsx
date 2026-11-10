import { useMutation } from "convex/react";
import { Text, View } from "react-native";

import { api, type Id } from "../../../convex";
import { Button } from "../../../ui/button";
import { Panel, QueryLoading } from "../../dashboard/chrome";
import { useIntent } from "../../adversaries/intent";

import { useCombatGm } from "./context";
import { gmStyles } from "./styles";

/** The board's three sizes (convex/lib/combatMaps.ts MAP_SIZES), as on the empty GM screen (dcm-gdzi.18). */
const SIZES = [
  { key: "small" as const, label: "Small 22×15" },
  { key: "medium" as const, label: "Medium 30×20" },
  { key: "large" as const, label: "Large 40×27" },
];

export function CombatGmMaps() {
  const { campaignId, layout, maps } = useCombatGm();
  const create = useIntent(api.combatMaps.create);
  const setLive = useMutation(api.combatMaps.setLive);

  async function makeLive(mapId: Id<"combatMaps">) {
    if (layout._id === mapId && layout.live) return;
    await setLive({ campaignId, mapId });
  }

  return (
    <Panel title="Maps">
      <QueryLoading label="Loading maps" value={maps} />
      {maps === undefined ? null : (
        <>
          <Text style={gmStyles.muted}>
            Live map: {layout.name}
            {layout.live ? " · LIVE" : ""}
          </Text>
          <View style={gmStyles.row}>
            {SIZES.map((s) => (
              <Button disabled={create.pending} key={s.key} onPress={() => void create.fire({ campaignId, size: s.key })} variant="outline">
                {`New ${s.label}`}
              </Button>
            ))}
          </View>
          {maps.length === 0 ? (
            <Text style={gmStyles.muted}>No saved maps yet.</Text>
          ) : (
            maps.map((m) => (
              <View key={m._id} style={gmStyles.mapRow} testID={`combat-map-row-${m._id}`}>
                <Text style={gmStyles.chipText}>
                  {m.name} · {m.w}×{m.h}
                  {m.live ? " · LIVE" : ""}
                </Text>
                {!m.live ? (
                  <Button onPress={() => void makeLive(m._id)} variant="outline">
                    Make live
                  </Button>
                ) : null}
              </View>
            ))
          )}
        </>
      )}
    </Panel>
  );
}
