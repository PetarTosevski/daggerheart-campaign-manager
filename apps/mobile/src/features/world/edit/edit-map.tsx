import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";

import type { Point } from "../../../../../../src/lib/domain/travel";
import { HORIZON_FRAME, mapImageSize, type MapState } from "../../../../../../src/lib/world/map-state";
import { cellOf, paintTerrain, terrainDiff, type TerrainCode } from "../../../../../../src/lib/world/terrain";
import { colors } from "../../../theme/colors";
import type { WorldMapData } from "../contract";
import { MapCanvas } from "../map-canvas";
import { resolveMapImageUrl } from "../map-image";
import { useMapPanZoom } from "../pan-zoom";
import { touchToPct } from "./coords";
import type { MapActions } from "./map-actions";

type StrokePhase = "start" | "move" | "end";

export function EditMap({
  data,
  painting,
  brush,
  brushSize,
  placing,
  movingId,
  actions,
  onPlaced,
  onMoved,
}: {
  data: WorldMapData;
  painting: boolean;
  brush: TerrainCode;
  brushSize: number;
  placing: string | null;
  movingId: number | null;
  actions: MapActions;
  onPlaced: () => void;
  onMoved: () => void;
}) {
  const state = data.state as MapState;
  const isHorizon = data.frameId === HORIZON_FRAME;
  const image = mapImageSize(data.frameId, state);
  const aspect = image.height / image.width;
  const imageUrl = resolveMapImageUrl(data.frameId, data.mapUrl, state.customMap);

  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const panZoom = useMapPanZoom(viewport.w, viewport.h, aspect);
  const stroke = useRef<{ start: string; grid: string } | null>(null);
  const [localTerrain, setLocalTerrain] = useState<string | null>(null);
  const terrain = localTerrain ?? state.terrain;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ w: width, h: height });
    if (width > 0) panZoom.fit();
  };

  const displayState = localTerrain !== null ? { ...state, terrain } : state;

  function onStroke(phase: StrokePhase, p: Point) {
    if (!painting || isHorizon) return;
    const { c, r } = cellOf(p.x, p.y);
    if (phase === "start") stroke.current = { start: terrain, grid: terrain };
    const s = stroke.current;
    if (!s) return;
    if (phase !== "end" || s.grid === s.start) s.grid = paintTerrain(s.grid, c, r, brushSize, brush);
    if (phase === "end") {
      stroke.current = null;
      setLocalTerrain(null);
      if (s.grid !== s.start) {
        const diff = terrainDiff(s.start, s.grid);
        void actions.paintCells(diff.indexes, diff.codes);
      }
    } else {
      setLocalTerrain(s.grid);
    }
  }

  function onTap(locationX: number, locationY: number) {
    const p = touchToPct(locationX, locationY, panZoom.view, aspect);
    if (placing) {
      void actions.addToken(placing, p.x, p.y).then(() => onPlaced());
      return;
    }
    if (movingId !== null) {
      void actions.updateToken(movingId, { x: p.x, y: p.y }).then(() => onMoved());
    }
  }

  const panStart = useRef({ x: 0, y: 0 });
  /* eslint-disable react-hooks/refs -- RNGH callbacks run outside React render. */
  const pan = Gesture.Pan()
    .onBegin((e) => {
      panStart.current = { x: panZoom.view.x, y: panZoom.view.y };
      if (painting) onStroke("start", touchToPct(e.x, e.y, panZoom.view, aspect));
    })
    .onUpdate((e) => {
      if (painting) {
        onStroke("move", touchToPct(e.x, e.y, panZoom.view, aspect));
        return;
      }
      panZoom.setView({
        z: panZoom.view.z,
        x: panStart.current.x + e.translationX,
        y: panStart.current.y + e.translationY,
      });
    })
    .onEnd((e) => {
      if (painting) onStroke("end", touchToPct(e.x, e.y, panZoom.view, aspect));
      else if (!placing && movingId === null && Math.hypot(e.translationX, e.translationY) < 8) {
        onTap(e.x, e.y);
      }
    })
    .runOnJS(true);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      panZoom.zoomAt(panZoom.view.z * e.scale, viewport.w / 2, viewport.h / 2);
    })
    .runOnJS(true);
  /* eslint-enable react-hooks/refs */

  const gesture = Gesture.Simultaneous(pan, pinch);

  return (
    <View style={styles.shell}>
      <GestureDetector gesture={gesture}>
        <View onLayout={onLayout} style={styles.viewport} testID="world-edit-map">
          {viewport.w > 0 ? (
            <MapCanvas
              frameId={data.frameId}
              imageUrl={imageUrl}
              isHorizon={isHorizon}
              label="GM edit map"
              showGrid={false}
              showTerrain
              showTokens
              state={displayState}
              view={panZoom.view}
            />
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderColor: colors.line2,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  viewport: {
    minHeight: 280,
  },
});
