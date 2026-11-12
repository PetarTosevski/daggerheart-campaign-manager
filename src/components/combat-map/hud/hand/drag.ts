"use client";

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";

import { rootScale } from "@/lib/css-zoom";

/**
 * Drag a hand card to play it (user 2026-11-09): dropping it in the middle of the screen does what its Use button does.
 * A press only becomes a drag after the pointer moves a few pixels, so a tap still raises the card and clicks still
 * reach More and Use; the click that ends a drag is swallowed.
 */

/** Pixels the pointer must move before a press becomes a drag. */
export const DRAG_START_PX = 8;

/** The middle of the screen, where a dropped card is played: away from the hand, the dock and the side panels. */
export function inPlayZone(x: number, y: number, width: number, height: number): boolean {
  return x > width * 0.2 && x < width * 0.8 && y > height * 0.12 && y < height * 0.68;
}

export type CardDrag = { dx: number; dy: number; over: boolean };

export function useDragToPlay(enabled: boolean, onDrop: () => void) {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const press = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const swallowClick = useRef(false);

  const end = () => {
    press.current = null;
    setDrag(null);
  };

  return {
    drag,
    handlers: {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (!enabled || e.button !== 0 || (e.target as Element).closest("button, a, input, select, textarea")) return;
        press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        if (!p.dragging) {
          if (Math.hypot(dx, dy) < DRAG_START_PX) return;
          p.dragging = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }
        // The card follows in CSS px (--dx / --dy): client px over the root zoom (dcm-1i3z). The zone test stays in client px.
        const k = rootScale();
        setDrag({ dx: dx / k, dy: dy / k, over: inPlayZone(e.clientX, e.clientY, window.innerWidth, window.innerHeight) });
      },
      onPointerUp(e: PointerEvent<HTMLElement>) {
        const p = press.current;
        if (!p || p.id !== e.pointerId) return;
        if (p.dragging) {
          swallowClick.current = true;
          if (inPlayZone(e.clientX, e.clientY, window.innerWidth, window.innerHeight)) onDrop();
        }
        end();
      },
      onPointerCancel: end,
      onLostPointerCapture(e: PointerEvent<HTMLElement>) {
        if (press.current?.id === e.pointerId && press.current.dragging) end();
      },
    },
    /** Swallows the click a drag ends with (call first in the card's click capture). Returns true when it did. */
    swallow(e: MouseEvent<HTMLElement>): boolean {
      if (!swallowClick.current) return false;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    },
  };
}
