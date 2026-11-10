import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { MOVE_LABELS, REST_MOVES, type RestKind, type RestMove } from "./catalog";
import { Section } from "./chrome";
import type { OpenRest } from "./types";

const ORDER: readonly RestKind[] = ["short", "long"];

/**
 * The downtime reference: the move names for a short rest and a long rest.
 * A move this character already picked on the open rest is marked.
 */
export function DowntimeSection({ picked }: { picked: OpenRest }) {
  return (
    <Section title="Downtime">
      <Text style={styles.intro}>Choose two moves, or the same move twice.</Text>
      {ORDER.map((kind) => (
        <View key={kind} style={styles.block}>
          <Text style={styles.head}>{kind === "short" ? "Short rest" : "Long rest"}</Text>
          {REST_MOVES[kind].map((move) => (
            <Move key={move} kind={kind} move={move} picked={picked} />
          ))}
        </View>
      ))}
    </Section>
  );
}

function Move({ kind, move, picked }: { kind: RestKind; move: RestMove; picked: OpenRest }) {
  const times = picked?.kind === kind ? picked.moves.filter((id) => id === move).length : 0;
  const label = MOVE_LABELS[move];
  return (
    <Text accessibilityLabel={times > 0 ? `${label}, picked` : label} style={times > 0 ? styles.picked : styles.move}>
      {label}
      {times > 1 ? ` · Picked ×${times}` : times === 1 ? " · Picked" : ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: colors.body,
    fontFamily: type.serif.fontFamily,
    fontSize: 16,
    fontStyle: type.serif.fontStyle,
  },
  block: {
    gap: space[1],
  },
  head: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 16,
    fontWeight: type.displayBold.fontWeight,
  },
  move: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
  },
  picked: {
    color: colors.hope,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: type.sansSemibold.fontWeight,
  },
});
