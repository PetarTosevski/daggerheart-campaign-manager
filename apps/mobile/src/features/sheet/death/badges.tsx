import { StyleSheet, Text, View } from "react-native";
import { useMutation } from "convex/react";
import * as Crypto from "expo-crypto";

import { AWAY_REASON_LABELS, type AwayReason } from "../../../../../../src/lib/domain/death/index";
import { api } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { type } from "../../../theme/fonts";
import { radius, space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import type { SheetSlotProps } from "../contract";

import { awayLabel, sheetFlags } from "./labels";
import type { DeathMoveState } from "./types";

export function DeathBadges({
  character,
  canEdit,
  isGm,
  deathState,
}: SheetSlotProps & { deathState: DeathMoveState | undefined }) {
  const returnFromAway = useMutation(api.deathMoves.returnFromAway);
  const writes = useWritesEnabled();
  const flags = sheetFlags(character.sheet);
  const unconscious = character.status === "active" && flags.conditions?.includes("unconscious");
  const away = character.status === "away";
  const journeyEnds = Boolean(flags.journeyEnds) && (isGm || canEdit) && character.status !== "dead";
  const returnToPlay = away && isGm && !character.benched;
  const deathAway = away && character.away !== undefined;
  if (!unconscious && !away && !deathAway && !journeyEnds && !returnToPlay) return null;

  return (
    <View accessibilityLabel="Death status" style={styles.row}>
      {unconscious ? (
        <Text style={styles.pillDark} testID="death-unconscious">
          Unconscious
        </Text>
      ) : null}
      {away ? (
        <Text style={styles.pillAway} testID="death-away">
          {awayLabel(character)}
        </Text>
      ) : null}
      {deathAway ? <AwayRequest character={character} deathState={deathState} isGm={isGm} /> : null}
      {journeyEnds ? (
        <Text style={styles.pillJourney} testID="death-journey-ends">
          Journey ends
        </Text>
      ) : null}
      {returnToPlay ? (
        <Button
          disabled={!writes}
          onPress={() => void returnFromAway({ characterId: character._id, idempotencyKey: Crypto.randomUUID() })}
          size="md"
          variant="pill"
        >
          Return to play
        </Button>
      ) : null}
    </View>
  );
}

function AwayRequest({
  character,
  isGm,
  deathState,
}: {
  character: SheetSlotProps["character"];
  isGm: boolean;
  deathState: DeathMoveState | undefined;
}) {
  const settle = useMutation(api.deathMoves.settleAway);
  const writes = useWritesEnabled();
  const reason = character.away?.reason as AwayReason | undefined;
  if (deathState === undefined || !deathState.awayRequested || reason === undefined) return null;
  const other: AwayReason = reason === "infirmary" ? "sentHome" : "infirmary";
  const choices = [
    [reason, "Confirm"],
    [other, `Change to ${AWAY_REASON_LABELS[other]}`],
  ] as const;
  return (
    <>
      <Text style={styles.pillRequested} testID="death-away-requested">
        Requested
      </Text>
      {isGm
        ? choices.map(([r, text]) => (
            <Button
              disabled={!writes}
              key={r}
              onPress={() => void settle({ characterId: character._id, reason: r, idempotencyKey: Crypto.randomUUID() })}
              size="md"
              variant="pill"
            >
              {text}
            </Button>
          ))
        : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    alignItems: "center",
  },
  pillDark: {
    backgroundColor: "#2a2140",
    borderRadius: radius.pill,
    color: "#d9ccff",
    fontFamily: type.displayBold.fontFamily,
    fontSize: 11,
    fontWeight: type.displayBold.fontWeight,
    letterSpacing: 1.4,
    overflow: "hidden",
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    textTransform: "uppercase",
  },
  pillAway: {
    backgroundColor: "#24343a",
    borderRadius: radius.pill,
    color: "#cfe3e8",
    fontFamily: type.displayBold.fontFamily,
    fontSize: 11,
    fontWeight: type.displayBold.fontWeight,
    letterSpacing: 1.4,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    textTransform: "uppercase",
  },
  pillRequested: {
    backgroundColor: "#3a3014",
    borderRadius: radius.pill,
    color: "#f3dfa8",
    fontFamily: type.displayBold.fontFamily,
    fontSize: 11,
    fontWeight: type.displayBold.fontWeight,
    letterSpacing: 1.4,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    textTransform: "uppercase",
  },
  pillJourney: {
    backgroundColor: "#3a1414",
    borderRadius: radius.pill,
    color: "#ffb0a8",
    fontFamily: type.displayBold.fontFamily,
    fontSize: 11,
    fontWeight: type.displayBold.fontWeight,
    letterSpacing: 1.4,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    textTransform: "uppercase",
  },
});
