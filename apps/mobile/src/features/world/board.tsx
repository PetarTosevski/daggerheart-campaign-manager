import { GestureDetector } from "react-native-gesture-handler";
import { useState } from "react";
import { LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from "react-native";

import { trailMethod } from "../../../../../src/lib/domain/travel";
import { HORIZON_FRAME, mapImageSize, travelRules, type PlayerMapState } from "../../../../../src/lib/world/map-state";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import type { WorldMapData } from "./contract";
import { WorldEditSlot } from "./edit";
import { useMapGesture } from "./gestures";
import { MapCanvas } from "./map-canvas";
import { resolveMapImageUrl } from "./map-image";
import { useMapPanZoom } from "./pan-zoom";
import { TravelLegend } from "./travel-legend";

/**
 * The World screen. The map fills the space between a fixed header and a short scrolling info panel: it is never
 * inside a vertical ScrollView, so a drag on the map always pans it. The GM's map tools replace the view map with
 * their own edit map while open.
 */
export function WorldBoard({ campaignName, data }: { campaignName: string; data: WorldMapData }) {
  const state = data.state as PlayerMapState;
  const isHorizon = data.frameId === HORIZON_FRAME;
  const isGm = data.role === "gm";
  const [toolsOpen, setToolsOpen] = useState(false);
  const rules = travelRules(state);
  const mo = state.options;

  return (
    <View style={styles.screen}>
      <Text style={styles.eyebrow}>World</Text>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {campaignName}
      </Text>
      {toolsOpen ? null : <ViewMap campaignName={campaignName} data={data} isHorizon={isHorizon} />}
      {toolsOpen || isHorizon ? null : (
        <ScrollView contentContainerStyle={styles.infoStack} style={styles.info}>
          <TravelLegend method={trailMethod(mo.trail)} pace={mo.pace} rules={rules} />
        </ScrollView>
      )}
      <WorldEditSlot data={data} enabled={isGm} onToggle={() => setToolsOpen((v) => !v)} open={toolsOpen} />
    </View>
  );
}

function ViewMap({ campaignName, data, isHorizon }: { campaignName: string; data: WorldMapData; isHorizon: boolean }) {
  const state = data.state as PlayerMapState;
  const image = mapImageSize(data.frameId, state);
  const aspect = image.height / image.width;
  const imageUrl = resolveMapImageUrl(data.frameId, data.mapUrl, state.customMap);

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [showTerrain, setShowTerrain] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [hideTokens, setHideTokens] = useState(false);
  const panZoom = useMapPanZoom(viewport.w, viewport.h, aspect);
  const gesture = useMapGesture(panZoom);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ w: width, h: height });
  };

  return (
    <>
      <Text style={styles.hint}>Pinch to zoom and drag to pan.</Text>
      <ScrollView contentContainerStyle={styles.toolbar} horizontal showsHorizontalScrollIndicator={false} style={styles.toolbarScroll}>
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
      </ScrollView>
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
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    gap: space[2],
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
    fontSize: 24,
    fontWeight: type.displayBold.fontWeight,
  },
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
  },
  toolbarScroll: {
    flexGrow: 0,
  },
  toolbar: {
    alignItems: "center",
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
    flex: 1,
    minHeight: 240,
  },
  mapPlaceholder: {
    backgroundColor: colors.ink2,
    borderRadius: 10,
    flex: 1,
  },
  info: {
    flexGrow: 0,
    maxHeight: "35%",
  },
  infoStack: {
    gap: space[2],
  },
});
