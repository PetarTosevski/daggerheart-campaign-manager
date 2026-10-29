import { useCallback, useEffect, useRef, useState } from "react";

/** Zoom 1 = the map as wide as the viewport. `x`, `y`: map top-left in viewport px. */
export type View = { z: number; x: number; y: number; w: number };

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 6;

export function rescaleView(view: Omit<View, "w">, from: number, to: number): Omit<View, "w"> {
  const r = from > 0 ? to / from : 1;
  return { z: view.z, x: view.x * r, y: view.y * r };
}

/**
 * Pan and zoom for a native map viewport. Zoom 1 draws the stage as wide as the viewport.
 * `frameW` and `frameH` are the fraction of that stage the Fit button should fill (1 frames the whole stage).
 * Combat passes the battlefield's share, leaving the fog margin outside the frame.
 */
export function useMapPanZoom(viewportW: number, viewportH: number, aspect: number, frameW = 1, frameH = 1) {
  const [view, setViewState] = useState<View>({ z: 1, x: 0, y: 0, w: viewportW });
  const viewRef = useRef(view);

  const setView = useCallback(
    (next: Omit<View, "w">) => {
      const w = viewportW || 1;
      const h = viewportH || 1;
      const mw = w * next.z;
      const mh = mw * aspect;
      const keep = 80;
      const clamped = {
        z: next.z,
        x: Math.min(w - keep, Math.max(keep - mw, next.x)),
        y: Math.min(h - keep, Math.max(keep - mh, next.y)),
        w,
      };
      viewRef.current = clamped;
      setViewState(clamped);
    },
    [aspect, viewportH, viewportW],
  );

  const fitZoom = useCallback(() => {
    const w = viewportW || 1;
    const h = viewportH || 1;
    const fw = frameW > 0 ? frameW : 1;
    const fh = frameH > 0 ? frameH : 1;
    const byWidth = 1 / fw;
    const byHeight = h / (w * aspect * fh);
    return Math.min(MAX_ZOOM, byWidth, byHeight);
  }, [aspect, frameH, frameW, viewportH, viewportW]);

  const fit = useCallback(() => {
    const w = viewportW || 1;
    const h = viewportH || 1;
    const z = fitZoom();
    setView({ z, x: (w - w * z) / 2, y: (h - w * z * aspect) / 2 });
  }, [aspect, fitZoom, setView, viewportH, viewportW]);

  const zoomAt = useCallback(
    (nz: number, cx?: number, cy?: number) => {
      const w = viewportW || 1;
      const h = viewportH || 1;
      const cur = viewRef.current;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nz));
      const px = cx ?? w / 2;
      const py = cy ?? h / 2;
      const fx = (px - cur.x) / (w * cur.z);
      const fy = (py - cur.y) / (w * cur.z * aspect);
      setView({ z, x: px - fx * w * z, y: py - fy * w * z * aspect });
    },
    [aspect, setView, viewportH, viewportW],
  );

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const cur = viewRef.current;
      setView({ z: cur.z, x: cur.x + dx, y: cur.y + dy });
    },
    [setView],
  );

  const centreOn = useCallback(
    (xPct: number, yPct: number, z = viewRef.current.z) => {
      const w = viewportW || 1;
      const h = viewportH || 1;
      const mw = w * z;
      setView({ z, x: w / 2 - (xPct / 100) * mw, y: h / 2 - (yPct / 100) * mw * aspect });
    },
    [aspect, setView, viewportH, viewportW],
  );

  useEffect(() => {
    if (viewportW <= 0) return;
    const prev = viewRef.current;
    if (prev.w > 0 && Math.abs(prev.w - viewportW) <= 24) {
      setView(rescaleView(prev, prev.w, viewportW));
      return;
    }
    fit();
  }, [aspect, fit, setView, viewportW]);

  return { view, viewRef, setView, fit, fitZoom, zoomAt, panBy, centreOn };
}
