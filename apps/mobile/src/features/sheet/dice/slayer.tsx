import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { RollPrompt } from "../../../../../../src/lib/domain/class-features/types";
import { api, type Id } from "../../../convex";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { useIntent } from "./intent";

/** After an action roll with Hope: take the Hope or store a Slayer Die (`rolls.storeSlayerDie`). */
export function SlayerOffer({
  characterId,
  entryId,
  prompt,
}: {
  characterId: Id<"characters">;
  entryId: Id<"actionLog">;
  prompt: RollPrompt;
}) {
  const store = useIntent(api.rolls.storeSlayerDie);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [stored, setStored] = useState<string | null>(null);
  if (dismissed === entryId) return null;
  if (stored !== null) {
    return (
      <Text accessibilityRole="text" style={styles.status}>
        {stored}
      </Text>
    );
  }
  return (
    <View accessibilityLabel={prompt.text} accessibilityRole="group" style={styles.box}>
      <Text style={styles.prompt}>{prompt.text}</Text>
      <View style={styles.row}>
        {prompt.choices.map((c) => (
          <Button
            disabled={store.pending}
            key={c.key}
            onPress={() => {
              if (c.key !== "store") {
                setDismissed(entryId);
                return;
              }
              void store.fire({ characterId, entryId }).then((out) => {
                if (out) setStored(`Stored a Slayer Die (${out.slayerDice}/${out.capacity}).`);
              });
            }}
            size="md"
            variant="pill"
          >
            {c.label}
          </Button>
        ))}
      </View>
      {store.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {store.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: space[2],
  },
  prompt: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  status: {
    color: colors.mutedText,
    fontFamily: type.serifItalic.fontFamily,
    fontSize: 15,
    fontStyle: "italic",
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
