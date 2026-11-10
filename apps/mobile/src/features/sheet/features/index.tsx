import { StyleSheet, View } from "react-native";

import type { Id } from "../../../convex";
import { space } from "../../../theme/spacing";
import type { SheetSlotProps } from "../contract";
import { ClassFeaturesPanel } from "./class-features";
import { ClassExtras } from "./extras/class-extras";
import { FrameExtras } from "./extras/frame-extras";
import { useExtrasView } from "./extras/use-extras-view";
import { LunarPhasesSection } from "./lunar";

/**
 * The sheet's features slot (D5): the Class Features panel first, then the
 * class extras (Druid Beastform, Beastbound Companion), then the Lunar
 * Phases section (holder only, Hope & Fear on), then the frame extras
 * (Motherboard, Beast Feast, Castle High). Mirrors the website order:
 * class-first, then its extras, then session features, then frame extras.
 */
export function FeaturesSlot(props: SheetSlotProps) {
  const { campaignId, character } = props;
  const { view } = useExtrasView({
    campaignId: campaignId as Id<"campaigns">,
    characterId: character._id,
    sheet: character.sheet,
  });

  return (
    <View
      accessibilityLabel={`Features slot for ${character.sheet.name}`}
      style={styles.stack}
    >
      <ClassFeaturesPanel {...props} />
      {view ? <ClassExtras characterId={character._id} view={view} /> : null}
      <LunarPhasesSection {...props} />
      {view ? (
        <FrameExtras
          campaignId={campaignId as Id<"campaigns">}
          characterId={character._id}
          view={view}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4] },
});
