"use client";

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";

/** Zoom 1 = the map as wide as the viewport (the board's zoom). `x`, `y`: the map's top-left in viewport pixels. */
export type View = { z: number; x: number; y: number; /** viewport width the view was computed for */ w: number };

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 6;

/**
 * Pan and zoom for the World map viewport: wheel zoom anchored on the cursor,
 * drag and two-finger pinch (driven by the caller's pointer handlers), buttons
 * and keyboard. `aspect` is the map's height / width.
 */
export function usePanZoom(viewport: RefObject<HTMLDivElement | null>, aspect: number) {
  const [view, setViewState] = useState<View>({ z: 1, x: 0, y: 0, w: 0 });
  const viewRef = useRef(view);

  function size() {
    const el = viewport.current;
    return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 1, h: 1 };
  }

  function setView(next: Omit<View, "w">) {
    const { w, h } = size();
    const mw = w * next.z;
    const mh = mw * aspect;
    // Keep at least 80 px of the map in view.
    const keep = 80;
    const clamped = {
      z: next.z,
      x: Math.min(w - keep, Math.max(keep - mw, next.x)),
      y: Math.min(h - keep, Math.max(keep - mh, next.y)),
      w,
    };
    viewRef.current = clamped;
    setViewState(clamped);
  }

  function fitZoom() {
    const { w, h } = size();
    return Math.min(1, h / (w * aspect));
  }

  function fit() {
    const { w, h } = size();
    const z = fitZoom();
    setView({ z, x: (w - w * z) / 2, y: (h - w * z * aspect) / 2 });
  }

  /** Zooms to `nz`, keeping the map point under (cx, cy) (viewport px; default the centre) still. */
  function zoomAt(nz: number, cx?: number, cy?: number) {
    const { w, h } = size();
    const cur = viewRef.current;
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nz));
    const px = cx ?? w / 2;
    const py = cy ?? h / 2;
    const fx = (px - cur.x) / (w * cur.z);
    const fy = (py - cur.y) / (w * cur.z * aspect);
    setView({ z, x: px - fx * w * z, y: py - fy * w * z * aspect });
  }

  function panBy(dx: number, dy: number) {
    setView({ ...viewRef.current, x: viewRef.current.x + dx, y: viewRef.current.y + dy });
  }

  /** Centres a map point given in percent, optionally at a zoom. */
  function centreOn(xPct: number, yPct: number, z = viewRef.current.z) {
    const { w, h } = size();
    const mw = w * z;
    setView({ z, x: w / 2 - (xPct / 100) * mw, y: h / 2 - (yPct / 100) * mw * aspect });
  }

  const onFit = useEffectEvent(fit);
  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (e.shiftKey) return;
    const fz = fitZoom();
    // Fully zoomed out, scrolling down moves the page.
    if (e.deltaY > 0 && viewRef.current.z <= fz + 0.002) return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const r = viewport.current!.getBoundingClientRect();
    zoomAt(Math.max(fz, viewRef.current.z * Math.exp(-d * 0.0015)), e.clientX - r.left, e.clientY - r.top);
  });

  // Fit on mount and when the map's aspect changes (a new image).
  useEffect(() => {
    const id = requestAnimationFrame(() => onFit());
    return () => cancelAnimationFrame(id);
  }, [aspect]);

  // Refit when the viewport resizes (window, full screen); wheel zoom anchored on the cursor.
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

  return { view, viewRef, setView, fit, zoomAt, panBy, centreOn };
}
