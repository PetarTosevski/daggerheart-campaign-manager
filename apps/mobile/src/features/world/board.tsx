import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useRef, useState } from "react";
import { LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from "react-native";

import { trailMethod } from "../../../../../src/lib/domain/travel";
import { HORIZON_FRAME, mapImageSize, travelRules, type PlayerMapState } from "../../../../../src/lib/world/map-state";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import type { WorldMapData } from "./contract";
import { WorldEditSlot } from "./edit";
import { MapCanvas } from "./map-canvas";
import { resolveMapImageUrl } from "./map-image";
import { useMapPanZoom } from "./pan-zoom";
import { TravelLegend } from "./travel-legend";

export function WorldBoard({ campaignName, data }: { campaignName: string; data: WorldMapData }) {
  const state = data.state as PlayerMapState;
  const isHorizon = data.frameId === HORIZON_FRAME;
  const isGm = data.role === "gm";
  const image = mapImageSize(data.frameId, state);
  const aspect = image.height / image.width;
  const imageUrl = resolveMapImageUrl(data.frameId, data.mapUrl, state.customMap);
  const rules = travelRules(state);
  const mo = state.options;
  const trail = trailMethod(mo.trail);

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [showTerrain, setShowTerrain] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [hideTokens, setHideTokens] = useState(false);

  const panZoom = useMapPanZoom(viewport.w, viewport.h, aspect);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ w: width, h: height });
  };

  const panStart = useRef({ x: 0, y: 0 });
  /* eslint-disable react-hooks/refs -- RNGH callbacks run outside React render. */
  const pan = Gesture.Pan()
    .onBegin(() => {
      panStart.current = { x: panZoom.view.x, y: panZoom.view.y };
    })
    .onUpdate((e) => {
      panZoom.setView({
        z: panZoom.view.z,
        x: panStart.current.x + e.translationX,
        y: panStart.current.y + e.translationY,
      });
    })
    .runOnJS(true);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      panZoom.zoomAt(panZoom.view.z * e.scale, viewport.w / 2, viewport.h / 2);
    })
    .runOnJS(true);
  /* eslint-enable react-hooks/refs */

  const gesture = Gesture.Simultaneous(pan, pinch);

  const hint = isGm
    ? "Scroll or pinch to zoom, drag to pan."
    : "Pinch to zoom and drag to pan.";

  return (
    <ScrollView contentContainerStyle={styles.stack}>
      <Text style={styles.eyebrow}>World</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {campaignName}
      </Text>
      <Text style={styles.hint}>{hint}</Text>
      <View style={styles.toolbar}>
        {!isHorizon ? (
          <Button onPress={() => setShowTerrain((v) => !v)} variant="outline">
            Terrain overlay
          </Button>
        ) : (
          <Button onPress={() => setShowGrid((v) => !v)} variant="outline">
            Hex grid
          </Button>
        )}
        <Button onPress={() => panZoom.zoomAt(panZoom.view.z / 1.25)} variant="outline">
          Zoom out
        </Button>
        <Text style={styles.zoom}>{Math.round(panZoom.view.z * 100)}%</Text>
        <Button onPress={() => panZoom.zoomAt(panZoom.view.z * 1.25)} variant="outline">
          Zoom in
        </Button>
        <Button onPress={panZoom.fit} variant="outline">
          Fit map
        </Button>
        <Button onPress={() => setHideTokens((v) => !v)} variant="outline">
          {hideTokens ? "Show tokens" : "Hide tokens"}
        </Button>
      </View>
      {!isHorizon ? <TravelLegend method={trail} pace={mo.pace} rules={rules} /> : null}
      {!imageUrl ? (
        <Text style={styles.note}>The map image is not available, so this is blank parchment until art loads or the GM uploads one.</Text>
      ) : null}
      <GestureDetector gesture={gesture}>
        <View onLayout={onLayout} style={styles.mapShell} testID="world-map-shell">
          {viewport.w > 0 ? (
            <MapCanvas
              frameId={data.frameId}
              imageUrl={imageUrl}
              isHorizon={isHorizon}
              label={`Map of ${campaignName}`}
              showGrid={showGrid}
              showTerrain={showTerrain}
              showTokens={!hideTokens}
              state={state}
              view={panZoom.view}
            />
          ) : (
            <View style={styles.mapPlaceholder} />
          )}
        </View>
      </GestureDetector>
      <WorldEditSlot enabled={isGm} data={data} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
    paddingBottom: space[8],
  },
  eyebrow: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: colors.body,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  zoom: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    minWidth: 48,
    textAlign: "center",
  },
  note: {
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    backgroundColor: "#2a2416",
    borderColor: "#5a4a2a",
    borderRadius: 10,
    borderWidth: 1,
    color: "#f0dfb8",
    padding: space[3],
  },
  mapShell: {
    flexGrow: 1,
    minHeight: 320,
  },
  mapPlaceholder: {
    backgroundColor: colors.ink2,
    borderRadius: 10,
    flex: 1,
    minHeight: 280,
  },
});
