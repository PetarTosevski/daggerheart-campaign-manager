import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { useDuration } from "../theme/motion";
import { radius, space } from "../theme/spacing";

export type RollDieRole = "hope" | "fear" | "advantage" | "disadvantage" | "help" | "extra" | "damage";

/** A die the server (or a manual entry) already rolled. This view does not roll. */
export type RollDie = {
  value: number;
  sides: number;
  role?: RollDieRole;
  dropped?: boolean;
};

const roleName: Record<RollDieRole, string> = {
  hope: "Hope",
  fear: "Fear",
  advantage: "Advantage",
  disadvantage: "Disadvantage",
  help: "Help",
  extra: "Extra",
  damage: "Damage",
};

const roleColor: Record<RollDieRole, string> = {
  hope: colors.hope,
  fear: colors.fear,
  advantage: colors.ok,
  disadvantage: colors.danger,
  help: colors.ok,
  extra: colors.parchment,
  damage: colors.brand,
};

function dieLabel(die: RollDie): string {
  const role = die.role ? `${roleName[die.role]} ` : "";
  const dropped = die.dropped ? ", not counted" : "";
  return `${role}d${die.sides}: ${die.value}${dropped}`;
}

function DieFace({ die }: { die: RollDie }) {
  const motion = useDuration();
  const settled = motion.roll === 0;
  const opacity = useSharedValue(settled ? 1 : 0);
  const scale = useSharedValue(settled ? 1 : 0.92);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: motion.roll });
    scale.value = withTiming(1, { duration: motion.roll });
  }, [motion.roll, opacity, scale]);

  const animated = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
      transform: [{ scale: scale.value }],
    };
  }, []);

  const color = die.role ? roleColor[die.role] : colors.parchment;

  return (
    <Animated.View style={animated}>
      <View
        accessibilityLabel={dieLabel(die)}
        style={[styles.face, die.dropped ? styles.dropped : null, { borderColor: color }]}
      >
        <Text style={[styles.value, { color }, die.dropped ? styles.struck : null]}>{String(die.value)}</Text>
        <Text style={styles.sides}>{`d${die.sides}`}</Text>
      </View>
    </Animated.View>
  );
}

export function RollResult({ dice }: { dice: readonly RollDie[] }) {
  return (
    <View accessibilityLabel="Dice" style={styles.row}>
      {dice.map((die, index) => (
        <DieFace die={die} key={`${index}-${die.role ?? "die"}-${die.sides}-${die.value}`} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  face: {
    alignItems: "center",
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    minWidth: space[12],
    paddingHorizontal: space[2],
    paddingVertical: space[2],
  },
  dropped: {
    opacity: 0.6,
  },
  value: {
    fontFamily: type.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: type.displayBold.fontWeight,
  },
  struck: {
    textDecorationLine: "line-through",
  },
  sides: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    fontWeight: type.sans.fontWeight,
  },
});
