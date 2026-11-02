import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";
import { Button, type ButtonVariant } from "../../ui/button";

/** Shared frame for tracker panels. `gmOnly` adds the website's "GM only" tag. */
export function TrackerCard({
  title,
  subtitle,
  gmOnly = false,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  gmOnly?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {gmOnly ? <Text style={styles.gmOnly}>GM only</Text> : null}
          </View>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {actions}
      </View>
      {children}
    </View>
  );
}

/** Outlined tracker control. Disabled while the campaign is offline or `disabled` is set. */
export function TrackerButton({
  children,
  onPress,
  disabled = false,
  accessibilityLabel,
  variant = "outline",
}: {
  children: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  variant?: ButtonVariant;
}) {
  const writes = useWritesEnabled();
  return (
    <Button
      accessibilityLabel={accessibilityLabel ?? children}
      disabled={disabled || !writes}
      onPress={onPress}
      variant={variant}
    >
      {children}
    </Button>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
      {error}
    </Text>
  );
}

export function Notice({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice}>
      {children}
    </Text>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      maxLength={maxLength}
      multiline={multiline}
      onChangeText={onChangeText}
      placeholder={placeholder ?? label}
      placeholderTextColor={colors.subtle}
      style={[styles.field, multiline ? styles.fieldMulti : null]}
      value={value}
    />
  );
}

/**
 * Saves when editing ends and the trimmed text differs from the stored value.
 * Pass `key={value}` so a server change remounts the field.
 */
export function SavedField({
  label,
  value,
  onSave,
  multiline = false,
  maxLength,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      defaultValue={value}
      maxLength={maxLength}
      multiline={multiline}
      onEndEditing={(event) => {
        const next = event.nativeEvent.text;
        if (next.trim() !== value) onSave(next);
      }}
      placeholder={label}
      placeholderTextColor={colors.subtle}
      style={[styles.field, multiline ? styles.fieldMulti : null]}
    />
  );
}

export function CheckRow({
  label,
  checked,
  disabled = false,
  onPress,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const writes = useWritesEnabled();
  const off = disabled || !writes || onPress === undefined;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: off }}
      disabled={off}
      onPress={onPress}
      style={[styles.check, off ? styles.disabled : null]}
    >
      <Text style={styles.checkText}>
        {checked ? "☑" : "☐"} {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  header: {
    gap: space[2],
  },
  titles: {
    gap: space[1],
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: type.displayBold.fontWeight,
  },
  gmOnly: {
    borderColor: colors.violet,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.fear,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 11,
    fontWeight: type.sansMedium.fontWeight,
    letterSpacing: 1.4,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    textTransform: "uppercase",
  },
  subtitle: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    fontWeight: type.sans.fontWeight,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    fontWeight: type.sans.fontWeight,
  },
  notice: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.hope,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontWeight: type.sans.fontWeight,
    padding: space[3],
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
    justifyContent: "center",
    minHeight: hit.minHeight,
    paddingVertical: space[2],
  },
  checkText: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    fontWeight: type.sans.fontWeight,
  },
  disabled: {
    opacity: 0.5,
  },
});
