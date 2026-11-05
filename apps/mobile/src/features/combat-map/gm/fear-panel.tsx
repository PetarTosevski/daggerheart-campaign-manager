import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { MAX_FEAR, MIN_FEAR } from "../../../../../../src/lib/domain/fear";
import { api } from "../../../convex";
import { WriteButton } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type as textType } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { AlertLine, Panel, QueryLoading } from "../../dashboard/chrome";
import { useIntent } from "../../dashboard/intent";

import { useCombatGm } from "./context";
import { gmStyles } from "./styles";

export function CombatGmFear() {
  const { campaignId, fear: loaded } = useCombatGm();
  const adjust = useIntent(api.fear.adjust);
  const [bump, setBump] = useState<{ from: number; by: number } | null>(null);
  const shown = loaded !== undefined && bump && bump.from === loaded ? loaded + bump.by : loaded;

  function change(direction: "increase" | "decrease") {
    if (loaded === undefined || shown === undefined) return;
    const delta = direction === "increase" ? 1 : -1;
    const next = shown + delta;
    if (next < MIN_FEAR || next > MAX_FEAR) return;
    setBump({ from: loaded, by: next - loaded });
    void adjust.fire({ campaignId, direction });
  }

  return (
    <Panel title="GM Fear">
      <QueryLoading label="Loading Fear" value={loaded} />
      {loaded === undefined || shown === undefined ? null : (
        <View style={styles.controls}>
          <Text accessibilityLabel={`Fear ${shown} of ${MAX_FEAR}`} style={styles.value} testID="combat-fear">
            {String(shown)}
          </Text>
          <View style={gmStyles.row}>
            <WriteButton accessibilityLabel="Decrease Fear" onPress={() => change("decrease")} variant="outline">
              −
            </WriteButton>
            <WriteButton accessibilityLabel="Increase Fear" onPress={() => change("increase")} variant="outline">
              +
            </WriteButton>
          </View>
          <AlertLine message={adjust.error} />
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  controls: {
    gap: space[3],
  },
  value: {
    color: colors.fear,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 36,
    fontWeight: textType.displayBold.fontWeight,
  },
});
