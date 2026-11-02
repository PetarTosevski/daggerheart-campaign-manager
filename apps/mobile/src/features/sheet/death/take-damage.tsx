import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "convex/react";
import * as Crypto from "expo-crypto";

import { hitPointsToMark, type Severity, type Thresholds } from "../../../../../../src/lib/domain/characters";
import { errorMessage } from "../../../../../../src/lib/convex-errors";
import { api } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { defenseOf, thresholdsOf } from "../catalog";
import type { SheetSlotProps } from "../contract";

type DamagePlan = { severity: Severity; marks: number; armorUsed: boolean };

const SEVERITY_LABEL: Record<Severity, string> = {
  none: "No damage",
  minor: "Minor damage",
  major: "Major damage",
  severe: "Severe damage",
};

function planDamage(damage: number, thresholds: Thresholds, useArmorSlot: boolean, armorFree: number): DamagePlan {
  const raw = hitPointsToMark(damage, thresholds, false);
  const armorUsed = useArmorSlot && armorFree > 0 && raw.marks > 0;
  const result = armorUsed ? hitPointsToMark(damage, thresholds, true) : raw;
  return { ...result, armorUsed };
}

/** Manual damage entry (`characters.applyDamage`), matching the website calculator. */
export function TakeDamage({ character }: Pick<SheetSlotProps, "character">) {
  const applyDamage = useMutation(api.characters.applyDamage);
  const writes = useWritesEnabled();
  const sheet = character.sheet;
  const thresholds = thresholdsOf(sheet);
  const armorScore = defenseOf(sheet).armorScore;
  const armorFree = Math.max(0, armorScore - sheet.armorMarked);
  const [raw, setRaw] = useState("");
  const [useArmor, setUseArmor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const damage = Number.parseInt(raw, 10);
  const valid = Number.isFinite(damage) && damage > 0;
  const plan = valid ? planDamage(damage, thresholds, useArmor, armorFree) : null;

  async function apply() {
    if (!plan || !writes) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      await applyDamage({
        characterId: character._id,
        damage,
        useArmorSlot: plan.armorUsed,
        idempotencyKey: Crypto.randomUUID(),
      });
      setOutcome(`${SEVERITY_LABEL[plan.severity]}: ${plan.marks} Hit Point${plan.marks === 1 ? "" : "s"} marked.`);
      setRaw("");
      setUseArmor(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View accessibilityLabel="Take damage" style={styles.box}>
      <Text style={styles.label}>Take damage</Text>
      <TextInput
        accessibilityLabel="Damage roll"
        keyboardType="number-pad"
        onChangeText={(value) => setRaw(value.replace(/[^0-9]/g, "").slice(0, 3))}
        placeholder="Roll"
        placeholderTextColor={colors.mutedText}
        style={styles.input}
        value={raw}
      />
      <View style={styles.row}>
        <Button
          disabled={armorFree <= 0}
          onPress={() => setUseArmor((current) => !current)}
          variant={useArmor ? "solid" : "outline"}
        >
          {armorFree <= 0 ? "No Armor Slot free" : useArmor ? "Using an Armor Slot" : "Use an Armor Slot"}
        </Button>
      </View>
      <Button disabled={!plan || busy || !writes || (plan.marks === 0 && !plan.armorUsed)} onPress={() => void apply()} variant="solid">
        Apply
      </Button>
      {plan ? (
        <Text style={styles.hint}>
          {SEVERITY_LABEL[plan.severity]}
          {plan.marks > 0 ? `: marks ${plan.marks} Hit Point${plan.marks === 1 ? "" : "s"}` : ""}
          {plan.armorUsed ? " (Armor Slot used)" : ""}
        </Text>
      ) : null}
      {outcome ? (
        <Text accessibilityRole="text" style={styles.outcome}>
          {outcome}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space[3],
    paddingVertical: space[2],
  },
  label: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: type.sansSemibold.fontWeight,
  },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 18,
    minHeight: 44,
    paddingHorizontal: space[3],
  },
  row: {
    gap: space[2],
  },
  hint: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontStyle: "italic",
  },
  outcome: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
