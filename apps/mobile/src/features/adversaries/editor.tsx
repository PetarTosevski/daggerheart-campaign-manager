import type { FunctionArgs } from "convex/server";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import {
  changedFields,
  RANGES,
  validateCustom,
  withImprovisedStats,
  type CustomAdversaryInput,
  type CustomFeature,
  type CustomTier,
} from "../../../../../src/lib/adversaries/custom";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { ADVERSARY_TYPES, type AdversaryFeatureKind } from "../../../../../src/lib/srd/types";
import { api, type Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";

import { Chip, ErrorLine } from "./controls";
import { useAct } from "./intent";
import { advStyles } from "./styles";
import { inputOf, type CustomAdversary } from "./types";

type CustomPatch = FunctionArgs<typeof api.customAdversaries.update>["patch"];

const FEATURE_KINDS: readonly AdversaryFeatureKind[] = ["passive", "action", "reaction"];
const TIERS: readonly CustomTier[] = [1, 2, 3, 4];

/** A whole-number field; text that is not a number keeps the last good value. */
function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <View style={advStyles.grow}>
      <Text style={advStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="numbers-and-punctuation"
        onChangeText={(next) => {
          setText(next);
          const trimmed = next.trim();
          if (trimmed === "") onChange(null);
          else if (/^-?\d+$/.test(trimmed)) onChange(Number(trimmed));
        }}
        style={advStyles.input}
        value={text}
      />
    </View>
  );
}

function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <View style={advStyles.section}>
      <Text style={advStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        onChangeText={onChange}
        style={[advStyles.input, multiline ? advStyles.textarea : null]}
        value={value}
      />
    </View>
  );
}

/** The patch `customAdversaries.update` takes: only the changed fields (CL3); `hordePerHp: null` clears it. */
function patchOf(prev: CustomAdversaryInput, next: CustomAdversaryInput): CustomPatch {
  const patch: Record<string, unknown> = {};
  for (const field of changedFields(prev, next)) patch[field] = field === "hordePerHp" ? (next.hordePerHp ?? null) : next[field];
  return patch as CustomPatch;
}

/**
 * Edits a custom adversary (D8 A5): name, tier and type, the numbers, attack, texts and features. "Use improvised
 * stats" applies the tier's row of CB p.208. Save sends only the changed fields.
 */
export function CustomEditor({ campaignId, custom, onDone }: { campaignId: Id<"campaigns">; custom: CustomAdversary; onDone: () => void }) {
  const writes = useWritesEnabled();
  const update = useAct(api.customAdversaries.update);
  const [draft, setDraft] = useState<CustomAdversaryInput>(() => inputOf(custom));
  const [formError, setFormError] = useState<string | null>(null);

  function set(next: Partial<CustomAdversaryInput>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function setFeature(index: number, next: Partial<CustomFeature>) {
    setDraft((current) => ({ ...current, features: current.features.map((f, i) => (i === index ? { ...f, ...next } : f)) }));
  }

  async function save() {
    setFormError(null);
    let checked: CustomAdversaryInput;
    try {
      checked = validateCustom(draft);
    } catch (caught) {
      setFormError(errorMessage(caught));
      return;
    }
    const patch = patchOf(inputOf(custom), checked);
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    const done = await update.act({ campaignId, customId: custom._id, patch });
    if (done !== undefined) onDone();
  }

  return (
    <View accessibilityLabel={`Edit ${custom.name}`} style={advStyles.card}>
      <Text accessibilityRole="header" style={advStyles.h2}>
        Edit {custom.name}
      </Text>
      <TextField label="Name" onChange={(name) => set({ name })} value={draft.name} />
      <Text style={advStyles.label}>Tier</Text>
      <View style={advStyles.row}>
        {TIERS.map((tier) => (
          <Chip key={tier} label={`Tier ${tier}`} on={draft.tier === tier} onPress={() => set({ tier })} />
        ))}
      </View>
      <Button
        accessibilityLabel="Use improvised stats for this tier"
        onPress={() => setDraft((current) => withImprovisedStats(current, (TIERS.includes(current.tier as CustomTier) ? current.tier : 1) as CustomTier))}
        variant="outline"
      >
        Use improvised stats
      </Button>
      <Text style={advStyles.label}>Type</Text>
      <View style={advStyles.row}>
        {ADVERSARY_TYPES.map((type) => (
          <Chip key={type} label={type} on={draft.type === type} onPress={() => set({ type })} />
        ))}
      </View>
      {draft.type === "Horde" ? (
        <NumberField label="Creatures per HP" onChange={(n) => set({ hordePerHp: n ?? undefined })} value={draft.hordePerHp ?? null} />
      ) : null}
      <View style={advStyles.row}>
        <NumberField label="Difficulty" onChange={(n) => set({ difficulty: n ?? 0 })} value={draft.difficulty} />
        <NumberField label="HP" onChange={(n) => set({ hp: n ?? 0 })} value={draft.hp} />
        <NumberField label="Stress" onChange={(n) => set({ stress: n ?? 0 })} value={draft.stress} />
      </View>
      <View style={advStyles.row}>
        <NumberField label="Major threshold" onChange={(major) => set({ thresholds: { ...draft.thresholds, major } })} value={draft.thresholds.major} />
        <NumberField label="Severe threshold" onChange={(severe) => set({ thresholds: { ...draft.thresholds, severe } })} value={draft.thresholds.severe} />
      </View>
      <TextField label="Attack name" onChange={(name) => set({ attack: { ...draft.attack, name } })} value={draft.attack.name} />
      <View style={advStyles.row}>
        <NumberField label="Attack modifier" onChange={(modifier) => set({ attack: { ...draft.attack, modifier: modifier ?? 0 } })} value={draft.attack.modifier} />
        <View style={advStyles.grow}>
          <TextField label="Damage" onChange={(damage) => set({ attack: { ...draft.attack, damage } })} value={draft.attack.damage} />
        </View>
      </View>
      <Text style={advStyles.label}>Range</Text>
      <View style={advStyles.row}>
        {RANGES.map((range) => (
          <Chip key={range} label={range} on={draft.attack.range === range} onPress={() => set({ attack: { ...draft.attack, range } })} />
        ))}
      </View>
      <TextField label="Description" multiline onChange={(description) => set({ description })} value={draft.description} />
      <TextField label="Motives & Tactics" multiline onChange={(motives) => set({ motives })} value={draft.motives} />

      <Text style={advStyles.label}>Features</Text>
      {draft.features.map((feature, i) => (
        <View key={i} style={advStyles.paper}>
          <TextField label={`Feature ${i + 1} name`} onChange={(name) => setFeature(i, { name })} value={feature.name} />
          <View style={advStyles.row}>
            {FEATURE_KINDS.map((kind) => (
              <Chip key={kind} label={kind} on={feature.kind === kind} onPress={() => setFeature(i, { kind })} />
            ))}
          </View>
          <TextField label={`Feature ${i + 1} text`} multiline onChange={(text) => setFeature(i, { text })} value={feature.text} />
          <Button
            accessibilityLabel={`Remove feature ${i + 1}`}
            onPress={() => set({ features: draft.features.filter((_, j) => j !== i) })}
            variant="danger"
          >
            Remove feature
          </Button>
        </View>
      ))}
      <Button
        onPress={() => set({ features: [...draft.features, { name: "New feature", kind: "action", text: "" }] })}
        variant="outline"
      >
        + Add feature
      </Button>

      <ErrorLine message={formError ?? update.error} />
      <View style={advStyles.row}>
        <Button onPress={onDone} variant="outline">
          Cancel
        </Button>
        <Button disabled={!writes || update.pending} onPress={() => void save()} variant="solid">
          Save
        </Button>
      </View>
    </View>
  );
}
