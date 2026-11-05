import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { FeatureScope } from "../../../../../../src/lib/domain/class-features/types";
import {
  bumpUsed,
  currentPhase,
  holdsLunarPhases,
  MOON_PHASES,
  moonDie,
  type MoonPhase,
} from "../../../../../../src/lib/domain/session-features";
import type { CharacterSheet } from "../../../../../../src/lib/validation/characters";
import { api } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import type { SheetSlotProps } from "../contract";
import type { SheetData } from "../types";
import { useIntent } from "./intent";
import { MoonArt } from "./moon-art";
import { parseFeatureSheet } from "./parse-sheet";
import { FeatureError, FeatureNote, FeatureSection } from "./ui";

function scopeOf(hopeAndFear: boolean): FeatureScope {
  return { hopeAndFear, ikonis: false };
}

function range(p: MoonPhase): string {
  return p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
}

function bumpBlocked(sheet: CharacterSheet): string | null {
  if (moonDie(sheet) === undefined) return "No moon die to raise yet.";
  if (bumpUsed({ featureUses: sheet.featureUses ?? [] })) return "Used this rest; it refreshes after a rest.";
  if (sheet.hope < 1) return "Needs 1 Hope.";
  return null;
}

function LunarBody({
  props,
  parsed,
}: {
  props: SheetSlotProps;
  parsed: CharacterSheet;
}) {
  const characterId = props.character._id;
  const bump = useIntent(api.sessionFeatures.bumpMoonDie);
  const writes = useWritesEnabled();
  const [error, setError] = useState<string | null>(null);
  const scope = scopeOf(props.hopeAndFear);

  const die = moonDie(parsed);
  const phase = currentPhase(parsed, scope);
  const blocked = bumpBlocked(parsed);

  async function onBump() {
    setError(null);
    await bump.fire({ characterId });
    if (bump.error) setError(bump.error);
  }

  return (
    <FeatureSection accessibilityLabel="Lunar Phases" testID="lunar-phases" title="Lunar Phases">
      <View accessibilityLabel="Moon phases" style={styles.phases}>
        {MOON_PHASES.map((p) => {
          const on = phase?.key === p.key;
          return (
            <View
              accessibilityState={{ selected: on }}
              key={p.key}
              style={[styles.phaseCard, on ? styles.phaseOn : null]}
            >
              <MoonArt glow={on} phase={p.key} />
              <Text style={styles.phaseName}>{p.name}</Text>
              <Text accessibilityLabel={`Roll ${range(p)}`} style={styles.phaseRange}>
                {range(p)}
              </Text>
              <Text style={styles.phaseEffect}>{p.effect}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.nowRow}>
        <View accessibilityLabel={die === undefined ? "No moon die" : `Moon die ${die}`} style={styles.die}>
          <Text style={styles.dieText}>{die ?? "–"}</Text>
        </View>
        <View style={styles.nowText}>
          {phase ? (
            <>
              <Text style={styles.nowName}>{phase.name} moon</Text>
              <FeatureNote>{`${phase.effect}, until the session ends.`}</FeatureNote>
            </>
          ) : (
            <FeatureNote>No moon die: rolled when the session starts.</FeatureNote>
          )}
        </View>
      </View>
      {props.canEdit ? (
        <View style={styles.bumpRow}>
          <Button
            accessibilityLabel="Spend a Hope: +1 to the moon die"
            disabled={!writes || bump.pending || blocked !== null}
            onPress={() => void onBump()}
            variant="solid"
          >
            ☾ Spend a Hope: +1 to the moon die
          </Button>
          <FeatureNote>{blocked ?? "Once per rest; a 6 becomes a 1."}</FeatureNote>
          <FeatureError error={error ?? bump.error} />
        </View>
      ) : null}
    </FeatureSection>
  );
}

export function LunarPhasesSection(props: SheetSlotProps) {
  const parsed = parseFeatureSheet(props.character.sheet as SheetData & Record<string, unknown>);
  if (!parsed) return null;
  if (!holdsLunarPhases(parsed, scopeOf(props.hopeAndFear))) return null;
  return <LunarBody parsed={parsed} props={props} />;
}

const styles = StyleSheet.create({
  phases: {
    gap: space[2],
  },
  phaseCard: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[1],
    padding: space[3],
  },
  phaseOn: {
    backgroundColor: colors.hopeBg,
    borderColor: colors.brand,
  },
  phaseName: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
    fontWeight: type.displayBold.fontWeight,
  },
  phaseRange: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  phaseEffect: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  nowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[3],
  },
  die: {
    alignItems: "center",
    borderColor: colors.brand,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  dieText: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 24,
    fontWeight: type.displayBold.fontWeight,
  },
  nowText: {
    flex: 1,
    gap: space[1],
  },
  nowName: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: type.sansSemibold.fontWeight,
  },
  bumpRow: {
    gap: space[2],
  },
});
