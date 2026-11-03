import { useState } from "react";
import { StyleSheet, View } from "react-native";

import type { Id } from "../../../convex";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { Section } from "../../sheet/chrome";
import type { CombatSlotProps } from "../contract";
import { AttackPanel } from "./attack-panel";
import { CombatIncoming } from "./incoming";
import { HandPanel } from "./hand-panel";
import { PlayTargetsProvider } from "./targets";
import { TargetPicker } from "./target-picker";
import { TokenControls } from "./token-controls";

/** Player combat actions: token move/turn, cards, attacks and incoming-hit reactions. */
export function CombatPlaySlot({ campaignId, layout, view }: CombatSlotProps) {
  const [open, setOpen] = useState(false);
  if (view.state !== "ok" || view.mapId !== layout._id) {
    return <View accessibilityLabel="Combat play" testID="combat-play-slot" />;
  }
  const cid = campaignId as Id<"campaigns">;
  if (!open) {
    return (
      <View accessibilityLabel="Combat play" style={styles.stack} testID="combat-play-slot">
        <Button accessibilityLabel="Open combat actions" onPress={() => setOpen(true)} variant="solid">
          Move, cards and attacks
        </Button>
      </View>
    );
  }
  return (
    <PlayTargetsProvider>
      <View accessibilityLabel="Combat play" style={styles.stack} testID="combat-play-slot">
        <Button accessibilityLabel="Close combat actions" onPress={() => setOpen(false)} variant="outline">
          Close
        </Button>
        <Section title="Your token">
          <TokenControls campaignId={cid} view={view} />
        </Section>
        <Section title="Incoming hit">
          <CombatIncoming campaignId={cid} view={view} />
        </Section>
        <Section title="Target">
          <TargetPicker view={view} />
        </Section>
        <Section title="Hand">
          <HandPanel campaignId={cid} layout={layout} view={view} />
        </Section>
        <Section title="Attack">
          <AttackPanel campaignId={cid} layout={layout} view={view} />
        </Section>
      </View>
    </PlayTargetsProvider>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[4],
  },
});
