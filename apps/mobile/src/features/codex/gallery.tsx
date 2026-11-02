import { useMutation } from "convex/react";
import { Image } from "expo-image";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { MAX_CODEX_IMAGES } from "../../../../../src/lib/codex/schema";
import type { GmEntry, PlayerEntry } from "../../../../../src/lib/codex/view";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";

type Img = { key: string; url: string | null; shown?: boolean };

export type LightboxState = { entryId: string; key: string };

export function Gallery({
  entry,
  gm,
  onOpen,
}: {
  entry: GmEntry | PlayerEntry;
  gm: boolean;
  onOpen: (key: string) => void;
}) {
  const uploadUrl = useMutation(api.codex.imageUploadUrl);
  const attach = useMutation(api.codex.attachImage);
  const setShown = useMutation(api.codex.setImageShown);
  const setCover = useMutation(api.codex.setCover);
  const removeImage = useMutation(api.codex.removeImage);
  const writes = useWritesEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const entryId = entry._id as Id<"codexEntries">;
  const images: Img[] = entry.images;
  const full = images.length >= MAX_CODEX_IMAGES;
  const name = entry.name || "this entry";

  async function run(op: () => Promise<unknown>) {
    setError(null);
    try {
      await op();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function addFromLibrary() {
    if (full || !writes) return;
    setBusy(true);
    try {
      const picker = await import("expo-image-picker");
      const picked = await picker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.86 });
      if (picked.canceled || picked.assets[0] === undefined) return;
      const asset = picked.assets[0];
      const url = await uploadUrl({ entryId });
      const file = await fetch(asset.uri);
      const body = await file.blob();
      const uploaded = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        body,
      });
      if (!uploaded.ok) throw new Error("The upload failed. Try again.");
      const stored = (await uploaded.json()) as { storageId?: string };
      if (!stored.storageId) throw new Error("The upload failed. Try again.");
      const result = await attach({ entryId, storageId: stored.storageId as Id<"_storage"> });
      if (result.error) setError(result.error);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Images
      </Text>
      {gm ? (
        <Text style={styles.note}>Reveal an image to let the players see it. Revealing one also marks the entry as known.</Text>
      ) : null}
      {!gm && images.length === 0 ? <Text style={styles.note}>Nothing to show yet.</Text> : null}
      <View style={styles.grid}>
        {images.map((image) => {
          const hidden = gm && !image.shown;
          const isCover = entry.cover === image.key;
          return (
            <View key={image.key} style={[styles.tile, hidden ? styles.tileHidden : null]}>
              <Pressable
                accessibilityLabel={`Open image of ${name}${gm ? (image.shown ? " (revealed)" : " (hidden from players)") : ""}`}
                accessibilityRole="button"
                onPress={() => onOpen(image.key)}
                style={styles.tileOpen}
              >
                {image.url ? (
                  <Image accessibilityIgnoresInvertColors source={{ uri: image.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Text style={styles.placeholder}>No preview</Text>
                )}
              </Pressable>
              {gm ? (
                <View style={styles.tools}>
                  <Button
                    accessibilityLabel={image.shown ? "Hide image from players" : "Reveal image to players"}
                    onPress={() => {
                      void run(() => setShown({ entryId, storageId: image.key, shown: !image.shown }));
                    }}
                    size="md"
                    variant={image.shown ? "solid" : "outline"}
                  >
                    {image.shown ? "Revealed" : "Hidden"}
                  </Button>
                  <View style={styles.toolRow}>
                    <Button
                      accessibilityLabel="Use as the main picture"
                      onPress={() => {
                        void run(() => setCover({ entryId, storageId: image.key }));
                      }}
                      size="md"
                      variant={isCover ? "solid" : "outline"}
                    >
                      Main
                    </Button>
                    <Button
                      accessibilityLabel={confirmKey === image.key ? "Confirm delete image" : "Delete image"}
                      onPress={() => {
                        if (confirmKey !== image.key) {
                          setConfirmKey(image.key);
                          return;
                        }
                        setConfirmKey(null);
                        void run(() => removeImage({ entryId, storageId: image.key }));
                      }}
                      size="md"
                      variant="danger"
                    >
                      {confirmKey === image.key ? "Sure?" : "Delete"}
                    </Button>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        {gm ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={busy || full || !writes ? { disabled: true } : undefined}
            disabled={busy || full || !writes}
            onPress={() => {
              void addFromLibrary();
            }}
            style={[styles.addTile, full ? styles.addTileFull : null]}
          >
            <Text style={styles.addGlyph}>＋</Text>
            <Text style={styles.note}>{full ? `At most ${MAX_CODEX_IMAGES} images` : "Add images from the library"}</Text>
          </Pressable>
        ) : null}
      </View>
      {busy ? (
        <Text accessibilityRole="progressbar" style={styles.note}>
          Adding images…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Lightbox({
  title,
  images,
  state,
  onChange,
  onClose,
}: {
  title: string;
  images: Img[];
  state: LightboxState;
  onChange: (next: LightboxState) => void;
  onClose: () => void;
}) {
  const index = Math.max(0, images.findIndex((image) => image.key === state.key));
  const current = images[index];
  if (!current) return null;
  const single = images.length < 2;
  function step(delta: number) {
    if (!images.length) return;
    const next = images[(index + delta + images.length) % images.length];
    onChange({ entryId: state.entryId, key: next.key });
  }
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <Pressable accessibilityRole="button" accessibilityLabel="Close image viewer" onPress={onClose} style={styles.lightboxBackdrop}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.lightboxBody}>
          {current.url ? (
            <Image accessibilityIgnoresInvertColors source={{ uri: current.url }} style={styles.lightboxImage} contentFit="contain" />
          ) : null}
          <View style={styles.lightboxBar}>
            <Button accessibilityLabel="Previous image" disabled={single} onPress={() => step(-1)} variant="outline">
              Previous
            </Button>
            <Text style={styles.lightboxTitle}>{title}</Text>
            <Text style={styles.note}>
              {index + 1} / {images.length}
            </Text>
            <Button accessibilityLabel="Next image" disabled={single} onPress={() => step(1)} variant="outline">
              Next
            </Button>
            <Button onPress={onClose} variant="outline">
              Close
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[3],
    padding: space[4],
  },
  heading: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
  note: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[3],
  },
  tile: {
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
    width: "46%",
  },
  tileHidden: {
    opacity: 0.55,
  },
  tileOpen: {
    height: 120,
  },
  placeholder: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    padding: space[3],
  },
  tools: {
    gap: space[2],
    padding: space[2],
  },
  toolRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  addTile: {
    alignItems: "center",
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderStyle: "dashed",
    borderWidth: 1,
    gap: space[2],
    justifyContent: "center",
    minHeight: 120,
    padding: space[3],
    width: "46%",
  },
  addTileFull: {
    opacity: 0.6,
  },
  addGlyph: {
    color: colors.parchment,
    fontSize: 28,
    lineHeight: 32,
  },
  lightboxBackdrop: {
    backgroundColor: "rgba(3, 6, 7, 0.94)",
    flex: 1,
    justifyContent: "center",
    padding: space[4],
  },
  lightboxBody: {
    gap: space[3],
  },
  lightboxImage: {
    height: 420,
    width: "100%",
  },
  lightboxBar: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    justifyContent: "center",
  },
  lightboxTitle: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
});
