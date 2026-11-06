import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";

/** A 44 pt toggle chip for the combat dock (dcm-gdzi.18): targets, tools, options. */
export function Chip({
  label,
  selected = false,
  disabled = false,
  onPress,
  accessibilityLabel,
  testID,
  hint,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
  /** A second, quieter line (a band, "no line of sight"). */
  hint?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipOn : null, disabled ? styles.chipOff : null]}
      testID={testID}
    >
      <Text style={[styles.text, selected ? styles.textOn : null]}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </Pressable>
  );
}

export function ChipRow({ children, label, testID }: { children: ReactNode; label?: string; testID?: string }) {
  return (
    <View accessibilityLabel={label} style={styles.row} testID={testID}>
      {children}
    </View>
  );
}

export const dockText = StyleSheet.create({
  title: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: type.sansSemibold.fontWeight,
  },
  body: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2], alignItems: "center" },
  chip: {
    justifyContent: "center",
    minHeight: 44,
    minWidth: 44,
    borderColor: colors.line2,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipOff: { opacity: 0.45 },
  text: { color: colors.parchment, fontFamily: type.sans.fontFamily, fontSize: 14 },
  textOn: { color: colors.brandInk, fontFamily: type.sansSemibold.fontFamily, fontWeight: type.sansSemibold.fontWeight },
  hint: { color: colors.subtle, fontFamily: type.sans.fontFamily, fontSize: 11 },
});
