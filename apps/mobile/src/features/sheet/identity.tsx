import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { PortraitControl } from "../party/portrait";
import { signed, traitLabel, TRAIT_IDS } from "./catalog";
import { Line, Section } from "./chrome";
import type { TraitId } from "../../../../../src/lib/srd/types";
import type { SheetCharacter } from "./types";

export function IdentitySection({
  character,
  canEdit,
  isGm,
  onTrait,
  onUpdate,
}: {
  character: SheetCharacter;
  canEdit: boolean;
  isGm: boolean;
  /** One trait by a delta (rule 12: an intent, never the whole traits object). */
  onTrait: (trait: TraitId, delta: number) => void;
  onUpdate: (patch: { name?: string; pronouns?: string; description?: string }) => void;
}) {
  const sheet = character.sheet;
  const writes = useWritesEnabled();
  return (
    <Section title="Identity">
      <PortraitControl
        canEdit={canEdit}
        characterId={character._id}
        hasPortrait={character.portraitUrl !== null}
        name={sheet.name}
        portraitUrl={character.portraitUrl}
        portrait={character.sheet.portrait}
      />
      <Field
        label="Name"
        readOnly={!canEdit}
        value={sheet.name}
        onSave={(name) => onUpdate({ name })}
      />
      <Field
        label={sheet.pronounsLabel === "gender" ? "Gender" : "Pronouns"}
        readOnly={!canEdit}
        value={sheet.pronouns}
        onSave={(pronouns) => onUpdate({ pronouns })}
      />
      <Field
        label="Description"
        readOnly={!canEdit}
        value={sheet.description}
        onSave={(description) => onUpdate({ description })}
      />
      <View accessibilityLabel="Traits" style={styles.traits}>
        {TRAIT_IDS.map((trait) => {
          const value = sheet.traits[trait] ?? 0;
          const marked = (sheet.traitMarks[trait] ?? 0) > 0;
          return (
            <View key={trait} style={styles.trait}>
              <Text style={styles.traitName}>{traitLabel(trait)}</Text>
              <Text accessibilityLabel={`${traitLabel(trait)} ${signed(value)}`} style={styles.traitValue}>
                {signed(value)}
              </Text>
              {marked ? <Text style={styles.mark}>Marked this tier</Text> : null}
              {canEdit && isGm ? (
                <View style={styles.traitSteps}>
                  <Button
                    accessibilityLabel={`Decrease ${traitLabel(trait)}`}
                    disabled={!writes || value <= -5}
                    onPress={() => onTrait(trait, -1)}
                    variant="outline"
                  >
                    −
                  </Button>
                  <Button
                    accessibilityLabel={`Increase ${traitLabel(trait)}`}
                    disabled={!writes || value >= 10}
                    onPress={() => onTrait(trait, 1)}
                    variant="outline"
                  >
                    +
                  </Button>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </Section>
  );
}

function Field({
  label,
  value,
  readOnly,
  onSave,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  if (readOnly) return <Line label={label} value={value || "—"} />;
  return (
    <TextInput
      accessibilityLabel={label}
      onChangeText={setDraft}
      onEndEditing={() => {
        const next = (draft ?? value).trim();
        setDraft(null);
        if (next !== value) onSave(next);
      }}
      onFocus={() => setDraft(value)}
      style={styles.input}
      value={shown}
    />
  );
}

const styles = StyleSheet.create({
  traits: {
    gap: space[2],
  },
  trait: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[2],
  },
  traitName: {
    color: colors.label,
    flex: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
  traitValue: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
  mark: {
    color: colors.hope,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
  },
  traitSteps: {
    flexDirection: "row",
    gap: space[2],
  },
  input: {
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: space[3],
  },
});
