import { Canvas, Group, Path, Skia } from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path as SvgPath, Polyline } from "react-native-svg";

import { scaleBar } from "../../../../../src/lib/domain/travel";
import { mapImageSize, type MapToken, type PlayerMapState } from "../../../../../src/lib/world/map-state";
import { tokenType, tokenTypes, type TokenType } from "../../../../../src/lib/world/token-types";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hexPathLayers, terrainPathLayers } from "./paths/layers";
import type { View as MapPanView } from "./pan-zoom";

export type MapCanvasProps = {
  label: string;
  frameId: string;
  state: PlayerMapState;
  imageUrl: string | null;
  view: MapPanView;
  showTerrain: boolean;
  showGrid: boolean;
  showTokens: boolean;
  isHorizon: boolean;
};

function pctToPx(p: { x: number; y: number }, mapW: number, mapH: number) {
  return { left: (p.x / 100) * mapW, top: (p.y / 100) * mapH };
}

function TokenMarker({ token, types, mapW, mapH, dim }: { token: MapToken; types: TokenType[]; mapW: number; mapH: number; dim: boolean }) {
  const kind = tokenType(types, token.type);
  const pos = pctToPx(token, mapW, mapH);
  return (
    <View
      accessibilityLabel={`${token.name || kind.label}, ${kind.label}`}
      pointerEvents="none"
      style={[
        styles.token,
        {
          left: pos.left,
          top: pos.top,
          opacity: dim ? 0.45 : 1,
        },
      ]}
    >
      <View style={[styles.tokenIcon, { backgroundColor: kind.colour, borderStyle: dim ? "dashed" : "solid" }]}>
        <Svg height={14} width={14} viewBox="0 0 24 24">
          <SvgPath d={kind.path} fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} />
        </Svg>
      </View>
      <Text style={[styles.tokenLabel, dim ? styles.tokenLabelDim : null]}>
        {token.location ? "📍 " : ""}
        {token.name || kind.label}
      </Text>
    </View>
  );
}

function PartyMarker({ party, mapW, mapH }: { party: PlayerMapState["party"]; mapW: number; mapH: number }) {
  const pos = pctToPx(party, mapW, mapH);
  return (
    <View accessibilityLabel="Party token" pointerEvents="none" style={[styles.token, { left: pos.left, top: pos.top, zIndex: 6 }]}>
      <View style={[styles.tokenIcon, styles.partyIcon]}>
        <Svg height={18} width={18} viewBox="0 0 24 24">
          <SvgPath d="M5 21V3 M5 4h11l-2.5 3.5L16 11H5" fill="none" stroke="#2a1a04" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} />
        </Svg>
      </View>
      <Text style={styles.partyLabel}>The Party</Text>
    </View>
  );
}

/** Map art, terrain, hex crawl, trail and tokens (view-only; no GM paint). */
export function MapCanvas(props: MapCanvasProps) {
  const image = mapImageSize(props.frameId, props.state);
  const aspect = image.height / image.width;
  const mapW = props.view.w * props.view.z;
  const mapH = mapW * aspect;
  const types = useMemo(() => tokenTypes(props.state), [props.state]);
  const bar = scaleBar(props.state.scaleKm);
  const trail = [...props.state.party.trail, { x: props.state.party.x, y: props.state.party.y }];

  const terrainLayers = props.showTerrain && !props.isHorizon ? terrainPathLayers(props.state.terrain) : [];
  const hexLayers =
    props.state.hexCrawl && props.isHorizon
      ? hexPathLayers({
          crawl: props.state.hexCrawl,
          imageWidth: image.width,
          imageHeight: image.height,
          showGrid: props.showGrid,
        })
      : [];

  return (
    <View
      accessibilityLabel={`${props.label}. Pinch to zoom and drag to pan.`}
      accessibilityRole="none"
      importantForAccessibility="yes"
      style={styles.viewport}
    >
      <View
        style={{
          width: mapW,
          height: mapH,
          transform: [{ translateX: props.view.x }, { translateY: props.view.y }],
        }}
      >
        {props.imageUrl ? (
          <Image accessibilityIgnoresInvertColors contentFit="fill" source={{ uri: props.imageUrl }} style={{ width: mapW, height: mapH }} />
        ) : (
          <View style={[styles.parchment, { width: mapW, height: mapH }]} />
        )}
        <Canvas pointerEvents="none" style={[StyleSheet.absoluteFill, { width: mapW, height: mapH }]}>
          <Group transform={[{ scaleX: mapW / 128 }, { scaleY: mapH / 98 }]}>
            {terrainLayers.map((layer) => (
              <Path key={layer.id} color={layer.fill ?? "transparent"} path={Skia.Path.MakeFromSVGString(layer.path) ?? Skia.Path.Make()} style="fill" />
            ))}
          </Group>
          <Group transform={[{ scaleX: mapW / image.width }, { scaleY: mapH / image.height }]}>
            {hexLayers.map((layer) => (
              <Path
                key={layer.id}
                color={layer.fill ?? layer.stroke ?? "transparent"}
                path={Skia.Path.MakeFromSVGString(layer.path) ?? Skia.Path.Make()}
                strokeWidth={layer.stroke ? (layer.strokeWidth ?? 1) : 0}
                style={layer.fill ? "fill" : "stroke"}
              />
            ))}
          </Group>
        </Canvas>
        {props.showTokens ? (
          <Svg height={mapH} pointerEvents="none" style={StyleSheet.absoluteFill} width={mapW} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Polyline
              fill="none"
              points={trail.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke="#8e2b2b"
              strokeDasharray="0.9 0.7"
              strokeLinecap="round"
              strokeWidth={0.3}
            />
          </Svg>
        ) : null}
        {props.showTokens
          ? props.state.party.trail.map((p, i, a) => {
              const dot = pctToPx(p, mapW, mapH);
              return (
                <View
                  key={`trail-${i}`}
                  style={[
                    styles.trailDot,
                    {
                      left: dot.left - 5,
                      top: dot.top - 5,
                      opacity: 0.35 + (0.65 * (i + 1)) / a.length,
                    },
                  ]}
                />
              );
            })
          : null}
        {props.showTokens
          ? props.state.tokens.map((token) => (
              <TokenMarker dim={false} key={token.id} mapH={mapH} mapW={mapW} token={token} types={types} />
            ))
          : null}
        {props.showTokens ? <PartyMarker mapH={mapH} mapW={mapW} party={props.state.party} /> : null}
        <View style={[styles.scaleBar, { width: `${bar.percent}%` }]}>
          <Text style={styles.scaleLabel}>{bar.label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    backgroundColor: colors.ink2,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 280,
    overflow: "hidden",
  },
  parchment: {
    backgroundColor: colors.parchment,
  },
  token: {
    marginLeft: -13,
    marginTop: -13,
    position: "absolute",
    zIndex: 4,
  },
  tokenIcon: {
    alignItems: "center",
    borderColor: "rgba(255, 243, 214, 0.85)",
    borderRadius: 999,
    borderWidth: 2,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  partyIcon: {
    backgroundColor: colors.brand,
  },
  tokenLabel: {
    backgroundColor: "rgba(26, 20, 8, 0.88)",
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    borderRadius: 6,
    color: colors.parchment,
    marginTop: 2,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tokenLabelDim: {
    textDecorationLine: "line-through",
  },
  partyLabel: {
    backgroundColor: "#2a1a04",
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    borderRadius: 6,
    color: "#f3cf86",
    fontWeight: "600",
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  trailDot: {
    backgroundColor: "#8e2b2b",
    borderColor: "#efe3c8",
    borderRadius: 999,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    width: 10,
    zIndex: 3,
  },
  scaleBar: {
    backgroundColor: "rgba(239, 227, 200, 0.92)",
    borderColor: "#2a1f14",
    borderTopWidth: 1.5,
    bottom: "3%",
    left: "2%",
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: "absolute",
  },
  scaleLabel: {
    color: "#2a1f14",
    fontFamily: type.sansSemibold.fontFamily,
    fontSize: 13,
    fontWeight: type.sansSemibold.fontWeight,
  },
});
