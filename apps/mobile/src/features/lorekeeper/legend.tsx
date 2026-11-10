import { Text, View } from "react-native";

import { LEGEND_TITLE, VERDICT_COPY } from "../../../../../src/lib/lorekeeper/copy";
import { lkStyles } from "./styles";

const LEGEND = [
  { verdict: "rules" as const, pill: lkStyles.pillOk },
  { verdict: "unclear" as const, pill: lkStyles.pillAmber },
  { verdict: "none" as const, pill: lkStyles.pillRed },
];

export function LegendCard() {
  return (
    <View accessibilityLabel="How answers are marked" style={lkStyles.card}>
      <Text style={lkStyles.cardTitle}>{LEGEND_TITLE}</Text>
      {LEGEND.map(({ verdict, pill }) => (
        <View key={verdict} style={{ flexDirection: "row", gap: 8 }}>
          <Text style={[lkStyles.pill, pill]}>{VERDICT_COPY[verdict].label}</Text>
          <Text style={lkStyles.muted}>{VERDICT_COPY[verdict].legend}</Text>
        </View>
      ))}
    </View>
  );
}
