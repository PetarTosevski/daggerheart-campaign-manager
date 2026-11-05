import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";

import { brushSquares, movePoint, objectAt, type PaintValue } from "../../../../../../src/components/combat-map/editor/edit-model";

import type { CombatMapLayout, CombatPlayerView } from "../contract";
import { CombatMapCanvas } from "../map-canvas";
import { useMapPanZoom } from "../../world/pan-zoom";
import { touchToSquare } from "./coords";
import type { useEditActions } from "./edit-actions";
import { toolFor, useEditor } from "./editor-state";
import { editStyles } from "./styles";
import type { SpriteEditing } from "./use-sprite-editing";
type StrokePaint = PaintValue | { layer: "texture"; texture: NonNullable<CombatMapLayout["objects"][number]["sprite"]> };

export function CombatEditMap({
  layout,
  view,
  sprites,
  edits,
}: {
  layout: CombatMapLayout;
  view: Extract<CombatPlayerView, { state: "noCharacter" }>;
  sprites: SpriteEditing;
  edits: ReturnType<typeof useEditActions>;
}) {
  const editor = useEditor();
  const isImage = layout.source === "image";
  const tool = toolFor(editor.tool, isImage);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const panZoom = useMapPanZoom(viewport.w, viewport.h, layout.h / layout.w);
  const stroke = useRef<{ paint: StrokePaint; squares: Set<number> } | null>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ w: width, h: height });
    if (width > 0) panZoom.fit();
  };

  function finishStroke() {
    const s = stroke.current;
    stroke.current = null;
    if (!s || s.squares.size === 0) return;
    if (typeof s.paint === "string") edits.paint([...s.squares], s.paint);
    else edits.paint([...s.squares], s.paint);
  }

  function onTap(locationX: number, locationY: number) {
    const p = touchToSquare(locationX, locationY, { ...panZoom.view, w: viewport.w }, layout);
    if (tool === "object") {
      const hit = objectAt(layout.objects, p.x, p.y);
      if (hit) {
        editor.selectObject(hit._id);
        return;
      }
      const sprite = sprites.active ? (editor.sprite ?? sprites.palette.objects[0]?.ref ?? null) : null;
      void (sprite !== null ? edits.addSprite(sprite, p.x, p.y) : edits.add(editor.kind, p.x, p.y)).then((id) => {
        if (id !== null) editor.selectObject(id);
      });
    }
  }

  const panStart = useRef({ x: 0, y: 0 });
  /* eslint-disable react-hooks/refs -- RNGH callbacks run outside React render. */
  const pan = Gesture.Pan()
    .onBegin((e) => {
      panStart.current = { x: panZoom.view.x, y: panZoom.view.y };
      if (tool === "pan" || tool === "object") return;
      const p = touchToSquare(e.x, e.y, { ...panZoom.view, w: viewport.w }, layout);
      const paint: StrokePaint =
        tool !== "terrain"
          ? tool
          : sprites.active && editor.texture !== null
            ? { layer: "texture", texture: editor.texture }
            : editor.terrain;
      stroke.current = { paint, squares: new Set(brushSquares(p.x, p.y, editor.brush, layout.w, layout.h)) };
    })
    .onUpdate((e) => {
      const s = stroke.current;
      if (s) {
        const p = touchToSquare(e.x, e.y, { ...panZoom.view, w: viewport.w }, layout);
        for (const q of brushSquares(p.x, p.y, editor.brush, layout.w, layout.h)) s.squares.add(q);
        return;
      }
      const d = drag.current;
      if (d) {
        if (!d.moved && Math.hypot(e.translationX, e.translationY) > 3) d.moved = true;
        return;
      }
      if (tool === "pan" || tool === "object") {
        panZoom.setView({
          z: panZoom.view.z,
          x: panStart.current.x + e.translationX,
          y: panStart.current.y + e.translationY,
        });
      }
    })
    .onEnd((e) => {
      if (stroke.current) {
        finishStroke();
        return;
      }
      const d = drag.current;
      if (d && d.moved) {
        const p = touchToSquare(e.x, e.y, { ...panZoom.view, w: viewport.w }, layout);
        const at = movePoint(p.x, p.y, layout.w, layout.h);
        edits.move(d.id, at.x, at.y);
        drag.current = null;
        return;
      }
      drag.current = null;
      if (tool === "object" && Math.hypot(e.translationX, e.translationY) < 8) onTap(e.x, e.y);
    })
    .runOnJS(true);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      panZoom.zoomAt(panZoom.view.z * e.scale, viewport.w / 2, viewport.h / 2);
    })
    .runOnJS(true);
  /* eslint-enable react-hooks/refs */

  const gesture = Gesture.Simultaneous(pan, pinch);
  const selected = layout.objects.find((o) => o._id === editor.selectedObjectId) ?? null;

  return (
    <View style={editStyles.mapShell} testID="combat-edit-map">
      <GestureDetector gesture={gesture}>
        <View onLayout={onLayout} style={styles.viewport}>
          {viewport.w > 0 ? (
            <CombatMapCanvas isGm label="Edit map preview" layout={layout} panView={panZoom.view} view={view} />
          ) : null}
        </View>
      </GestureDetector>
      {selected ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="combat-edit-selected" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flexGrow: 1,
    minHeight: 220,
    overflow: "hidden",
  },
});
