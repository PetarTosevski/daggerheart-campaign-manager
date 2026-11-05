import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Id } from "../../../convex";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";

import type { CombatSlotProps } from "../contract";
import { usePlayTargets } from "./targets";

type OkView = Extract<CombatSlotProps["view"], { state: "ok" }>;

export function TargetPicker({ view }: { view: OkView }) {
  const { targetTokenId, setTargetTokenId } = usePlayTargets();
  const enemies = view.others.filter((t) => t.side === "enemy");
  if (enemies.length === 0) {
    return (
      <Text style={styles.muted} testID="combat-play-no-targets">
        No enemies in sight to target.
      </Text>
    );
  }
  return (
    <View accessibilityLabel="Attack targets" style={styles.wrap} testID="combat-play-targets">
      {enemies.map((t) => {
        const picked = targetTokenId === t._id;
        return (
          <Pressable
            accessibilityLabel={`Target ${t.name}`}
            accessibilityRole="button"
            accessibilityState={{ selected: picked }}
            key={t._id}
            onPress={() => setTargetTokenId(picked ? null : (t._id as Id<"combatTokens">))}
            style={[styles.chip, picked ? styles.chipOn : null]}
            testID={`combat-target-${t._id}`}
          >
            <Text style={[styles.chipText, picked ? styles.chipTextOn : null]}>{t.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: {
    borderColor: colors.line2,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  chipOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  chipTextOn: {
    color: colors.brandInk,
    fontFamily: type.sansSemibold.fontFamily,
    fontWeight: type.sansSemibold.fontWeight,
  },
  muted: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
