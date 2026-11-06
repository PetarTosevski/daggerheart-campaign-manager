import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { ACCENTS } from "../../../../../src/lib/validation/campaigns";
import {
  readSettingsBackup,
  settingsBackupText,
  type SettingsView,
} from "../../../../../src/lib/validation/settings-backup";
import { api } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { sectionLabel } from "../../shell/sections";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";
import { QueryBoundary } from "../../ui/query-boundary";
import { PreferenceRows } from "./preferences";

type SettingsPatch = FunctionArgs<typeof api.settings.update>;
type MapStyle = "classic" | "sprites";
type Status = { text: string; ok: boolean };

/**
 * Account settings from `src/app/(gm)/settings-dialog.tsx`, plus the account's Preferences (the website's avatar
 * popover). Accent is stored here; the website applies it in `accent-sync.tsx`, which the phone shell owns. The
 * campaign route renders `CampaignSettingsScreen` instead.
 */
export function SettingsScreen() {
  return (
    <QueryBoundary>
      <SettingsBody />
    </QueryBoundary>
  );
}

function SettingsBody() {
  const settings = useQuery(api.settings.get);
  const viewer = useQuery(api.users.viewer);
  const [error, setError] = useState<string | null>(null);

  if (settings === undefined) {
    return <Loading label="Loading settings" />;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
    >
      <Text accessibilityRole="header" style={styles.title}>
        {sectionLabel("settings")}
      </Text>
      <TableFields onError={setError} settings={settings} />
      <AccentPicker onError={setError} settings={settings} />
      <Expansions onError={setError} settings={settings} />
      <MapStyleSlider onError={setError} style={settings.defaultMapStyle} />
      <QueryBoundary title="Preferences">
        <PreferenceRows />
      </QueryBoundary>
      <SavedData onReplaced={() => setError(null)} settings={settings} />
      <Account email={viewer?.email ?? null} onError={setError} />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function useSettingsUpdate() {
  const update = useMutation(api.settings.update);
  if (!("withOptimisticUpdate" in update)) return update;
  return update.withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.settings.get, {});
    if (current && args.defaultMapStyle) {
      store.setQuery(api.settings.get, {}, { ...current, defaultMapStyle: args.defaultMapStyle });
    }
  });
}

function useSave(onError: (message: string | null) => void) {
  const update = useSettingsUpdate();
  const writes = useWritesEnabled();
  return (patch: SettingsPatch) => {
    if (!writes) return;
    onError(null);
    void attempt(() => update(patch)).then((message) => {
      if (message) onError(message);
    });
  };
}

/** `null` when the call resolved. A thrown Convex or network error becomes its message. */
async function attempt(call: () => unknown): Promise<string | null> {
  try {
    await Promise.resolve(call());
    return null;
  } catch (error) {
    return shownError(error);
  }
}

const GENERIC_ERROR = "Something went wrong. Check your connection and try again.";

/**
 * `errorMessage` is the website's wording. Jest can load a second `convex`
 * for `src/lib`, so a `ConvexError` thrown in a test may fail `instanceof`
 * there; the payload still carries the message the server sent.
 */
function shownError(error: unknown): string {
  const text = errorMessage(error);
  if (text !== GENERIC_ERROR) return text;
  if (typeof error !== "object" || error === null || !("data" in error)) return text;
  const data = error.data;
  if (typeof data !== "object" || data === null || !("message" in data)) return text;
  return typeof data.message === "string" && data.message ? data.message : text;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.section}>
      {children}
    </Text>
  );
}

function TableFields({
  settings,
  onError,
}: {
  settings: SettingsView;
  onError: (message: string | null) => void;
}) {
  const save = useSave(onError);
  return (
    <View style={styles.sectionBlock}>
      <SectionTitle>Table</SectionTitle>
      <NameField
        label="Table name"
        maxLength={80}
        onSave={(value) => save({ tableName: value })}
        placeholder="e.g. Thursday Night Crew"
        value={settings.tableName}
      />
      <NameField
        label="Your name"
        maxLength={80}
        onSave={(value) => save({ gmName: value })}
        placeholder="Your name"
        value={settings.gmName}
      />
    </View>
  );
}

/**
 * A text field that saves on blur, one field per call (rule 12), without overwriting someone else's edit: while it is
 * not focused it shows the live value, so an edit made on the website shows at once; on focus it keeps the value it
 * started from, and on blur it saves only when the text (trimmed) differs from that starting value. Tapping in and out
 * of a field never writes back a value the field showed before a newer one arrived.
 */
export function useBlurField(value: string, onSave: (value: string) => void) {
  // The text being edited, or null while the field is not focused (it then shows `value`).
  const [draft, setDraft] = useState<string | null>(null);
  const atFocus = useRef(value);
  return {
    value: draft ?? value,
    onFocus: () => {
      atFocus.current = value;
      setDraft(value);
    },
    onChangeText: (next: string) => setDraft(next),
    onBlur: () => {
      const next = (draft ?? value).trim();
      setDraft(null);
      if (next !== atFocus.current.trim()) onSave(next);
    },
  };
}

function NameField({
  label,
  value,
  placeholder,
  maxLength,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  onSave: (value: string) => void;
}) {
  const writes = useWritesEnabled();
  const field = useBlurField(value, onSave);
  return (
    <View style={styles.field}>
      <Text accessible={false} style={styles.label}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        editable={writes}
        maxLength={maxLength}
        onBlur={field.onBlur}
        onChangeText={field.onChangeText}
        onFocus={field.onFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        style={styles.input}
        value={field.value}
      />
    </View>
  );
}

function AccentPicker({
  settings,
  onError,
}: {
  settings: SettingsView;
  onError: (message: string | null) => void;
}) {
  const save = useSave(onError);
  const writes = useWritesEnabled();
  return (
    <View style={styles.sectionBlock}>
      <SectionTitle>Display</SectionTitle>
      <Text style={styles.label}>
        Accent colour <Text style={styles.hint}>· menu and campaign dashboards</Text>
      </Text>
      <View accessibilityLabel="Accent colour" accessibilityRole="radiogroup" style={styles.swatches}>
        {ACCENTS.map((swatch) => {
          const checked = swatch.value === settings.accent;
          const state = { disabled: !writes, selected: checked };
          const onPress = () => save({ accent: swatch.value });
          const style = [
            styles.swatch,
            { backgroundColor: swatch.value, borderColor: checked ? colors.parchment : colors.line2 },
          ];
          return (
            <Pressable
              accessibilityLabel={swatch.label}
              accessibilityRole="radio"
              accessibilityState={state}
              disabled={!writes}
              key={swatch.value}
              onPress={onPress}
              style={style}
            />
          );
        })}
      </View>
    </View>
  );
}

function Expansions({
  settings,
  onError,
}: {
  settings: SettingsView;
  onError: (message: string | null) => void;
}) {
  const save = useSave(onError);
  const writes = useWritesEnabled();
  const hope = settings.expansions.hopeAndFear;
  return (
    <View style={styles.sectionBlock}>
      <SectionTitle>Expansions</SectionTitle>
      <Pressable
        accessibilityLabel="Hope & Fear"
        accessibilityRole="switch"
        accessibilityState={{ checked: hope ?? false, disabled: !writes }}
        disabled={!writes}
        onPress={() => save({ expansions: { hopeAndFear: !(hope ?? false) } })}
        style={styles.switchRow}
      >
        <View style={[styles.track, hope ? styles.trackOn : null]}>
          <View style={[styles.knob, hope ? styles.knobOn : null]} />
        </View>
        <View style={styles.switchCopy}>
          <Text accessible={false} style={styles.label}>
            Hope & Fear
          </Text>
          <Text style={styles.hint}>
            New campaigns start with Hope & Fear content. Change it per campaign on its dashboard.
          </Text>
          {hope === undefined ? (
            <Text style={styles.note}>Not set yet: each frame uses its own default.</Text>
          ) : null}
        </View>
      </Pressable>
      {hope !== undefined ? (
        <Button disabled={!writes} onPress={() => save({ expansions: { hopeAndFear: null } })} variant="outline">
          Use each frame’s default
        </Button>
      ) : null}
    </View>
  );
}

function MapStyleSlider({ style, onError }: { style: MapStyle; onError: (message: string | null) => void }) {
  const save = useSave(onError);
  const writes = useWritesEnabled();
  const sprites = style === "sprites";
  return (
    <View style={styles.sectionBlock}>
      <SectionTitle>Maps</SectionTitle>
      <Text style={styles.label}>
        Style of new maps <Text style={styles.hint}>· existing maps keep theirs</Text>
      </Text>
      <Pressable
        accessibilityLabel="Style of new maps"
        accessibilityRole="switch"
        accessibilityState={{ checked: sprites, disabled: !writes }}
        accessibilityValue={{ text: sprites ? "Sprites" : "Classic" }}
        disabled={!writes}
        onPress={() => {
          if (!writes) return;
          save({ defaultMapStyle: sprites ? "classic" : "sprites" });
        }}
        style={styles.mapRow}
      >
        <Text accessible={false} style={sprites ? styles.hint : styles.label}>
          Classic
        </Text>
        <View style={[styles.track, sprites ? styles.trackOn : null]}>
          <View style={[styles.knob, sprites ? styles.knobOn : null]} />
        </View>
        <Text accessible={false} style={sprites ? styles.label : styles.hint}>
          Sprites
        </Text>
      </Pressable>
    </View>
  );
}

function SavedData({ settings, onReplaced }: { settings: SettingsView; onReplaced: () => void }) {
  const restore = useMutation(api.settings.restore);
  const reset = useMutation(api.settings.reset);
  const writes = useWritesEnabled();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const showBackup = () => {
    setText(settingsBackupText(settings));
    setStatus({
      text: "Backup shown below and selected. Copy it (Ctrl/Cmd+C) and keep it somewhere safe.",
      ok: true,
    });
  };

  const restoreBackup = () => {
    if (!writes || busy) return;
    const read = readSettingsBackup(text);
    if (!read.ok) {
      setStatus({ text: read.message, ok: false });
      return;
    }
    setBusy(true);
    void attempt(() => restore({ text })).then((message) => {
      if (message) setStatus({ text: message, ok: false });
      else {
        onReplaced();
        setStatus({ text: "Settings restored from the backup.", ok: true });
      }
      setBusy(false);
    });
  };

  const resetSettings = () => {
    if (!writes || busy) return;
    setBusy(true);
    void attempt(() => reset({})).then((message) => {
      if (message) setStatus({ text: message, ok: false });
      else {
        setConfirming(false);
        onReplaced();
        setStatus({ text: "Settings reset to their defaults.", ok: true });
      }
      setBusy(false);
    });
  };

  return (
    <View style={styles.sectionBlock}>
      <SectionTitle>Saved data</SectionTitle>
      <Text style={styles.body}>
        Your campaigns are saved to your account and sync across devices. This backup covers your app settings: copy
        it to keep them, or paste one here to restore.
      </Text>
      <Button onPress={showBackup} variant="outline">
        Show backup
      </Button>
      <Button disabled={!writes || busy} onPress={restoreBackup} variant="outline">
        Restore from pasted backup
      </Button>
      <Button disabled={!writes || busy} onPress={() => setConfirming(true)} variant="danger">
        Reset settings…
      </Button>
      <TextInput
        accessibilityLabel="Backup data"
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        onChangeText={setText}
        placeholder="Your backup appears here. To restore, paste a backup and press Restore."
        placeholderTextColor={colors.faint}
        spellCheck={false}
        style={styles.backup}
        value={text}
      />
      {status ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole={status.ok ? "text" : "alert"} style={status.ok ? styles.ok : styles.error}>
          {status.text}
        </Text>
      ) : null}
      {confirming ? (
        <View accessibilityLabel="Confirm reset" accessibilityRole="alert" style={styles.confirm}>
          <Text style={styles.confirmText}>
            Put your table name, name, accent colour, expansion defaults and map style back to their defaults? Your
            campaigns are not affected.
          </Text>
          <Button onPress={() => setConfirming(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={!writes || busy} onPress={resetSettings} variant="dangerSolid">
            Reset
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function Account({ email, onError }: { email: string | null; onError: (message: string | null) => void }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  return (
    <View style={styles.sectionBlock}>
      <SectionTitle>Account</SectionTitle>
      <Text style={styles.body}>
        Signed in as <Text accessibilityLabel="Signed in email">{email ?? "…"}</Text>
      </Text>
      <Button
        onPress={() => {
          onError(null);
          void attempt(() => signOut()).then((message) => {
            if (message) onError(message);
            else router.replace("/sign-in");
          });
        }}
        variant="outline"
      >
        Sign out
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap: space[6],
    paddingBottom: space[8],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  sectionBlock: {
    gap: space[3],
  },
  section: {
    color: colors.mutedText,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 12,
    fontWeight: type.sansMedium.fontWeight,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  field: {
    gap: space[2],
  },
  label: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontWeight: type.sans.fontWeight,
  },
  hint: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    fontWeight: type.sans.fontWeight,
  },
  note: {
    color: colors.hope,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    fontWeight: type.sans.fontWeight,
  },
  body: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontWeight: type.sans.fontWeight,
  },
  input: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    minHeight: hit.minHeight,
    paddingHorizontal: space[3],
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  swatch: {
    borderRadius: 22,
    borderWidth: 3,
    height: hit.minHeight,
    width: hit.minHeight,
  },
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[3],
    minHeight: hit.minHeight,
  },
  switchCopy: {
    flex: 1,
    gap: space[1],
  },
  mapRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space[3],
    minHeight: hit.minHeight,
  },
  track: {
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 56,
  },
  trackOn: {
    backgroundColor: colors.hopeBg,
  },
  knob: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    height: 20,
    marginLeft: 3,
    width: 20,
  },
  knobOn: {
    marginLeft: 31,
  },
  backup: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    minHeight: 110,
    padding: space[3],
    textAlignVertical: "top",
  },
  ok: {
    backgroundColor: colors.okBg,
    borderColor: colors.okLine,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ok,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    padding: space[3],
  },
  error: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerLine,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    padding: space[3],
  },
  confirm: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerLine,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  confirmText: {
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    fontWeight: type.sans.fontWeight,
  },
});
