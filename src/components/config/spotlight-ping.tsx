"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { SpotlightPingProps } from "./slots";

/**
 * 'Ping me when I get the spotlight' (plan config U6d, user answer Q14 a), mounted once in the campaign shell, so it
 * works on every campaign page. When the spotlight moves to a PC the viewer owns, and `preferences.spotlightPing` is on:
 * a soft chime at the dice volume (`public/sounds/spotlight-ping.wav`; silent while `diceSound` is off or the volume is
 * 0) and the toast "You have the spotlight" (`role="status"`), which hides itself after `PING_TOAST_MS` or when the
 * spotlight moves again.
 *
 * - Reads `combatSpotlight.state` (the subscription the HUD's spotlight parts share) and, only for a change to a PC,
 *   that one character (`charactersReads.get`, its `mine`) until ownership is known. "The whole party" (holder null) and
 *   the GM's own takes are never "your PC".
 * - Never on first load, and never for the GM (co-GMs included): only the GM moves the spotlight, so a GM is never
 *   told about their own move. The pref off unsubscribes, and turning it back on counts as a first load.
 * - A change is the holder plus its `since`: handing the spotlight back to the same PC after someone else held it
 *   pings again; an idempotent repeat (`moved: false`) does not.
 * - No effect writes state from render data: the change is derived during render (React's "adjust state when a prop
 *   changes" pattern); the one effect plays the sound (a side effect outside React) and the timer hides the toast from
 *   its callback. Nothing writes to the server (rule 13).
 * - The toast's fade-in is off under the device's reduced motion (`motion-safe:`) and the account's Reduce motion.
 */

/** How long the toast stays. */
export const PING_TOAST_MS = 5000;
export const PING_TEXT = "You have the spotlight";
const PING_SOUND = "/sounds/spotlight-ping.wav";

type Holder = { kind: "gm" } | { kind: "pc"; characterId: Id<"characters">; name: string } | null;

/** One spotlight position: who holds it and since when (the GM, a PC or the whole party). */
export function spotlightKey(state: { holder: Holder; since: number | null }): string {
  const { holder, since } = state;
  if (holder === null) return "party";
  return holder.kind === "gm" ? `gm:${since ?? ""}` : `pc:${holder.characterId}:${since ?? ""}`;
}

type Tracked = {
  /** The last spotlight position seen; null before the first one (first load), so it never pings. */
  key: string | null;
  /** A PC that just got the spotlight, whose owner is not known yet. */
  check: Id<"characters"> | null;
  /** The position the toast is showing, or null. */
  ping: string | null;
};

const IDLE: Tracked = { key: null, check: null, ping: null };

let audio: HTMLAudioElement | null = null;

/** Plays the chime at `volume` (0-100) from the start. Silent where audio is unavailable or blocked. */
export function playSpotlightChime(volume: number): void {
  try {
    if (typeof Audio !== "function") return;
    audio ??= new Audio(PING_SOUND);
    audio.volume = Math.min(1, Math.max(0, volume / 100));
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Autoplay blocked or no audio device: the toast still shows.
    });
  } catch {
    // No audio on this device: the toast still shows.
  }
}

export function SpotlightPing({ campaignId, isGm }: SpotlightPingProps): ReactNode {
  const prefs = useQuery(api.preferences.get, isGm ? "skip" : {});
  const on = !isGm && prefs !== undefined && prefs.spotlightPing;
  const state = useQuery(api.combatSpotlight.state, on ? { campaignId } : "skip");
  const [tracked, setTracked] = useState<Tracked>(IDLE);
  const owned = useQuery(api.charactersReads.get, tracked.check === null ? "skip" : { characterId: tracked.check });

  // Derived during render (no effect): reset while off, record each new position, then settle the check.
  let next = tracked;
  if (!on || state === undefined) {
    if (!on && tracked !== IDLE) next = IDLE;
  } else {
    const key = spotlightKey(state);
    if (key !== tracked.key) {
      const pc = tracked.key !== null && state.holder?.kind === "pc" ? state.holder.characterId : null;
      next = { key, check: pc, ping: null };
    } else if (tracked.check !== null && owned !== undefined) {
      next = { key, check: null, ping: owned?.mine === true ? key : null };
    }
  }
  if (next !== tracked) setTracked(next);

  const ping = next.ping;
  const sound = prefs !== undefined && prefs.diceSound ? prefs.diceVolume : 0;
  const played = useRef<string | null>(null);
  useEffect(() => {
    // Once per ping (StrictMode re-runs effects; a volume change while the toast shows must not replay it).
    if (ping === null || played.current === ping) return;
    played.current = ping;
    if (sound > 0) playSpotlightChime(sound);
  }, [ping, sound]);
  useEffect(() => {
    if (ping === null) return;
    const timer = setTimeout(() => setTracked((t) => (t.ping === ping ? { ...t, ping: null } : t)), PING_TOAST_MS);
    return () => clearTimeout(timer);
  }, [ping]);

  if (ping === null) return null;
  const calm = prefs?.reduceMotion === true;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <p
        role="status"
        data-testid="spotlight-ping"
        className={`rounded-md border border-amber-300/60 bg-popover px-4 py-2 text-sm font-medium text-popover-foreground shadow-lg ${
          calm ? "" : "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
        }`}
      >
        {PING_TEXT}
      </p>
    </div>
  );
}
