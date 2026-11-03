import { useState } from "react";
import { View } from "react-native";

import { Button } from "../../../ui/button";

import type { CombatSlotProps } from "../contract";
import { CombatGmTools } from "./tools";

/**
 * GM tools load on demand so the combat map shell (C4) keeps subscribing only to
 * `combatMaps.live` and `combatVision.playerView` until the GM opens this panel.
 */
export function CombatGmSlot(props: CombatSlotProps) {
  const [open, setOpen] = useState(false);
  if (!props.isGm) return null;

  return (
    <View testID="combat-gm-slot">
      {open ? (
        <CombatGmTools {...props} />
      ) : (
        <Button accessibilityLabel="Open GM combat tools" onPress={() => setOpen(true)} variant="outline">
          GM combat tools
        </Button>
      )}
    </View>
  );
}
