import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { StyleSheet, Text, View } from "react-native";

import { initialsOf } from "../../../../../src/components/combat-map/tokens/geometry";

import type { MapView } from "./view-math";

/** What the map draws for a token: the GM's `combatTokensReads.list` rows and a player's `playerView` tokens both fit. */
export type MapToken = {
  _id: string;
  name: string;
  side: "pc" | "enemy" | "ally" | "neutral";
  x: number;
  y: number;
  size: number;
  mine?: boolean;
};

/** Points per square inside the token layer before its transform (big enough that text stays sharp when zoomed in). */
export const TOKEN_UNIT = 64;

/** Ring colours per side (the board's SIDE colours, src/components/combat-map/tokens/sides.ts). */
const SIDE_RING: Record<MapToken["side"], string> = {
  pc: "#e3b45a",
  enemy: "#c0392b",
  ally: "#4f9e72",
  neutral: "#8a9aa0",
};

const SIDE_FILL: Record<MapToken["side"], string> = {
  pc: "#2e2410",
  enemy: "#3e120d",
  ally: "#163322",
  neutral: "#263236",
};

/**
 * The tokens over the map (dcm-gdzi.10, dcm-gdzi.18): one layer in square units, moved and scaled by the map's shared
 * view on the UI thread, so tokens follow pan and pinch without a React render and grow with zoom and token size.
 */
export function CombatTokensLayer({
  tokens,
  view,
  w,
  h,
  label,
}: {
  tokens: readonly MapToken[];
  view: SharedValue<MapView>;
  w: number;
  h: number;
  label: string;
}) {
  const moved = useAnimatedStyle(() => {
    const v = view.value;
    return { transform: [{ translateX: v.x }, { translateY: v.y }, { scale: v.s / TOKEN_UNIT }] };
  });

  return (
    <Animated.View
      accessibilityLabel={label}
      pointerEvents="none"
      style={[styles.layer, { width: w * TOKEN_UNIT, height: h * TOKEN_UNIT }, moved]}
      testID="combat-map-stage"
    >
      {tokens.map((token) => {
        const size = token.size * TOKEN_UNIT;
        const label = `${token.name}${token.mine ? ", yours" : ""}, ${token.side}`;
        return (
          <View
            key={token._id}
            accessibilityLabel={label}
            style={[
              styles.token,
              {
                left: token.x * TOKEN_UNIT + size * 0.06,
                top: token.y * TOKEN_UNIT + size * 0.06,
                width: size * 0.88,
                height: size * 0.88,
                borderRadius: size,
                borderColor: SIDE_RING[token.side],
                borderWidth: token.mine ? 6 : 4,
                backgroundColor: SIDE_FILL[token.side],
              },
            ]}
            testID={`combat-token-${token._id}`}
          >
            <Text style={[styles.tokenText, { fontSize: 22 * Math.min(token.size, 2) }]}>{initialsOf(token.name, token.size)}</Text>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    left: 0,
    position: "absolute",
    top: 0,
    transformOrigin: "0 0",
  },
  token: {
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
  },
  tokenText: {
    color: "#ece6d6",
    fontWeight: "700",
  },
});
