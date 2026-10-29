import { useQuery } from "convex/react";
import { StyleSheet, Text, View } from "react-native";

import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import { useIntent } from "../../sheet/dice/intent";

import type { CombatSlotProps } from "../contract";
import { canFireOnPhone, playableUses, type HandCard } from "./card-use";
import { usePlayTargets } from "./targets";

type OkView = Extract<CombatSlotProps["view"], { state: "ok" }>;

export function HandPanel({
  campaignId,
  layout,
  view,
}: {
  campaignId: Id<"campaigns">;
  layout: CombatSlotProps["layout"];
  view: OkView;
}) {
  const hand = useQuery(api.combatCardsReads.hand, { campaignId, characterId: view.characterId });
  const useCard = useIntent(api.combatCards.useCard);
  const { targetTokenId } = usePlayTargets();
  const writes = useWritesEnabled();

  if (hand === undefined) {
    return (
      <Text accessibilityRole="status" style={styles.muted}>
        Loading your hand…
      </Text>
    );
  }

  const cards = hand.loadout.filter((c) => playableUses(c).length > 0);
  if (cards.length === 0) {
    return (
      <Text style={styles.muted} testID="combat-play-hand-empty">
        No combat cards ready in your loadout.
      </Text>
    );
  }

  async function play(card: HandCard) {
    if (!writes || !targetTokenId) return;
    const use = playableUses(card)[0];
    if (!use) return;
    if (!canFireOnPhone(use, true)) return;
    await useCard.fire({
      campaignId,
      characterId: view.characterId,
      mapId: layout._id,
      cardId: card.cardId,
      targetTokenIds: [targetTokenId],
      choices: [],
      roll: { modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0 },
    });
  }

  return (
    <View accessibilityLabel="Combat hand" style={styles.wrap} testID="combat-play-hand">
      {!targetTokenId ? (
        <Text style={styles.hint}>Pick an enemy target below before playing a card that needs one.</Text>
      ) : null}
      {cards.map((card) => {
        const use = playableUses(card)[0]!;
        const canPhone = canFireOnPhone(use, Boolean(targetTokenId));
        const disabled = !writes || useCard.pending || !canPhone;
        return (
          <View key={card.cardId} style={styles.card} testID={`combat-hand-card-${card.cardId}`}>
            <Text style={styles.name}>{card.name}</Text>
            <Text style={styles.meta}>
              {card.state === "exhausted" ? card.resetLabel ?? "Exhausted" : "Ready"}
            </Text>
            {!canPhone ? <Text style={styles.hint}>Open this card on the website to choose its options.</Text> : null}
            <Button
              accessibilityLabel={`Use ${card.name}`}
              disabled={disabled}
              onPress={() => void play(card)}
              variant="solid"
            >
              Use
            </Button>
          </View>
        );
      })}
      {useCard.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {useCard.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  card: { gap: space[2] },
  name: {
    color: colors.parchment,
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 17,
    fontWeight: type.sansSemibold.fontWeight,
  },
  meta: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
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
