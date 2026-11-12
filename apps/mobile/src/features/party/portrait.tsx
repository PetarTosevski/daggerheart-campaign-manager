import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useMutation } from "convex/react";

import { api } from "../../convex";
import type { Id } from "../../convex";
import { errorMessage } from "../../../../../src/lib/convex-errors";
import { designAsset } from "../../../../../src/lib/design-assets";
import { clampPortraitFrame, type PortraitFrame } from "../../../../../src/lib/party/portrait-frame";
import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { Button } from "../../ui/button";

/** The website's origin, for preset portrait art (`designAsset` paths are site-relative). */
const SITE = process.env.EXPO_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "https://dualityheart.com";

/** The server's limit and allowlist (`characters.attachPortrait`: 3 MB; png, jpeg, webp, gif). */
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Portraits show at 56 px at most; 512 px square keeps them sharp on any screen and far under the server's limit. */
export const PORTRAIT_SIZE = 512;

/**
 * Shrinks a picked (already square-cropped) image to `PORTRAIT_SIZE` wide and re-encodes it as JPEG, so a phone photo
 * uploads in kilobytes, not megabytes. A smaller image is only re-encoded, never enlarged.
 */
export async function resizePortrait(asset: { uri: string; width: number }): Promise<{ uri: string; type: string }> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > PORTRAIT_SIZE) context.resize({ width: PORTRAIT_SIZE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return { uri: saved.uri, type: "image/jpeg" };
}

/** The picture to show: an uploaded portrait's URL, or a preset's art on the website. */
export function portraitSource(portraitUrl: string | null, portrait: { kind: string; asset?: string } | undefined): string | null {
  if (portraitUrl) return portraitUrl;
  if (portrait?.kind !== "asset" || !portrait.asset) return null;
  const path = designAsset(portrait.asset);
  if (!path) return null;
  return /^https?:/.test(path) ? path : `${SITE}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * The saved close-up (plan portrait-frame, PZ3; display only, the phone does not edit it) as expo-image props, drawn
 * like the website's inner layer: the picture covers the clipped shape aligned at x% y% (expo-image's `contentPosition`
 * percent works like CSS `background-position`), then scales by `zoom` about that same point (`transformOrigin`
 * percent, React Native 0.74+). Null without a frame: the picture draws exactly as before.
 */
export function portraitImageFrame(frame: PortraitFrame | null | undefined): {
  contentPosition: { left: `${number}%`; top: `${number}%` };
  style: { transform: [{ scale: number }]; transformOrigin: string };
} | null {
  if (!frame) return null;
  const { zoom, x, y } = clampPortraitFrame(frame);
  return {
    contentPosition: { left: `${x}%`, top: `${y}%` },
    style: { transform: [{ scale: zoom }], transformOrigin: `${x}% ${y}%` },
  };
}

/**
 * Shows the portrait (dcm-gdzi.26) and changes it: the library image first, checked against the server's size and
 * type allowlist, and only then an upload URL (cancelling the picker spends none). The picker crops square and
 * re-encodes at quality 0.7 (iOS hands HEIC over as JPEG when it re-encodes); `resizePortrait` then shrinks it to
 * 512 px JPEG before the upload.
 */
export function PortraitControl({
  characterId,
  name,
  portraitUrl,
  portrait,
  portraitFrame,
  hasPortrait,
  canEdit,
}: {
  characterId: Id<"characters">;
  name: string;
  portraitUrl: string | null;
  portrait?: { kind: string; asset?: string };
  /** The sheet's saved close-up (`sheet.portraitFrame`); absent: today's framing. */
  portraitFrame?: PortraitFrame;
  hasPortrait: boolean;
  canEdit: boolean;
}) {
  const requestUrl = useMutation(api.characters.portraitUploadUrl);
  const attach = useMutation(api.characters.attachPortrait);
  const writes = useWritesEnabled();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  const source = portraitSource(portraitUrl, portrait);
  const framed = portraitImageFrame(portraitFrame);

  async function change() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const picker = await import("expo-image-picker");
      const picked = await picker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
      if (picked.canceled || picked.assets[0] === undefined) return;
      const asset = picked.assets[0];
      if (!TYPES.has(asset.mimeType ?? "image/jpeg")) {
        setError("Choose a PNG, JPEG, WebP or GIF image.");
        return;
      }
      const { uri, type } = await resizePortrait(asset);
      const file = await fetch(uri);
      const body = await file.blob();
      if (body.size > MAX_BYTES) {
        setError("That image is over 3 MB. Choose a smaller one.");
        return;
      }
      const url = await requestUrl({ characterId });
      if (typeof url !== "string" || url.length === 0) return;
      const uploaded = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": type },
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
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <View accessibilityLabel={source ? `Portrait of ${name}` : `${name} has no portrait`} style={styles.mark}>
        {source ? (
          framed ? (
            // The round mark clips; the scaled picture drops its own rounding, which would scale off-centre with it.
            <Image
              accessibilityIgnoresInvertColors
              contentFit="cover"
              contentPosition={framed.contentPosition}
              source={{ uri: source }}
              style={[styles.framedImage, framed.style]}
              testID="portrait-image"
            />
          ) : (
            <Image accessibilityIgnoresInvertColors contentFit="cover" source={{ uri: source }} style={styles.image} testID="portrait-image" />
          )
        ) : (
          <Text style={styles.letter}>{letter}</Text>
        )}
      </View>
      {canEdit ? (
        <Button
          accessibilityLabel={`Upload a portrait for ${name}`}
          disabled={!writes || busy}
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
    overflow: "hidden",
    width: 56,
  },
  image: {
    borderRadius: 28,
    height: 56,
    width: 56,
  },
  framedImage: {
    height: 56,
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
