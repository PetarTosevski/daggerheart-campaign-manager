import { Canvas, DashPathEffect, Group, Path, Skia, type SkPath } from "@shopify/react-native-skia";
import { Image } from "expo-image";
import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path as SvgPath, Polyline } from "react-native-svg";

import { scaleBar } from "../../../../../src/lib/domain/travel";
import type { HexGrid } from "../../../../../src/lib/world/hex";
import { layoutHexTokens, type HexTokenItem, type HexTokenPlace } from "../../../../../src/lib/world/hex-tokens";
import { mapImageSize, type MapToken, type PlayerMapState } from "../../../../../src/lib/world/map-state";
import { tokenType, tokenTypes, type TokenType } from "../../../../../src/lib/world/token-types";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { HexMarker, PARTY_ICON } from "./hex-marker";
import { hexPathLayers, terrainPathLayers, type SkiaPathLayer } from "./paths/layers";
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

/** Terrain overlay paths are in terrain-grid units (128 × 98 over the map). */
const TERRAIN_W = 128;
const TERRAIN_H = 98;

/**
 * Map art, terrain, hex crawl, trail and markers (view only; GM edits go through `edit/`).
 *
 * Pan moves one transformed View; everything inside is `MapLayers`, memoised on the map's size, so a pan frame
 * re-renders nothing below it. Overlay paths are parsed into Skia paths once per change of the map data (not per
 * frame or per zoom step); zoom only rescales them.
 */
export function MapCanvas(props: MapCanvasProps) {
  const image = mapImageSize(props.frameId, props.state);
  const mapW = props.view.w * props.view.z;
  const mapH = mapW * (image.height / image.width);
  return (
    <View
      accessibilityLabel={`${props.label}. Pinch to zoom and drag to pan.`}
      accessibilityRole="none"
      importantForAccessibility="yes"
      style={styles.viewport}
    >
      <View style={{ width: mapW, height: mapH, transform: [{ translateX: props.view.x }, { translateY: props.view.y }] }}>
        <MapLayers
          imageHeight={image.height}
          imageUrl={props.imageUrl}
          imageWidth={image.width}
          isHorizon={props.isHorizon}
          mapH={mapH}
          mapW={mapW}
          showGrid={props.showGrid}
          showTerrain={props.showTerrain}
          showTokens={props.showTokens}
          state={props.state}
        />
      </View>
    </View>
  );
}

type MapLayersProps = {
  state: PlayerMapState;
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  mapW: number;
  mapH: number;
  showTerrain: boolean;
  showGrid: boolean;
  showTokens: boolean;
  isHorizon: boolean;
};

const MapLayers = memo(function MapLayers(props: MapLayersProps) {
  const { state, mapW, mapH, imageWidth, imageHeight, isHorizon } = props;
  // On a hex-grid map (the Journey to Horizon hex crawl, the website's `crawl`) every marker is a hex of its grid.
  const crawl = isHorizon ? (state.hexCrawl ?? null) : null;

  const terrainLayers = useMemo(
    () => (props.showTerrain && !isHorizon ? terrainPathLayers(state.terrain) : []),
    [props.showTerrain, isHorizon, state.terrain],
  );
  const hexLayers = useMemo(
    () => (crawl ? hexPathLayers({ crawl, imageWidth, imageHeight, showGrid: props.showGrid }) : []),
    [crawl, imageWidth, imageHeight, props.showGrid],
  );

  return (
    <>
      {props.imageUrl ? (
        <Image accessibilityIgnoresInvertColors contentFit="fill" source={{ uri: props.imageUrl }} style={{ width: mapW, height: mapH }} />
      ) : (
        <View style={[styles.parchment, { width: mapW, height: mapH }]} />
      )}
      {terrainLayers.length > 0 || hexLayers.length > 0 ? (
        <Canvas pointerEvents="none" style={[StyleSheet.absoluteFill, { width: mapW, height: mapH }]}>
          <OverlayGroup layers={terrainLayers} scaleX={mapW / TERRAIN_W} scaleY={mapH / TERRAIN_H} />
          <OverlayGroup layers={hexLayers} scaleX={mapW / imageWidth} scaleY={mapH / imageHeight} />
        </Canvas>
      ) : null}
      {props.showTokens ? <Trail mapH={mapH} mapW={mapW} party={state.party} /> : null}
      {props.showTokens ? <Markers grid={crawl?.grid ?? null} imageHeight={imageHeight} imageWidth={imageWidth} mapH={mapH} mapW={mapW} state={state} /> : null}
      <ScaleBar scaleKm={state.scaleKm} />
    </>
  );
});

/** Skia paths parsed once per layer list (memoised on its identity), drawn under a scale transform. */
function OverlayGroup({ layers, scaleX, scaleY }: { layers: SkiaPathLayer[]; scaleX: number; scaleY: number }) {
  const paths = useMemo(
    () => layers.map((layer): { layer: SkiaPathLayer; path: SkPath } => ({ layer, path: Skia.Path.MakeFromSVGString(layer.path) ?? Skia.Path.Make() })),
    [layers],
  );
  if (paths.length === 0) return null;
  // Strokes and dashes are in screen pixels (non-scaling), so undo the group's scale.
  const k = Math.max(Math.min(scaleX, scaleY), 1e-6);
  return (
    <Group transform={[{ scaleX }, { scaleY }]}>
      {paths.map(({ layer, path }) =>
        layer.style === "fill" ? (
          <Path color={layer.color} key={layer.id} path={path} style="fill" />
        ) : (
          <Path color={layer.color} key={layer.id} path={path} strokeWidth={(layer.strokeWidth ?? 1) / k} style="stroke">
            {layer.dash ? <DashPathEffect intervals={[layer.dash[0] / k, layer.dash[1] / k]} /> : null}
          </Path>
        ),
      )}
    </Group>
  );
}

function pctToPx(p: { x: number; y: number }, mapW: number, mapH: number) {
  return { left: (p.x / 100) * mapW, top: (p.y / 100) * mapH };
}

function Trail({ party, mapW, mapH }: { party: PlayerMapState["party"]; mapW: number; mapH: number }) {
  const points = useMemo(() => [...party.trail, { x: party.x, y: party.y }].map((p) => `${p.x},${p.y}`).join(" "), [party]);
  return (
    <>
      <Svg height={mapH} pointerEvents="none" preserveAspectRatio="none" style={StyleSheet.absoluteFill} viewBox="0 0 100 100" width={mapW}>
        <Polyline fill="none" points={points} stroke="#8e2b2b" strokeDasharray="0.9 0.7" strokeLinecap="round" strokeWidth={0.3} />
      </Svg>
      {party.trail.map((p, i, a) => {
        const dot = pctToPx(p, mapW, mapH);
        return (
          <View
            key={`trail-${i}`}
            pointerEvents="none"
            style={[styles.trailDot, { left: dot.left - 5, top: dot.top - 5, opacity: 0.35 + (0.65 * (i + 1)) / a.length }]}
          />
        );
      })}
    </>
  );
}

function tokenText(token: MapToken, kind: TokenType) {
  return token.name || kind.label;
}

/**
 * Markers and the party. With a hex grid each is a hex of it (`layoutHexTokens`, the party first so it keeps the
 * centre of a shared hex); without one, round markers.
 */
function Markers({
  state,
  grid,
  imageWidth,
  imageHeight,
  mapW,
  mapH,
}: {
  state: PlayerMapState;
  grid: HexGrid | null;
  imageWidth: number;
  imageHeight: number;
  mapW: number;
  mapH: number;
}) {
  const types = useMemo(() => tokenTypes(state), [state]);
  const { party, tokens } = state;
  const places = useMemo(() => {
    if (!grid) return null;
    const items: HexTokenItem[] = [{ key: "party", x: party.x, y: party.y }, ...tokens.map((t) => ({ key: String(t.id), x: t.x, y: t.y }))];
    return layoutHexTokens(items, grid, { width: imageWidth, height: imageHeight });
  }, [grid, party.x, party.y, tokens, imageWidth, imageHeight]);

  const partyPlace = places?.get("party") ?? null;
  return (
    <>
      {tokens.map((token) => {
        const kind = tokenType(types, token.type);
        const place: HexTokenPlace | null = places?.get(String(token.id)) ?? null;
        const text = tokenText(token, kind);
        const a11y = `${text}, ${kind.label}${token.hidden ? " (hidden from players)" : ""}`;
        return place && grid ? (
          <HexMarker
            accessibilityLabel={a11y}
            dim={token.hidden}
            fill={kind.colour}
            icon={kind.path}
            iconStroke="#fff"
            id={`t${token.id}`}
            key={token.id}
            label={`${token.location ? "📍 " : ""}${token.name}`}
            mapH={mapH}
            mapW={mapW}
            orientation={grid.orientation}
            place={place}
          />
        ) : (
          <RoundMarker a11y={a11y} key={token.id} kind={kind} mapH={mapH} mapW={mapW} text={text} token={token} />
        );
      })}
      {partyPlace && grid ? (
        <HexMarker
          accessibilityLabel="Party token"
          fill="party"
          icon={PARTY_ICON}
          iconStroke="#2a1a04"
          id="party"
          label="The Party"
          labelStyle={styles.partyHexLabel}
          mapH={mapH}
          mapW={mapW}
          orientation={grid.orientation}
          place={partyPlace}
          zIndex={6}
        />
      ) : (
        <RoundParty mapH={mapH} mapW={mapW} party={party} />
      )}
    </>
  );
}

function RoundMarker({ token, kind, text, a11y, mapW, mapH }: { token: MapToken; kind: TokenType; text: string; a11y: string; mapW: number; mapH: number }) {
  const pos = pctToPx(token, mapW, mapH);
  const dim = token.hidden;
  return (
    <View accessibilityLabel={a11y} pointerEvents="none" style={[styles.token, { left: pos.left, top: pos.top }]}>
      <View style={[styles.tokenIcon, { backgroundColor: kind.colour, borderStyle: dim ? "dashed" : "solid", opacity: dim ? 0.45 : 1 }]}>
        <Svg height={14} viewBox="0 0 24 24" width={14}>
          <SvgPath d={kind.path} fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} />
        </Svg>
      </View>
      <Text style={[styles.tokenLabel, dim ? styles.tokenLabelDim : null]}>
        {token.location ? "📍 " : ""}
        {text}
      </Text>
    </View>
  );
}

function RoundParty({ party, mapW, mapH }: { party: PlayerMapState["party"]; mapW: number; mapH: number }) {
  const pos = pctToPx(party, mapW, mapH);
  return (
    <View accessibilityLabel="Party token" pointerEvents="none" style={[styles.token, { left: pos.left, top: pos.top, zIndex: 6 }]}>
      <View style={[styles.tokenIcon, styles.partyIcon]}>
        <Svg height={18} viewBox="0 0 24 24" width={18}>
          <SvgPath d={PARTY_ICON} fill="none" stroke="#2a1a04" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} />
        </Svg>
      </View>
      <Text style={styles.partyLabel}>The Party</Text>
    </View>
  );
}

function ScaleBar({ scaleKm }: { scaleKm: number }) {
  const bar = scaleBar(scaleKm);
  return (
    <View pointerEvents="none" style={[styles.scaleBar, { width: `${bar.percent}%` }]}>
      <Text style={styles.scaleLabel}>{bar.label}</Text>
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
    minHeight: 240,
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
  partyHexLabel: {
    backgroundColor: "#2a1a04",
    color: "#f3cf86",
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
