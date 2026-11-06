import { useQuery } from "convex/react";
import { StyleSheet, Text, View } from "react-native";

import { api } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { sectionLabel } from "../../shell/sections";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Loading } from "../../ui/loading";
import { QueryBoundary } from "../../ui/query-boundary";

import { CombatBoard } from "./board";
import type { CombatPlayerView } from "./contract";
import { combatMapEnabled } from "./flag";

export function CombatMapScreen() {
  if (!combatMapEnabled()) return <CombatMapOff />;
  return (
    <QueryBoundary>
      <CombatBody />
    </QueryBoundary>
  );
}

function CombatBody() {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  const layout = useQuery(api.combatMaps.live, { campaignId: campaign._id });
  // The GM sees every token (combatTokensReads.list in the board), never a character's view (the website's `gm` viewing).
  const playerView = useQuery(api.combatVision.playerView, isGm ? "skip" : { campaignId: campaign._id });

  if (layout === undefined || (!isGm && playerView === undefined)) {
    return <Loading label={`Loading ${sectionLabel("combat-map").toLowerCase()}`} />;
  }

  const view: CombatPlayerView | undefined = isGm ? (layout === null ? { state: "noMap" } : { state: "noCharacter", mapId: layout._id }) : playerView;
  return <CombatBoard layout={layout} view={view} />;
}

function CombatMapOff() {
  return (
    <View style={styles.off} testID="combat-map-off">
      <Text style={styles.offText}>The combat map is not on the phone yet. Open it on the website.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  off: {
    backgroundColor: colors.ink,
    flex: 1,
    padding: space[4],
  },
  offText: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
});
