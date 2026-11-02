import { StyleSheet, View } from "react-native";

import type { Id } from "../../../../convex";
import { space } from "../../../../theme/spacing";
import { BeastFeastPanel } from "./panels/beast-feast";
import { CastleHighPanel } from "./panels/castle-high";
import { MotherboardPanel } from "./panels/motherboard";
import type { ExtrasView } from "./use-extras-view";

/**
 * Frame extras in the sheet's frame extras region: Motherboard module,
 * Beast Feast ingredients and cookbook, Castle High skyshard. Each panel
 * is rendered inline (no overlay).
 */
export function FrameExtras({
  campaignId,
  characterId,
  view,
}: {
  campaignId: Id<"campaigns">;
  characterId: Id<"characters">;
  view: ExtrasView;
}) {
  const { canEdit } = view;
  const hasAny =
    view.motherboard !== null ||
    (view.beastFeast !== null && view.cookbook !== null) ||
    view.castleHigh !== null;
  if (!hasAny) return null;

  return (
    <View style={styles.stack}>
      {view.motherboard ? (
        <MotherboardPanel
          characterId={characterId}
          state={view.motherboard}
          level={view.level}
          tier={view.tier}
          canEdit={canEdit}
        />
      ) : null}
      {view.beastFeast && view.cookbook ? (
        <BeastFeastPanel
          campaignId={campaignId}
          characterId={characterId}
          state={view.beastFeast}
          cookbook={view.cookbook}
          capacity={view.ingredientCapacity}
          canEdit={canEdit}
        />
      ) : null}
      {view.castleHigh ? (
        <CastleHighPanel
          characterId={characterId}
          state={view.castleHigh}
          canEdit={canEdit}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4] },
});
