import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useMutation } from "convex/react";

import { api } from "../../convex";
import type { Id } from "../../convex";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { Button } from "../../ui/button";

/**
 * Asks for an upload URL, then a library image, then attaches the stored file.
 * A missing URL stops before the picker, so a test can press the button and
 * only see `portraitUploadUrl`.
 */
export function PortraitControl({
  characterId,
  name,
  portraitUrl,
  hasPortrait,
  canEdit,
}: {
  characterId: Id<"characters">;
  name: string;
  portraitUrl: string | null;
  hasPortrait: boolean;
  canEdit: boolean;
}) {
  const requestUrl = useMutation(api.characters.portraitUploadUrl);
  const attach = useMutation(api.characters.attachPortrait);
  const writes = useWritesEnabled();
  const [error, setError] = useState<string | null>(null);
  const letter = name.trim().charAt(0).toUpperCase() || "?";

  async function change() {
    setError(null);
    try {
      const url = await requestUrl({ characterId });
      if (typeof url !== "string" || url.length === 0) return;
      const picker = await import("expo-image-picker");
      const picked = await picker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (picked.canceled || picked.assets[0] === undefined) return;
      const asset = picked.assets[0];
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
      const result = await attach({
        characterId,
        storageId: stored.storageId as Id<"_storage">,
      });
      if (result.error) setError(result.error);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <View style={styles.row}>
      <View accessibilityLabel={portraitUrl ? `Portrait of ${name}` : `${name} has no portrait`} style={styles.mark}>
        <Text style={styles.letter}>{letter}</Text>
      </View>
      {canEdit ? (
        <Button
          accessibilityLabel={`Upload a portrait for ${name}`}
          disabled={!writes}
          onPress={() => {
            void change();
          }}
          variant="outline"
        >
          {hasPortrait ? "Change portrait" : "Add portrait"}
        </Button>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "flex-start",
    gap: 8,
  },
  mark: {
    alignItems: "center",
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: 28,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  letter: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 22,
    fontWeight: type.displayBold.fontWeight,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
