import { Pressable, StyleSheet, Text, View } from "react-native";

import { useWritesEnabled } from "../../../../../shell/offline";
import { colors } from "../../../../../theme/colors";
import { type } from "../../../../../theme/fonts";
import { hit, radius, space } from "../../../../../theme/spacing";

/**
 * A row of diamond-style pips (mirrors the website `Pips` from
 * src/components/party/extras/ui.tsx). Clicking pip k marks k (or clears
 * back to k − 1).
 */
export function Pips({
  label,
  marked,
  total,
  disabled,
  onSet,
}: {
  label: string;
  marked: number;
  total: number;
  disabled: boolean;
  onSet: (value: number) => void;
}) {
  const writes = useWritesEnabled();
  return (
    <View accessibilityLabel={`${label}: ${marked} of ${total} marked`} style={styles.row}>
      {Array.from({ length: total }, (_, k) => {
        const on = k < marked;
        return (
          <Pressable
            key={k}
            accessibilityLabel={`${label} ${k + 1} of ${total}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: disabled || !writes }}
            disabled={disabled || !writes}
            onPress={() => onSet(k + 1 === marked ? k : k + 1)}
            style={[styles.pip, on ? styles.pipOn : null]}
          >
            <Text style={on ? styles.pipTextOn : styles.pipText}>◆</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
  },
  pip: {
    alignItems: "center",
    borderColor: colors.line2,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: hit.minHeight,
    justifyContent: "center",
    width: hit.minHeight,
  },
  pipOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
  },
  pipText: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 18,
  },
  pipTextOn: {
    color: colors.hope,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 18,
    fontWeight: type.sansSemibold.fontWeight,
  },
});
