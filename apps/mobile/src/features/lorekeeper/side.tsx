import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { LegendCard } from "./legend";
import { LibraryCard } from "./library";
import { RulingsCard } from "./rulings";
import type { LorekeeperSideProps } from "./slots";
import { lkStyles } from "./styles";

export function LorekeeperSide(props: LorekeeperSideProps) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityLabel="Library & rulings"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        style={lkStyles.foldBtn}
      >
        <Text style={lkStyles.foldLabel}>Library & rulings</Text>
        <Text style={lkStyles.foldLabel}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 12, marginTop: 8 }}>
          <LibraryCard {...props} />
          <LegendCard />
          <RulingsCard {...props} />
        </View>
      ) : null}
    </View>
  );
}
