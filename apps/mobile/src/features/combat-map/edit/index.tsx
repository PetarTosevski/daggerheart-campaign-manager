import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import type { CombatSlotProps } from "../contract";

import { CombatEditTools } from "./edit-tools";

/**
 * GM map editing (C6-combat-edit). Collapsed by default so the combat view test
 * never mounts edit subscriptions until the GM opens tools.
 *
 * Uses the live layout from `CombatBoard` (same payload as `combatMaps.live`)
 * so this slot does not double-subscribe while closed.
 */
export function CombatEditSlot(props: CombatSlotProps) {
  const [open, setOpen] = useState(false);

  if (!props.isGm) return null;

  return (
    <View style={styles.slot} testID="combat-edit-slot">
      <Button accessibilityLabel={open ? "Close GM map editor" : "Open GM map editor"} onPress={() => setOpen((v) => !v)} variant="outline">
        {open ? "Close GM map editor" : "GM map editor"}
      </Button>
      {open ? (
        <>
          <Text style={styles.hint}>Paint terrain, place objects, switch style, and generate layouts on the edit map below.</Text>
          <CombatEditTools {...props} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    gap: space[2],
    marginTop: space[2],
  },
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
});
