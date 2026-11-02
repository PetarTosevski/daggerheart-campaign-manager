import { useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { ALLEGIANCE_UNKNOWN, factionsFor, regionsFor, type CodexPatch } from "../../../../../src/lib/codex/schema";
import { allegianceNote, type GmEntry } from "../../../../../src/lib/codex/view";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";

import { Cover } from "./cover";
import { Gallery, Lightbox, type LightboxState } from "./gallery";
import { PinPicker } from "./pin-picker";
import type { CodexPin } from "./types";
import { codexStyles } from "./styles";

export function GmDetail({
  campaignId,
  frameId,
  entry,
  pins,
  entries,
  onDeleted,
}: {
  campaignId: string;
  frameId: string;
  entry: GmEntry;
  pins: CodexPin[];
  entries: GmEntry[];
  onDeleted: () => void;
}) {
  const router = useRouter();
  const update = useMutation(api.codex.update);
  const setPin = useMutation(api.codex.setPin);
  const remove = useMutation(api.codex.remove);
  const writes = useWritesEnabled();
  const text = useQuery(api.codex.entryText, { entryId: entry._id as Id<"codexEntries"> });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pickPin, setPickPin] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const entryId = entry._id as Id<"codexEntries">;
  const isLoc = entry.kind === "location";
  const factions = factionsFor(frameId);
  const regions = regionsFor(frameId);
  const coverUrl = entry.images.find((image) => image.key === entry.cover)?.url ?? null;
  async function run(op: () => Promise<unknown>) {
    setError(null);
    try {
      await op();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function save(patch: CodexPatch) {
    if (!writes) return;
    void run(() => update({ entryId, patch }));
  }

  return (
    <View style={codexStyles.stack}>
      <View style={codexStyles.card}>
        <Cover
          gm
          name={entry.name}
          onOpen={() => {
            if (entry.cover) setLightbox({ entryId: entry._id, key: entry.cover });
          }}
          url={coverUrl}
        />
        <FieldInput
          editable={writes}
          fieldKey={`${entry._id}-name`}
          label="Name"
          maxLength={120}
          onSave={(value) => save({ name: value })}
          placeholder={isLoc ? "e.g. The Sunken Abbey" : "e.g. Kreil Dirn"}
          style={[codexStyles.input, codexStyles.inputTitle]}
          value={entry.name}
        />
        <FieldInput
          editable={writes}
          fieldKey={`${entry._id}-role`}
          label={isLoc ? "Kind of place" : "Role"}
          maxLength={160}
          onSave={(value) => save({ role: value })}
          placeholder={isLoc ? "e.g. Ruined temple, Haven district" : "e.g. Haven’s spymaster"}
          style={codexStyles.input}
          value={entry.role}
        />

        {!isLoc ? (
          <View style={codexStyles.card}>
            <Text style={codexStyles.label}>True allegiance</Text>
            <View style={codexStyles.tabRow}>
              <AllegiancePick
                label="Unassigned"
                onPick={() => save({ allegiance: "" })}
                selected={entry.allegiance === ""}
              />
              {factions.map((faction) => (
                <AllegiancePick
                  key={faction}
                  label={faction}
                  onPick={() => save({ allegiance: faction })}
                  selected={entry.allegiance === faction}
                />
              ))}
            </View>
            <Text style={codexStyles.label}>Players see</Text>
            <View style={codexStyles.tabRow}>
              <AllegiancePick
                label="Unknown"
                onPick={() => save({ allegianceShown: ALLEGIANCE_UNKNOWN })}
                selected={entry.allegianceShown === ALLEGIANCE_UNKNOWN}
              />
              {factions.map((faction) => (
                <AllegiancePick
                  key={`shown-${faction}`}
                  label={faction}
                  onPick={() => save({ allegianceShown: faction })}
                  selected={entry.allegianceShown === faction}
                />
              ))}
            </View>
            <Text style={codexStyles.muted}>{allegianceNote(entry.allegiance, entry.allegianceShown)}</Text>
            {entry.allegiance && entry.allegianceShown !== entry.allegiance ? (
              <Button onPress={() => save({ allegianceShown: entry.allegiance })} variant="outline">
                Reveal true allegiance
              </Button>
            ) : null}
          </View>
        ) : null}

        {isLoc && regions.length ? (
          <View style={codexStyles.card}>
            <Text style={codexStyles.label}>Region</Text>
            {entry.regionAuto ? (
              <Text style={codexStyles.subhead}>
                {entry.region || "Unsorted"} · from map pin
              </Text>
            ) : (
              <View style={codexStyles.tabRow}>
                <AllegiancePick label="Unsorted" onPick={() => save({ region: "" })} selected={entry.region === ""} />
                {regions.map((region) => (
                  <AllegiancePick key={region} label={region} onPick={() => save({ region })} selected={entry.region === region} />
                ))}
              </View>
            )}
            <Text style={codexStyles.muted}>
              {entry.regionAuto
                ? "Set automatically from where its pin sits on the World map."
                : "Pick a region, or link this place to a map pin to set it automatically."}
            </Text>
          </View>
        ) : null}

        <View style={codexStyles.row}>
          <Button
            accessibilityLabel={entry.known ? "Known to players" : "Secret from players"}
            onPress={() => save({ known: !entry.known })}
            variant={entry.known ? "solid" : "danger"}
          >
            {entry.known ? "Known to players" : "Secret from players"}
          </Button>
          {isLoc ? (
            <Button disabled={pins.length === 0 || !writes} onPress={() => setPickPin(true)} variant="outline">
              {entry.tokenId !== null ? "Change pin" : "Link to map pin"}
            </Button>
          ) : null}
          {entry.tokenId !== null ? (
            <>
              <Button
                onPress={() => {
                  router.push(`/campaign/${campaignId}/world?token=${entry.tokenId}`);
                }}
                variant="outline"
              >
                Show on map
              </Button>
              <Button
                onPress={() => {
                  void run(() => setPin({ entryId, tokenId: null }));
                }}
                variant="outline"
              >
                Unlink pin
              </Button>
            </>
          ) : null}
          <Button
            onPress={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              void run(async () => {
                await remove({ entryId });
                onDeleted();
              });
            }}
            variant="danger"
          >
            {confirmDelete ? "Click again to delete" : "Delete"}
          </Button>
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={codexStyles.error}>
            {error}
          </Text>
        ) : null}
      </View>

      <Gallery
        entry={entry}
        gm
        onOpen={(key) => {
          setLightbox({ entryId: entry._id, key });
        }}
      />

      {text === undefined ? (
        <Text accessibilityRole="progressbar" style={codexStyles.muted}>
          Loading notes…
        </Text>
      ) : text?.role === "gm" ? (
        <View style={codexStyles.stack}>
          <View style={codexStyles.card}>
            <Text style={codexStyles.muted}>Shown in Player view once this entry is known.</Text>
            <FieldInput
              editable={writes}
              fieldKey={`${entry._id}-pdesc`}
              label="What the players know"
              maxLength={8000}
              multiline
              onSave={(value) => save({ pdesc: value })}
              placeholder={isLoc ? "What the party has seen or heard about this place…" : "What the party knows about this person…"}
              style={[codexStyles.input, codexStyles.textarea]}
              value={text.pdesc}
            />
          </View>
          <View style={codexStyles.card}>
            <Text style={codexStyles.muted}>Never shown to players.</Text>
            <FieldInput
              editable={writes}
              fieldKey={`${entry._id}-gmn`}
              label="GM notes"
              maxLength={8000}
              multiline
              onSave={(value) => save({ gmn: value })}
              placeholder="Secrets, motives, stats, hooks…"
              style={[codexStyles.input, codexStyles.textarea]}
              value={text.gmn}
            />
          </View>
        </View>
      ) : null}

      {lightbox ? (
        <Lightbox
          images={entry.images}
          onChange={setLightbox}
          onClose={() => setLightbox(null)}
          state={lightbox}
          title={entry.name}
        />
      ) : null}
      <PinPicker
        entries={entries}
        entry={entry}
        frameId={frameId}
        onClose={() => setPickPin(false)}
        open={pickPin}
        pins={pins}
      />
    </View>
  );
}

function AllegiancePick({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : undefined}
      onPress={onPick}
      style={[codexStyles.tab, selected ? codexStyles.tabOn : null]}
    >
      <Text style={[codexStyles.tabText, selected ? codexStyles.tabTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

function FieldInput({
  label,
  value,
  fieldKey,
  editable,
  onSave,
  placeholder,
  maxLength,
  multiline,
  style,
}: {
  label: string;
  value: string;
  fieldKey: string;
  editable: boolean;
  onSave: (next: string) => void;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  style: object | object[];
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <>
      <Text style={codexStyles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
        key={fieldKey}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={setDraft}
        onEndEditing={() => {
          const next = draft ?? value;
          setDraft(null);
          if (next !== value) onSave(next);
        }}
        onFocus={() => setDraft(value)}
        placeholder={placeholder}
        style={style}
        value={shown}
      />
    </>
  );
}
