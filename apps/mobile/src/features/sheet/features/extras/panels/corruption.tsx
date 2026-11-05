import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useQuery } from "convex/react";

import { api } from "../../../../../convex";
import type { Id } from "../../../../../convex";
import { colors } from "../../../../../theme/colors";
import { type } from "../../../../../theme/fonts";
import { space } from "../../../../../theme/spacing";
import { Button } from "../../../../../ui/button";
import { useIntent } from "../../intent";
import {
  CheckOption,
  FeatureError,
  FeatureLabel,
  FeatureNote,
  FeatureSection,
  FeatureStatus,
} from "../../ui";
import { Pips } from "./pips";

/**
 * Motherboard's optional Corruption Track on the Companion sheet (CB 295).
 * Renders nothing where the rule doesn't apply.
 */
export function CorruptionPanel({ characterId }: { characterId: Id<"characters"> }) {
  const view = useQuery(api.characterExtras.corruption, { characterId });
  const remnant = useIntent(api.characterExtras.setCompanionRemnant);
  const repair = useIntent(api.characterExtras.repairCompanion);
  const replace = useIntent(api.characterExtras.replaceCompanion);
  const [notice, setNotice] = useState<string | null>(null);
  if (!view) return null;
  const error = remnant.error ?? repair.error ?? replace.error;

  return (
    <FeatureSection accessibilityLabel="Corruption Track" title="Corruption Track">
      <CheckOption
        label="This companion is a remnant"
        checked={view.remnant}
        onPress={() => {
          if (!view.canEdit || view.lost || remnant.pending) return;
          void remnant.fire({ characterId, remnant: !view.remnant });
        }}
      />
      {view.remnant || view.marks > 0 ? (
        <>
          <FeatureLabel>{`Corruption ${view.marks} / ${view.trackSize}`}</FeatureLabel>
          <Pips
            label="Corruption"
            marked={view.marks}
            total={view.trackSize}
            disabled
            onSet={() => undefined}
          />
        </>
      ) : null}
      {view.lastRoll ? (
        <FeatureNote>
          {`Last downtime roll: Fear Die ${view.lastRoll.fearDie}${view.lastRoll.marked ? " (marked a Corruption)" : ""}.`}
        </FeatureNote>
      ) : null}
      {view.lost ? (
        <View style={styles.block}>
          <Text style={styles.warn}>
            The remnant has marked its last Corruption: it becomes violent and can no longer be commanded or repaired. Take a new companion with two new Experiences; the level-up options you have already chosen carry over.
          </Text>
          {view.canEdit ? (
            <Button
              accessibilityLabel="Take a new companion"
              disabled={replace.pending}
              onPress={() => void replace.fire({ characterId })}
              variant="solid"
            >
              Take a new companion
            </Button>
          ) : null}
        </View>
      ) : null}
      {view.canRepair && view.remnant && !view.lost ? (
        <Button
          accessibilityLabel="Repair (clear 1d4)"
          disabled={repair.pending || view.marks === 0}
          onPress={async () => {
            const done = await repair.fire({ characterId });
            if (done) setNotice(`Repair rolled ${done.die}: cleared ${done.cleared} Corruption.`);
          }}
          variant="outline"
        >
          Repair (clear 1d4)
        </Button>
      ) : null}
      <FeatureStatus message={notice} />
      <FeatureNote>
        At the beginning of downtime, roll your Fear Die. On a 1, mark a Corruption and describe the glitch that overcomes your companion. Specialized technomancers may temporarily repair the remnant (clears 1d4 Corruption).
      </FeatureNote>
      <FeatureError error={error} />
    </FeatureSection>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[2] },
  warn: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
