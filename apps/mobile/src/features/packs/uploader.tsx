import { useMutation } from "convex/react";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import type { RgbaImage } from "../../../../../src/lib/sprite-packs/cut";
import {
  MAX_PACK_SPRITES,
  MAX_SPRITE_BYTES,
  MAX_SPRITE_NAME,
  MAX_SPRITE_PX,
} from "../../../../../convex/lib/validators/spritePacks";
import type { PackRow } from "../../../../../convex/spritePacks";
import { api, type Id } from "../../convex";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { cutImages, layoutLabel } from "./cut-files";
import { SpriteFields, type FieldChange } from "./fields";
import {
  classicAfterLight,
  cleanName,
  defaultLabels,
  SHEET_LAYOUT_INFO,
  SHEET_LAYOUTS,
  suggestClassic,
  type SheetLayout,
  type SpriteLabels,
} from "./labels";
import { asyncThumbnail, encodeSprite, maxSideForLabels, readPickedSheet, SheetError } from "./sheet-image";
import { styles } from "./styles";

type Status = { state: "idle" } | { state: "uploading" } | { state: "done" } | { state: "error"; message: string };

type CutRow = {
  key: string;
  image: RgbaImage;
  thumb: string;
  labels: SpriteLabels;
  classicPicked: boolean;
  selected: boolean;
  status: Status;
};

type Loaded = { image: RgbaImage; source: string };

let rowKeys = 0;

function relabel(row: CutRow, change: FieldChange): CutRow {
  const labels: SpriteLabels = { ...row.labels, ...change } as SpriteLabels;
  if ("classicKind" in change) return { ...row, labels, classicPicked: true };
  if (!row.classicPicked) return { ...row, labels: { ...labels, classicKind: suggestClassic(labels) } };
  if ("light" in change) return { ...row, labels: { ...labels, classicKind: classicAfterLight(labels.classicKind, labels) } };
  return { ...row, labels };
}

export function Uploader({ campaignId, pack }: { campaignId: Id<"campaigns">; pack: PackRow }) {
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [layout, setLayout] = useState<SheetLayout>("auto");
  const [rows, setRows] = useState<CutRow[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [read, setRead] = useState<string | null>(null);
  const [busy, setBusy] = useState<"cutting" | "uploading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadUrl = useMutation(api.spritePacks.spriteUploadUrl);
  const attach = useMutation(api.spritePacks.attachSprite);

  async function cut(images: Loaded[], chosen: SheetLayout) {
    setBusy("cutting");
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const outcomes = cutImages(images, chosen);
      const next: CutRow[] = [];
      for (const outcome of outcomes) {
        for (const piece of outcome.pieces) {
          const labels = defaultLabels(outcome.layout, next.length);
          next.push({
            key: `cut-${++rowKeys}`,
            image: piece.image,
            thumb: "",
            labels,
            classicPicked: false,
            selected: true,
            status: { state: "idle" },
          });
        }
      }
      for (const row of next) {
        row.thumb = await asyncThumbnail(row.image);
      }
      setRows(next);
      setNotes(outcomes.flatMap((o) => o.notes));
      setRead(chosen === "auto" ? [...new Set(outcomes.map((o) => layoutLabel(o.layout)))].join(", ") : null);
    } finally {
      setBusy(null);
    }
  }

  async function pickImages() {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images"],
      quality: 1,
    });
    if (result.canceled) return;
    const images: Loaded[] = [];
    try {
      for (const asset of result.assets) {
        images.push({
          image: await readPickedSheet(asset.uri, asset.fileName ?? "image", asset.mimeType ?? undefined),
          source: asset.fileName ?? "image",
        });
      }
    } catch (e) {
      setError(e instanceof SheetError ? e.message : "Couldn't read that image.");
      return;
    }
    setLoaded(images);
    await cut(images, layout);
  }

  function chooseLayout(next: SheetLayout) {
    setLayout(next);
    if (loaded.length > 0) void cut(loaded, next);
  }

  function update(key: string, change: (row: CutRow) => CutRow) {
    setRows((current) => current.map((row) => (row.key === key ? change(row) : row)));
  }

  const chosen = rows.filter((r) => r.selected && r.status.state !== "done");
  const room = MAX_PACK_SPRITES - pack.sprites.length;

  async function uploadSelected() {
    setError(null);
    if (chosen.length > room) {
      setError(`This pack has room for ${room} more sprite${room === 1 ? "" : "s"}; untick ${chosen.length - room}.`);
      return;
    }
    const named = chosen.find((r) => cleanName(r.labels.name, MAX_SPRITE_NAME) === null);
    if (named) {
      setError(`Every sprite needs a name of 1 to ${MAX_SPRITE_NAME} characters.`);
      return;
    }
    setBusy("uploading");
    try {
      for (const row of chosen) {
        update(row.key, (r) => ({ ...r, status: { state: "uploading" } }));
        try {
          const { blob, px, contentType } = await encodeSprite(
            row.image,
            maxSideForLabels(row.labels.category, row.labels.w, row.labels.h, MAX_SPRITE_PX),
            MAX_SPRITE_BYTES,
          );
          const url = await uploadUrl({ campaignId });
          const res = await fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body: blob });
          if (!res.ok) throw new SheetError("The upload failed. Try again.");
          const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
          const { name, terrain, ...labels } = row.labels;
          const texture = labels.category === "texture";
          const result = await attach({
            campaignId,
            packId: pack._id,
            storageId,
            ...labels,
            name: name.trim(),
            footprint: labels.w === labels.h ? "circle" : "rect",
            ...(texture ? { terrain, rotatable: true } : {}),
            px,
          });
          update(row.key, (r) => ({
            ...r,
            selected: !result.ok,
            status: result.ok ? { state: "done" } : { state: "error", message: result.message },
          }));
        } catch (e) {
          const message = e instanceof SheetError ? e.message : errorMessage(e);
          update(row.key, (r) => ({ ...r, status: { state: "error", message } }));
        }
      }
    } finally {
      setBusy(null);
    }
  }

  function clear() {
    setLoaded([]);
    setRows([]);
    setNotes([]);
    setRead(null);
    setError(null);
  }

  const done = rows.filter((r) => r.status.state === "done").length;

  return (
    <View accessibilityLabel={`Add sprites to ${pack.name}`} style={{ gap: space[3] }}>
      <Text style={styles.muted}>
        Choose a sprite sheet or single sprites. They are cut on your phone; only the sprites you pick are uploaded.
      </Text>
      <Button disabled={busy !== null} onPress={() => void pickImages()} variant="outline">
        Choose images…
      </Button>
      <Text style={styles.label}>Sheet layout</Text>
      <View style={styles.row}>
        {SHEET_LAYOUTS.map((l) => (
          <Button key={l} disabled={busy !== null} onPress={() => chooseLayout(l)} variant={layout === l ? "solid" : "outline"}>
            {SHEET_LAYOUT_INFO[l].label}
          </Button>
        ))}
      </View>
      {busy === "cutting" ? (
        <Text accessibilityRole="status" style={styles.muted}>
          Cutting…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.err}>
          {error}
        </Text>
      ) : null}
      {rows.length > 0 ? (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {rows.length} cut{rows.length === 1 ? "" : "s"}
            {read ? ` · read as ${read}` : ""}
            {done > 0 ? ` · ${done} uploaded` : ""}
          </Text>
          <View style={styles.row}>
            <Button
              onPress={() => setRows((rs) => rs.map((r) => ({ ...r, selected: r.status.state !== "done" })))}
              variant="outline"
            >
              Select all
            </Button>
            <Button onPress={() => setRows((rs) => rs.map((r) => ({ ...r, selected: false })))} variant="outline">
              Select none
            </Button>
          </View>
          {notes.length > 0 ? (
            <View accessibilityLabel="Cut notes">
              {notes.map((note) => (
                <Text key={note} style={styles.muted}>
                  {note}
                </Text>
              ))}
            </View>
          ) : null}
          <View style={styles.spriteList}>
            {rows.map((row, i) => (
              <CutCard key={row.key} index={i} onChange={(change) => update(row.key, change)} row={row} />
            ))}
          </View>
          <View style={styles.row}>
            <Button disabled={busy !== null || chosen.length === 0} onPress={() => void uploadSelected()} variant="primary">
              {busy === "uploading" ? "Uploading…" : `Upload selected (${chosen.length})`}
            </Button>
            <Button disabled={busy !== null} onPress={clear} variant="outline">
              Clear
            </Button>
          </View>
        </>
      ) : null}
    </View>
  );
}

function CutCard({ row, index, onChange }: { row: CutRow; index: number; onChange: (change: (row: CutRow) => CutRow) => void }) {
  const done = row.status.state === "done";
  return (
    <View accessibilityLabel={`Cut ${index + 1}: ${row.labels.name}`} style={styles.spriteCard}>
      <View style={styles.row}>
        {row.thumb ? <Image source={{ uri: row.thumb }} style={styles.thumb} /> : <View style={styles.thumb} />}
        <View style={{ flex: 1, gap: 6 }}>
          <View style={styles.row}>
            <Switch
              accessibilityLabel={`Upload cut ${index + 1}`}
              disabled={done}
              onValueChange={(selected) => onChange((r) => ({ ...r, selected }))}
              value={row.selected}
            />
            <Text style={styles.muted}>Upload</Text>
          </View>
          {row.status.state === "uploading" ? <Text style={styles.muted}>Uploading…</Text> : null}
          {done ? <Text style={styles.muted}>Uploaded</Text> : null}
          {row.status.state === "error" ? (
            <Text accessibilityRole="alert" style={styles.err}>
              {row.status.message}
            </Text>
          ) : null}
        </View>
      </View>
      <Text style={styles.label}>Name</Text>
      <TextInput
        editable={!done}
        maxLength={MAX_SPRITE_NAME}
        onChangeText={(name) => onChange((r) => ({ ...r, labels: { ...r.labels, name } }))}
        style={styles.input}
        value={row.labels.name}
      />
      <SpriteFields onChange={(change) => onChange((r) => relabel(r, change))} values={row.labels} />
    </View>
  );
}
