import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Section } from "./chrome";
import type { SheetStatus } from "./types";

const CHOICES = [
  { status: "active", label: "Active" },
  { status: "dead", label: "Dead" },
  { status: "retired", label: "Retired" },
] as const satisfies readonly { status: SheetStatus; label: string }[];

export function StatusSection({
  name,
  status,
  canEdit,
  onStatus,
}: {
  name: string;
  status: SheetStatus;
  canEdit: boolean;
  onStatus: (status: "active" | "dead" | "retired") => void;
}) {
  const writes = useWritesEnabled();
  const [confirm, setConfirm] = useState<"dead" | "retired" | null>(null);
  if (!canEdit) return null;
  const current = CHOICES.find((choice) => choice.status === status)?.label ?? status;
  return (
    <Section title="Status">
      <Text style={styles.current}>{current}</Text>
      <View accessibilityLabel="Character status" style={styles.row}>
        {CHOICES.map((choice) => (
          <Button
            accessibilityLabel={`Mark ${name} ${choice.label}`}
            disabled={!writes || choice.status === status}
            key={choice.status}
            onPress={() => {
              if (choice.status === "active") onStatus("active");
              else setConfirm(choice.status);
            }}
            variant={choice.status === status ? "solid" : "outline"}
          >
            {choice.label}
          </Button>
        ))}
      </View>
      {confirm ? (
        <View accessibilityLabel={`Confirm ${confirm}`} accessibilityRole="alert" style={styles.confirm}>
          <Text style={styles.copy}>
            Mark {name} as {confirm}? You can set them active again later.
          </Text>
          <Button
            disabled={!writes}
            onPress={() => {
              onStatus(confirm);
              setConfirm(null);
            }}
            variant="dangerSolid"
          >
            {confirm === "dead" ? "Mark dead" : "Mark retired"}
          </Button>
          <Button onPress={() => setConfirm(null)} variant="outline">
            Cancel
          </Button>
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  current: {
    color: colors.parchment,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 16,
    fontWeight: type.sansMedium.fontWeight,
  },
  row: {
    gap: space[2],
  },
  confirm: {
    gap: space[2],
  },
  copy: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
});
