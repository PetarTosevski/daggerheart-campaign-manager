import { StyleSheet, Text, View } from "react-native";

import { HORIZON_FRAME } from "../../../../../../src/lib/world/map-state";
import { useCampaign } from "../../../shell/campaign-provider";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";
import type { WorldMapData } from "../contract";
import { GmMapTools } from "./gm-tools";

/**
 * GM palette, terrain paint, token panel and map uploads (C5-world-edit).
 * Closed by default so the world view never mounts `world-palette` until the GM opens tools. The board owns `open`:
 * while the tools are open their edit map takes the view map's place, so neither map sits inside a ScrollView.
 *
 * Pass `data` from `WorldBoard` (same `maps.get` payload as the map). Without it the slot stays a
 * shell so the board does not double-subscribe in the test harness.
 */
export function WorldEditSlot({
  enabled,
  data,
  open = false,
  onToggle,
}: {
  enabled: boolean;
  data?: WorldMapData;
  open?: boolean;
  onToggle?: () => void;
}) {
  const campaign = useCampaign();

  if (!enabled) return null;
  if (data === undefined) {
    return <View style={styles.slot} testID="world-edit-slot" />;
  }

  const horizon = data.frameId === HORIZON_FRAME;
  const isCustomFrame = campaign.custom !== null;

  return (
    <View style={[styles.slot, open ? styles.open : null]} testID="world-edit-slot">
      <Button accessibilityLabel={open ? "Close GM map tools" : "Open GM map tools"} onPress={() => onToggle?.()} variant="outline">
        {open ? "Close GM map tools" : "GM map tools"}
      </Button>
      {open ? (
        <>
          <Text style={styles.hint}>
            {horizon
              ? "Place markers and upload map art on the edit map below."
              : "Paint terrain, place or move markers, and upload map art on the edit map below."}
          </Text>
          <GmMapTools campaignId={campaign._id} data={data} isCustomFrame={isCustomFrame} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    gap: space[2],
  },
  open: {
    flex: 1,
  },
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
});
