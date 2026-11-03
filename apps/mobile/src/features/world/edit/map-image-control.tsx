import { useMutation } from "convex/react";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../../src/lib/convex-errors";
import { api } from "../../../convex";
import type { Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { hit, radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";

const MAX_BYTES = 8 * 1024 * 1024;

export function MapImageControl({
  campaignId,
  hasUpload,
  isCustom,
  scaleKm,
}: {
  campaignId: Id<"campaigns">;
  hasUpload: boolean;
  isCustom: boolean;
  scaleKm: number;
}) {
  const uploadUrl = useMutation(api.maps.mapImageUploadUrl);
  const attach = useMutation(api.maps.attachMapImage);
  const remove = useMutation(api.maps.removeMapImage);
  const writes = useWritesEnabled();
  const [width, setWidth] = useState(String(scaleKm));
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function uploadFromLibrary() {
    if (!writes) return;
    setStatus(null);
    const km = Number(width);
    if (!Number.isFinite(km) || km < 1 || km > 100_000) {
      setStatus("Enter the map width in km (1–100,000).");
      return;
    }
    setBusy(true);
    try {
      const picker = await import("expo-image-picker");
      const picked = await picker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.92 });
      if (picked.canceled || picked.assets[0] === undefined) return;
      const asset = picked.assets[0];
      if ((asset.fileSize ?? 0) > MAX_BYTES) {
        setStatus("Maps must be at most 8 MB.");
        return;
      }
      const url = await uploadUrl({ campaignId });
      const file = await fetch(asset.uri);
      const body = await file.blob();
      const uploaded = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        body,
      });
      if (!uploaded.ok) throw new Error("Upload failed.");
      const stored = (await uploaded.json()) as { storageId?: string };
      if (!stored.storageId) throw new Error("Upload failed.");
      const result = await attach({
        campaignId,
        storageId: stored.storageId as Id<"_storage">,
        width: asset.width,
        height: asset.height,
        scaleKm: km,
      });
      setStatus(result.ok ? "Map uploaded." : result.message);
    } catch (caught) {
      setStatus(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        Map image
      </Text>
      <Text style={styles.note}>
        {isCustom ? "Upload your campaign map (PNG, JPEG, WebP or GIF, up to 8 MB)." : "Replace the frame map with your own image (up to 8 MB)."}
      </Text>
      <Text style={styles.label}>Width (km)</Text>
      <TextInput
        accessibilityLabel="Uploaded map width in kilometres"
        keyboardType="numeric"
        onChangeText={setWidth}
        style={styles.input}
        value={width}
      />
      <Button disabled={busy || !writes} onPress={() => void uploadFromLibrary()} variant="solid">
        {busy ? "Uploading…" : hasUpload ? "Replace map image" : "Upload map image"}
      </Button>
      {hasUpload ? (
        <Button
          disabled={busy}
          onPress={async () => {
            try {
              await remove({ campaignId });
              setStatus(isCustom ? "Map image removed." : "Using the frame map.");
            } catch (caught) {
              setStatus(errorMessage(caught));
            }
          }}
          variant="outline"
        >
          {isCustom ? "Remove map image" : "Use the frame map"}
        </Button>
      ) : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.ink2,
    borderColor: colors.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: space[2],
    padding: space[3],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 18,
    fontWeight: type.displayBold.fontWeight,
  },
  note: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  label: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
  },
  input: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    minHeight: hit.minHeight,
    paddingHorizontal: space[2],
  },
  status: {
    color: colors.brand,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
});
