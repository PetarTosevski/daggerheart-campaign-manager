import { useMutation } from "convex/react";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { designAsset } from "../../../../../src/lib/design-assets";
import type { GmEntry } from "../../../../../src/lib/codex/view";
import { WORLD_MAPS } from "../../../../../src/lib/world/map-state";
import { api } from "../../convex";
import type { Id } from "../../convex";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Sheet } from "../../ui/sheet";

import type { CodexPin } from "./types";

export function PinPicker({
  frameId,
  entry,
  entries,
  pins,
  open,
  onClose,
}: {
  frameId: string;
  entry: GmEntry;
  entries: GmEntry[];
  pins: CodexPin[];
  open: boolean;
  onClose: () => void;
}) {
  const setPin = useMutation(api.codex.setPin);
  const [error, setError] = useState<string | null>(null);
  const map = WORLD_MAPS[frameId as keyof typeof WORLD_MAPS];
  const mapUri = map ? designAsset(map.asset) : undefined;
  const title = `Place “${entry.name || "this location"}” on the map`;

  async function link(tokenId: number) {
    if (tokenId === entry.tokenId) {
      onClose();
      return;
    }
    setError(null);
    try {
      await setPin({ entryId: entry._id as Id<"codexEntries">, tokenId });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Sheet onClose={onClose} open={open} title="Link map pin">
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.note}>Tap a pin to link this location to it. Pins are placed and moved on the World map.</Text>
        <View style={[styles.map, map ? { aspectRatio: map.width / map.height } : { aspectRatio: 4 / 3 }]}>
          {mapUri ? (
            <Image accessibilityIgnoresInvertColors source={{ uri: mapUri }} style={StyleSheet.absoluteFill} contentFit="fill" />
          ) : (
            <View style={styles.mapFallback} />
          )}
          {pins.map((pin) => {
            const mine = pin.id === entry.tokenId;
            const used =
              !mine && entries.some((row) => row.kind === "location" && row.tokenId === pin.id && row._id !== entry._id);
            const label = `${pin.name || "Pin"}${mine ? " (this location)" : used ? " (linked to another location)" : " — tap to link"}${pin.hidden ? " · hidden from players" : ""}`;
            const size = mine ? 22 : 16;
            return (
              <Pressable
                key={pin.id}
                accessibilityLabel={label}
                accessibilityRole="button"
                onPress={() => {
                  void link(pin.id);
                }}
                style={[
                  styles.pin,
                  {
                    left: `${pin.x}%`,
                    top: `${pin.y}%`,
                    width: size,
                    height: size,
                    opacity: pin.hidden ? 0.6 : 1,
                    backgroundColor: mine ? colors.brand : used ? "#6a5a8a" : "#2a6a6a",
                  },
                ]}
              />
            );
          })}
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Button onPress={onClose} variant="outline">
          Cancel
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
  },
  title: {
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
  map: {
    backgroundColor: "#e6d8b8",
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  mapFallback: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#e6d8b8",
  },
  pin: {
    borderColor: "#fff3d6",
    borderRadius: 999,
    borderWidth: 2,
    position: "absolute",
    transform: [{ translateX: -8 }, { translateY: -8 }],
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
