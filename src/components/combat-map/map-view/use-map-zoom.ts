"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { cssScale } from "@/lib/css-zoom";

/** The board's zoom range and step (`setZoom`: 0.15..2.5, buttons x1.2, Ctrl + scroll x1.12). */
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 2.5;
export const ZOOM_STEP = 1.2;
const WHEEL_STEP = 1.12;

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/**
 * The CSS scale on the element and its ancestors (`cssScale`, src/lib/css-zoom.ts): the root zoom times the Combat
 * HUD's make-room scale while a sheet is open (plan combat-hud H2.2: 0.94, tablet 0.92), so client pixels are layout
 * pixels times this (dcm-bxp.99.32.14, dcm-1i3z).
 */
export { cssScale } from "@/lib/css-zoom";

/**
 * The stage point (unzoomed layout px) under the client point (cx, cy): `s` is the stage's client rect, `scale` the
 * CSS scale on it (`cssScale`).
 */
export function anchorAt(s: Pick<DOMRect, "left" | "top">, zoom: number, scale: number, cx: number, cy: number) {
  return { px: (cx - s.left) / (zoom * scale), py: (cy - s.top) / (zoom * scale), cx, cy };
}

/**
 * How far to scroll the viewport (its layout px) so the anchored stage point sits under its client point at zoom `z`:
 * the client distance to close, divided by the CSS scale, since a scroll moves the stage by `scale` client px per px.
 */
export function anchorScroll(s: Pick<DOMRect, "left" | "top">, a: { px: number; py: number; cx: number; cy: number }, z: number, scale: number) {
  return { x: (s.left - a.cx) / scale + a.px * z, y: (s.top - a.cy) / scale + a.py * z };
}

/** A rectangle of the stage in unzoomed pixels. */
export type FitArea = { x: number; y: number; w: number; h: number };

/**
 * Zoom for the combat map viewport, following the World map's pattern (src/app/(gm)/campaigns/[campaignId]/world/
 * use-pan-zoom.ts: Fit on mount and on resize, wheel zoom anchored on the cursor through a non-passive listener)
 * with the board's model: the viewport scrolls (pan = scroll), the stage is `contentW x contentH` pixels at zoom 1,
 * and Ctrl / Cmd + scroll zooms (a plain scroll scrolls). `fitKey` changes when another map (or size) is shown.
 *
 * `fitArea` (unzoomed stage px, optional): what Fit frames instead of the whole stage, centred in the viewport. The
 * player's view passes the squares their character has explored (C8, Q1), so Fit never frames the map's real
 * bounds; without it Fit frames the whole stage (the GM's map, or the player's padded area).
 */
export function useMapZoom(
  viewport: RefObject<HTMLDivElement | null>,
  stage: HTMLDivElement | null,
  contentW: number,
  contentH: number,
  fitKey: string,
  fitArea: FitArea | null = null,
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
      anchor.current = anchorAt(s, zoomRef.current, cssScale(st), cx, cy);
    }
    zoomRef.current = next;
    setZoomState(next);
  }

  function fitZoom(): number {
    const vp = viewport.current;
    const w = fitArea ? fitArea.w : contentW;
    const h = fitArea ? fitArea.h : contentH;
    if (!vp || w <= 0 || h <= 0) return zoomRef.current;
    return clampZoom(Math.min((vp.clientWidth - 8) / w, (vp.clientHeight - 8) / h));
  }

  /** Scrolls so the stage point (px, py) (unzoomed) sits under the client point (cx, cy) at zoom `z`. */
  function scrollToAnchor(a: { px: number; py: number; cx: number; cy: number }, z: number) {
    const vp = viewport.current;
    if (!vp || !stage) return;
    const by = anchorScroll(stage.getBoundingClientRect(), a, z, cssScale(stage));
    vp.scrollBy(by.x, by.y);
  }

  function fit() {
    anchor.current = null;
    const z = fitZoom();
    const vp = viewport.current;
    if (fitArea && vp) {
      // Centre the fitted area in the viewport.
      const v = vp.getBoundingClientRect();
      anchor.current = { px: fitArea.x + fitArea.w / 2, py: fitArea.y + fitArea.h / 2, cx: v.left + v.width / 2, cy: v.top + v.height / 2 };
    }
    if (z === zoomRef.current) {
      // No re-render follows, so scroll now.
      const a = anchor.current;
      anchor.current = null;
      if (a) scrollToAnchor(a, z);
      return;
    }
    zoomRef.current = z;
    setZoomState(z);
  }

  // After a zoom change, scroll so the anchored stage point is back under the cursor (or the fitted area's centre).
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (a) scrollToAnchor(a, zoom);
    // scrollToAnchor reads the current viewport and stage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // The viewport's outer size: a scrollbar that appears when the stage outgrows the viewport (classic scrollbars, as
    // on Windows) shrinks only its inner size. That is no resize, or a zoom in from Fit would refit at once.
    let width = el.offsetWidth;
    let height = el.offsetHeight;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (el.offsetWidth === width && el.offsetHeight === height) return;
            width = el.offsetWidth;
            height = el.offsetHeight;
            onFit();
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
