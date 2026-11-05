import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { RollPrompt } from "../../../../../../src/lib/domain/class-features/types";
import { SLAYER_STORE_PROMPT } from "../../../../../../src/lib/domain/session-features";
import { api, type Id } from "../../../convex";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { useIntent } from "./intent";

/** Strange Patterns, Favor, and similar post-roll choices (`classFeatures.use`). Slayer uses SlayerOffer. */
export function RollPrompts({ characterId, prompts }: { characterId: Id<"characters">; prompts: RollPrompt[] }) {
  const answer = useIntent(api.classFeatures.use);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const visible = prompts.filter((p) => p.key !== SLAYER_STORE_PROMPT);
  if (visible.length === 0) return null;
  return (
    <View style={styles.stack}>
      {visible.map((p) => (
        <View accessibilityLabel={p.text} accessibilityRole="group" key={p.key} style={styles.box}>
          <Text style={styles.prompt}>{p.text}</Text>
          {answered[p.key] ? (
            <Text accessibilityRole="text" style={styles.done}>
              {answered[p.key]}
            </Text>
          ) : (
            <View style={styles.row}>
              {p.choices.map((c) => (
                <Button
                  disabled={answer.pending}
                  key={c.key}
                  onPress={() =>
                    void answer.fire({ characterId, featureKey: p.featureKey, params: { choice: c.key } }).then((out) => {
                      if (out) setAnswered((a) => ({ ...a, [p.key]: out.summary }));
                    })
                  }
                  size="md"
                  variant="pill"
                >
                  {c.label}
                </Button>
              ))}
            </View>
          )}
          {answer.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {answer.error}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
  },
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
  done: {
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
