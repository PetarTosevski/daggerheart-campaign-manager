import { useMutation } from "convex/react";
import { StyleSheet, Text, View } from "react-native";

import {
  normalizeAngle,
  TURN_BUTTON_STEP,
} from "../../../../../../src/components/combat-map/tokens/geometry";
import { api, type Id } from "../../../convex";
import { useWritesEnabled } from "../../../shell/offline";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/fonts";
import { space } from "../../../theme/spacing";
import { Button } from "../../../ui/button";

import type { CombatSlotProps } from "../contract";

type OkView = Extract<CombatSlotProps["view"], { state: "ok" }>;

export function TokenControls({
  campaignId,
  view,
}: {
  campaignId: Id<"campaigns">;
  view: OkView;
}) {
  const token = view.pcs.find((t) => t.mine && t._id === view.tokenId) ?? view.pcs.find((t) => t.mine);
  const writes = useWritesEnabled();
  const move = useMutation(api.combatTokens.move);
  const turn = useMutation(api.combatTokens.turn);

  if (!token || !token.canMove) {
    return (
      <Text style={styles.muted} testID="combat-play-token-idle">
        {token ? "Your token cannot move on this map." : "You have no token on the battlefield."}
      </Text>
    );
  }

  async function step(dx: number, dy: number) {
    if (!writes) return;
    try {
      await move({ campaignId, tokenId: token!._id, x: token!.x + dx, y: token!.y + dy });
    } catch {
      // MOVE_BLOCKED and other refusals roll back on the server.
    }
  }

  async function rotate(delta: number) {
    if (!writes || !token) return;
    await turn({ campaignId, tokenId: token._id, angle: normalizeAngle(token.face + delta) });
  }

  return (
    <View accessibilityLabel="Token movement" style={styles.wrap} testID="combat-play-token">
      <Text style={styles.pos}>
        {token.name} at ({token.x}, {token.y})
      </Text>
      <View style={styles.row}>
        <Button accessibilityLabel="Move west" disabled={!writes} onPress={() => void step(-1, 0)} variant="outline">
          W
        </Button>
        <View style={styles.col}>
          <Button accessibilityLabel="Move north" disabled={!writes} onPress={() => void step(0, -1)} variant="outline">
            N
          </Button>
          <Button accessibilityLabel="Move south" disabled={!writes} onPress={() => void step(0, 1)} variant="outline">
            S
          </Button>
        </View>
        <Button accessibilityLabel="Move east" disabled={!writes} onPress={() => void step(1, 0)} variant="outline">
          E
        </Button>
      </View>
      <View style={styles.row}>
        <Button accessibilityLabel="Turn left" disabled={!writes} onPress={() => void rotate(-TURN_BUTTON_STEP)} variant="outline">
          Turn ⟲
        </Button>
        <Button accessibilityLabel="Turn right" disabled={!writes} onPress={() => void rotate(TURN_BUTTON_STEP)} variant="outline">
          Turn ⟳
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2], alignItems: "center" },
  col: { gap: space[2] },
  pos: {
    color: colors.body,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
  },
  muted: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
  },
});
