import { memo } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Svg, { ClipPath, Defs, G, Path, Polygon, RadialGradient, Stop } from "react-native-svg";

import type { HexGrid } from "../../../../../src/lib/world/hex";
import { hexPoints, type HexTokenPlace } from "../../../../../src/lib/world/hex-tokens";
import { type } from "../../theme/fonts";

/** The party's flag icon (24 × 24), as on the website. */
export const PARTY_ICON = "M5 21V3 M5 4h11l-2.5 3.5L16 11H5";

type HexMarkerProps = {
  /** Unique per marker: names the clip path and gradient. */
  id: string;
  place: HexTokenPlace;
  orientation: HexGrid["orientation"];
  mapW: number;
  mapH: number;
  /** A colour, or "party" for the party's gold. */
  fill: string;
  /** The icon's path in a 24 × 24 box. */
  icon: string;
  iconStroke: string;
  label: string;
  accessibilityLabel: string;
  /** Hidden from players (GM only): dashed border, faded. */
  dim?: boolean;
  zIndex?: number;
  labelStyle?: StyleProp<TextStyle>;
};

/**
 * A World Map marker drawn as a hex of the map's grid (`src/lib/world/hex-tokens.ts`, the website's `HexFace`): the
 * colour clipped to the hex with the icon inside and a hex border; a whole hex keeps its name along its bottom, a
 * shared one (a third of the hex) shows no name, and the top of an overfull stack shows "+n". Its box is the place's
 * percentage of the map, so it sits on its printed hex at every zoom.
 */
export const HexMarker = memo(function HexMarker({
  id,
  place,
  orientation,
  mapW,
  mapH,
  fill,
  icon,
  iconStroke,
  label,
  accessibilityLabel,
  dim = false,
  zIndex,
  labelStyle,
}: HexMarkerProps) {
  const w = (place.width / 100) * mapW;
  const h = (place.height / 100) * mapH;
  if (!(w > 0 && h > 0)) return null;
  const pts = hexPoints(orientation, w, h);
  // A whole hex keeps its name inside along the bottom, so the icon sits above it.
  const iconSize = Math.min(w, h) * (place.shared ? 0.6 : 0.46);
  const iconX = (w - iconSize) / 2;
  const iconY = place.shared ? (h - iconSize) / 2 : h * 0.4 - iconSize / 2;
  const iconScale = iconSize / 24;
  const labelWidth = Math.max(w * 0.92, 72);
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      pointerEvents="none"
      style={[
        styles.box,
        {
          left: (place.x / 100) * mapW - w / 2,
          top: (place.y / 100) * mapH - h / 2,
          width: w,
          height: h,
          zIndex,
        },
      ]}
      testID={`hex-marker-${id}`}
    >
      <Svg height={h} opacity={dim ? 0.5 : 1} viewBox={`0 0 ${w} ${h}`} width={w}>
        <Defs>
          <ClipPath id={`hc-${id}`}>
            <Polygon points={pts} />
          </ClipPath>
          {fill === "party" ? (
            <RadialGradient cx="40%" cy="35%" id={`hg-${id}`} r="70%">
              <Stop offset="0" stopColor="#f3cf86" />
              <Stop offset="1" stopColor="#b07a22" />
            </RadialGradient>
          ) : null}
        </Defs>
        <G clipPath={`url(#hc-${id})`}>
          <Polygon fill={fill === "party" ? `url(#hg-${id})` : fill} points={pts} />
          <G transform={`translate(${iconX} ${iconY}) scale(${iconScale})`}>
            <Path d={icon} fill="none" stroke={iconStroke} strokeLinecap="round" strokeLinejoin="round" strokeWidth={fill === "party" ? 1.9 : 1.8} />
          </G>
        </G>
        <Polygon fill="none" points={pts} stroke="rgba(255, 243, 214, 0.9)" strokeDasharray={dim ? "4 3" : undefined} strokeWidth={1.5} />
      </Svg>
      {!place.shared && label ? (
        <View pointerEvents="none" style={[styles.labelRow, { left: (w - labelWidth) / 2, width: labelWidth }]}>
          <Text numberOfLines={1} style={[styles.label, labelStyle, dim ? styles.labelDim : null]}>
            {label}
          </Text>
        </View>
      ) : null}
      {place.stacked > 0 ? (
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.more}>
          +{place.stacked}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    zIndex: 4,
  },
  labelRow: {
    alignItems: "center",
    bottom: "8%",
    position: "absolute",
  },
  label: {
    backgroundColor: "rgba(239, 227, 200, 0.9)",
    borderRadius: 4,
    color: "#2a1f14",
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 11,
    fontWeight: type.sansSemibold.fontWeight,
    overflow: "hidden",
    paddingHorizontal: 4,
  },
  labelDim: {
    opacity: 0.55,
    textDecorationLine: "line-through",
  },
  more: {
    backgroundColor: "#2a1a04",
    borderRadius: 6,
    bottom: -4,
    color: "#f3cf86",
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 11,
    fontWeight: type.sansSemibold.fontWeight,
    overflow: "hidden",
    paddingHorizontal: 3,
    position: "absolute",
    right: -6,
  },
});
