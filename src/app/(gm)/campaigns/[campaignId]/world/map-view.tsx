"use client";

import { useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import type { Point, RouteAnalysis } from "@/lib/domain/travel";
import { hexesCovering, hexesPath, neighbours, type Hex, type HexGrid } from "@/lib/world/hex";
import type { HexCrawl, MapToken } from "@/lib/world/map-state";
import { TERRAIN_COLOURS, TERRAIN_COLUMNS, TERRAIN_ROWS, terrainPaths, type TerrainCode } from "@/lib/world/terrain";
import { tokenType, type TokenType } from "@/lib/world/token-types";

import type { usePanZoom } from "./use-pan-zoom";

export type MapTool = "pan" | "paint" | "draw";
export type StrokePhase = "start" | "move" | "end";

export type MapViewProps = {
  viewport: RefObject<HTMLDivElement | null>;
  panZoom: ReturnType<typeof usePanZoom>;
  fullScreen: boolean;
  label: string;
  imageUrl: string | null;
  image: { width: number; height: number };
  editable: boolean;
  tokens: MapToken[];
  types: TokenType[];
  showTokens: boolean;
  selectedId: number | null;
  party: { x: number; y: number; trail: Point[] };
  partyDraggable: boolean;
  terrain: string;
  showTerrain: boolean;
  showBlockOnly: boolean;
  painting: boolean;
  brush: TerrainCode;
  brushSize: number;
  route: { points: Point[]; analysis: RouteAnalysis | null; freehand: boolean; label: string } | null;
  crawl: HexCrawl | null;
  showGrid: boolean;
  selectedHex: Hex | null;
  tool: MapTool;
  crosshair: boolean;
  scaleBar: { percent: number; label: string };
  onMapClick: (p: Point) => void;
  onStroke: (phase: StrokePhase, p: Point) => void;
  onSelectToken: (id: number) => void;
  onMoveToken: (id: number, p: Point) => void;
  onMoveParty: (p: Point) => void;
  onDropType: (type: string, p: Point) => void;
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** The map viewport: art, terrain, hexes, trail, route and tokens, with pan, pinch, wheel and keyboard zoom. */
export function MapView(props: MapViewProps) {
  const { viewport, panZoom, image, editable } = props;
  const mapRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | null
    | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean; button: number }
    | { kind: "pinch"; d0: number; z0: number }
    | { kind: "stroke" }
  >(null);
  const drag = useRef<{ id: number | "party"; sx: number; sy: number; moved: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: number | "party"; p: Point } | null>(null);
  const [hoverCell, setHoverCell] = useState<{ c: number; r: number } | null>(null);
  const aspect = image.height / image.width;
  const { view } = panZoom;
  const mapW = view.w * view.z;

  const toPct = (clientX: number, clientY: number): Point => {
    const r = mapRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: clamp(((clientX - r.left) / r.width) * 100), y: clamp(((clientY - r.top) / r.height) * 100) };
  };

  const vpPoint = (clientX: number, clientY: number) => {
    const r = viewport.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const target = e.target as Element;
    if (target.closest(".tok, button, input, select, textarea, a")) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no capturable pointer.
    }
    if (pointers.current.size === 2) {
      if (gesture.current?.kind === "stroke") props.onStroke("end", toPct(e.clientX, e.clientY));
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: panZoom.viewRef.current.z };
      return;
    }
    if (pointers.current.size > 2) return;
    if (e.button === 0 && props.tool !== "pan") {
      gesture.current = { kind: "stroke" };
      props.onStroke("start", toPct(e.clientX, e.clientY));
      return;
    }
    if (e.button !== 0) e.preventDefault();
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: panZoom.viewRef.current.x, vy: panZoom.viewRef.current.y, moved: false, button: e.button };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (props.painting) {
      const p = toPct(e.clientX, e.clientY);
      const c = Math.floor((p.x / 100) * TERRAIN_COLUMNS);
      const r = Math.floor((p.y / 100) * TERRAIN_ROWS);
      if (!hoverCell || hoverCell.c !== c || hoverCell.r !== r) setHoverCell({ c, r });
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const mid = vpPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      panZoom.zoomAt((g.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, mid.x, mid.y);
    } else if (g.kind === "stroke") {
      props.onStroke("move", toPct(e.clientX, e.clientY));
    } else {
      const dx = e.clientX - g.sx;
      const dy = e.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      panZoom.setView({ z: panZoom.viewRef.current.z, x: g.vx + dx, y: g.vy + dy });
    }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // Pinch ended with one finger still down: carry on as a pan from here.
      if (g?.kind === "pinch") {
        const [rest] = [...pointers.current.values()];
        gesture.current = { kind: "pan", sx: rest.x, sy: rest.y, vx: panZoom.viewRef.current.x, vy: panZoom.viewRef.current.y, moved: true, button: 0 };
      }
      return;
    }
    gesture.current = null;
    if (g?.kind === "stroke") props.onStroke("end", toPct(e.clientX, e.clientY));
    else if (g?.kind === "pan" && !g.moved && g.button === 0 && e.type === "pointerup") props.onMapClick(toPct(e.clientX, e.clientY));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const step = 60;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      panZoom.panBy(...moves[e.key]);
    }
  }

  // ---- token and party dragging (GM). The dragged item is read from `data-drag`.
  const dragId = (el: Element): number | "party" => {
    const v = (el as HTMLElement).dataset.drag;
    return v === "party" ? "party" : Number(v);
  };
  const canDrag = (id: number | "party") => editable && (id !== "party" || props.partyDraggable);

  function onItemPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const id = dragId(e.currentTarget);
    if (canDrag(id)) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events have no capturable pointer.
      }
    }
    drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false };
  }

  function onItemPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || d.id !== dragId(e.currentTarget) || !canDrag(d.id)) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    setDragPos({ id: d.id, p: toPct(e.clientX, e.clientY) });
  }

  function onItemPointerUp(e: PointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== dragId(e.currentTarget)) return;
    if (!d.moved) {
      if (d.id !== "party") props.onSelectToken(d.id);
      return;
    }
    const p = toPct(e.clientX, e.clientY);
    if (d.id === "party") props.onMoveParty(p);
    else props.onMoveToken(d.id, p);
    setDragPos(null);
  }

  function onItemPointerCancel() {
    drag.current = null;
    setDragPos(null);
  }

  const itemHandlers = { onPointerDown: onItemPointerDown, onPointerMove: onItemPointerMove, onPointerUp: onItemPointerUp, onPointerCancel: onItemPointerCancel };

  function nudge(e: KeyboardEvent<HTMLButtonElement>, at: Point, onMove: (p: Point) => void) {
    const step = e.shiftKey ? 2 : 0.5;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = d[e.key];
    if (!m || !editable) return;
    e.preventDefault();
    e.stopPropagation();
    onMove({ x: clamp(at.x + m[0]), y: clamp(at.y + m[1]) });
  }

  const paths = useMemo(() => (props.showTerrain || props.showBlockOnly ? terrainPaths(props.terrain) : null), [props.showTerrain, props.showBlockOnly, props.terrain]);

  const hexLayer = useMemo(() => {
    const crawl = props.crawl;
    if (!crawl) return null;
    const grid: HexGrid = crawl.grid;
    const explored = crawl.hexes.filter((h) => h.explored);
    return {
      grid: props.showGrid ? hexesPath(hexesCovering(image.width, image.height, grid), grid) : "",
      explored: hexesPath(explored, grid),
      near: crawl.party ? hexesPath(neighbours(crawl.party), grid) : "",
      party: crawl.party ? hexesPath([crawl.party], grid) : "",
      selected: props.selectedHex ? hexesPath([props.selectedHex], grid) : "",
      poi: hexesPath(
        crawl.hexes.filter((h) => h.poi),
        { ...grid, size: grid.size * 0.28 },
      ),
      hiddenPoi: hexesPath(
        crawl.hexes.filter((h) => h.poi?.hidden),
        { ...grid, size: grid.size * 0.28 },
      ),
    };
  }, [props.crawl, props.showGrid, props.selectedHex, image.width, image.height]);

  const party = dragPos?.id === "party" ? { ...props.party, ...dragPos.p } : props.party;
  const trail = [...props.party.trail, { x: party.x, y: party.y }];
  const mapStyle: CSSProperties = {
    width: mapW,
    height: mapW * aspect,
    transform: `translate(${view.x}px, ${view.y}px)`,
    backgroundImage: props.imageUrl ? `url(${props.imageUrl})` : undefined,
    cursor: props.crosshair ? "crosshair" : undefined,
  };
  const brushColour = TERRAIN_COLOURS[props.brush];
  const n = 2 * props.brushSize - 1;

  return (
    <div
      ref={viewport}
      className={`w-vp${props.fullScreen ? " w-fs" : ""}`}
      role="application"
      aria-label={`${props.label}. Arrow keys pan; + and − zoom.`}
      aria-roledescription="map"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => props.painting && setHoverCell(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={mapRef}
        data-map="1"
        className={`w-canvas${props.imageUrl ? "" : " w-parchment"}`}
        style={mapStyle}
        onDragOver={(e: DragEvent) => e.preventDefault()}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          const type = e.dataTransfer.getData("text/plain");
          if (type) props.onDropType(type, toPct(e.clientX, e.clientY));
        }}
      >
        {paths && props.showTerrain ? (
          <svg viewBox="0 0 128 98" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]">
            <path d={paths.h} fill="rgba(176, 58, 46, 0.42)" shapeRendering="crispEdges" />
            <path d={paths.w} fill="rgba(70, 150, 80, 0.30)" shapeRendering="crispEdges" />
            <path d={paths.d} fill="rgba(20, 80, 40, 0.55)" shapeRendering="crispEdges" />
            <path d={paths.m} fill="rgba(70, 120, 110, 0.5)" shapeRendering="crispEdges" />
            <path d={paths.r} fill="rgba(227, 170, 60, 0.55)" shapeRendering="crispEdges" />
            <path d={paths.x} fill={props.painting ? "rgba(60, 110, 200, 0.35)" : "transparent"} shapeRendering="crispEdges" />
            <path d={paths.b} fill="rgba(12, 9, 6, 0.78)" shapeRendering="crispEdges" />
          </svg>
        ) : null}
        {paths && !props.showTerrain && props.showBlockOnly ? (
          <svg viewBox="0 0 128 98" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]">
            <path d={paths.b} fill="rgba(12, 9, 6, 0.78)" shapeRendering="crispEdges" />
          </svg>
        ) : null}
        {props.painting && hoverCell ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 box-border"
            style={{
              left: `${((hoverCell.c - (props.brushSize - 1)) / TERRAIN_COLUMNS) * 100}%`,
              top: `${((hoverCell.r - (props.brushSize - 1)) / TERRAIN_ROWS) * 100}%`,
              width: `${(n / TERRAIN_COLUMNS) * 100}%`,
              height: `${(n / TERRAIN_ROWS) * 100}%`,
              border: `2px solid ${brushColour}`,
              outline: "1px solid rgba(255, 248, 228, 0.9)",
              background: `${brushColour}33`,
              borderRadius: props.brushSize > 1 ? "35%" : "2px",
            }}
          />
        ) : null}
        {hexLayer ? (
          <svg
            viewBox={`0 0 ${image.width} ${image.height}`}
            preserveAspectRatio="none"
            width="100%"
            height="100%"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[1]"
          >
            {hexLayer.grid ? <path d={hexLayer.grid} fill="none" stroke="rgba(60, 36, 12, 0.6)" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
            <path d={hexLayer.explored} fill="rgba(227, 180, 90, 0.28)" stroke="rgba(138, 90, 16, 0.85)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {hexLayer.near ? <path d={hexLayer.near} fill="none" stroke="rgba(138, 90, 16, 0.8)" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /> : null}
            {hexLayer.party ? <path d={hexLayer.party} fill="rgba(227, 180, 90, 0.4)" stroke="#8a5a10" strokeWidth={3} vectorEffect="non-scaling-stroke" /> : null}
            <path d={hexLayer.poi} fill="#f3cf86" stroke="#2a1f14" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={hexLayer.hiddenPoi} fill="#5a2a6a" stroke="#f3cf86" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {hexLayer.selected ? <path d={hexLayer.selected} fill="none" stroke="#8e2b2b" strokeWidth={3} vectorEffect="non-scaling-stroke" /> : null}
          </svg>
        ) : null}
        {props.showTokens ? (
          <>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" className="pointer-events-none absolute inset-0 z-[2]">
              <polyline
                points={trail.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="#8e2b2b"
                strokeDasharray="0.9 0.7"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ strokeWidth: 3 }}
              />
            </svg>
            {props.party.trail.map((p, i, a) => (
              <span
                key={i}
                aria-hidden="true"
                className="pointer-events-none absolute z-[2] -mt-[5px] -ml-[5px] size-[10px] rounded-full border-2 border-[#efe3c8] bg-[#8e2b2b]"
                style={{ left: `${p.x}%`, top: `${p.y}%`, opacity: 0.35 + (0.65 * (i + 1)) / a.length }}
              />
            ))}
          </>
        ) : null}
        {props.route ? <RouteLayer route={props.route} /> : null}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[3%] left-[2%] z-[4] flex flex-col gap-[3px] rounded-md bg-[rgba(239,227,200,0.92)] px-2.5 pt-1.5 pb-1 shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
        >
          <span
            className="block h-1.5 min-w-[60px] border-[1.5px] border-t-0 border-[#2a1f14]"
            style={{ width: `${props.scaleBar.percent.toFixed(1)}%`, background: "repeating-linear-gradient(90deg, #2a1f14 0 25%, transparent 25% 50%)" }}
          />
          <span className="font-display text-[11px] font-bold text-[#2a1f14]">{props.scaleBar.label}</span>
        </div>
        {props.showTokens
          ? props.tokens.map((t) => {
              const type = tokenType(props.types, t.type);
              const pos = dragPos?.id === t.id ? dragPos.p : t;
              const on = t.id === props.selectedId;
              const dim = t.hidden && editable;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="tok"
                  data-tok-id={t.id}
                  aria-label={`${t.name || type.label}, ${type.label}${t.hidden ? " (hidden from players)" : ""}.${editable ? " Drag or use the arrow keys to move, click to edit." : ""}`}
                  aria-pressed={editable ? on : undefined}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: on ? 5 : undefined }}
                  onKeyDown={(e) => nudge(e, t, (p) => props.onMoveToken(t.id, p))}
                  onClick={(e) => {
                    // Keyboard activation (pointer taps select on pointer up).
                    if (e.detail === 0) props.onSelectToken(t.id);
                  }}
                  onDoubleClick={() => {
                    props.onSelectToken(t.id);
                    window.setTimeout(() => document.querySelector<HTMLInputElement>("[data-name-field]")?.select(), 40);
                  }}
                  data-drag={t.id}
                  {...itemHandlers}
                >
                  <span
                    className="tok-ic"
                    style={{
                      background: type.colour,
                      border: `2px ${dim ? "dashed" : "solid"} rgba(255, 243, 214, 0.85)`,
                      boxShadow: on ? "0 0 0 3px #e3b45a, 0 3px 8px rgba(0, 0, 0, 0.55)" : undefined,
                      opacity: dim ? 0.45 : undefined,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d={type.path} />
                    </svg>
                  </span>
                  <span className="tok-lbl" style={dim ? { opacity: 0.55, textDecoration: "line-through" } : undefined}>
                    {t.location ? "📍 " : ""}
                    {t.name}
                  </span>
                </button>
              );
            })
          : null}
        {props.showTokens ? (
          <button
            type="button"
            className="tok"
            aria-label={editable && props.partyDraggable ? "Party token. Drag or use the arrow keys to move the party." : "Party token"}
            style={{ left: `${party.x}%`, top: `${party.y}%`, zIndex: 6 }}
            onKeyDown={(e) => props.partyDraggable && nudge(e, party, props.onMoveParty)}
            data-drag="party"
            {...itemHandlers}
          >
            <span className="tok-ic party-ic">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2a1a04" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 21V3 M5 4h11l-2.5 3.5L16 11H5" />
              </svg>
            </span>
            <span className="tok-lbl" style={{ background: "#2a1a04", color: "#f3cf86" }}>
              The Party
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

const RUN_COLOURS = TERRAIN_COLOURS;

function RouteLayer({ route }: { route: NonNullable<MapViewProps["route"]> }) {
  const P = (q: Point) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`;
  const pts = route.points;
  if (!pts.length) return null;
  const dots = route.freehand ? [pts[0], ...(pts.length > 1 ? [pts[pts.length - 1]] : [])] : pts;
  const end = pts[pts.length - 1];
  return (
    <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" className="pointer-events-none absolute inset-0 z-[7]">
        <polyline points={pts.map(P).join(" ")} fill="none" stroke="rgba(246, 238, 220, 0.92)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {route.analysis?.runs.map((r, i) => (
          <polyline
            key={i}
            points={r.points.map(P).join(" ")}
            fill="none"
            stroke={RUN_COLOURS[r.terrain] ?? "#47a55a"}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {dots.map((q, i) => {
        const isEnd = route.freehand || i === 0 || i === dots.length - 1;
        const s = isEnd ? 14 : 10;
        return (
          <span
            key={i}
            aria-hidden="true"
            className="pointer-events-none absolute z-[8] rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.6)]"
            style={{
              left: `${q.x}%`,
              top: `${q.y}%`,
              width: s,
              height: s,
              margin: `-${s / 2}px 0 0 -${s / 2}px`,
              background: isEnd ? "#f4efe6" : "#1a1408",
              border: `2px solid ${isEnd ? "#1a1408" : "#f4efe6"}`,
            }}
          />
        );
      })}
      <span
        className="pointer-events-none absolute z-[9] rounded-[7px] border border-[#e3b45a] bg-[#1a1408] px-[9px] py-1 text-[12px] font-semibold whitespace-nowrap text-[#f4efe6] shadow-[0_2px_6px_rgba(0,0,0,0.5)]"
        style={{ left: `${end.x}%`, top: `${end.y}%`, transform: "translate(-50%, -170%)" }}
      >
        {route.label}
      </span>
    </>
  );
}
