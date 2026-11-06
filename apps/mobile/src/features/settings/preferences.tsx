import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState } from "react";
import { Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import {
  DICE_VOLUME_MAX,
  DICE_VOLUME_MIN,
  TEXT_SIZES,
  clampVolume,
  type TextSize,
} from "../../../../../src/lib/config/preferences";
import { api } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";
import { ChoiceRow, SectionTitle, SwitchRow, controlStyles } from "./controls";

/** One preference, changed alone (rule 12: a single-field intent). */
export type PreferenceChange = FunctionArgs<typeof api.preferences.set>["change"];

/** The website's text for the Preferences rows (`src/components/config/prefs/index.tsx`, `PREFS_TEXT`). */
export const PREFS_TEXT = {
  title: "Preferences",
  dice3d: { label: "3D dice", hint: "Rolls tumble across the screen." },
  diceSound: { label: "Dice sound" },
  volume: { label: "Volume", aria: "Dice volume" },
  reduceMotion: { label: "Reduce motion", hint: "Calmer sheet and card animations." },
  textSize: { label: "Text size" },
  spotlightPing: { label: "Ping me when I get the spotlight" },
} as const;

const TEXT_SIZE_CHOICES: readonly { value: TextSize; label: string }[] = TEXT_SIZES.map((value) => ({
  value,
  label: { small: "Small", medium: "Medium", large: "Large" }[value],
}));

/** One tap of the volume buttons. The phone has no slider; each tap saves the new volume (one intent per tap). */
export const VOLUME_STEP = 10;

/**
 * `preferences.set` with an optimistic update on `preferences.get` (rule 12): the switch moves at once and rolls back
 * if the server refuses, as the website's `useSetPreference`.
 */
function useSetPreference() {
  const set = useMutation(api.preferences.set);
  if (!("withOptimisticUpdate" in set)) return set;
  return set.withOptimisticUpdate((store, { change }) => {
    const current = store.getQuery(api.preferences.get, {});
    if (current !== undefined) store.setQuery(api.preferences.get, {}, { ...current, [change.key]: change.value });
  });
}

/**
 * The account's Preferences (plan config U6a, design `.pm-pop .row`), for everyone: each control saves one field with
 * `preferences.set`. Saved to the account, so they follow the user to the website.
 */
export function PreferenceRows() {
  const prefs = useQuery(api.preferences.get, {});
  const set = useSetPreference();
  const writes = useWritesEnabled();
  const [error, setError] = useState<string | null>(null);

  if (prefs === undefined) return <Loading label="Loading preferences" />;

  const change = (next: PreferenceChange) => {
    if (!writes) return;
    setError(null);
    void Promise.resolve()
      .then(() => set({ change: next }))
      .catch((e: unknown) => setError(errorMessage(e)));
  };
  const volume = (delta: number) => {
    const next = clampVolume(prefs.diceVolume + delta);
    if (next !== prefs.diceVolume) change({ key: "diceVolume", value: next });
  };

  return (
    <View style={controlStyles.block}>
      <SectionTitle>{PREFS_TEXT.title}</SectionTitle>
      <SwitchRow
        {...PREFS_TEXT.dice3d}
        checked={prefs.dice3d}
        disabled={!writes}
        onChange={(value) => change({ key: "dice3d", value })}
      />
      <SwitchRow
        {...PREFS_TEXT.diceSound}
        checked={prefs.diceSound}
        disabled={!writes}
        onChange={(value) => change({ key: "diceSound", value })}
      />
      <View style={controlStyles.switchRow}>
        <View style={controlStyles.rowText}>
          <Text accessible={false} style={controlStyles.label}>
            {PREFS_TEXT.volume.label}
          </Text>
          <Text accessibilityLabel={PREFS_TEXT.volume.aria} style={controlStyles.hint}>
            {String(prefs.diceVolume)}
          </Text>
        </View>
        <Button
          accessibilityLabel="Quieter"
          disabled={!writes || prefs.diceVolume <= DICE_VOLUME_MIN}
          onPress={() => volume(-VOLUME_STEP)}
          variant="outline"
        >
          −
        </Button>
        <Button
          accessibilityLabel="Louder"
          disabled={!writes || prefs.diceVolume >= DICE_VOLUME_MAX}
          onPress={() => volume(VOLUME_STEP)}
          variant="outline"
        >
          +
        </Button>
      </View>
      <SwitchRow
        {...PREFS_TEXT.reduceMotion}
        checked={prefs.reduceMotion}
        disabled={!writes}
        onChange={(value) => change({ key: "reduceMotion", value })}
      />
      <ChoiceRow
        choices={TEXT_SIZE_CHOICES}
        disabled={!writes}
        label={PREFS_TEXT.textSize.label}
        onChange={(value) => change({ key: "textSize", value })}
        value={prefs.textSize}
      />
      <SwitchRow
        {...PREFS_TEXT.spotlightPing}
        checked={prefs.spotlightPing}
        disabled={!writes}
        onChange={(value) => change({ key: "spotlightPing", value })}
      />
      {error ? (
        <Text accessibilityRole="alert" style={controlStyles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
