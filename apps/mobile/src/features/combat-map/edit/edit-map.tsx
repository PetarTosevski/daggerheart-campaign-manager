import { useRef } from "react";
import { StyleSheet, View } from "react-native";

import { brushSquares, movePoint, objectAt, type PaintValue } from "../../../../../../src/components/combat-map/editor/edit-model";

import type { CombatMapLayout, CombatPlayerView } from "../contract";
import { CombatMapStage } from "../map-canvas";
import type { MapHandlers } from "../use-map-view";
import { clampToMap } from "./coords";
import type { useEditActions } from "./edit-actions";
import { toolFor, useEditor } from "./editor-state";
import { editStyles } from "./styles";
import type { SpriteEditing } from "./use-sprite-editing";
type StrokePaint = PaintValue | { layer: "texture"; texture: NonNullable<CombatMapLayout["objects"][number]["sprite"]> };

/** A drag shorter than this many points is a tap. */
const TAP_PT = 8;

export function CombatEditMap({
  layout,
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
  const stroke = useRef<{ paint: StrokePaint; squares: Set<number> } | null>(null);
  const drag = useRef<{ id: string } | null>(null);

  function finishStroke() {
    const s = stroke.current;
    stroke.current = null;
    if (!s || s.squares.size === 0) return;
    if (typeof s.paint === "string") edits.paint([...s.squares], s.paint);
    else edits.paint([...s.squares], s.paint);
  }

  function onTap(at: { x: number; y: number }) {
    if (tool !== "object") return;
    const hit = objectAt(layout.objects, at.x, at.y);
    if (hit) {
      editor.selectObject(hit._id);
      return;
    }
    const sprite = sprites.active ? (editor.sprite ?? sprites.palette.objects[0]?.ref ?? null) : null;
    void (sprite !== null ? edits.addSprite(sprite, at.x, at.y) : edits.add(editor.kind, at.x, at.y)).then((id) => {
      if (id !== null) editor.selectObject(id);
    });
  }

  // Drags and taps in squares; a drag the editor does not take pans the map (world/gestures.ts useMapGesture).
  const handlers: MapHandlers = (toSquare) => ({
    onDragStart: (p) => {
      const at = clampToMap(toSquare(p.x, p.y), layout);
      if (tool === "pan") return false;
      if (tool === "object") {
        const hit = objectAt(layout.objects, at.x, at.y);
        if (!hit) return false;
        drag.current = { id: hit._id };
        editor.selectObject(hit._id);
        return true;
      }
      const paint: StrokePaint =
        tool !== "terrain" ? tool : sprites.active && editor.texture !== null ? { layer: "texture", texture: editor.texture } : editor.terrain;
      stroke.current = { paint, squares: new Set(brushSquares(at.x, at.y, editor.brush, layout.w, layout.h)) };
      return true;
    },
    onDragMove: (p) => {
      const s = stroke.current;
      if (!s) return;
      const at = clampToMap(toSquare(p.x, p.y), layout);
      for (const q of brushSquares(at.x, at.y, editor.brush, layout.w, layout.h)) s.squares.add(q);
    },
    onDragEnd: (p, moved) => {
      const at = clampToMap(toSquare(p.x, p.y), layout);
      if (stroke.current) {
        finishStroke();
        return;
      }
      const d = drag.current;
      drag.current = null;
      if (d && moved >= TAP_PT) {
        const to = movePoint(at.x, at.y, layout.w, layout.h);
        edits.move(d.id, to.x, to.y);
        return;
      }
      if (!d && moved < TAP_PT) onTap(at);
    },
  });

  const selected = layout.objects.find((o) => o._id === editor.selectedObjectId) ?? null;

  return (
    <View style={editStyles.mapShell} testID="combat-edit-map">
      <View style={styles.viewport}>
        <CombatMapStage fog={null} handlers={handlers} label="Edit map preview" layout={layout} pad={0} tokens={[]} />
      </View>
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
