import { StyleSheet, Text, View } from "react-native";

import { FOG_PAD_SQUARES } from "../../../../../src/lib/domain/combat-map/vision";

import type { CombatMapLayout, CombatPlayerView } from "./contract";
import { MAP_CELL } from "./constants";

type TokenLike = {
  _id: string;
  name: string;
  side: string;
  x: number;
  y: number;
  size: number;
  mine?: boolean;
};

function tokensFromView(view: CombatPlayerView): TokenLike[] {
  if (view.state !== "ok") return [];
  return [...view.pcs, ...view.others];
}

export function CombatTokensLayer({
  layout,
  view,
  isGm,
  padSquares,
  mapW,
  mapH,
}: {
  layout: CombatMapLayout;
  view: CombatPlayerView;
  isGm: boolean;
  padSquares: number;
  mapW: number;
  mapH: number;
}) {
  const pad = isGm ? 0 : padSquares || FOG_PAD_SQUARES;
  const stageW = (layout.w + 2 * pad) * MAP_CELL;
  const stageH = (layout.h + 2 * pad) * MAP_CELL;
  const scaleX = mapW / stageW;
  const scaleY = mapH / stageH;
  const tokens = tokensFromView(view);

  return (
    <>
      {tokens.map((token) => {
        const cx = (token.x + token.size / 2 + pad) * MAP_CELL * scaleX;
        const cy = (token.y + token.size / 2 + pad) * MAP_CELL * scaleY;
        const label = `${token.name}${token.mine ? ", yours" : ""}, ${token.side}`;
        return (
          <View
            key={token._id}
            accessibilityLabel={label}
            pointerEvents="none"
            style={[
              styles.token,
              {
                left: cx - 14,
                top: cy - 14,
                borderColor: token.side === "enemy" ? "#c44" : token.mine ? "#e3b45a" : "#6a8",
              },
            ]}
          >
            <Text style={styles.tokenText}>{token.name.slice(0, 2).toUpperCase()}</Text>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  token: {
    alignItems: "center",
    backgroundColor: "#1a1408",
    borderRadius: 14,
    borderWidth: 2,
    height: 28,
    justifyContent: "center",
    position: "absolute",
    width: 28,
  },
  tokenText: {
    color: "#ece6d6",
    fontSize: 10,
    fontWeight: "700",
  },
});
