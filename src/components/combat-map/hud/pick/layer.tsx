"use client";

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import type { HudLayerProps } from "../state";
import { keepPicks, ringLabel, stateOf, togglePick, canToggle } from "./model";
import { usePickScene } from "./scene";
import { usePick } from "./session";

/**
 * The target rings (plan combat-hud H3.0; CmpTokens "Target rings", HANDOFF "Target ring states"): a HUD map layer
 * that draws, during a pick session, a ring on every creature the panel lists:
 *   picked  solid gold with a glow and a check badge (an ally or yourself: mint)
 *   in      dashed gold
 *   out     dashed amber with a "GM" badge (the GM approves)
 *   los     dotted salmon, the token's face dimmed, eye-off badge (can't be picked)
 * with the band label above (`.tg-l`) and a rider's secondary label below (`.tg-rl`), plus a dashed aim line from the
 * actor to the primary target. A tap on a ring picks (the same `setPicked` as the panel's rows), so rows and rings
 * stay in step. The tap targets sit over the tokens only during a session; they never take keyboard focus (the
 * panel's rows are the keyboard path) and press `preventDefault` on pointer down so the map does not pan.
 */
export function PickRings(props: HudLayerProps) {
  const pick = usePick();
  const live = pick.session;
  const scene = usePickScene(props, live?.spec ?? null, live?.picked ?? []);
  if (!live || scene.loading) return null;
  const { spec } = live;
  const picked = keepPicks(live.picked, scene.rows);
  const { viewport } = props;
  const step = viewport.cell * viewport.zoom;
  const pad = viewport.pad;
  const centre = (t: { x: number; y: number; size: number }) => ({ x: (t.x + t.size / 2 + pad) * step, y: (t.y + t.size / 2 + pad) * step });
  const below = new Map((spec.options ?? []).filter((o) => o.tokenId && live.options[o.id]).map((o) => [o.tokenId as string, o.ringLabel ?? o.label]));
  const actor = scene.actorTokenId ? scene.tokens.get(scene.actorTokenId) : undefined;
  const primary = picked[0] ? scene.tokens.get(picked[0]) : undefined;
  // H5.2: the GM acting for an adversary: purple rings, no "GM" badge on out of range (HANDOFF "GM attack picking").
  const gm = spec.source.kind === "adversary";
  const dim = scene.rows.filter((r) => r.reach === "los" && !picked.includes(r.tokenId)).map((r) => r.tokenId);

  return (
    <div className="hud-tg-layer" data-testid="hud-pick-rings">
      {dim.length > 0 ? (
        <style>{dim.map((id) => `.hud-map [data-token="${id}"] .tk-face{opacity:.5;filter:grayscale(.6)}`).join("")}</style>
      ) : null}
      {actor && primary ? (
        <svg className="hud-tg-aim" width={(viewport.w + 2 * pad) * step} height={(viewport.h + 2 * pad) * step} aria-hidden="true">
          <line x1={centre(actor).x} y1={centre(actor).y} x2={centre(primary).x} y2={centre(primary).y} />
        </svg>
      ) : null}
      {scene.rows.map((row) => {
        const t = scene.tokens.get(row.tokenId);
        const st = stateOf(row, picked);
        // Your own token carries a ring only once you pick yourself (its own gold ring already marks it).
        if (!t || (row.side === "self" && st !== "picked")) return null;
        // An out-of-range pick keeps its amber ring and GM badge (hard rule 3); picked shows as the check otherwise.
        const ring = st === "picked" && row.reach === "out" ? "out" : st;
        const c = centre(t);
        const size = t.size * step - 6 * viewport.zoom;
        const can = canToggle(row, spec.rule);
        const label = ringLabel(row);
        return (
          <div
            key={row.tokenId}
            className={cn("hud-tg", gm && "hud-tg-gm", `hud-tg-${ring}`, st === "picked" && "hud-tg-on", st === "picked" && row.side !== "enemy" && "hud-tg-ally")}
            style={{ left: c.x, top: c.y, "--s": `${size}px` } as CSSProperties}
            data-testid="hud-pick-ring"
            data-token={row.tokenId}
            data-state={st}
            data-reach={row.reach}
          >
            <span className="hud-tg-ring" aria-hidden="true" />
            {label ? (
              <span className="hud-tg-l" aria-hidden="true">
                {label}
              </span>
            ) : null}
            {ring === "out" && gm ? null : ring === "out" ? (
              <span className="hud-tg-b" aria-hidden="true">
                <b>GM</b>
              </span>
            ) : st === "picked" ? (
              <span className="hud-tg-b" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            ) : st === "los" ? (
              <span className="hud-tg-b" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </span>
            ) : null}
            {below.has(row.tokenId) ? (
              <span className="hud-tg-rl" aria-hidden="true">
                {below.get(row.tokenId)}
              </span>
            ) : null}
            {can ? (
              <button
                type="button"
                className="hud-tg-hit"
                tabIndex={-1}
                aria-label={`${st === "picked" ? "Unpick" : "Pick"} ${row.name}`}
                data-testid="hud-pick-ring-hit"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick.setPicked(togglePick(picked, row.tokenId, spec.rule, row))}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
