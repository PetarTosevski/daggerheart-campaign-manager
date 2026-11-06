import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useCampaign } from "../../shell/campaign-provider";
import { sectionLabel } from "../../shell/sections";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";

import type { CombatMapLayout, CombatPlayerView } from "./contract";
import { CombatEditSlot } from "./edit";
import { EmptyGmMaps } from "./gm/empty-maps";
import { CombatGmSlot } from "./gm";
import { CombatHudBar } from "./hud-bar";
import { GmLiveMap, PlayerLiveMap } from "./live-map";
import { CombatPlaySlot } from "./play";

export function CombatBoard({
  layout,
  view,
}: {
  layout: CombatMapLayout | null;
  view: CombatPlayerView | undefined;
}) {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  const player = !isGm;
  const campaignId = campaign._id;

  if (layout === null || view === undefined) {
    return (
      <ScrollView contentContainerStyle={styles.stack}>
        <Text style={styles.eyebrow}>{sectionLabel("combat-map")}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {campaign.name}
        </Text>
        {layout === null && player ? (
          <Text style={styles.empty}>The GM has not shown a map yet.</Text>
        ) : layout !== null ? (
          <Text style={styles.empty}>Loading the battlefield…</Text>
        ) : (
          <EmptyGmMaps />
        )}
      </ScrollView>
    );
  }

  const slotProps = { campaignId: campaign._id, isGm, layout, view };

  return (
    <View style={styles.screen}>
      <CombatHudBar campaignId={campaignId} mapId={layout._id} />
      <View style={styles.map}>
        {/* Keyed by the map's id (identity, not live content): a new live map mounts a fresh view and is fitted. */}
        {isGm ? (
          <GmLiveMap campaignId={campaignId} key={layout._id} layout={layout} />
        ) : (
          <PlayerLiveMap campaignId={campaignId} key={layout._id} layout={layout} view={view} />
        )}
      </View>
      {/* The dock scrolls inside at most 45% of the screen, so open panels never squeeze the map to nothing. */}
      <ScrollView
        contentContainerStyle={styles.dockContent}
        keyboardShouldPersistTaps="handled"
        style={styles.dock}
        testID="combat-dock"
      >
        {isGm ? <CombatGmSlot {...slotProps} /> : <CombatPlaySlot {...slotProps} />}
        <CombatEditSlot {...slotProps} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.ink,
    flex: 1,
  },
  stack: {
    gap: space[3],
    padding: space[4],
    paddingBottom: space[8],
  },
  eyebrow: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: colors.body,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  empty: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    paddingVertical: space[6],
  },
  map: {
    flex: 1,
    minHeight: 240,
  },
  dock: {
    backgroundColor: colors.panel,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexGrow: 0,
    maxHeight: "45%",
  },
  dockContent: {
    gap: space[2],
    padding: space[3],
  },
});
