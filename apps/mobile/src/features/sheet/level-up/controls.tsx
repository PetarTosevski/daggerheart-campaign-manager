import { StyleSheet, Text, View } from "react-native";

import { useQuery } from "convex/react";

import { api } from "../../../convex";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import type { SheetSlotProps } from "../contract";

import { useIntent } from "../../trackers/intent";
import { useLevelUpDraft } from "./draft";
import { canLevelUp, fullSheet } from "./shared";

export function LevelUpControls({ slot }: { slot: SheetSlotProps }) {
  const { character, canEdit, isGm } = slot;
  const lu = useLevelUpDraft();
  const undo = useIntent(api.levelUp.undoLast);
  const sheet = fullSheet(character);
  const level = sheet?.level ?? character.sheet.level;
  const canLevel = canLevelUp(sheet, canEdit, isGm);
  const latest = sheet?.advancements.at(-1);
  const undoable = canEdit && latest !== undefined && latest.level === level;
  const playerMayUndo = useQuery(api.levelUp.canUndo, undoable && !isGm ? { characterId: character._id } : "skip");
  const canUndo = undoable && (isGm || playerMayUndo === true);
  const leveling = lu.active;

  return (
    <View style={styles.row}>
      <View accessibilityRole="image" accessibilityLabel={`Level ${level}`} style={styles.circle}>
        <Text style={styles.levelNum}>{level}</Text>
        <Text style={styles.levelWord}>Level</Text>
      </View>
      {canLevel && !leveling ? (
        <Button accessibilityLabel={`Level up to ${level + 1}`} onPress={lu.start}>
          ▲
        </Button>
      ) : null}
      {canUndo ? (
        <Button accessibilityLabel={`Undo level ${level}`} disabled={undo.pending} onPress={() => void undo.fire({ characterId: character._id })} variant="outline">
          −
        </Button>
      ) : null}
      {!canLevel && sheet?.levelUpPending ? <Text style={styles.pending}>Level up pending</Text> : null}
      {undo.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {undo.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  circle: {
    alignItems: "center",
    backgroundColor: colors.parchment,
    borderColor: colors.brand,
    borderRadius: 33,
    borderWidth: 2,
    height: 66,
    justifyContent: "center",
    width: 66,
  },
  levelNum: { color: colors.ink, fontFamily: type.displayBold.fontFamily, fontSize: 22 },
  levelWord: { color: colors.mutedText, fontFamily: type.sans.fontFamily, fontSize: 11 },
  pending: { color: colors.ok, fontFamily: type.sans.fontFamily, fontSize: 14 },
  error: { color: colors.danger, fontFamily: type.sans.fontFamily, fontSize: 14 },
});
