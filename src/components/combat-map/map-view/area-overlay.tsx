"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Component, useId, useState, type ReactNode } from "react";

import { areaArt, FILL_TILE_SQUARES, type AreaArt } from "@/lib/combat-map/area-effects";
import { errorMessage } from "@/lib/convex-errors";
import { RANGE_SQUARES } from "@/lib/domain/combat-map/ranges";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CombatRole } from "../slots";
import { useTokens, type TokenView } from "../tokens/use-tokens";
import { startAreaPick, type Square } from "./area-pick";

/**
 * Live map areas on the board (plan lanes-2 wave 9, tracer AO; dcm-lqnt): every live area of `combatAreas.list` (a
 * player reads the live map's only; the server decides) drawn with its kind's art (src/lib/combat-map/area-effects:
 * the label picks the kind, `generic` when none):
 *
 * - fills tiled across the circle, see-through, clipped to it; the swirl fills (aura-earth, aura-air, ink) drawn once,
 *   scaled to the circle;
 * - decals (rings) scaled to the circle; moonlight and silence faint;
 * - walls: the strip repeated along the line, one square thick (a wall without art: a dashed line).
 *
 * A circle reaches its radius (CB p.103 Defined Ranges in squares) plus half its centre's footprint, as the vision
 * engine's disc does (src/lib/domain/feature-effects/areas.ts `sightDisc`). An area around a token the viewer has no
 * token for (a player's view holds the PC tokens) is not drawn. Over the map canvas, under the fog and the tokens.
 *
 * `AreaTools` is the GM's minimal panel (the combat UI redesign, dcm-bxp.99.32, is pending): draw an area by hand, move
 * or resize one (Dark Cloud: Close by default, the GM adjusts; dcm-bxp.99.19.39), remove one.
 */

export type AreaView = FunctionReturnType<typeof api.combatAreas.list>[number];
type Radius = AreaView["radius"];

export const RADIUS_LABEL: Record<Radius, string> = { melee: "Melee", veryClose: "Very Close", close: "Close", far: "Far", veryFar: "Very Far" };
const RADII = Object.keys(RADIUS_LABEL) as Radius[];

/** An area's shape in map squares (no padding): a circle's centre and reach, or a wall's two end centres. Null: its token is not in view. */
export type AreaGeometry = { shape: "circle"; cx: number; cy: number; r: number } | { shape: "wall"; ax: number; ay: number; bx: number; by: number };

export function areaGeometry(area: Pick<AreaView, "shape" | "centre" | "radius" | "wall">, tokens: readonly Pick<TokenView, "_id" | "x" | "y" | "size">[], mapSize: number): AreaGeometry | null {
  if (area.shape === "wall") {
    if (!area.wall) return null;
    const [ax = 0, ay = 0] = area.wall.a;
    const [bx = 0, by = 0] = area.wall.b;
    return { shape: "wall", ax: ax + 0.5, ay: ay + 0.5, bx: bx + 0.5, by: by + 0.5 };
  }
  const reach = area.radius === "veryFar" ? mapSize : RANGE_SQUARES[area.radius];
  if (area.centre.kind === "square") return { shape: "circle", cx: area.centre.x + 0.5, cy: area.centre.y + 0.5, r: reach + 0.5 };
  const tokenId = area.centre.tokenId;
  const token = tokens.find((t) => t._id === tokenId);
  if (!token) return null;
  const size = Math.max(1, Math.min(3, Math.trunc(token.size) || 1));
  return { shape: "circle", cx: token.x + size / 2, cy: token.y + size / 2, r: reach + size / 2 };
}

/** The live areas of the board's map (undefined while loading). */
export function useMapAreas(campaignId: Id<"campaigns">, mapId: Id<"combatMaps">): AreaView[] | undefined {
  return useQuery(api.combatAreas.list, { campaignId, mapId });
}

type OverlayProps = { campaignId: Id<"campaigns">; role: CombatRole; mapId: Id<"combatMaps">; w: number; h: number; pad: number; step: number };

/** Keeps a failing area read from blanking the board (rule 11): the overlay draws nothing, the tools say so. */
class AreaBoundary extends Component<{ children: ReactNode; label: string | null }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label ?? "The map areas"} failed to load`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.label === null) return null;
    return (
      <div role="alert" className="cm-alert cm-m0">
        {this.props.label} failed to load.{" "}
        <button type="button" className="cm-btn cm-sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

export function AreaOverlay(props: OverlayProps) {
  return (
    <AreaBoundary label={null}>
      <Overlay {...props} />
    </AreaBoundary>
  );
}

function Overlay({ campaignId, role, mapId, w, h, pad, step }: OverlayProps) {
  const areas = useMapAreas(campaignId, mapId);
  const tokens = useTokens(campaignId, role, mapId);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!areas || areas.length === 0) return null;
  const width = (w + 2 * pad) * step;
  const height = (h + 2 * pad) * step;
  return (
    <svg className="cm-area-overlay" data-testid="map-areas" data-count={areas.length} aria-hidden="true" width={width} height={height} viewBox={`0 0 ${w + 2 * pad} ${h + 2 * pad}`}>
      {areas.map((area) => {
        const geometry = areaGeometry(area, tokens ?? [], Math.max(w, h));
        if (geometry === null) return null;
        return <AreaShape key={area._id} id={`${uid}-${area._id}`} label={area.label} art={areaArt(area.label, area.shape)} geometry={geometry} pad={pad} />;
      })}
    </svg>
  );
}

function AreaShape({ id, label, art, geometry, pad }: { id: string; label: string; art: AreaArt; geometry: AreaGeometry; pad: number }) {
  const data = { "data-testid": "map-area", "data-label": label, "data-kind": art.drawn, "data-mode": art.mode };
  if (geometry.shape === "wall") {
    const ax = geometry.ax + pad;
    const ay = geometry.ay + pad;
    const len = Math.hypot(geometry.bx - geometry.ax, geometry.by - geometry.ay);
    const angle = (Math.atan2(geometry.by - geometry.ay, geometry.bx - geometry.ax) * 180) / Math.PI;
    if (art.url === null || art.px === null) {
      return <line {...data} x1={ax} y1={ay} x2={geometry.bx + pad} y2={geometry.by + pad} className="cm-area-wall-plain" />;
    }
    // One square thick; the strip keeps its aspect and repeats along the line, half a square past each end centre.
    const tile = art.px.w / art.px.h;
    return (
      <g {...data} transform={`translate(${ax} ${ay}) rotate(${angle})`} opacity={art.opacity}>
        <defs>
          <pattern id={id} patternUnits="userSpaceOnUse" x={-0.5} y={-0.5} width={tile} height={1}>
            <image href={art.url} width={tile} height={1} preserveAspectRatio="none" />
          </pattern>
        </defs>
        <rect x={-0.5} y={-0.5} width={len + 1} height={1} fill={`url(#${id})`} />
      </g>
    );
  }
  const cx = geometry.cx + pad;
  const cy = geometry.cy + pad;
  const r = geometry.r;
  const edge = <circle cx={cx} cy={cy} r={r} className={art.drawn === "generic" ? "cm-area-edge cm-area-edge-dashed" : "cm-area-edge"} />;
  if (art.url === null) {
    return (
      <g {...data}>
        <circle cx={cx} cy={cy} r={r} className="cm-area-tint" />
        {edge}
      </g>
    );
  }
  if (art.mode === "decal") {
    return (
      <g {...data}>
        <image href={art.url} x={cx - r} y={cy - r} width={2 * r} height={2 * r} opacity={art.opacity} preserveAspectRatio="none" />
      </g>
    );
  }
  if (art.mode === "scale") {
    return (
      <g {...data}>
        <defs>
          <clipPath id={id}>
            <circle cx={cx} cy={cy} r={r} />
          </clipPath>
        </defs>
        <image href={art.url} x={cx - r} y={cy - r} width={2 * r} height={2 * r} opacity={art.opacity} clipPath={`url(#${id})`} preserveAspectRatio="none" />
        {edge}
      </g>
    );
  }
  return (
    <g {...data}>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={FILL_TILE_SQUARES} height={FILL_TILE_SQUARES}>
          <image href={art.url} width={FILL_TILE_SQUARES} height={FILL_TILE_SQUARES} preserveAspectRatio="none" />
        </pattern>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} opacity={art.opacity} />
      {edge}
    </g>
  );
}

// ---------------------------------------------------------------- the GM's area tools

type ToolsProps = { campaignId: Id<"campaigns">; mapId: Id<"combatMaps"> };

/** Picks one square, or two for a wall, then runs `done`. */
function pickSquares(mapId: string, prompts: readonly string[], radius: Radius | undefined, done: (squares: Square[]) => Promise<string | null>) {
  const got: Square[] = [];
  const next = (i: number) =>
    startAreaPick({
      prompt: prompts[i] ?? "Pick a square",
      mapId,
      ...(radius !== undefined && radius !== "veryFar" ? { radius } : {}),
      onPick: async (square) => {
        got.push(square);
        if (i + 1 < prompts.length) {
          next(i + 1);
          return null;
        }
        return done(got);
      },
    });
  next(0);
}

export function AreaTools(props: ToolsProps) {
  return (
    <AreaBoundary label="The area tools">
      <Tools {...props} />
    </AreaBoundary>
  );
}

function Tools({ campaignId, mapId }: ToolsProps) {
  const areas = useMapAreas(campaignId, mapId);
  const tokens = useTokens(campaignId, "gm", mapId);
  const ids = { label: useId(), shape: useId(), radius: useId(), owner: useId(), sight: useId() };
  const [label, setLabel] = useState("Dark Cloud");
  const [shape, setShape] = useState<"circle" | "wall">("circle");
  const [radius, setRadius] = useState<Radius>("close");
  const [owner, setOwner] = useState("");
  const [sight, setSight] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const draw = useMutation(api.combatAreaEdits.draw);
  const move = useMutation(api.combatAreaEdits.move);
  const resize = useMutation(api.combatAreaEdits.resize).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(api.combatAreas.list, { campaignId, mapId });
    if (list) store.setQuery(api.combatAreas.list, { campaignId, mapId }, list.map((a) => (a._id === args.areaId ? { ...a, radius: args.radius } : a)));
  });
  const remove = useMutation(api.combatAreas.remove).withOptimisticUpdate((store, args) => {
    const list = store.getQuery(api.combatAreas.list, { campaignId, mapId });
    if (list) store.setQuery(api.combatAreas.list, { campaignId, mapId }, list.filter((a) => a._id !== args.areaId));
  });
  const pcs = (tokens ?? []).filter((t) => t.kind === "pc" && t.characterId !== undefined);
  const ownerId = pcs.some((t) => t.characterId === owner) ? owner : (pcs[0]?.characterId ?? "");
  const names = new Map(pcs.map((t) => [t.characterId as string, t.name]));
  const fail = (e: unknown) => setError(errorMessage(e));

  function startDraw() {
    setError(null);
    const name = label.trim() || "Area";
    const prompts = shape === "wall" ? [`Pick the first end of ${name}`, `Pick the second end of ${name}`] : [`Pick the centre of ${name}`];
    pickSquares(mapId, prompts, shape === "circle" ? radius : undefined, async ([at, to]) => {
      if (!at) return null;
      await draw({ campaignId, mapId, characterId: ownerId, label: name, shape, at, ...(to ? { to } : {}), ...(shape === "circle" ? { radius } : {}), blocksSight: sight });
      return `${name} drawn.`;
    });
  }

  return (
    <section className="cm-area-tools" aria-label="Areas" data-testid="area-tools">
      <h3 className="cm-area-tools-title">Areas</h3>
      {areas === undefined ? (
        <p role="status" className="cm-muted">
          Loading…
        </p>
      ) : areas.length === 0 ? (
        <p className="cm-muted">No live area on this map.</p>
      ) : (
        <ul className="cm-area-list">
          {areas.map((a) => (
            <li key={a._id} className="cm-area-row" data-testid="area-row" data-label={a.label}>
              <span className="cm-area-name">
                {a.label}
                <span className="cm-muted"> · {names.get(a.characterId) ?? "PC"}</span>
              </span>
              {a.shape === "circle" ? (
                <select
                  aria-label={`Radius of ${a.label}`}
                  value={a.radius}
                  onChange={(e) => {
                    setError(null);
                    resize({ campaignId, areaId: a._id, radius: e.target.value as Radius }).catch(fail);
                  }}
                >
                  {RADII.map((r) => (
                    <option key={r} value={r}>
                      {RADIUS_LABEL[r]}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                className="cm-btn cm-sm"
                aria-label={`Move ${a.label}`}
                onClick={() => {
                  setError(null);
                  const prompts = a.shape === "wall" ? [`Pick the first end of ${a.label}`, `Pick the second end of ${a.label}`] : [`Pick the new centre of ${a.label}`];
                  pickSquares(mapId, prompts, a.shape === "circle" ? a.radius : undefined, async ([at, to]) => {
                    if (!at) return null;
                    await move({ campaignId, areaId: a._id, at, ...(to ? { to } : {}) });
                    return `${a.label} moved.`;
                  });
                }}
              >
                Move
              </button>
              <button
                type="button"
                className="cm-btn cm-sm"
                aria-label={`Remove ${a.label}`}
                onClick={() => {
                  setError(null);
                  remove({ campaignId, areaId: a._id }).catch(fail);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="cm-area-draw">
        <legend className="cm-lbl">Draw an area</legend>
        <label htmlFor={ids.label} className="cm-lbl">
          Name
        </label>
        <input id={ids.label} className="cm-in" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        <label htmlFor={ids.shape} className="cm-lbl">
          Shape
        </label>
        <select id={ids.shape} value={shape} onChange={(e) => setShape(e.target.value as "circle" | "wall")}>
          <option value="circle">Circle</option>
          <option value="wall">Wall</option>
        </select>
        {shape === "circle" ? (
          <>
            <label htmlFor={ids.radius} className="cm-lbl">
              Radius
            </label>
            <select id={ids.radius} value={radius} onChange={(e) => setRadius(e.target.value as Radius)}>
              {RADII.map((r) => (
                <option key={r} value={r}>
                  {RADIUS_LABEL[r]}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <label htmlFor={ids.owner} className="cm-lbl">
          Belongs to
        </label>
        <select id={ids.owner} value={ownerId} onChange={(e) => setOwner(e.target.value)} disabled={pcs.length === 0}>
          {pcs.map((t) => (
            <option key={t._id} value={t.characterId}>
              {t.name}
            </option>
          ))}
        </select>
        <label htmlFor={ids.sight} className="sd-check">
          <input id={ids.sight} type="checkbox" checked={sight} onChange={(e) => setSight(e.target.checked)} />
          <span>Blocks sight</span>
        </label>
        <button type="button" className="cm-btn cm-sm" disabled={ownerId === ""} onClick={startDraw}>
          Pick on the map
        </button>
        {pcs.length === 0 ? <p className="cm-muted">Add a PC token first: an area belongs to a character.</p> : null}
      </fieldset>
      {error ? (
        <p role="alert" className="cm-alert cm-m0">
          {error}
        </p>
      ) : null}
    </section>
  );
}
