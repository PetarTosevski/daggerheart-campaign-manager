"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { givesLight } from "@/lib/domain/combat-map/light";
import { RANGE_BANDS } from "@/lib/domain/combat-map/ranges";
import { spriteTraits } from "@/lib/sprite-packs/traits";

import type { Id } from "../../../../convex/_generated/dataModel";
import { brushSquares, objectLabel } from "../editor/edit-model";
import { useMapView } from "../map-view/context";
import type { MapLayerProps } from "../slots";
import { initialsOf } from "../tokens/geometry";
import { useRings } from "../tokens/rings";
import { SIDES } from "../tokens/sides";
import { useTokens } from "../tokens/use-tokens";
import { FOG_COLOURS, UNSEEN_CSS, fogImage, maskAt, type FogMasks } from "./fog";
import { useCampaignLight } from "./use-campaign-light";
import {
  doorLabels,
  okView,
  useDoors,
  useExploredSync,
  useFogMasks,
  useStoredExplored,
  useViewing,
  useVisionActions,
  type OtherToken,
  type ViewOk,
} from "./use-vision";
import { useVisionState } from "./vision-state";

/** Fog canvas pixels per square (the board's `k`); the canvas is scaled to the stage with CSS. */
const FOG_PX = 12;

/** Range circle colours per band (C6's tokens-layer.tsx, the board's RANGES), for the tokens this layer draws. */
const RING_COLOURS = ["rgba(255,255,255,0.8)", "rgba(243,207,134,0.9)", "rgba(111,184,166,0.9)", "rgba(198,182,242,0.85)"] as const;

/** Token background per side without a portrait (C6, the board). */
const SIDE_BACKGROUND: Record<OtherToken["side"], string> = {
  pc: "radial-gradient(circle at 35% 30%, #4a3a1a, #1d160a)",
  enemy: "radial-gradient(circle at 35% 30%, #6a2018, #2a0a08)",
  ally: "radial-gradient(circle at 35% 30%, #2f5a40, #10241a)",
  neutral: "radial-gradient(circle at 35% 30%, #4a5a60, #1a2428)",
};

/**
 * Paints a character's fog (R11) on `canvas`: the server's masks at half-square resolution, blurred as on the
 * board. With padding (players, Q1) everything outside the map is refilled with exactly the unseen fog after the
 * blur, so nothing past the edge is ever lighter than unexplored fog.
 */
function paintFog(canvas: HTMLCanvasElement, masks: FogMasks, w: number, h: number, pad: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = (w + 2 * pad) * FOG_PX;
  const height = (h + 2 * pad) * FOG_PX;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const image = fogImage(masks, pad);
  const samples = document.createElement("canvas");
  samples.width = image.width;
  samples.height = image.height;
  samples.getContext("2d")?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const u = FOG_PX / masks.scale;
  const shift = pad > 0 ? 0 : -image.offset * u;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.filter = `blur(${Math.round(FOG_PX * 0.45)}px)`;
  ctx.drawImage(samples, shift, shift, image.width * u, image.height * u);
  ctx.filter = "none";
  if (pad > 0) {
    const p = pad * FOG_PX;
    const bands: [number, number, number, number][] = [
      [0, 0, width, p],
      [0, height - p, width, p],
      [0, p, p, height - 2 * p],
      [width - p, p, p, height - 2 * p],
    ];
    ctx.fillStyle = UNSEEN_CSS;
    for (const [x, y, bw, bh] of bands) {
      ctx.clearRect(x, y, bw, bh);
      ctx.fillRect(x, y, bw, bh);
    }
  }
}

/** One SVG path of unit squares ("x,y" keys or `y * w + x` indexes). */
function squaresPath(squares: Iterable<string | number>, w: number, pad: number): string {
  let d = "";
  for (const s of squares) {
    const [x, y] = typeof s === "number" ? [s % w, Math.floor(s / w)] : (s.split(",").map(Number) as [number, number]);
    d += `M${x + pad} ${y + pad}h1v1h-1z`;
  }
  return d;
}

/** The viewer's cone outline (R6): two dashed lines from the token's centre along the cone's edges. */
function ConeOutline({ view, w, h, pad }: { view: ViewOk; w: number; h: number; pad: number }) {
  const own = view.pcs.find((t) => t._id === view.tokenId);
  if (!own) return null;
  const cx = own.x + own.size / 2 + pad;
  const cy = own.y + own.size / 2 + pad;
  const half = ((view.coneDeg / 2) * Math.PI) / 180;
  // Long enough to leave the whole stage from anywhere on it; the SVG clips at the stage.
  const r = 2 * (Math.max(w, h) + 2 * pad);
  const end = (a: number) => `L${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`;
  return (
    <path
      data-testid="combat-cone"
      d={`M${cx} ${cy}${end(own.face - half)}M${cx} ${cy}${end(own.face + half)}`}
      fill="none"
      stroke="rgba(243,207,134,0.75)"
      strokeWidth={2}
      strokeDasharray="10 8"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/**
 * Map area (slot `VisionLayer`, D9 C8): the fog of war and everything the vision feature draws on the map.
 * - Player (R11, Q1): the fog from their character's view (clear, dim, explored, unseen) over the map and the
 *   FOG_PAD_SQUARES of padding (always unseen fog), the cone outline, the non-PC tokens the server sends (C7's
 *   `others`, drawn here because C6's layer reads only PC tokens; a GM-revealed one has the board's dashed
 *   outline), switches on the lights they can see or have seen (R9), and the throttled explored-area sync.
 * - GM previewing a PC in Play (R12): that PC's fog and cone; tokens the PC cannot see are ghosted and revealed ones
 *   outlined on C6's layer.
 * - GM's own view: the night or dim tint (as on the board), the fog brush marks, light switches in Play, and the fog
 *   brush (R12) when a brush tool is on.
 * Layering: fog z 1 (under C6's tokens at z 2), light switches z 1 after the fog, other tokens z 2 after C6's, the
 * brush z 3 (it paints over tokens too).
 */
export function VisionLayer(props: MapLayerProps) {
  const { campaignId, role, mode, map, viewport, selectedTokenId, onSelectToken } = props;
  const { layout, cells } = useMapView();
  const { cell, zoom, w, h, pad } = viewport;
  const step = cell * zoom;
  const gm = role === "gm";
  const editing = gm && mode === "edit";
  const viewing = useViewing(props);
  const view = editing ? null : okView(viewing);
  const stored = useStoredExplored(campaignId, viewing);
  const masks = useFogMasks(view, stored.mask);
  useExploredSync(campaignId, viewing, masks, stored.mask, stored.loaded);
  const light = useCampaignLight(campaignId);
  const actions = useVisionActions(campaignId);
  const { fogTool, brush } = useVisionState();
  // The GM's every token (C6's `list`, shared with its layer); players' PC tokens are not needed here.
  const roleTokens = useTokens(campaignId, role, map._id);
  const tokens = gm ? roleTokens : undefined;
  const rings = useRings();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (masks) paintFog(el, masks, w, h, pad);
    else {
      el.width = 0;
      el.height = 0;
    }
  }, [masks, w, h, pad]);

  // ---- the GM's fog brush (R12): one paintFog per stroke, previewed while dragging.
  const brushing = gm && mode === "play" && fogTool !== "off";
  const stroke = useRef<{ pointerId: number; squares: Set<number> } | null>(null);
  const [strokeSquares, setStrokeSquares] = useState<number[]>([]);
  function onBrushDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || fogTool === "off") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = viewport.toSquares(e.clientX, e.clientY);
    const squares = new Set(brushSquares(p.x, p.y, brush, w, h));
    stroke.current = { pointerId: e.pointerId, squares };
    setStrokeSquares([...squares]);
  }
  function onBrushMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = stroke.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const p = viewport.toSquares(e.clientX, e.clientY);
    const added = brushSquares(p.x, p.y, brush, w, h).filter((q) => !s.squares.has(q));
    if (added.length === 0) return;
    for (const q of added) s.squares.add(q);
    setStrokeSquares([...s.squares]);
  }
  function onBrushUp(e: ReactPointerEvent<HTMLDivElement>) {
    const s = stroke.current;
    if (!s || s.pointerId !== e.pointerId) return;
    stroke.current = null;
    setStrokeSquares([]);
    if (fogTool !== "off" && s.squares.size > 0) void actions.paintFog(map._id, [...s.squares], fogTool);
  }

  // ---- other tokens (players): selection and range circles (R3) for the ones this layer draws.
  const others = role === "player" && view ? view.others : [];
  const selectedOther = others.find((t) => t._id === selectedTokenId) ?? null;
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || !selectedOther) return;
    if (e.key === "r" || e.key === "R") rings.toggle(selectedOther._id);
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // ---- the GM's preview: tokens the PC cannot see are ghosted, revealed ones outlined (C6's token buttons).
  const previewCss = useMemo(() => {
    if (viewing.kind !== "preview" || !view || !tokens) return "";
    const shown = new Set<string>([...view.pcs.map((t) => t._id), ...view.others.map((t) => t._id)]);
    const revealed = new Set(view.others.filter((t) => t.revealed).map((t) => t._id));
    return tokens
      .map((t) =>
        !shown.has(t._id)
          ? `.cm-root [data-token="${t._id}"]{opacity:.28;filter:grayscale(.6)}`
          : revealed.has(t._id)
            ? `.cm-root [data-token="${t._id}"]{outline:2px dashed #c6b6f2;outline-offset:5px}`
            : "",
      )
      .join("");
  }, [viewing.kind, view, tokens]);

  // ---- doors the viewer may switch (map-movement M2, D8): the server sends only those (players: the ones seen).
  const doors = useDoors(props);
  const labels = doorLabels(doors);

  // ---- lights the viewer may switch (R9): the GM every campfire and wall torch; a player those seen or explored.
  const lights = editing
    ? []
    : layout.objects.filter((o) => {
        if (!givesLight({ kind: o.kind, traits: o.sprite ? spriteTraits(o.sprite) : null })) return false;
        if (gm) return true;
        return masks !== null && (maskAt(masks.seen, masks, o.x, o.y) || maskAt(masks.explored, masks, o.x, o.y));
      });

  const marks = gm && viewing.kind === "gm" ? cells.fog : {};
  const hidePath = squaresPath(Object.keys(marks).filter((k) => marks[k] === "hide"), w, pad);
  const revealPath = squaresPath(Object.keys(marks).filter((k) => marks[k] === "reveal"), w, pad);
  const tint =
    gm && viewing.kind === "gm" && !editing && light
      ? light.light === "night"
        ? FOG_COLOURS.gmNight
        : light.light === "dim"
          ? FOG_COLOURS.gmDim
          : null
      : null;
  const stageW = (w + 2 * pad) * step;
  const stageH = (h + 2 * pad) * step;

  return (
    <>
      <canvas
        ref={canvas}
        className="cm-fog"
        data-testid="combat-fog"
        data-pad={pad}
        aria-hidden="true"
        style={{ width: stageW, height: stageH, display: masks ? "block" : "none" }}
      />
      {tint ? (
        <div
          className="cm-fog-tint"
          aria-hidden="true"
          style={{ left: pad * step, top: pad * step, width: w * step, height: h * step, background: `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${tint[3] / 255})` }}
        />
      ) : null}
      <svg
        className="cm-vis-over"
        aria-hidden="true"
        width={stageW}
        height={stageH}
        viewBox={`0 0 ${w + 2 * pad} ${h + 2 * pad}`}
        preserveAspectRatio="none"
      >
        {revealPath ? <path data-testid="combat-fog-marks-reveal" d={revealPath} fill="rgba(255,240,200,0.18)" /> : null}
        {hidePath ? (
          <path data-testid="combat-fog-marks-hide" d={hidePath} fill="rgba(20,0,30,0.55)" stroke="rgba(200,150,255,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ) : null}
        {view ? <ConeOutline view={view} w={w} h={h} pad={pad} /> : null}
        {strokeSquares.length > 0 ? <path d={squaresPath(strokeSquares, w, pad)} fill="rgba(255,240,200,0.35)" /> : null}
      </svg>
      {lights.length > 0 ? (
        <div className="cm-vis-lights">
          {lights.map((o) => {
            const lit = o.lit !== false;
            const label = objectLabel(o.kind);
            const size = Math.max(0.9, o.r * 1.6) * step;
            return (
              <button
                key={o._id}
                type="button"
                className="cm-vis-light"
                data-testid="combat-light"
                aria-pressed={lit}
                aria-label={`${lit ? "Put out" : "Light"} the ${label.toLowerCase()}`}
                title={`${label}: ${lit ? "lit, click to put it out" : "out, click to light it"}`}
                style={{ left: (o.x + pad) * step, top: (o.y + pad) * step, width: size, height: size }}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => void actions.setLit(o._id as Id<"combatMapObjects">, !lit)}
              />
            );
          })}
        </div>
      ) : null}
      {doors.length > 0 && !editing ? (
        <div className="cm-vis-lights">
          {doors.map((d) => {
            const label = (labels.get(d._id) ?? "Door").toLowerCase();
            const size = Math.max(0.9, d.r * 1.2) * step;
            return (
              <button
                key={d._id}
                type="button"
                className="cm-vis-light cm-vis-door"
                data-testid="combat-door"
                aria-pressed={d.open}
                aria-label={`${d.open ? "Close" : "Open"} ${label}`}
                title={`${label}: ${d.open ? "open, click to close it" : "closed, click to open it"}`}
                style={{ left: (d.x + pad) * step, top: (d.y + pad) * step, width: size, height: size }}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => void actions.setOpen(d._id, !d.open)}
              />
            );
          })}
        </div>
      ) : null}
      {others.length > 0 ? (
        <OtherTokens
          others={others}
          w={w}
          h={h}
          pad={pad}
          cell={cell}
          zoom={zoom}
          selectedTokenId={selectedTokenId}
          onSelect={onSelectToken}
          ringsOn={(id) => rings.on(id)}
        />
      ) : null}
      {brushing ? (
        <div
          className="cm-vis-brush"
          data-testid="combat-fog-brush"
          style={{ left: pad * step, top: pad * step, width: w * step, height: h * step }}
          onPointerDown={onBrushDown}
          onPointerMove={onBrushMove}
          onPointerUp={onBrushUp}
          onPointerCancel={() => {
            stroke.current = null;
            setStrokeSquares([]);
          }}
        />
      ) : null}
      {previewCss ? <style>{previewCss}</style> : null}
      {actions.error ? (
        <p role="alert" className="cm-alert cm-vis-error">
          {actions.error}
          <button type="button" className="cm-btn cm-sm" onClick={actions.clearError}>
            Dismiss
          </button>
        </p>
      ) : null}
    </>
  );
}

/**
 * The non-PC tokens a player sees (C7's `others`: name, side, size, facing, `revealed`; never stats, R4), in C6's
 * token look (side ring, initials, facing arrow, name tag) plus the board's dashed outline and eye badge for a token
 * the GM revealed in dim light (R10). They cannot be moved; a click selects one (its card is in the vision panel)
 * and R shows its range circles (R3).
 */
function OtherTokens({
  others,
  w,
  h,
  pad,
  cell,
  zoom,
  selectedTokenId,
  onSelect,
  ringsOn,
}: {
  others: OtherToken[];
  w: number;
  h: number;
  pad: number;
  cell: number;
  zoom: number;
  selectedTokenId: string | null;
  onSelect: (id: Id<"combatTokens"> | null) => void;
  ringsOn: (id: string) => boolean;
}) {
  return (
    <div className="cm-tokens cm-vis-others" data-testid="combat-other-tokens" style={{ width: (w + 2 * pad) * cell, height: (h + 2 * pad) * cell, transform: `scale(${zoom})` }}>
      <div className="cm-tokens-map" style={{ left: pad * cell, top: pad * cell }}>
        {others
          .filter((t) => ringsOn(t._id))
          .map((t) => {
            const cx = (t.x + t.size / 2) * cell;
            const cy = (t.y + t.size / 2) * cell;
            const first = t.name.split(" ")[0] ?? t.name;
            return (
              <div key={`rings-${t._id}`} data-testid="combat-rings" aria-hidden="true">
                {RANGE_BANDS.map((band, i) => {
                  const rad = (band.squares + t.size / 2) * cell;
                  return (
                    <div key={band.key}>
                      <div
                        className="cm-ring"
                        style={{ left: cx - rad, top: cy - rad, width: 2 * rad, height: 2 * rad, border: `2px dashed ${RING_COLOURS[i]}`, boxShadow: `inset 0 0 0 1px ${SIDES[t.side].colour}33` }}
                      />
                      <span className="cm-ringlbl" style={{ left: cx + rad * 0.71 + 4, top: cy - rad * 0.71 - 18 }}>
                        {first} · {band.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        {others.map((t) => {
          const on = t._id === selectedTokenId;
          const side = SIDES[t.side];
          const deg = (t.face * 180) / Math.PI;
          // The adversary's rulebook art when it has some (user 2026-10-21), else the side's colour and initials.
          const art = t.portrait?.kind === "url" ? t.portrait.url : null;
          return (
            <button
              key={t._id}
              type="button"
              className={["cm-tok", "fixed", on ? "sel" : "", t.revealed ? "revealed" : ""].filter(Boolean).join(" ")}
              data-token={t._id}
              data-testid="combat-token"
              data-square={`${t.x},${t.y}`}
              data-face={Math.round(deg)}
              aria-label={`${t.name}, ${side.label}${t.revealed ? ", revealed to you" : ""}`}
              aria-pressed={on}
              style={{
                left: t.x * cell + 3,
                top: t.y * cell + 3,
                width: t.size * cell - 6,
                height: t.size * cell - 6,
                ...(art ? { backgroundImage: `url(${art})`, backgroundSize: "cover", backgroundPosition: "center 25%" } : { background: SIDE_BACKGROUND[t.side] }),
                border: `3px solid ${side.colour}`,
                boxShadow: on ? `0 3px 8px rgba(0,0,0,.6), 0 0 0 3px #fff, 0 0 18px ${side.colour}` : "0 3px 8px rgba(0,0,0,.6)",
                zIndex: on ? 30 : 10,
              }}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onSelect(t._id)}
            >
              <span className="cm-face" aria-hidden="true" style={{ transform: `rotate(${deg}deg)`, ["--tc" as string]: side.colour }} />
              {art ? null : (
                <span className="cm-ini" aria-hidden="true" style={{ fontSize: Math.round(t.size * cell * 0.34) }}>
                  {initialsOf(t.name, t.size)}
                </span>
              )}
              <span className="cm-tag" aria-hidden="true" style={{ top: t.size * cell - 4 }}>
                {t.name}
              </span>
              {t.revealed ? (
                <span className="cm-badge cm-vis-rev" aria-hidden="true">
                  👁
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
