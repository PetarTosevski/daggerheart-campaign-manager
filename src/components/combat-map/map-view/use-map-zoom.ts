"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The board's zoom range and step (`setZoom`: 0.15..2.5, buttons x1.2, Ctrl + scroll x1.12). */
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 2.5;
export const ZOOM_STEP = 1.2;
const WHEEL_STEP = 1.12;

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/**
 * Zoom for the combat map viewport, following the World map's pattern (src/app/(gm)/campaigns/[campaignId]/world/
 * use-pan-zoom.ts: Fit on mount and on resize, wheel zoom anchored on the cursor through a non-passive listener)
 * with the board's model: the viewport scrolls (pan = scroll), the stage is `contentW x contentH` pixels at zoom 1,
 * and Ctrl / Cmd + scroll zooms (a plain scroll scrolls). `fitKey` changes when another map (or size) is shown.
 */
export function useMapZoom(
  viewport: RefObject<HTMLDivElement | null>,
  stage: HTMLDivElement | null,
  contentW: number,
  contentH: number,
  fitKey: string,
) {
  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef(zoom);
  /** The stage point (unzoomed px) to keep under a client point after the next zoom change. */
  const anchor = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  /** Zooms to `z`; keeps the stage point under (clientX, clientY) still (default: the viewport's centre). */
  function setZoom(z: number, clientX?: number, clientY?: number) {
    const vp = viewport.current;
    const st = stage;
    const next = clampZoom(z);
    if (vp && st) {
      const v = vp.getBoundingClientRect();
      const s = st.getBoundingClientRect();
      const cx = clientX ?? v.left + v.width / 2;
      const cy = clientY ?? v.top + v.height / 2;
      anchor.current = { px: (cx - s.left) / zoomRef.current, py: (cy - s.top) / zoomRef.current, cx, cy };
    }
    zoomRef.current = next;
    setZoomState(next);
  }

  function fitZoom(): number {
    const vp = viewport.current;
    if (!vp || contentW <= 0 || contentH <= 0) return zoomRef.current;
    return clampZoom(Math.min((vp.clientWidth - 8) / contentW, (vp.clientHeight - 8) / contentH));
  }

  function fit() {
    anchor.current = null;
    const z = fitZoom();
    zoomRef.current = z;
    setZoomState(z);
  }

  // After a zoom change, scroll so the anchored stage point is back under the cursor.
  useLayoutEffect(() => {
    const a = anchor.current;
    const vp = viewport.current;
    anchor.current = null;
    if (!a || !vp || !stage) return;
    const s = stage.getBoundingClientRect();
    vp.scrollBy(s.left - (a.cx - a.px * zoom), s.top - (a.cy - a.py * zoom));
  }, [zoom, viewport, stage]);

  const onFit = useEffectEvent(fit);
  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoomRef.current * (e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP), e.clientX, e.clientY);
  });

  // Fit when another map is shown (after layout, so the viewport has its size).
  useEffect(() => {
    const id = requestAnimationFrame(() => onFit());
    return () => cancelAnimationFrame(id);
  }, [fitKey]);

  // Refit when the viewport resizes (window, layout switch); Ctrl + scroll zooms at the cursor.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let first = true;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (first) first = false;
            else onFit();
          });
    observer?.observe(el);
    const wheel = (e: WheelEvent) => onWheel(e);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer?.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, [viewport]);

  return { zoom, zoomRef, setZoom, fit };
}
