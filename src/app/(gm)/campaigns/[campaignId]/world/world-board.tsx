"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { designAsset } from "@/lib/design-assets";
import {
  METHOD_LABELS,
  TRAIL_MODES,
  TRAIL_MODE_LABELS,
  TRAVEL_METHODS,
  analyseRoute,
  formatDistance,
  formatLeg,
  formatTravelTime,
  mapScale,
  routeWarning,
  scaleBar,
  trailLeg,
  trailTotal,
  travelHours,
  type Point,
  type TrailMode,
  type TravelMethod,
  type TravelPace,
} from "@/lib/domain/travel";
import { hexDistance, hexToPixel, pixelToHex, type Hex } from "@/lib/world/hex";
import { HORIZON_FRAME, WORLD_MAPS, mapImageSize, playerMapView, travelRules, type MapState, type MapToken, type PlayerMapState } from "@/lib/world/map-state";
import {
  BRUSHES,
  BRUSH_SIZES,
  TERRAIN_COLOURS,
  TERRAIN_NAMES,
  cellOf,
  paintTerrain,
  suggestedTerrain,
  terrainAt,
  terrainDiff,
  type TerrainCode,
} from "@/lib/world/terrain";
import { tokenType, tokenTypes } from "@/lib/world/token-types";

import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { MapView as MapViewData } from "../../../../../../convex/maps";
import { CrawlInfo, HexCrawlPanel } from "./hex-panel";
import { useMapActions } from "./map-actions";
import { MapImageControl } from "./map-image";
import { MapView, type StrokePhase } from "./map-view";
import { Palette } from "./palette";
import { TokenPanel } from "./token-panel";
import { TravelRulesDialog } from "./travel-rules";
import { usePanZoom } from "./use-pan-zoom";

type MeasureMode = "line" | "way" | "free";

/** The World board (World.dc.html) for one campaign. */
export function WorldBoard({ campaignId, campaignName, data, focusId }: { campaignId: Id<"campaigns">; campaignName: string; data: MapViewData; focusId: number | null }) {
  const actions = useMapActions(campaignId);
  const isGm = data.role === "gm";
  const [preview, setPreview] = useState(false);
  const editable = isGm && !preview;
  // Only the GM previews the player view, and the GM receives the full state.
  const state: MapState | PlayerMapState = useMemo(() => (editable || !isGm ? data.state : playerMapView(data.state as MapState)), [data.state, editable, isGm]);
  const horizon = data.frameId === HORIZON_FRAME;
  const crawl = horizon ? (state.hexCrawl ?? null) : null;

  const published = (WORLD_MAPS as Record<string, { asset: string }>)[data.frameId];
  const imageUrl = state.customMap ? data.mapUrl : published ? (designAsset(published.asset) ?? null) : null;
  const image = mapImageSize(data.frameId, state);
  const scale = mapScale(state.scaleKm, image.width, image.height);
  const rules = travelRules(state);
  const types = useMemo(() => tokenTypes(state), [state]);

  // ---- board state
  const [placing, setPlacing] = useState<string | null>(null);
  const [selId, setSelId] = useState<number | null>(focusId);
  const [selHex, setSelHex] = useState<Hex | null>(null);
  const [showTerrain, setShowTerrain] = useState(false);
  const [hideToks, setHideToks] = useState(false);
  const [fs, setFs] = useState(false);
  const [painting, setPainting] = useState(false);
  const [brush, setBrush] = useState<TerrainCode>("r");
  const [bsize, setBsize] = useState(2);
  const [localTerrain, setLocalTerrain] = useState<string | null>(null);
  /** Each entry restores the cells a stroke (or reset) changed to their previous codes. */
  const undo = useRef<{ indexes: number[]; codes: string }[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const stroke = useRef<{ start: string; grid: string } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [mmode, setMmode] = useState<MeasureMode>("way");
  const [mpts, setMpts] = useState<Point[]>([]);
  const [showGrid, setShowGrid] = useState(false);
  const [settingOrigin, setSettingOrigin] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [scaleDraft, setScaleDraft] = useState<string | null>(null);

  const viewport = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const panZoom = usePanZoom(viewport, image.height / image.width);
  const terrain = localTerrain ?? state.terrain;
  const lookup = (p: Point) => terrainAt(terrain, p.x, p.y);

  // Focus a token from the dashboard's Locations panel (after the first fit).
  const focusToken = useEffectEvent(() => {
    const t = data.state.tokens.find((x) => x.id === focusId);
    if (t) panZoom.centreOn(t.x, t.y, Math.max(panZoom.viewRef.current.z, 1.75));
  });
  useEffect(() => {
    if (focusId === null) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => focusToken()));
    return () => cancelAnimationFrame(id);
  }, [focusId]);

  const visibleTokens = state.tokens;
  const sel = editable ? (state.tokens.find((t) => t.id === selId) ?? null) : null;

  // ---- hex helpers (Horizon)
  const toHex = (p: Point): Hex | null => (crawl ? pixelToHex((p.x / 100) * image.width, (p.y / 100) * image.height, crawl.grid) : null);
  const snap = (p: Point): Point => {
    if (!crawl) return p;
    const h = toHex(p)!;
    const c = hexToPixel(h, crawl.grid);
    return { x: Math.max(0, Math.min(100, (c.x / image.width) * 100)), y: Math.max(0, Math.min(100, (c.y / image.height) * 100)) };
  };
  const partyHex = crawl?.party ?? null;

  // ---- measure
  const mo = state.options;
  const units = mo.units;
  const mRes = mpts.length > 1 ? analyseRoute(mpts, scale, lookup, mo, rules) : null;
  const hours = travelHours(mo.hours);
  const routeLabel = mRes ? `${formatDistance(mRes.km, units)} · ${mRes.blocked ? "⛔ blocked" : formatTravelTime(mRes.days, hours)}` : mmode === "free" ? "Drag to draw" : "Click the next point";
  const summary = (() => {
    if (!mRes)
      return {
        total: mpts.length ? "Add another point…" : "No route yet",
        sub: mmode === "free" ? "Press and drag on the map to draw a path." : mmode === "line" ? "Click two points on the map." : "Click to drop waypoints; each click adds a leg.",
        parts: [] as { c: string; label: string }[],
        warn: "",
      };
    const parts = (Object.keys(mRes.per) as TerrainCode[])
      .filter((k) => mRes.per[k] > 0.05)
      .map((k) => ({ c: TERRAIN_COLOURS[k], label: `${TERRAIN_NAMES[k]} ${formatDistance(mRes.per[k], units)} · ${Math.round((mRes.per[k] / mRes.km) * 100)}%` }));
    if (mRes.blocked)
      return {
        total: `${formatDistance(mRes.km, units)} · ⛔ Impassable`,
        sub: `The route crosses ${formatDistance(mRes.per["#"], units)} of impassable terrain. Redraw it around the black areas.`,
        parts,
        warn: "",
      };
    return {
      total: `${formatDistance(mRes.km, units)} · ${formatTravelTime(mRes.days, hours)}`,
      sub: `${mmode === "line" ? "Straight line" : mmode === "free" ? "Freehand path" : `${mpts.length - 1} ${mpts.length === 2 ? "leg" : "legs"}`} · ${hours} h travel per day`,
      parts,
      warn: routeWarning(mRes, mo.method),
    };
  })();

  // ---- distances
  const partyPt = { x: state.party.x, y: state.party.y };
  const leg = (a: Point, b: Point) => trailLeg(a, b, scale, lookup, mo.trail, rules);
  const hexAway = (t: MapToken) => {
    const a = partyHex ?? toHex(partyPt);
    const b = toHex(t);
    if (!a || !b) return "";
    const n = hexDistance(a, b);
    return `${n} ${n === 1 ? "hex" : "hexes"} (~${n * 24} mi)`;
  };
  const fromParty = (t: MapToken) => (crawl ? hexAway(t) : formatLeg(leg(partyPt, t), units));
  const distances = (t: MapToken) =>
    state.tokens
      .filter((o) => o.id !== t.id)
      .map((o) => {
        const name = o.name || tokenType(types, o.type).label;
        if (crawl) {
          const a = toHex(t)!;
          const b = toHex(o)!;
          return { name, sortBy: hexDistance(a, b), text: `${hexDistance(a, b)} hexes` };
        }
        const r = leg(t, o);
        return { name, sortBy: r.days, text: formatLeg(r, units) };
      })
      .sort((a, b) => a.sortBy - b.sortBy)
      .slice(0, 8);
  const trail = trailTotal([...state.party.trail, partyPt], scale, lookup, mo.trail, rules);
  const trailText = crawl ? null : trail ? formatLeg(trail, units) : "nowhere yet";

  // ---- mode switches
  const stopTools = () => {
    setPlacing(null);
    setMeasuring(false);
    setMpts([]);
    setSettingOrigin(false);
  };
  const togglePaint = () => {
    if (!editable || horizon) return;
    setPainting((p) => !p);
    setPlacing(null);
    setMeasuring(false);
    setMpts([]);
    setSelId(null);
  };
  const toggleMeasure = () => {
    if (horizon) return;
    setMeasuring((m) => !m);
    setMpts([]);
    setPlacing(null);
    setPainting(false);
  };
  const togglePlayer = () => {
    if (!isGm) return;
    setPreview((p) => !p);
    setPlacing(null);
    setSelId(null);
    setMeasuring(false);
    setPainting(false);
  };
  const toggleFs = () => {
    if (fs) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      setFs(false);
      return;
    }
    setFs(true);
    const el = section.current;
    if (el?.requestFullscreen && document.fullscreenEnabled) void el.requestFullscreen().catch(() => undefined);
  };

  // ---- terrain painting (local until the stroke ends, then only the changed cells are sent)
  const pushUndo = (before: string, after: string) => {
    undo.current = [...undo.current, terrainDiff(after, before)].slice(-30);
    setUndoCount(undo.current.length);
  };
  const undoPaint = () => {
    const prev = undo.current.pop();
    setUndoCount(undo.current.length);
    if (prev !== undefined) void actions.paintCells(prev.indexes, prev.codes);
  };
  const resetTerrain = async () => {
    pushUndo(terrain, suggestedTerrain(data.frameId));
    await actions.resetTerrain();
  };

  function onStroke(phase: StrokePhase, p: Point) {
    if (painting) {
      const { c, r } = cellOf(p.x, p.y);
      if (phase === "start") stroke.current = { start: terrain, grid: terrain };
      const s = stroke.current;
      if (!s) return;
      if (phase !== "end" || s.grid === s.start) s.grid = paintTerrain(s.grid, c, r, bsize, brush);
      if (phase === "end") {
        stroke.current = null;
        setLocalTerrain(null);
        if (s.grid !== s.start) {
          pushUndo(s.start, s.grid);
          const diff = terrainDiff(s.start, s.grid);
          void actions.paintCells(diff.indexes, diff.codes);
        }
      } else setLocalTerrain(s.grid);
      return;
    }
    // Freehand route.
    if (phase === "start") setMpts([p]);
    else
      setMpts((pts) => {
        const last = pts[pts.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.35) return pts;
        return pts.length >= 400 ? pts : [...pts, p];
      });
  }

  function onMapClick(p: Point) {
    if (settingOrigin && crawl) {
      setSettingOrigin(false);
      void actions.setHexGrid({ ...crawl.grid, originX: Math.round((p.x / 100) * image.width * 10) / 10, originY: Math.round((p.y / 100) * image.height * 10) / 10 });
      return;
    }
    if (measuring) {
      if (mmode === "free") return;
      setMpts((pts) => (mmode === "line" ? (pts.length >= 2 ? [p] : [...pts, p]) : [...pts, p]));
      return;
    }
    if (placing && editable) {
      const at = snap(p);
      void actions.addToken(placing, at.x, at.y).then((r) => r && setSelId(r.id));
      setPlacing(null);
      return;
    }
    if (crawl && editable) {
      setSelHex(toHex(p));
      setSelId(null);
      return;
    }
    if (selId !== null) setSelId(null);
  }

  const moveParty = (p: Point, via?: Point[]) => actions.moveParty(p.x, p.y, via);
  const sendPartyAlongRoute = async () => {
    if (mpts.length < 2) return;
    const step = Math.max(1, Math.floor(mpts.length / 10));
    const via = mpts.filter((_, i) => i % step === 0).slice(0, -1).slice(-11);
    await moveParty(mpts[mpts.length - 1], via);
    setMpts([]);
  };

  // ---- keyboard shortcuts (the board's keys)
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || t.closest("dialog"))) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      if (painting && undoCount) {
        e.preventDefault();
        undoPaint();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (painting) {
      const bi = ["1", "2", "3", "4", "5", "6", "7"].indexOf(e.key);
      if (bi >= 0) {
        e.preventDefault();
        setBrush(BRUSHES[bi].code);
        return;
      }
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const sizes = BRUSH_SIZES.map((z) => z.size);
        const i = Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(bsize) + (e.key === "]" ? 1 : -1)));
        setBsize(sizes[i]);
        return;
      }
    }
    const zoomBy = (k: number) => () => panZoom.zoomAt(panZoom.viewRef.current.z * k);
    const keys: Record<string, () => void> = {
      f: toggleFs,
      m: toggleMeasure,
      t: () => !horizon && setShowTerrain((v) => !v),
      h: () => setHideToks((v) => !v),
      v: togglePlayer,
      p: togglePaint,
      "+": zoomBy(1.25),
      "=": zoomBy(1.25),
      "-": zoomBy(1 / 1.25),
      _: zoomBy(1 / 1.25),
      "0": panZoom.fit,
    };
    if (e.key === "Escape") {
      if (fs) toggleFs();
      else if (placing || measuring || settingOrigin) stopTools();
      else return;
      e.preventDefault();
      return;
    }
    const fn = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
  const onFullscreenChange = useEffectEvent(() => {
    if (!document.fullscreenElement) setFs(false);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey(e);
    const fsChange = () => onFullscreenChange();
    window.addEventListener("keydown", key);
    document.addEventListener("fullscreenchange", fsChange);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("fullscreenchange", fsChange);
    };
  }, []);

  const hint = !editable
    ? isGm
      ? "Player view: hidden markers and GM tools are tucked away."
      : "Scroll or pinch to zoom, drag to pan."
    : settingOrigin
      ? "Click the centre of a hex on the map to set the grid origin."
      : measuring
        ? mmode === "free"
          ? "Freehand: press and drag on the map to draw a route."
          : mmode === "line"
            ? "Click two points to measure. Drag to pan."
            : "Click to add waypoints. Drag to pan, scroll to zoom."
        : placing
          ? `Click anywhere on the map to place a ${tokenType(types, placing).label.toLowerCase()}.`
          : crawl
            ? "Click a hex to edit it or move the party. Scroll to zoom, drag to pan. Drag tokens to move them."
            : "Scroll to zoom, drag (or right-drag, in any mode) to pan. Fully zoomed out, scrolling down moves the page (Shift + scroll always does). Drag tokens to move them; the gold banner is your party.";
  const hintActive = measuring || !!placing || settingOrigin;

  const legend = [
    { c: "rgba(227, 170, 60, 0.85)", label: `Road · ${rules.trail.foot.road} km/day on foot` },
    { c: "rgba(70, 150, 80, 0.7)", label: `Wilds · ${rules.trail.foot.wilds} km/day` },
    { c: "rgba(20, 80, 40, 0.85)", label: `Deep wilds · ${rules.trail.foot.deep} km/day` },
    { c: "rgba(70, 120, 110, 0.85)", label: `Marshland · ${rules.trail.foot.marsh} km/day` },
    { c: "rgba(176, 58, 46, 0.8)", label: `Mountains / hard going · ${rules.trail.foot.mountains} km/day` },
    ...(painting ? [{ c: "rgba(60, 110, 200, 0.6)", label: "Water / no path" }] : []),
    { c: "rgba(12, 9, 6, 0.85)", label: "Impassable" },
  ];
  const showLegend = !horizon && (showTerrain || painting);
  const isCustom = data.frameId === "custom";

  const tool = painting ? "paint" : measuring && mmode === "free" ? "draw" : "pan";

  return (
    <main className={`w-main${editable ? " w-gm" : ""}`}>
      {editable ? <Palette types={types} placing={placing} onPick={(id) => (setPlacing(id), setMeasuring(false), setPainting(false))} actions={actions} /> : null}

      <section
        ref={section}
        aria-label={`Map of ${campaignName}`}
        className={`w-map flex min-w-0 flex-col gap-2.5 ${fs ? "fixed inset-0 z-[1000] box-border overflow-auto bg-[#0d1417] px-4 py-3" : ""}`}
        style={fs ? undefined : { position: "relative" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div role="status" className="text-[14px]" style={{ color: hintActive ? "#f3cf86" : "#9fb2b6" }}>
            {hint}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {editable ? (
              <label className="flex items-center gap-1.5 text-[12px] text-[#9fb2b6]">
                Map width
                <input
                  className="fld w-20"
                  style={{ minHeight: 36, padding: "4px 8px" }}
                  type="number"
                  min={10}
                  step={10}
                  value={scaleDraft ?? String(state.scaleKm)}
                  onChange={(e) => setScaleDraft(e.target.value)}
                  onBlur={() => {
                    if (scaleDraft !== null) void actions.setOptions({ scaleKm: Math.max(10, Number(scaleDraft) || 400) });
                    setScaleDraft(null);
                  }}
                  aria-label="Map width in kilometres"
                />
                km
              </label>
            ) : (
              <span className="text-[12px] text-[#9fb2b6]">Map width {state.scaleKm} km</span>
            )}
            {!measuring && !horizon && editable ? (
              <label className="flex items-center gap-1.5 text-[12px] text-[#9fb2b6]">
                Pace
                <select className="fld w-auto" style={{ minHeight: 36, padding: "4px 8px" }} value={mo.trail} onChange={(e) => actions.setOptions({ trail: e.target.value as TrailMode })} aria-label="Travel pace">
                  {TRAIL_MODES.map((m) => (
                    <option key={m} value={m}>
                      {TRAIL_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {!horizon ? (
              <button type="button" className="zbtn zw tip" data-tip="Terrain overlay · T" aria-pressed={showTerrain} onClick={() => setShowTerrain((s) => !s)}>
                🗺 Terrain
              </button>
            ) : (
              <button type="button" className="zbtn zw tip" data-tip="Show the whole hex grid" aria-pressed={showGrid} onClick={() => setShowGrid((s) => !s)}>
                ⬡ Hex grid
              </button>
            )}
            {editable && !horizon ? (
              <button type="button" className="zbtn zw tip" data-tip="Paint terrain · P" aria-pressed={painting} onClick={togglePaint}>
                🖌 Paint
              </button>
            ) : null}
            {isGm ? (
              <button type="button" className="zbtn zw tip" data-tip="Player view · V" aria-pressed={preview} onClick={togglePlayer}>
                {preview ? "✎ GM view" : "👁 Player view"}
              </button>
            ) : null}
            {!horizon ? (
              <button type="button" className="zbtn zw tip" data-tip="Measure / plan a route · M" aria-pressed={measuring} onClick={toggleMeasure}>
                📏 Measure
              </button>
            ) : null}
            <button type="button" className="zbtn tip" data-tip="Zoom out · −" aria-label="Zoom out" onClick={() => panZoom.zoomAt(panZoom.view.z / 1.25)}>
              −
            </button>
            <span className="min-w-12 text-center text-[13px] text-[#9fb2b6]" aria-label="Zoom level">
              {Math.round(panZoom.view.z * 100)}%
            </span>
            <button type="button" className="zbtn tip" data-tip="Zoom in · +" aria-label="Zoom in" onClick={() => panZoom.zoomAt(panZoom.view.z * 1.25)}>
              +
            </button>
            <button type="button" className="zbtn zw tip" data-tip="Fit the whole map · 0" aria-label="Fit map" onClick={panZoom.fit}>
              Fit
            </button>
            <button type="button" className="zbtn zw tip" data-tip="Hide / show all tokens · H" aria-pressed={hideToks} onClick={() => setHideToks((s) => !s)}>
              {hideToks ? "👁 Show tokens" : "🙈 Hide all tokens"}
            </button>
            <button type="button" className="zbtn zw tip" aria-pressed={fs} aria-label={fs ? "Exit full screen (Esc)" : "Full screen"} data-tip={`${fs ? "Exit full screen (Esc)" : "Full screen"} · F`} onClick={toggleFs}>
              {fs ? "✕ Exit full screen" : "⛶ Full screen"}
            </button>
          </div>
        </div>

        {painting ? (
          <div role="toolbar" aria-label="Terrain brushes" className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e3b45a] bg-[#141e22] px-3 py-2.5">
            <span className="font-display text-[14px] font-bold text-[#f3cf86]">Paint terrain</span>
            {BRUSHES.map((b, i) => (
              <button
                key={b.code}
                type="button"
                className="brush tip"
                data-tip={`${b.label} · ${i + 1}`}
                aria-pressed={brush === b.code}
                onClick={() => setBrush(b.code)}
                style={{ background: b.bg, borderColor: b.code === "#" && brush !== b.code ? "#6a5a40" : undefined }}
              >
                {b.label}
              </button>
            ))}
            <span className="ml-1.5 text-[12px] text-[#9fb2b6]" title="Keys 1–7 pick a terrain, [ and ] change the size, Ctrl+Z undoes a stroke">
              Brush
            </span>
            {BRUSH_SIZES.map((z) => (
              <button
                key={z.size}
                type="button"
                className="zbtn tip"
                aria-pressed={bsize === z.size}
                aria-label={`Brush size ${z.label}`}
                data-tip="Brush size · [ smaller  ] bigger"
                onClick={() => setBsize(z.size)}
                style={{ width: 36, minWidth: 36, height: 36, fontSize: 13 }}
              >
                {z.label}
              </button>
            ))}
            <span className="flex-1" />
            <button type="button" className="zbtn zw tip" onClick={undoPaint} disabled={!undoCount} data-tip="Undo last stroke · Ctrl+Z">
              ↶ Undo stroke{undoCount > 1 ? ` (${undoCount})` : ""}
            </button>
            <span className="text-[11px] text-[#7f9297]">1–7 terrain · [ ] size · Ctrl+Z undo</span>
            <button type="button" className="zbtn zw" onClick={resetTerrain}>
              Reset to suggested
            </button>
            <button type="button" className="zbtn zw zgold" onClick={togglePaint}>
              Done
            </button>
          </div>
        ) : null}

        {measuring ? (
          <div role="region" aria-label="Measure and plan a route" className="flex flex-col gap-2.5 rounded-xl border border-[#e3b45a] bg-[#141e22] px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 font-display text-[14px] font-bold text-[#f3cf86]">Route</span>
              {(
                [
                  ["line", "Straight line", "Distance between two points"],
                  ["way", "Waypoints", "Click to add points along a route"],
                  ["free", "Freehand", "Press and drag to draw a path"],
                ] as const
              ).map(([k, label, tip]) => (
                <button key={k} type="button" className="mseg tip" aria-pressed={mmode === k} data-tip={tip} onClick={() => (setMmode(k), setMpts([]))}>
                  {label}
                </button>
              ))}
              <span className="mx-1 h-6 w-px bg-[#2a3a40]" />
              <label className="flex items-center gap-1.5 text-[12px] text-[#9fb2b6]">
                Travel
                <select
                  className="fld w-auto"
                  style={{ minHeight: 34, padding: "2px 8px" }}
                  value={mo.method}
                  disabled={!editable}
                  onChange={(e) => actions.setOptions({ method: e.target.value as TravelMethod })}
                  aria-label="Travel method"
                >
                  {TRAVEL_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-[#9fb2b6]">
                Pace
                <select
                  className="fld w-auto"
                  style={{ minHeight: 34, padding: "2px 8px" }}
                  value={mo.pace}
                  disabled={!editable}
                  onChange={(e) => actions.setOptions({ pace: e.target.value as TravelPace })}
                  aria-label="Route pace"
                >
                  <option value="slow">Cautious ×{rules.slow}</option>
                  <option value="normal">Normal</option>
                  <option value="fast">Forced march ×{rules.fast}</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-[#9fb2b6]">
                Hours/day
                <input
                  className="fld w-16"
                  style={{ minHeight: 34, padding: "2px 8px" }}
                  type="number"
                  min={1}
                  max={16}
                  disabled={!editable}
                  defaultValue={hours}
                  key={hours}
                  onBlur={(e) => actions.setOptions({ hours: travelHours(Number(e.target.value)) })}
                  aria-label="Travel hours per day"
                />
              </label>
              <button type="button" className="mseg" disabled={!editable} onClick={() => actions.setOptions({ units: units === "mi" ? "km" : "mi" })} title="Switch units">
                {units === "mi" ? "Miles" : "Kilometres"}
              </button>
              {editable ? (
                <button type="button" className="mseg" aria-haspopup="dialog" onClick={() => setRulesOpen(true)}>
                  Speeds…
                </button>
              ) : null}
              <span className="flex-1" />
              <button type="button" className="mseg" disabled={!mpts.length} onClick={() => setMpts(mmode === "free" ? [] : mpts.slice(0, -1))}>
                Undo point
              </button>
              <button type="button" className="mseg" disabled={!mpts.length} onClick={() => setMpts([])}>
                Clear
              </button>
              {editable ? (
                <button type="button" className="mseg tip" disabled={mpts.length < 2} data-tip="Move the party token along this route" onClick={sendPartyAlongRoute}>
                  Move party along route
                </button>
              ) : null}
              <button type="button" className="zbtn zw zgold" style={{ height: 34 }} onClick={toggleMeasure}>
                Done
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span role="status" data-testid="route-total" className="font-display text-[18px] font-bold text-[#f4efe6]">
                {summary.total}
              </span>
              <span className="text-[13px] text-[#9fb2b6]">{summary.sub}</span>
              {summary.parts.map((p) => (
                <span key={p.label} className="mchip">
                  <i style={{ background: p.c }} />
                  {p.label}
                </span>
              ))}
              {summary.warn ? <span className="text-[12px] text-[#f0a37a]">{summary.warn}</span> : null}
            </div>
          </div>
        ) : null}

        {showLegend ? (
          <div className="flex flex-wrap gap-3 text-[12px] text-[#c8d3d0]">
            {legend.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5">
                <span className="size-3.5 rounded-[3px] border border-white/40" style={{ background: l.c }} />
                {l.label}
              </span>
            ))}
          </div>
        ) : null}
        {!imageUrl ? (
          <div role="note" className="rounded-[10px] border border-[#5a4a2a] bg-[#2a2416] px-3.5 py-2.5 text-[14px] leading-normal text-[#f0dfb8]">
            {isCustom
              ? "A custom campaign has no published map, so this is a blank parchment until the GM uploads one. Pins, the party marker, terrain painting and distances all still work."
              : "The map image isn't available, so this is a blank parchment."}
          </div>
        ) : null}
        {actions.error ? (
          <p role="alert" className="m-0 rounded-lg border border-[#6a2a2a] bg-[#2a1414] px-3 py-2 text-[13px] text-[#ff9a92]">
            {actions.error}
          </p>
        ) : null}
        {crawl && !editable ? <CrawlInfo crawl={crawl} /> : null}

        <MapView
          viewport={viewport}
          panZoom={panZoom}
          fullScreen={fs}
          label={`Map of ${campaignName}`}
          imageUrl={imageUrl}
          image={image}
          editable={editable}
          tokens={visibleTokens}
          types={types}
          showTokens={!hideToks}
          selectedId={sel?.id ?? null}
          party={state.party}
          partyDraggable={editable && !horizon}
          terrain={terrain}
          showTerrain={!horizon && (showTerrain || painting)}
          showBlockOnly={!horizon && measuring && !showTerrain && !painting}
          painting={painting}
          brush={brush}
          brushSize={bsize}
          route={measuring && mpts.length ? { points: mpts, analysis: mRes, freehand: mmode === "free", label: routeLabel } : null}
          crawl={crawl}
          showGrid={showGrid}
          selectedHex={editable ? selHex : null}
          tool={tool}
          crosshair={!!placing || measuring || painting || settingOrigin}
          scaleBar={scaleBar(state.scaleKm)}
          onMapClick={onMapClick}
          onStroke={onStroke}
          onSelectToken={(id) => editable && (setSelId(id), setSelHex(null))}
          onMoveToken={(id, p) => {
            const at = snap(p);
            void actions.updateToken(id, { x: at.x, y: at.y });
          }}
          onMoveParty={(p) => void moveParty(p)}
          onDropType={(type, p) => {
            if (!editable || !types.some((t) => t.id === type)) return;
            const at = snap(p);
            void actions.addToken(type, at.x, at.y).then((r) => r && setSelId(r.id));
          }}
        />
      </section>

      {editable ? (
        <TokenPanel
          tokens={state.tokens}
          types={types}
          selected={sel}
          onSelect={setSelId}
          fromParty={fromParty}
          distances={distances}
          trailText={trailText}
          actions={actions}
          onSendParty={horizon ? null : (t) => void moveParty({ x: t.x, y: t.y })}
          footer={<MapImageControl campaignId={campaignId} hasUpload={!!state.customMap} isCustom={isCustom} scaleKm={state.scaleKm} />}
        >
          {crawl ? (
            <HexCrawlPanel
              crawl={crawl}
              selected={selHex}
              actions={actions}
              showGrid={showGrid}
              onShowGrid={setShowGrid}
              settingOrigin={settingOrigin}
              onSettingOrigin={(on) => (setSettingOrigin(on), on && setShowGrid(true))}
            />
          ) : null}
        </TokenPanel>
      ) : null}
      {editable ? <TravelRulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} rules={rules} actions={actions} /> : null}
    </main>
  );
}
