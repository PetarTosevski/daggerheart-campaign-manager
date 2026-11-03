import { useQuery } from "convex/react";
import { StyleSheet, Text, View } from "react-native";

import { damageLabel, equippedWeapons } from "./weapons";
import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { useIntent } from "../../sheet/dice/intent";

import type { CombatSlotProps } from "../contract";
import { usePlayTargets } from "./targets";

type OkView = Extract<CombatSlotProps["view"], { state: "ok" }>;

export function AttackPanel({
  campaignId,
  layout,
  view,
}: {
  campaignId: Id<"campaigns">;
  layout: CombatSlotProps["layout"];
  view: OkView;
}) {
  const character = useQuery(api.characters.get, { characterId: view.characterId });
  const attack = useIntent(api.combatActions.attack);
  const { targetTokenId } = usePlayTargets();
  const writes = useWritesEnabled();

  if (character === undefined) {
    return (
      <Text accessibilityRole="status" style={styles.muted}>
        Loading your weapons…
      </Text>
    );
  }
  if (character === null) return null;

  const weapons = equippedWeapons(character.sheet);
  const primary = weapons[0];
  const target = view.others.find((t) => t._id === targetTokenId && t.side === "enemy");

  async function fire() {
    if (!writes || !primary || !targetTokenId) return;
    await attack.fire({
      campaignId,
      characterId: view.characterId,
      mapId: layout._id,
      targetTokenIds: [targetTokenId],
      slot: primary.slot,
      modifier: 0,
      experienceIds: [],
      advantage: 0,
      disadvantage: 0,
      help: 0,
      options: [],
    });
  }

  return (
    <View accessibilityLabel="Weapon attack" style={styles.wrap} testID="combat-play-attack">
      {primary ? (
        <Text style={styles.weapon}>
          {primary.weapon.name} · {damageLabel(primary.weapon, character.sheet.proficiency)}
        </Text>
      ) : (
        <Text style={styles.muted}>Equip a weapon on your sheet to attack.</Text>
      )}
      {target ? (
        <Text style={styles.target}>
          Target: {target.name}
        </Text>
      ) : (
        <Text style={styles.hint}>Pick an enemy target above.</Text>
      )}
      <Button
        accessibilityLabel="Attack selected target"
        disabled={!writes || attack.pending || !primary || !targetTokenId}
        onPress={() => void fire()}
        variant="solid"
      >
        {attack.pending ? "Rolling…" : "Attack"}
      </Button>
      {attack.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {attack.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  weapon: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 16,
    fontWeight: type.sansSemibold.fontWeight,
  },
  target: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  muted: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
  error: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
