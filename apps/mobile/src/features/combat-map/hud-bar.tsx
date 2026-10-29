import { useQuery } from "convex/react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { api, type Id } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";

/** Party banners and Fear for the live map. Same reads as the website phone strip. */
export function CombatHudBar({ campaignId, mapId }: { campaignId: Id<"campaigns">; mapId: string }) {
  const party = useQuery(api.combatHud.party, { campaignId, mapId });
  const scene = useQuery(api.combatHud.scene, { campaignId });

  return (
    <View style={styles.bar} testID="combat-hud-bar">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.party}>
        {party === undefined ? (
          <Text style={styles.muted}>Loading the party…</Text>
        ) : party.length === 0 ? (
          <Text style={styles.muted}>No heroes on this map.</Text>
        ) : (
          party.map((member) => {
            const left = Math.max(0, member.hp.max - member.hp.marked);
            return (
              <View
                accessibilityLabel={`${member.name}, ${left} hit points left${member.mine ? ", yours" : ""}`}
                key={member.characterId}
                style={[styles.banner, member.mine && styles.mine]}
              >
                <Text numberOfLines={1} style={styles.name}>
                  {member.name}
                </Text>
                <Text style={styles.hp}>{left}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
      <View accessibilityLabel={scene ? `GM Fear ${scene.fear}` : "GM Fear"} style={styles.fear}>
        <Text style={styles.fearLabel}>Fear</Text>
        <Text style={styles.fearValue}>{scene === undefined ? "…" : scene.fear}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: colors.panel,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: space[2],
    paddingHorizontal: space[2],
    paddingVertical: space[2],
  },
  party: {
    alignItems: "center",
    gap: space[2],
    paddingRight: space[2],
  },
  muted: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  banner: {
    backgroundColor: colors.ink2,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 120,
    minWidth: 72,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  mine: {
    borderColor: colors.brand,
  },
  name: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
  },
  hp: {
    color: colors.hope,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
    fontWeight: type.displayBold.fontWeight,
  },
  fear: {
    alignItems: "center",
    backgroundColor: colors.fearBg,
    borderRadius: 8,
    minWidth: 56,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
  },
  fearLabel: {
    color: colors.fear,
    fontFamily: type.sans.fontFamily,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  fearValue: {
    color: colors.fear,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
});
