"use client";

import { useEffect, useEffectEvent, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { sightOf } from "@/lib/domain/combat-map/sight";

import type { CombatMapLayout } from "../../../../convex/combatMaps";
import { useMapView } from "../map-view/context";
import type { MapLayerProps } from "../slots";
import { brushSquares, movePoint, objectAt, type PaintValue } from "./edit-model";
import { toolFor, useEditor } from "./editor-state";
import { useEditMutations } from "./use-edit-mutations";

/** The board's overlay colours. */
const COLORS = {
  block: "rgba(200,40,60,0.32)",
  blockEdge: "rgba(255,120,140,0.6)",
  outlineBlock: "rgba(255,90,110,0.9)",
  outlineCover: "rgba(120,200,255,0.9)",
  selected: "#e3b45a",
  strokeTerrain: "rgba(227,180,90,0.45)",
  strokeBlock: "rgba(200,40,60,0.4)",
  strokeErase: "rgba(240,240,240,0.35)",
};

type Stroke = { pointerId: number; paint: PaintValue; squares: Set<number> };
type ObjectDrag = { pointerId: number; id: string; sx: number; sy: number; moved: boolean; at: { x: number; y: number } | null };

type Overlay = {
  layout: CombatMapLayout;
  block: ReadonlySet<string>;
  selectedId: string | null;
  ghost: { id: string; x: number; y: number } | null;
  cell: number;
};

/**
 * Draws the edit overlay: painted sight blockers (red squares), every object's sight outline on painted maps
 * (solid red = blocks sight, dashed blue = cover only; R7), the selected object's ring and a moved object's ghost.
 * Vector outlines only, so a full redraw is cheap; the painted map itself is C3's canvas, which repaints only what
 * an edit changed.
 */
function drawOverlay(canvas: HTMLCanvasElement, { layout, block, selectedId, ghost, cell }: Overlay) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (canvas.width !== layout.w * cell || canvas.height !== layout.h * cell) {
    canvas.width = layout.w * cell;
    canvas.height = layout.h * cell;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1.5;
  for (const key of block) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    ctx.fillStyle = COLORS.block;
    ctx.fillRect(x * cell, y * cell, cell, cell);
    ctx.strokeStyle = COLORS.blockEdge;
    ctx.strokeRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
  }
  const isImage = layout.source === "image";
  for (const o of layout.objects) {
    const at = ghost?.id === o._id ? ghost : o;
    const mode = sightOf(o);
    if (!isImage && mode !== "none") {
      ctx.strokeStyle = mode === "block" ? COLORS.outlineBlock : COLORS.outlineCover;
      ctx.setLineDash(mode === "block" ? [] : [6, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at.x * cell, at.y * cell, o.r * cell * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (o._id === selectedId) {
      ctx.strokeStyle = COLORS.selected;
      ctx.setLineDash(ghost?.id === o._id ? [8, 6] : []);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(at.x * cell, at.y * cell, Math.max(0.6, o.r) * cell * 0.95 + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

/** Paints a stroke's new squares straight onto the overlay (no redraw while the GM drags). */
function drawStrokeSquares(canvas: HTMLCanvasElement, squares: readonly number[], w: number, cell: number, color: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = color;
  for (const s of squares) ctx.fillRect((s % w) * cell, Math.floor(s / w) * cell, cell, cell);
}

const strokeColor = (paint: PaintValue) => (paint === "block" ? COLORS.strokeBlock : paint === "eraseTerrain" || paint === "eraseBlock" ? COLORS.strokeErase : COLORS.strokeTerrain);

/**
 * Map area in Edit (slot `EditorLayer`): the tools' pointer handling (paint strokes, placing, selecting and
 * dragging objects) and the "blocks sight" overlay. With the Move-view tool it lets every pointer through, so the
 * map pans; otherwise it takes the left button (preventDefault, the map area's contract) and leaves the right
 * button to pan, as on the board.
 */
export function EditorLayer({ campaignId, map, viewport, onSelectToken }: MapLayerProps) {
  const { layout, cells } = useMapView();
  const editor = useEditor();
  const edits = useEditMutations(campaignId, map._id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<Stroke | null>(null);
  const drag = useRef<ObjectDrag | null>(null);
  const { cell, zoom, w, h, pad } = viewport;
  const tool = toolFor(editor.tool, layout.source === "image");
  const selectedId = layout.objects.some((o) => o._id === editor.selectedObjectId) ? editor.selectedObjectId : null;

  const overlay = (ghost: Overlay["ghost"] = null): Overlay => ({ layout, block: cells.block, selectedId, ghost, cell });

  useEffect(() => {
    if (canvas.current) drawOverlay(canvas.current, { layout, block: cells.block, selectedId, ghost: null, cell });
  }, [layout, cells.block, selectedId, cell]);

  function select(objectId: string | null) {
    editor.selectObject(objectId);
    if (objectId !== null) onSelectToken(null);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || tool === "pan") return;
    e.preventDefault();
    const p = viewport.toSquares(e.clientX, e.clientY);
    if (tool === "object") {
      const hit = objectAt(layout.objects, p.x, p.y);
      if (hit) {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointerId: e.pointerId, id: hit._id, sx: e.clientX, sy: e.clientY, moved: false, at: null };
        return;
      }
      void edits.add(editor.kind, p.x, p.y).then((id) => {
        if (id !== null) select(id);
      });
      return;
    }
    const paint: PaintValue = tool === "terrain" ? editor.terrain : tool;
    const squares = brushSquares(p.x, p.y, editor.brush, w, h);
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = { pointerId: e.pointerId, paint, squares: new Set(squares) };
    if (canvas.current) drawStrokeSquares(canvas.current, squares, w, cell, strokeColor(paint));
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = stroke.current;
    if (s && s.pointerId === e.pointerId) {
      const p = viewport.toSquares(e.clientX, e.clientY);
      const added = brushSquares(p.x, p.y, editor.brush, w, h).filter((q) => !s.squares.has(q));
      for (const q of added) s.squares.add(q);
      if (added.length > 0 && canvas.current) drawStrokeSquares(canvas.current, added, w, cell, strokeColor(s.paint));
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true;
    if (!d.moved) return;
    const p = viewport.toSquares(e.clientX, e.clientY);
    d.at = movePoint(p.x, p.y, w, h);
    if (canvas.current) drawOverlay(canvas.current, { ...overlay({ id: d.id, ...d.at }), selectedId: d.id });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const s = stroke.current;
    if (s && s.pointerId === e.pointerId) {
      stroke.current = null;
      // One write per stroke: every touched square in one intent, shown at once by the optimistic update.
      edits.paint([...s.squares], s.paint);
      if (canvas.current) drawOverlay(canvas.current, overlay());
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    select(d.id);
    if (d.moved && d.at) edits.move(d.id, d.at.x, d.at.y);
  }

  function onPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
    if (stroke.current?.pointerId === e.pointerId) stroke.current = null;
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
    if (canvas.current) drawOverlay(canvas.current, overlay());
  }

  // Delete / Backspace removes the selected object, Escape drops it (the board's shortcuts).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (selectedId === null) return;
    const target = e.target as HTMLElement | null;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      edits.remove(selectedId);
      editor.selectObject(null);
    } else if (e.key === "Escape") editor.selectObject(null);
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const step = cell * zoom;
  return (
    <div
      className={`cm-ed-layer cm-ed-tool-${tool}`}
      data-testid="combat-editor-layer"
      style={{ left: pad * step, top: pad * step, width: w * step, height: h * step }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <canvas ref={canvas} className="cm-ed-canvas" aria-hidden="true" />
    </div>
  );
}
