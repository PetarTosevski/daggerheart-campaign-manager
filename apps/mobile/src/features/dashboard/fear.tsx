import { useQuery } from "convex/react";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { FEAR_HIDDEN_LABEL, fearShown } from "../../../../../src/components/combat-map/hud/fear/hidden";
import { MAX_FEAR, MIN_FEAR } from "../../../../../src/lib/domain/fear";
import { api, type Id } from "../../convex";
import { WriteButton } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type as textType } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { AlertLine, Panel, PanelBoundary, QueryLoading } from "./chrome";
import { useIntent } from "./intent";

export function FearPanel({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  return (
    <PanelBoundary title="GM Fear">
      <FearBody campaignId={campaignId} isGm={isGm} />
    </PanelBoundary>
  );
}

function FearBody({ campaignId, isGm }: { campaignId: Id<"campaigns">; isGm: boolean }) {
  const loaded = useQuery(api.campaigns.fear, { campaignId });
  return (
    <Panel title="GM Fear">
      <QueryLoading label="Loading Fear" value={loaded} />
      {/* null: the GM hides Fear from this caller; it shows "?" and never offers an edit based on it. */}
      {loaded === undefined ? null : isGm && loaded !== null ? (
        <FearControls campaignId={campaignId} loaded={loaded} />
      ) : (
        <FearValue value={loaded} />
      )}
    </Panel>
  );
}

function FearValue({ value }: { value: number | null }) {
  return (
    <Text accessibilityLabel={value === null ? `Fear: ${FEAR_HIDDEN_LABEL}` : "Fear"} style={styles.value}>
      {fearShown(value)}
    </Text>
  );
}

function FearControls({ campaignId, loaded }: { campaignId: Id<"campaigns">; loaded: number }) {
  const adjust = useIntent(api.fear.adjust);
  const [bump, setBump] = useState<{ from: number; by: number } | null>(null);
  const shown = bump && bump.from === loaded ? loaded + bump.by : loaded;

  function change(direction: "increase" | "decrease") {
    const delta = direction === "increase" ? 1 : -1;
    const next = shown + delta;
    if (next < MIN_FEAR || next > MAX_FEAR) return;
    setBump({ from: loaded, by: next - loaded });
    void adjust.fire({ campaignId, direction });
  }

  return (
    <View style={styles.controls}>
      <FearValue value={shown} />
      <View style={styles.row}>
        <WriteButton
          accessibilityLabel="Decrease Fear"
          onPress={() => change("decrease")}
          variant="outline"
        >
          −
        </WriteButton>
        <WriteButton accessibilityLabel="Increase Fear" onPress={() => change("increase")} variant="outline">
          +
        </WriteButton>
      </View>
      <AlertLine message={adjust.error} />
    </View>
  );
}

const styles = StyleSheet.create({
  value: {
    color: colors.fear,
    fontFamily: textType.displayBold.fontFamily,
    fontSize: 40,
    fontWeight: textType.displayBold.fontWeight,
  },
  controls: {
    gap: space[3],
  },
  row: {
    flexDirection: "row",
    gap: space[2],
  },
});
