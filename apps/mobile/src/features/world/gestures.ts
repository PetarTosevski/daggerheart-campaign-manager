import { Gesture } from "react-native-gesture-handler";
import { useRef } from "react";

import type { useMapPanZoom } from "./pan-zoom";

type PanZoom = Pick<ReturnType<typeof useMapPanZoom>, "panBy" | "zoomAt" | "viewRef">;
type Point = { x: number; y: number };

export type MapGestureHandlers = {
  /** A one-finger drag starts at `p` (viewport px). Return true to take the drag instead of panning (painting). */
  onDragStart?: (p: Point) => boolean;
  onDragMove?: (p: Point) => void;
  /** The drag ended; `moved` is how far it travelled in px (a tap is a short one). */
  onDragEnd?: (p: Point, moved: number) => void;
};

/**
 * Drag to pan and pinch to zoom for a world map viewport. Both apply only the change since the last frame to the
 * current view, so a pan and a pinch at once compose, and the pinch zooms about the fingers (not the centre) from the
 * zoom it started at instead of compounding `scale` on every frame.
 */
export function useMapGesture(panZoom: PanZoom, handlers: MapGestureHandlers = {}) {
  const last = useRef({ tx: 0, ty: 0, scale: 1, custom: false });
  /* eslint-disable react-hooks/refs -- RNGH callbacks run outside React render. */
  const pan = Gesture.Pan()
    .onBegin((e) => {
      last.current.tx = 0;
      last.current.ty = 0;
      last.current.custom = handlers.onDragStart?.({ x: e.x, y: e.y }) ?? false;
    })
    .onUpdate((e) => {
      if (last.current.custom) {
        handlers.onDragMove?.({ x: e.x, y: e.y });
        return;
      }
      const dx = e.translationX - last.current.tx;
      const dy = e.translationY - last.current.ty;
      last.current.tx = e.translationX;
      last.current.ty = e.translationY;
      panZoom.panBy(dx, dy);
    })
    .onEnd((e) => {
      handlers.onDragEnd?.({ x: e.x, y: e.y }, Math.hypot(e.translationX, e.translationY));
    })
    .runOnJS(true);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      last.current.scale = 1;
    })
    .onUpdate((e) => {
      const factor = last.current.scale > 0 ? e.scale / last.current.scale : 1;
      last.current.scale = e.scale;
      panZoom.zoomAt(panZoom.viewRef.current.z * factor, e.focalX, e.focalY);
    })
    .runOnJS(true);
  /* eslint-enable react-hooks/refs */

  return Gesture.Simultaneous(pan, pinch);
}
