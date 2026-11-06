"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Where the hit window stands in the pop region (Main 'You're hit': beside the hit PC's token): 42 px right of the
 * token's on-screen box (left of it near the screen's right edge), vertically centred on it, kept on screen. Measured
 * every frame while open, as the picking panel does (the map pans, zooms and makes room under it); state changes only
 * when the spot moves. Without the token on screen: the middle of the pop region. At phone width the CSS docks the
 * window as a bottom sheet and ignores the spot.
 */

export const HIT_W = 320;
const EDGE = 8;

export type HitSpot = { x: number; y: number };

export function useHitSpot(tokenId: Id<"combatTokens"> | null, box: RefObject<HTMLElement | null>): HitSpot | null {
  const [spot, setSpot] = useState<HitSpot | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = box.current;
      const region = el?.closest<HTMLElement>("[data-hud-region]");
      if (!el || !region) return;
      const p = region.getBoundingClientRect();
      const h = el.offsetHeight;
      const token = tokenId === null ? null : document.querySelector(`.hud-map .cm-tok[data-token="${tokenId}"]`);
      let x: number;
      let y: number;
      if (token) {
        const r = token.getBoundingClientRect();
        const cx = r.left + r.width / 2 - p.left;
        const cy = r.top + r.height / 2 - p.top;
        const gap = Math.max(42, r.width * 0.62 + 12);
        x = cx + gap;
        if (x + HIT_W > p.width - EDGE) x = cx - gap - HIT_W;
        y = cy - h / 2;
      } else {
        x = (p.width - HIT_W) / 2;
        y = (p.height - h) / 2;
      }
      x = Math.round(Math.max(EDGE, Math.min(x, p.width - HIT_W - EDGE)));
      y = Math.round(Math.max(EDGE, Math.min(y, p.height - h - EDGE)));
      setSpot((s) => (s && s.x === x && s.y === y ? s : { x, y }));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tokenId, box]);
  return spot;
}
