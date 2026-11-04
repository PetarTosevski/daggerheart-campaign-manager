"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { usePick } from "../pick";
import { usePickScene } from "../pick/scene";
import type { HudLayerProps } from "../state";
import { chainOf } from "./chain";
import { outside, previewRadius, squareAt, type Square } from "./model";
import { movePointTo, placeSquare, useAreaPickState, type AreaPickLive } from "./store";

/**
 * The HUD's square-picking map layer (plan combat-hud H3.3; CmpPicking 'Area · pick a square', 'Wall · two points',
 * 'Chain links'). Inside the map stage, so it pans, zooms and makes room with the map; every pointer position goes
 * through `viewport.toSquares`, which measures the stage's on-screen scale (H2.2's `stageToSquares`), so a click lands on
 * the square under the pointer while the map is shifted for an open sheet.
 *
 * - Area: a crosshair on the hovered (or keyboard) square with the radius preview; placed centres stay marked.
 * - Wall: the line between the two ends, each end a draggable handle until the confirm.
 * - Chain (during a pick session whose data carries `chain`): dashed links from the actor through each link's creatures,
 *   numbered nodes.
 */
export function HudAreaPickLayer(props: HudLayerProps) {
  const { live } = useAreaPickState();
  return (
    <>
      {live && live.spec.mapId === props.map._id ? <AreaLayer {...props} live={live} /> : null}
      <ChainLayer {...props} />
    </>
  );
}

function AreaLayer({ viewport, live }: HudLayerProps & { live: AreaPickLive }) {
  const [hover, setHover] = useState<Square | null>(null);
  const drag = useRef<{ index: number; pointerId: number } | null>(null);
  const { w, h, pad, cell, zoom } = viewport;
  const step = cell * zoom;
  const W = (w + 2 * pad) * step;
  const H = (h + 2 * pad) * step;
  const { spec, points } = live;
  const at = (e: { clientX: number; clientY: number }) => squareAt(viewport.toSquares(e.clientX, e.clientY), w, h);
  const aim = hover ?? live.cursor;
  const reach = previewRadius(spec);
  const c = (s: Square) => ({ x: s.x + pad + 0.5, y: s.y + pad + 0.5 });
  const showAim = aim !== null && (points.length < spec.count || spec.shape === "circle");

  return (
    <div
      className="hud-ap-layer"
      data-testid="hud-area-layer"
      data-shape={spec.shape}
      style={{ width: W, height: H }}
      onPointerDown={(e) => e.preventDefault()}
      onPointerMove={(e) => {
        const sq = at(e);
        const d = drag.current;
        if (d && d.pointerId === e.pointerId) {
          if (sq) movePointTo(d.index, sq);
          return;
        }
        setHover(sq);
      }}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => {
        const sq = at(e);
        if (sq) placeSquare(sq);
      }}
    >
      <svg className="hud-ap-svg" aria-hidden="true" width={W} height={H} viewBox={`0 0 ${w + 2 * pad} ${h + 2 * pad}`}>
        {spec.shape === "circle"
          ? points.map((p, i) => (
              <g key={`p${i}`} className={cn("hud-ap-placed", outside(spec, p) && "hud-ap-out")} data-testid="hud-area-point" data-x={p.x} data-y={p.y}>
                {reach !== null ? <circle className="hud-ap-xh" cx={c(p).x} cy={c(p).y} r={reach} /> : null}
                <rect className="hud-ap-sq" x={p.x + pad} y={p.y + pad} width={1} height={1} />
                {spec.count > 1 ? (
                  <text className="hud-ap-nodet" x={c(p).x} y={c(p).y}>
                    {i + 1}
                  </text>
                ) : null}
              </g>
            ))
          : null}
        {spec.shape === "wall" && points.length === 2 ? <line className="hud-ap-wall" x1={c(points[0]!).x} y1={c(points[0]!).y} x2={c(points[1]!).x} y2={c(points[1]!).y} /> : null}
        {spec.shape === "wall" && points.length === 1 && aim ? <line className="hud-ap-wall hud-ap-wall-pre" x1={c(points[0]!).x} y1={c(points[0]!).y} x2={c(aim).x} y2={c(aim).y} /> : null}
        {showAim && aim ? (
          <g className={cn("hud-ap-aim", outside(spec, aim) && "hud-ap-out")} data-testid="hud-area-aim" data-x={aim.x} data-y={aim.y}>
            {reach !== null && spec.shape === "circle" ? <circle className="hud-ap-xh hud-ap-xh-pre" cx={c(aim).x} cy={c(aim).y} r={reach} /> : null}
            <rect className="hud-ap-sq" x={aim.x + pad} y={aim.y + pad} width={1} height={1} />
            <line className="hud-ap-xhc" x1={c(aim).x - 0.3} y1={c(aim).y} x2={c(aim).x + 0.3} y2={c(aim).y} />
            <line className="hud-ap-xhc" x1={c(aim).x} y1={c(aim).y - 0.3} x2={c(aim).x} y2={c(aim).y + 0.3} />
          </g>
        ) : null}
      </svg>
      {spec.shape === "wall"
        ? points.map((p, i) => (
            <span
              key={`h${i}`}
              className={cn("hud-ap-hnd", outside(spec, p) && "hud-ap-out")}
              style={{ left: (p.x + pad + 0.5) * step, top: (p.y + pad + 0.5) * step }}
              data-testid="hud-area-handle"
              data-x={p.x}
              data-y={p.y}
              aria-hidden="true"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                drag.current = { index: i, pointerId: e.pointerId };
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.pointerId !== e.pointerId) return;
                const sq = at(e);
                if (sq) movePointTo(d.index, sq);
              }}
              onPointerUp={(e) => {
                drag.current = null;
                e.currentTarget.releasePointerCapture?.(e.pointerId);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ))
        : null}
    </div>
  );
}

/** The chain links of the open pick session (its data's `chain`), from the actor through each link. */
function ChainLayer(props: HudLayerProps) {
  const pick = usePick();
  const live = pick.session;
  const chain = chainOf(live?.spec.data);
  const scene = usePickScene(props, chain ? (live?.spec ?? null) : null, live?.picked ?? []);
  if (!live || !chain || scene.loading) return null;
  const { viewport } = props;
  const step = viewport.cell * viewport.zoom;
  const pad = viewport.pad;
  const centre = (id: Id<"combatTokens"> | null | undefined) => {
    const t = id ? scene.tokens.get(id) : undefined;
    return t ? { x: (t.x + t.size / 2 + pad) * step, y: (t.y + t.size / 2 + pad) * step, r: (t.size * step) / 2 } : null;
  };
  // Each link: its creatures (the picked ones for the link being picked now).
  const links: Id<"combatTokens">[][] = [...chain.links, live.picked.length > 0 ? [...live.picked] : []].filter((l) => l.length > 0);
  const segments: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  const nodes: { n: number; x: number; y: number }[] = [];
  let from = centre(scene.actorTokenId);
  links.forEach((link, i) => {
    let first: { x: number; y: number } | null = null;
    for (const id of link) {
      const to = centre(id);
      if (!to) continue;
      if (from) segments.push({ from, to });
      nodes.push({ n: i + 1, x: to.x + to.r * 0.75, y: to.y - to.r * 0.75 });
      first ??= to;
    }
    // The next link reaches from this link's first creature (CmpPicking: "from the last one's reach").
    if (first) from = { ...first, r: 0 };
  });
  return (
    <svg className="hud-ap-chain" data-testid="hud-chain" aria-hidden="true" width={(viewport.w + 2 * pad) * step} height={(viewport.h + 2 * pad) * step}>
      {segments.map((s, i) => (
        <line key={`l${i}`} className="hud-ap-chainl" x1={s.from.x} y1={s.from.y} x2={s.to.x} y2={s.to.y} />
      ))}
      {nodes.map((n, i) => (
        <g key={`n${i}`} data-testid="hud-chain-node">
          <circle className="hud-ap-node" cx={n.x} cy={n.y} r={9} />
          <text className="hud-ap-nodet hud-ap-nodet-px" x={n.x} y={n.y}>
            {n.n}
          </text>
        </g>
      ))}
    </svg>
  );
}
