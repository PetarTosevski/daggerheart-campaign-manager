import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";

/** A settings section's heading (the website's H3 over a group of rows). */
export function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={controlStyles.section}>
      {children}
    </Text>
  );
}

/** A row's label and optional hint (the design's `.row-t`). */
function RowText({ label, hint }: { label: string; hint?: string }) {
  return (
    <View style={controlStyles.rowText}>
      <Text accessible={false} style={controlStyles.label}>
        {label}
      </Text>
      {hint ? <Text style={controlStyles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** A labelled on/off switch row (the design's `.sw`). The whole row is the target. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={controlStyles.switchRow}
    >
      <RowText hint={hint} label={label} />
      <View style={[controlStyles.track, checked ? controlStyles.trackOn : null]}>
        <View style={[controlStyles.knob, checked ? controlStyles.knobOn : null]} />
      </View>
    </Pressable>
  );
}

/** A labelled one-of-several choice (the design's `.seg`). Tapping the current choice sends nothing. */
export function ChoiceRow<T extends string>({
  label,
  hint,
  value,
  choices,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <View style={controlStyles.choiceRow}>
      <RowText hint={hint} label={label} />
      <View accessibilityLabel={label} accessibilityRole="radiogroup" style={controlStyles.segments}>
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <Pressable
              accessibilityLabel={choice.label}
              accessibilityRole="radio"
              accessibilityState={{ disabled, selected }}
              disabled={disabled}
              key={choice.value}
              onPress={() => {
                if (!selected) onChange(choice.value);
              }}
              style={[controlStyles.segment, selected ? controlStyles.segmentOn : null]}
            >
              <Text style={selected ? controlStyles.segmentTextOn : controlStyles.segmentText}>{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const controlStyles = StyleSheet.create({
  section: {
    color: colors.mutedText,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 12,
    fontWeight: type.sansMedium.fontWeight,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  rowText: {
    flex: 1,
    gap: space[1],
  },
  label: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontWeight: type.sans.fontWeight,
  },
  hint: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    fontWeight: type.sans.fontWeight,
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[3],
    minHeight: hit.minHeight,
  },
  choiceRow: {
    gap: space[2],
  },
  segments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  segment: {
    alignItems: "center",
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: hit.minHeight,
    paddingHorizontal: space[4],
  },
  segmentOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
  },
  segmentText: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontWeight: type.sans.fontWeight,
  },
  segmentTextOn: {
    color: colors.parchment,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 14,
    fontWeight: type.sansMedium.fontWeight,
  },
  track: {
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 56,
  },
  trackOn: {
    backgroundColor: colors.hopeBg,
  },
  knob: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    height: 20,
    marginLeft: 3,
    width: 20,
  },
  knobOn: {
    marginLeft: 31,
  },
  error: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerLine,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    padding: space[3],
  },
  block: {
    gap: space[3],
  },
});
