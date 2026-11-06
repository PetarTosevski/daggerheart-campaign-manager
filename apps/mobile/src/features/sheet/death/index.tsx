import { StyleSheet, View } from "react-native";
import { useQuery } from "convex/react";

import { api } from "../../../convex";
import { space } from "../../../theme/spacing";
import type { SheetSlotProps } from "../contract";

import { DeathBadges } from "./badges";
import { DeathBoundary } from "./boundary";
import { DeathMoveControls } from "./death-move";
import { TakeDamage } from "./take-damage";

function needsDeathState(character: SheetSlotProps["character"], canEdit: boolean): boolean {
  return canEdit || character.status === "away";
}

/** Death moves, status badges, and manual damage on the sheet (website party/death + damage calculator). */
export function DeathSlot(props: SheetSlotProps) {
  const { character, canEdit } = props;
  const watchState = needsDeathState(character, canEdit);
  const deathState = useQuery(api.deathMoves.state, watchState ? { characterId: character._id } : "skip");
  return (
    <View accessibilityLabel={`Death slot for ${character.sheet.name}`} style={styles.stack}>
      <DeathBoundary>
        <DeathBadges {...props} deathState={deathState} />
        {canEdit ? (
          <>
            <DeathMoveControls {...props} deathState={deathState} />
            <TakeDamage augments={props.augments} character={character} />
          </>
        ) : null}
      </DeathBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
  },
});
