import { StyleSheet, Text, View } from "react-native";

import { useWritesEnabled } from "../../shell/offline";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { cardName, cardRecall, deckChoices } from "./catalog";
import { Section } from "./chrome";
import type { SheetData } from "./types";

export function CardsSection({
  sheet,
  hopeAndFear,
  canEdit,
  duringRest,
  onMove,
  onTake,
}: {
  sheet: SheetData;
  hopeAndFear: boolean;
  canEdit: boolean;
  duringRest: boolean;
  onMove: (cardId: string, to: "loadout" | "vault") => void;
  onTake: (cardId: string) => void;
}) {
  const writes = useWritesEnabled();
  const loadout = new Set(sheet.domainCards.loadout);
  const deck = canEdit ? deckChoices(sheet, hopeAndFear) : [];
  return (
    <Section title="Domain cards">
      {sheet.domainCards.owned.length === 0 ? <Text style={styles.empty}>No domain cards yet.</Text> : null}
      {sheet.domainCards.owned.map((id) => {
        const inLoadout = loadout.has(id);
        const recall = cardRecall(id);
        const cost = duringRest || recall === 0 ? "free" : `${recall} Stress`;
        return (
          <View key={id} style={styles.card}>
            <Text style={styles.name}>
              {cardName(id)} · {inLoadout ? "Loadout" : `Vault, ${cost}`}
            </Text>
            {canEdit ? (
              <Button
                disabled={!writes}
                onPress={() => onMove(id, inLoadout ? "vault" : "loadout")}
                variant="outline"
              >
                {inLoadout ? `Vault ${cardName(id)}` : `Loadout ${cardName(id)}`}
              </Button>
            ) : null}
          </View>
        );
      })}
      {deck.length > 0 ? (
        <View style={styles.deck}>
          <Text style={styles.deckTitle}>Domain deck</Text>
          {deck.map((card) => (
            <Button disabled={!writes} key={card.id} onPress={() => onTake(card.id)} variant="outline">
              {`Take ${card.name}`}
            </Button>
          ))}
        </View>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  empty: {
    color: colors.mutedText,
    fontFamily: type.serif.fontFamily,
    fontSize: 16,
    fontStyle: type.serif.fontStyle,
  },
  card: {
    gap: space[2],
  },
  name: {
    color: colors.parchment,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 16,
    fontWeight: type.sansMedium.fontWeight,
  },
  deck: {
    gap: space[2],
  },
  deckTitle: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
});
