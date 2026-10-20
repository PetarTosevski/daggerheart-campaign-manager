"use client";

import "./map-view.css";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { FOG_PAD_SQUARES } from "@/lib/domain/combat-map/vision";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { CombatMapLayout } from "../../../../convex/combatMaps";
import type { CombatMapSummary, CombatMapViewport, MapBoardProps } from "../slots";
import { usePlayerFitArea } from "../vision/fit";
import { decodeCells } from "./cells";
import { MapViewContext, type MapViewState } from "./context";
import { imageMapSize, type ImageGrid } from "./grid";
import { GridControls } from "./grid-controls";
import { MAP_CELL, MapCanvas } from "./map-canvas";
import { useMapZoom, ZOOM_STEP } from "./use-map-zoom";
import { useViewerFlag } from "./use-viewer-flag";

/** localStorage key of the board's "Names" switch (per viewer). */
const NAMES_KEY = "dh.combat.names";

/** The board's hint under the map, per view. */
const HINT = {
  player: "Drag your own token to move · drag the gold knob to turn · click a torch or campfire to light it · click any token for its range circles.",
  edit: "Paint with the chosen tool · click an object to select it, drag to move it · right-drag or ✋ to pan · Ctrl + scroll to zoom.",
  play: "Drag tokens to move (they face the way they move) · drag the knob on a selected token to turn it · click torches and campfires to light them · Ctrl + scroll to zoom · N names · Delete removes.",
};

/** An image loaded for drawing (null until it has loaded, or without a URL). */
function useLoadedImage(url: string | null): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ url: string; img: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (url === null) return;
    const img = new Image();
    img.onload = () => setLoaded({ url, img });
    img.src = url;
    return () => {
      img.onload = null;
    };
  }, [url]);
  return loaded !== null && loaded.url === url ? loaded.img : null;
}

/** Main area (slot `MapBoard`): toolbar, the pan/zoom viewport with the map and the layers, or the empty states. */
export function MapBoard(props: MapBoardProps) {
  const { role, map, campaignId } = props;
  const gm = role === "gm";
  const gmLayout = useQuery(api.combatMaps.get, gm && map ? { campaignId, mapId: map._id } : "skip");
  const liveLayout = useQuery(api.combatMaps.live, !gm && map ? { campaignId } : "skip");
  const layout = gm ? gmLayout : liveLayout;

  if (!map || layout === null) return <EmptyBoard player={!gm} />;
  return <LoadedBoard {...props} map={map} layout={layout} />;
}

function EmptyBoard({ player }: { player: boolean }) {
  return (
    <section className="cm-board" aria-label="Battle map">
      <div className="cm-toolbar">
        <strong className="cm-map-title">Battle map</strong>
      </div>
      <div className="cm-vp" data-testid="combat-viewport">
        <div className="cm-empty">
          <div className="cm-empty-inner">
            <div className="cm-empty-title">{player ? "No battle yet" : "No battlefield yet"}</div>
            <div className="cm-muted">
              {player
                ? "The GM has not shown a map yet."
                : "Describe the scene and press Generate, or bring your own map image. Then add the party and the adversaries and drag them into position."}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type Drag = { kind: "pan" | "grid"; pointerId: number; sx: number; sy: number; left: number; top: number; moved: boolean; button: number };

function LoadedBoard(props: MapBoardProps & { map: CombatMapSummary; layout: CombatMapLayout | undefined }) {
  const { role, mode, map, layout, campaignId, renderLayers, onSelectToken } = props;
  const gm = role === "gm";
  const pad = gm ? 0 : FOG_PAD_SQUARES;
  const w = layout?.w ?? map.w;
  const h = layout?.h ?? map.h;
  const viewportRef = useRef<HTMLDivElement>(null);
  // The stage element as state (not a ref), so `toSquares` may be handed to layers during render.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  // Q1: a player's stage is the map padded by FOG_PAD_SQUARES of fog (the pan limits), and Fit frames the squares
  // their character has explored, never the map's real bounds (C8). The GM's Fit frames the map.
  const fitSquares = usePlayerFitArea({ campaignId, role }, map, pad);
  const fitArea = fitSquares ? { x: fitSquares.x * MAP_CELL, y: fitSquares.y * MAP_CELL, w: fitSquares.w * MAP_CELL, h: fitSquares.h * MAP_CELL } : null;
  const { zoom, setZoom, fit } = useMapZoom(
    viewportRef,
    stage,
    (w + 2 * pad) * MAP_CELL,
    (h + 2 * pad) * MAP_CELL,
    // Refit once when the explored area first arrives, not on every square explored.
    `${map._id}:${w}x${h}:${fitArea ? "explored" : "all"}`,
    fitArea,
  );
  const [showNames, setShowNames] = useViewerFlag(NAMES_KEY);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const [panning, setPanning] = useState(false);

  const image = useLoadedImage(layout?.image?.url ?? null);
  const imageSize = image ? { width: image.naturalWidth, height: image.naturalHeight } : null;
  const cells = useMemo(() => decodeCells(layout?.cells ?? [], w, h), [layout?.cells, w, h]);

  // Grid over an image (R1): Edit mode, GM, image maps. `preview` is the grid while a drag shifts it.
  const editingGrid = gm && mode === "edit" && layout?.source === "image" && layout.image !== null;
  const [shifting, setShifting] = useState(false);
  const [preview, setPreview] = useState<ImageGrid | null>(null);
  const setGridMutation = useMutation(api.combatMaps.setGrid).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId });
    if (!current?.image) return;
    const size = imageMapSize({ width: args.imageWidth, height: args.imageHeight }, args.grid);
    store.setQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId }, { ...current, ...size, image: { ...current.image, grid: args.grid } });
  });
  const setLive = useMutation(api.combatMaps.setLive).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(api.combatMaps.list, { campaignId: args.campaignId });
    if (list) store.setQuery(api.combatMaps.list, { campaignId: args.campaignId }, list.map((m) => ({ ...m, live: m._id === args.mapId })));
    const current = store.getQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId });
    if (current) store.setQuery(api.combatMaps.get, { campaignId: args.campaignId, mapId: args.mapId }, { ...current, live: true });
  });

  const grid = layout?.image?.grid ?? null;
  function commitGrid(next: ImageGrid) {
    if (!imageSize) return;
    setError(null);
    setGridMutation({ campaignId, mapId: map._id, grid: next, imageWidth: imageSize.width, imageHeight: imageSize.height }).catch((e: unknown) =>
      setError(errorMessage(e)),
    );
  }

  const step = MAP_CELL * zoom;
  function toSquares(clientX: number, clientY: number) {
    const r = stage?.getBoundingClientRect();
    if (!r) return { x: -1, y: -1 };
    return { x: (clientX - r.left) / step - pad, y: (clientY - r.top) / step - pad };
  }
  const viewport: CombatMapViewport = { cell: MAP_CELL, zoom, w, h, pad, toSquares, showNames };

  // ---- pointer: drag the background to pan (or to shift the grid), Ctrl + scroll zooms (useMapZoom).
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.defaultPrevented || e.pointerType === "touch") return;
    const vp = viewportRef.current;
    if (!vp) return;
    const kind = editingGrid && shifting && e.button === 0 ? "grid" : "pan";
    drag.current = { kind, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, left: vp.scrollLeft, top: vp.scrollTop, moved: false, button: e.button };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const vp = viewportRef.current;
    if (!d || !vp || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) {
      d.moved = true;
      // Captured only once it is a drag, so a plain click still reaches the layer under it.
      vp.setPointerCapture(e.pointerId);
      if (d.kind === "pan") setPanning(true);
    }
    if (!d.moved) return;
    if (d.kind === "pan") {
      vp.scrollLeft = d.left - dx;
      vp.scrollTop = d.top - dy;
    } else if (grid) {
      // Moving the image under a fixed grid: dragging right moves the image right, so the offset shrinks.
      setPreview({ ...grid, offsetX: Math.round(grid.offsetX - (dx / step) * grid.cell), offsetY: Math.round(grid.offsetY - (dy / step) * grid.cell) });
    }
  }
  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (d.kind === "grid" && d.moved && preview) commitGrid(preview);
    setPreview(null);
    // A click on the bare map drops the token selection (the board).
    if (!d.moved && d.button === 0 && d.kind === "pan") onSelectToken(null);
  }

  // ---- keyboard: N names, Escape drops the selection (the board's shortcuts; R/Delete belong to the tokens).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "n" || e.key === "N") setShowNames(!showNames);
    if (e.key === "Escape") onSelectToken(null);
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const shownGrid = preview ?? grid;
  const mapState: MapViewState | null = layout ? { layout, cells, viewport, image: imageSize } : null;
  const vpClass = ["cm-vp", "cm-vp-map", panning ? "cm-panning" : "", editingGrid && shifting ? "cm-shifting" : "", showNames ? "names" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="cm-board" aria-label="Battle map">
      <div className="cm-toolbar">
        <strong className="cm-map-title">{map.name}</strong>
        {map.live && gm ? <span className="cm-live">LIVE</span> : null}
        {gm && !map.live ? (
          <button
            type="button"
            className="cm-btn cm-sm"
            onClick={() => {
              setError(null);
              setLive({ campaignId, mapId: map._id }).catch((e: unknown) => setError(errorMessage(e)));
            }}
          >
            Make live
          </button>
        ) : null}
        <span className="cm-spacer" />
        <button type="button" className="cm-btn cm-sm" aria-pressed={showNames} onClick={() => setShowNames(!showNames)} title="Always show token names (N)">
          Aa Names
        </button>
        <button type="button" className="cm-btn cm-sm" aria-label="Zoom out" onClick={() => setZoom(zoom / ZOOM_STEP)}>
          −
        </button>
        <span className="cm-muted cm-zoom" aria-live="polite" data-testid="combat-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="cm-btn cm-sm" aria-label="Zoom in" onClick={() => setZoom(zoom * ZOOM_STEP)}>
          +
        </button>
        <button type="button" className="cm-btn cm-sm" onClick={fit}>
          Fit
        </button>
      </div>
      {editingGrid && grid ? (
        <GridControls grid={shownGrid ?? grid} onGrid={commitGrid} shifting={shifting} onShifting={setShifting} disabled={imageSize === null} />
      ) : null}
      {error ? (
        <p role="alert" className="cm-alert cm-m0">
          {error}
        </p>
      ) : null}
      <div
        ref={viewportRef}
        className={vpClass}
        data-testid="combat-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="cm-vp-inner">
          <div ref={setStage} className="cm-stage" data-testid="combat-stage" style={{ width: (w + 2 * pad) * step, height: (h + 2 * pad) * step }}>
            {layout && mapState ? (
              <MapViewContext.Provider value={mapState}>
                <MapCanvas layout={layout} paint={cells.paint} image={image} grid={shownGrid} zoom={zoom} pad={pad} />
                {renderLayers({ ...props, map, viewport })}
              </MapViewContext.Provider>
            ) : (
              <p role="status" className="cm-muted cm-vp-loading">
                Loading the map…
              </p>
            )}
          </div>
        </div>
      </div>
      <span className="cm-muted cm-hint">{gm ? (mode === "edit" ? HINT.edit : HINT.play) : HINT.player}</span>
    </section>
  );
}
