"use client";

import { useEffect, useEffectEvent } from "react";

/**
 * `raiseHand()` (dcm-bxp.99.32.20; plan combat-hud H3.4, answer 3b): the action ring's Cast "raises the hand". The
 * player's own hand (`HudHandBody` in mode "own") registers how it raises itself: it unfolds through its own fold
 * state and moves focus to the first card whose Use is enabled (else the first card), which raises it (hand.css
 * `.hud-hc:focus-within`); Tab / Shift+Tab walk the fan from there. One own hand is mounted at a time (the region's,
 * or the phone sheet's Hand tab).
 */
let raiser: (() => void) | null = null;

/** Raises the player's own hand. Returns false when there is no hand of yours to raise (nothing happens then). */
export function raiseHand(): boolean {
  if (!raiser) return false;
  raiser();
  return true;
}

/** Registers `raise` while `enabled` (the own hand); the latest render's `raise` runs. */
export function useRaiseHandle(enabled: boolean, raise: () => void): void {
  const run = useEffectEvent(raise);
  useEffect(() => {
    if (!enabled) return;
    const mine = () => run();
    raiser = mine;
    return () => {
      if (raiser === mine) raiser = null;
    };
  }, [enabled]);
}
