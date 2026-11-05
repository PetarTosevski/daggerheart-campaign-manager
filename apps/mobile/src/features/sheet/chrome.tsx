import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  readOnly,
  detail,
  onStep,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  readOnly: boolean;
  detail?: string;
  onStep: (delta: number) => void;
}) {
  const writes = useWritesEnabled();
  const summary = detail ?? `${label} ${value}`;
  return (
    <View accessibilityLabel={readOnly ? summary : undefined} style={styles.stepper}>
      <View style={styles.stepperText}>
        <Text style={styles.stepperLabel}>{label}</Text>
        <Text accessibilityLabel={summary} accessibilityLiveRegion="polite" style={styles.stepperValue}>
          {value}
        </Text>
      </View>
      {readOnly ? null : (
        <View style={styles.stepperButtons}>
          <Button
            accessibilityLabel={`Decrease ${label}`}
            disabled={!writes || value <= min}
            onPress={() => onStep(-1)}
            variant="outline"
          >
            −
          </Button>
          <Button
            accessibilityLabel={`Increase ${label}`}
            disabled={!writes || value >= max}
            onPress={() => onStep(1)}
            variant="outline"
          >
            +
          </Button>
        </View>
      )}
    </View>
  );
}

export function Line({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.line}>
      <Text style={styles.lineLabel}>{label}: </Text>
      {value}
    </Text>
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
  heading: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 20,
    fontWeight: type.displayBold.fontWeight,
  },
  stepper: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[3],
    justifyContent: "space-between",
  },
  stepperText: {
    flex: 1,
    gap: space[1],
  },
  stepperLabel: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    fontWeight: type.sans.fontWeight,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  stepperValue: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: type.displayBold.fontWeight,
  },
  stepperButtons: {
    flexDirection: "row",
    gap: space[2],
  },
  line: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    fontWeight: type.sans.fontWeight,
  },
  lineLabel: {
    color: colors.subtle,
  },
});
