import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { hit, radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";

export function FeatureSection({
  title,
  children,
  testID,
  accessibilityLabel,
}: {
  title: string;
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="summary"
      style={styles.section}
      testID={testID}
    >
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function FeatureLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function FeatureNote({ children }: { children: string }) {
  return <Text style={styles.note}>{children}</Text>;
}

export function FeatureError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
      {error}
    </Text>
  );
}

export function FeatureStatus({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={styles.status}>
      {message}
    </Text>
  );
}

export function ChipList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.chipBlock}>
      <FeatureLabel>{label}</FeatureLabel>
      <View accessibilityLabel={label} style={styles.chipRow}>
        {items.map((item) => (
          <Text key={item} style={styles.chip}>
            {item}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function LauncherRow({
  action,
  onPress,
  children,
}: {
  action: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const writes = useWritesEnabled();
  return (
    <View style={styles.launcher}>
      <Text style={styles.launcherText}>{children}</Text>
      <Button accessibilityLabel={action} disabled={!writes} onPress={onPress} variant="solid">
        {action}
      </Button>
    </View>
  );
}

export function FeatureField({
  label,
  value,
  onChangeText,
  multiline = false,
  maxLength,
  keyboardType = "default",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: "default" | "number-pad";
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      keyboardType={keyboardType}
      maxLength={maxLength}
      multiline={multiline}
      onChangeText={onChangeText}
      placeholder={label}
      placeholderTextColor={colors.subtle}
      style={[styles.field, multiline ? styles.fieldMulti : null]}
      value={value}
    />
  );
}

export function CheckOption({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  const writes = useWritesEnabled();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !writes }}
      disabled={!writes}
      onPress={onPress}
      style={styles.check}
    >
      <Text style={styles.checkText}>
        {checked ? "☑" : "☐"} {label}
      </Text>
    </Pressable>
  );
}

export function FeatureRow({
  title,
  cost,
  text,
  children,
}: {
  title: string;
  cost?: string | null;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <View accessibilityRole="none" style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{title}</Text>
        {cost ? <Text style={styles.rowCost}>{cost}</Text> : null}
      </View>
      {text ? <Text style={styles.rowText}>{text}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  sectionTitle: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: type.displayBold.fontWeight,
  },
  label: {
    color: colors.mutedText,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 13,
    fontWeight: type.sansMedium.fontWeight,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  note: {
    color: colors.mutedText,
    fontFamily: type.serifItalic.fontFamily,
    fontSize: 15,
    fontStyle: "italic",
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  status: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  chipBlock: {
    gap: space[2],
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  chip: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.hope,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    overflow: "hidden",
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  launcher: {
    alignItems: "flex-start",
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  launcherText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  field: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: hit.minHeight,
    paddingHorizontal: space[3],
  },
  fieldMulti: {
    minHeight: hit.lg,
    paddingVertical: space[2],
    textAlignVertical: "top",
  },
  check: {
    minHeight: hit.minHeight,
    justifyContent: "center",
  },
  checkText: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
  row: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  rowHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    justifyContent: "space-between",
  },
  rowTitle: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 17,
    fontWeight: type.displayBold.fontWeight,
  },
  rowCost: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  rowText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
});
