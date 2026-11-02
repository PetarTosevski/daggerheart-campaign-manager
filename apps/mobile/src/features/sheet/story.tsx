import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Line, Section, Stepper } from "./chrome";
import type { SheetData } from "./types";

export function StorySection({
  sheet,
  canEdit,
  onText,
  onGold,
  onChest,
  onAddItem,
  onRemoveItem,
  onAddExperience,
  onExperience,
  onRemoveExperience,
}: {
  sheet: SheetData;
  canEdit: boolean;
  onText: (patch: { description?: string; background?: string[]; connections?: string[]; notes?: string }) => void;
  onGold: (coin: "handfuls" | "bags", delta: number) => void;
  onChest: (chest: boolean) => void;
  onAddItem: (name: string) => void;
  onRemoveItem: (itemId: string) => void;
  onAddExperience: (name: string) => void;
  onExperience: (experienceId: string, value: number) => void;
  onRemoveExperience: (experienceId: string) => void;
}) {
  const writes = useWritesEnabled();
  return (
    <View style={styles.stack}>
      <Section title="Wealth">
        <Stepper
          label="Handfuls"
          max={99}
          min={0}
          onStep={(delta) => onGold("handfuls", delta)}
          readOnly={!canEdit}
          value={sheet.gold.handfuls}
        />
        <Stepper
          label="Bags"
          max={99}
          min={0}
          onStep={(delta) => onGold("bags", delta)}
          readOnly={!canEdit}
          value={sheet.gold.bags}
        />
        <Line label="Chest" value={sheet.gold.chest ? "Yes" : "No"} />
        {canEdit ? (
          <Button disabled={!writes} onPress={() => onChest(!sheet.gold.chest)} variant="outline">
            {sheet.gold.chest ? "Clear the chest" : "Mark a chest"}
          </Button>
        ) : null}
      </Section>
      <Section title="Inventory">
        {sheet.inventory.length === 0 ? <Text style={styles.muted}>Nothing carried.</Text> : null}
        {sheet.inventory.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.item}>{item.name}</Text>
            {canEdit ? (
              <Button disabled={!writes} onPress={() => onRemoveItem(item.id)} variant="outline">
                {`Remove ${item.name}`}
              </Button>
            ) : null}
          </View>
        ))}
        {canEdit ? <Adder disabled={!writes} label="Add item" onAdd={onAddItem} /> : null}
      </Section>
      <Section title="Experiences">
        {sheet.experiences.map((experience) => (
          <View key={experience.id} style={styles.stack}>
            <Stepper
              label={experience.name}
              max={12}
              min={-5}
              onStep={(delta) => onExperience(experience.id, experience.value + delta)}
              readOnly={!canEdit}
              value={experience.value}
            />
            {canEdit ? (
              <Button disabled={!writes} onPress={() => onRemoveExperience(experience.id)} variant="outline">
                {`Remove ${experience.name}`}
              </Button>
            ) : null}
          </View>
        ))}
        {canEdit ? <Adder disabled={!writes} label="Add Experience" onAdd={onAddExperience} /> : null}
      </Section>
      <Note
        canEdit={canEdit}
        label="Background"
        onSave={(text) => onText({ background: lines(text) })}
        value={sheet.background.join("\n")}
      />
      <Note
        canEdit={canEdit}
        label="Connections"
        onSave={(text) => onText({ connections: lines(text) })}
        value={sheet.connections.join("\n")}
      />
      <Note canEdit={canEdit} label="Notes" onSave={(notes) => onText({ notes })} value={sheet.notes} />
    </View>
  );
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function Adder({ label, disabled, onAdd }: { label: string; disabled: boolean; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <View style={styles.row}>
      <TextInput
        accessibilityLabel={label}
        onChangeText={setName}
        placeholder={label}
        placeholderTextColor={colors.faint}
        style={styles.input}
        value={name}
      />
      <Button
        disabled={disabled || name.trim().length === 0}
        onPress={() => {
          onAdd(name.trim());
          setName("");
        }}
        variant="solid"
      >
        {label}
      </Button>
    </View>
  );
}

function Note({
  label,
  value,
  canEdit,
  onSave,
}: {
  label: string;
  value: string;
  canEdit: boolean;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!canEdit) {
    return (
      <Section title={label}>
        <Text style={styles.item}>{value || "—"}</Text>
      </Section>
    );
  }
  return (
    <Section title={label}>
      <TextInput
        accessibilityLabel={label}
        multiline
        onChangeText={setDraft}
        onEndEditing={() => {
          const next = draft ?? value;
          setDraft(null);
          if (next !== value) onSave(next);
        }}
        onFocus={() => setDraft(value)}
        style={[styles.input, styles.multi]}
        value={draft ?? value}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
  },
  row: {
    gap: space[2],
  },
  item: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
  muted: {
    color: colors.mutedText,
    fontFamily: type.serif.fontFamily,
    fontSize: 16,
    fontStyle: type.serif.fontStyle,
  },
  input: {
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    flexGrow: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: space[3],
  },
  multi: {
    minHeight: 96,
    paddingVertical: space[3],
  },
});
