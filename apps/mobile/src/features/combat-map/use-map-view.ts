import { useMemo, useRef, useState } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

import { useMapGesture, type MapGestureHandlers } from "../world/gestures";
import type { View as PanZoomView } from "../world/pan-zoom";

import {
  clampView,
  fitView,
  panView,
  screenToSquare,
  zoomAbout,
  zoomLimits,
  zoomPercent,
  type MapBounds,
  type MapView,
  type Point,
  type Viewport,
} from "./view-math";

/** The editor's drag handlers, built with the screen-to-square conversion of the live view. */
export type MapHandlers = (toSquare: (px: number, py: number) => Point) => MapGestureHandlers;

/** The Skia group transform for a view: square (0, 0) at (x, y), `s` points per square. */
export type SkiaTransform = [{ translateX: number }, { translateY: number }, { scale: number }];

export function skiaTransform(view: MapView): SkiaTransform {
  "worklet";
  return [{ translateX: view.x }, { translateY: view.y }, { scale: view.s }];
}

/** Writes a shared value (outside the component, so the React compiler does not treat it as mutating hook state). */
function write<T>(shared: SharedValue<T>, value: T): void {
  shared.value = value;
}

/** What `useMapGesture` (world/gestures.ts) drives: pan by a delta, zoom to a scale about a point, the current zoom. */
export type MapPanZoom = {
  panBy: (dx: number, dy: number) => void;
  zoomAt: (scale: number, cx?: number, cy?: number) => void;
  viewRef: { readonly current: PanZoomView };
};

export type MapViewState = {
  /** The live view; gestures and buttons write it, nothing re-renders (the Skia canvas and tokens read it). */
  view: SharedValue<MapView>;
  /** The same view as the Skia group's transform (written together with `view`). */
  transform: SharedValue<SkiaTransform>;
  /** The zoom label (percent of the fit); updated when a drag ends or a button is pressed, not per frame. */
  zoom: number;
  /** Call from the viewport's onLayout: fits the map the first time the viewport has a size. */
  onViewport: (viewport: Viewport) => void;
  viewport: Viewport;
  fit: () => void;
  zoomBy: (factor: number) => void;
  panZoom: MapPanZoom;
  /** The pan + pinch gesture for a GestureDetector (`useMapGesture`). */
  gesture: ReturnType<typeof useMapGesture>;
  /** Screen point to square position, for taps and brushes. */
  toSquare: (px: number, py: number) => { x: number; y: number };
};

/**
 * Pan and zoom for the combat map on Reanimated shared values (dcm-gdzi.13, dcm-gdzi.14). The gesture is the world
 * map's `useMapGesture` (per-frame deltas, pinch about the fingers, no compounding); here it writes shared values
 * instead of React state, so a drag or pinch re-renders nothing: Skia and the token layer follow the shared values.
 * Mount it once per map (the caller keys its stage by the map's id) so a new map is fitted when its viewport first
 * has a size.
 */
export function useMapView(bounds: MapBounds, makeHandlers?: MapHandlers): MapViewState {
  const view = useSharedValue<MapView>({ s: 1, x: 0, y: 0 });
  const transform = useSharedValue<SkiaTransform>(skiaTransform({ s: 1, x: 0, y: 0 }));
  const [viewport, setViewport] = useState<Viewport>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(100);
  const fitted = useRef(false);
  const { w, h, pad } = bounds;

  const ops = useMemo(() => {
    const b: MapBounds = { w, h, pad };
    const apply = (next: MapView, vp: Viewport) => {
      const clamped = vp.w > 0 && vp.h > 0 ? clampView(next, vp, b) : next;
      write(view, clamped);
      write(transform, skiaTransform(clamped));
      return clamped;
    };
    const panZoom = (vp: Viewport): MapPanZoom => ({
      panBy: (dx, dy) => {
        apply(panView(view.value, dx, dy), vp);
      },
      zoomAt: (scale, cx = vp.w / 2, cy = vp.h / 2) => {
        const cur = view.value;
        apply(zoomAbout(cur, scale / cur.s, { x: cx, y: cy }, zoomLimits(vp, b)), vp);
      },
      viewRef: {
        get current() {
          const cur = view.value;
          return { z: cur.s, x: cur.x, y: cur.y, w: vp.w };
        },
      },
    });
    return { b, apply, panZoom };
  }, [w, h, pad, view, transform]);

  const panZoom = useMemo(() => ops.panZoom(viewport), [ops, viewport]);
  const refreshZoom = () => setZoom(zoomPercent(view.value, viewport, ops.b));
  const toSquare = (px: number, py: number) => {
    const cur = view.value;
    return screenToSquare(cur, px, py);
  };
  const handlers = makeHandlers?.(toSquare) ?? {};
  const gesture = useMapGesture(panZoom, {
    ...handlers,
    onDragEnd: (p, moved) => {
      handlers.onDragEnd?.(p, moved);
      refreshZoom();
    },
  });

  const onViewport = (next: Viewport) => {
    setViewport(next);
    if (next.w <= 0 || next.h <= 0) return;
    if (fitted.current) {
      ops.apply(view.value, next);
      return;
    }
    fitted.current = true;
    ops.apply(fitView(next, ops.b), next);
    setZoom(100);
  };

  const fit = () => {
    ops.apply(fitView(viewport, ops.b), viewport);
    setZoom(100);
  };

  const zoomBy = (factor: number) => {
    panZoom.zoomAt(view.value.s * factor);
    refreshZoom();
  };

  return { view, transform, zoom, onViewport, viewport, fit, zoomBy, panZoom, gesture, toSquare };
}
