import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { CUSTOM_BACKGROUNDS, CUSTOM_TONES } from "../../../../../src/lib/frames";
import {
  CAMPAIGN_NAME_MAX,
  CUSTOM_TEXT_MAX,
  PARTY_SIZES,
  STARTING_TIERS,
  type CustomFrameInput,
} from "../../../../../src/lib/validation/campaigns";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { AccountHeader } from "./chrome";
import { useCreateCampaign } from "./create-campaign";
import { accountStyles } from "./styles";

type Draft = CustomFrameInput & { name: string };

const EMPTY: Draft = {
  name: "",
  pitch: "",
  tones: ["Adventurous", "Heroic"],
  themes: "",
  touchstones: "",
  partySize: 4,
  startingTier: 1,
  background: "custom",
};

/** Custom section from `src/app/(gm)/new/custom-frame-form.tsx`. */
export function CustomFrameScreen() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const { submit, pending, error } = useCreateCampaign({ onCreated: () => setDraft(EMPTY) });
  const customName = draft.name.trim();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });

  return (
    <ScrollView contentContainerStyle={accountStyles.content} keyboardShouldPersistTaps="handled" style={accountStyles.screen}>
      <AccountHeader backHref="/new" backLabel="Back to campaign frames" title="Custom frame" />

      <Text style={accountStyles.label}>Campaign name</Text>
      <TextInput
        accessibilityLabel="Campaign name"
        maxLength={CAMPAIGN_NAME_MAX}
        onChangeText={(value) => set("name", value)}
        placeholder="Name your campaign"
        placeholderTextColor={colors.faint}
        style={accountStyles.input}
        value={draft.name}
      />

      <Text style={accountStyles.label}>Party size</Text>
      <View style={styles.chips}>
        {PARTY_SIZES.map((n) => (
          <Chip checked={draft.partySize === n} key={n} label={String(n)} onPress={() => set("partySize", n)} />
        ))}
      </View>

      <Text style={accountStyles.label}>Starting tier</Text>
      <View style={styles.chips}>
        {STARTING_TIERS.map((t) => (
          <Chip
            checked={draft.startingTier === t.tier}
            key={t.tier}
            label={`Tier ${t.tier} · Lvl ${t.level}`}
            onPress={() => set("startingTier", t.tier)}
          />
        ))}
      </View>

      <Text style={accountStyles.label}>The pitch</Text>
      <TextInput
        accessibilityLabel="The pitch"
        maxLength={CUSTOM_TEXT_MAX}
        multiline
        numberOfLines={4}
        onChangeText={(value) => set("pitch", value)}
        placeholder="What is this campaign about?"
        placeholderTextColor={colors.faint}
        style={[accountStyles.input, styles.textArea]}
        value={draft.pitch}
      />

      <Text style={accountStyles.label}>Tone & feel</Text>
      <View style={styles.chips}>
        {CUSTOM_TONES.map((tone) => {
          const on = draft.tones.includes(tone);
          return (
            <Chip
              checked={on}
              key={tone}
              label={tone}
              onPress={() => {
                const next = on ? draft.tones.filter((t) => t !== tone) : [...draft.tones, tone];
                set("tones", next);
              }}
            />
          );
        })}
      </View>

      <Text style={accountStyles.label}>Themes</Text>
      <TextInput
        accessibilityLabel="Themes"
        maxLength={CUSTOM_TEXT_MAX}
        multiline
        onChangeText={(value) => set("themes", value)}
        placeholderTextColor={colors.faint}
        style={[accountStyles.input, styles.textArea]}
        value={draft.themes}
      />

      <Text style={accountStyles.label}>Touchstones</Text>
      <TextInput
        accessibilityLabel="Touchstones"
        maxLength={CUSTOM_TEXT_MAX}
        multiline
        onChangeText={(value) => set("touchstones", value)}
        placeholderTextColor={colors.faint}
        style={[accountStyles.input, styles.textArea]}
        value={draft.touchstones}
      />

      <Text style={accountStyles.label}>Background art</Text>
      <View style={styles.chips}>
        {CUSTOM_BACKGROUNDS.map((bg) => (
          <Chip checked={draft.background === bg.id} key={bg.id} label={bg.label} onPress={() => set("background", bg.id)} />
        ))}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={accountStyles.error}>
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button onPress={() => router.back()} size="lg" variant="outline">
          Back
        </Button>
        <Button
          disabled={pending || customName.length === 0}
          onPress={() => {
            const { name, ...custom } = draft;
            void submit({ frameId: "custom", name: customName, custom });
          }}
          size="lg"
          variant="primary"
        >
          {pending ? "Creating…" : "Start custom campaign"}
        </Button>
      </View>
    </ScrollView>
  );
}

function Chip({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: checked }} onPress={onPress} style={[styles.chip, checked && styles.chipOn]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
    justifyContent: "flex-end",
  },
  chip: {
    borderColor: colors.line2,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  chipOn: {
    borderColor: colors.brand,
    backgroundColor: colors.raised,
  },
  chipText: {
    ...type.sans,
    color: colors.parchment,
    fontSize: 14,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  textArea: {
    minHeight: 96,
    paddingTop: space[3],
    textAlignVertical: "top",
  },
});
