import { useState } from "react";
import { StyleSheet, View } from "react-native";

import type { Id } from "../../../convex";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { SlotBoundary } from "../../adversaries/controls";
import { Section } from "../../sheet/chrome";
import { AllyPicks } from "../ally-picks";
import type { CombatSlotProps } from "../contract";
import { AttackPanel } from "./attack-panel";
import { CombatIncoming } from "./incoming";
import { HandPanel } from "./hand-panel";
import { TokenControls } from "./token-controls";

/**
 * Player combat actions: token move/turn, cards, attacks and incoming-hit reactions. An ally pick waiting on this
 * player's character shows even with the actions closed (FH-AP: "each ally picks their own").
 */
export function CombatPlaySlot({ campaignId, layout, view }: CombatSlotProps) {
  const [open, setOpen] = useState(false);
  if (view.state !== "ok" || view.mapId !== layout._id) {
    return <View accessibilityLabel="Combat play" testID="combat-play-slot" />;
  }
  const cid = campaignId as Id<"campaigns">;
  const picks = (
    <SlotBoundary label="Ally picks">
      <AllyPicks campaignId={cid} gm={false} />
    </SlotBoundary>
  );
  if (!open) {
    return (
      <View accessibilityLabel="Combat play" style={styles.stack} testID="combat-play-slot">
        {picks}
        <Button accessibilityLabel="Open combat actions" onPress={() => setOpen(true)} variant="solid">
          Move, cards and attacks
        </Button>
      </View>
    );
  }
  return (
    <View accessibilityLabel="Combat play" style={styles.stack} testID="combat-play-slot">
      <Button accessibilityLabel="Close combat actions" onPress={() => setOpen(false)} variant="outline">
        Close
      </Button>
      {picks}
      <Section title="Your token">
        <SlotBoundary label="Your token">
          <TokenControls campaignId={cid} view={view} />
        </SlotBoundary>
      </Section>
      <Section title="Incoming hit">
        <SlotBoundary label="Incoming hit">
          <CombatIncoming campaignId={cid} view={view} />
        </SlotBoundary>
      </Section>
      <Section title="Attack">
        <SlotBoundary label="Attack">
          <AttackPanel campaignId={cid} layout={layout} view={view} />
        </SlotBoundary>
      </Section>
      <Section title="Hand">
        <SlotBoundary label="Hand">
          <HandPanel campaignId={cid} layout={layout} view={view} />
        </SlotBoundary>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[4],
  },
});
