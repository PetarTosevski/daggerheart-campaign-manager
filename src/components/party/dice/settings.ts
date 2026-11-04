"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useSetPreference, usePreferences } from "@/components/config/prefs/use-preferences";
import { PREFERENCE_DEFAULTS, clampVolume } from "@/lib/config/preferences";

/**
 * The dice settings, saved to the account (plan config U6a, Q15 b): 3D dice, dice sound and its volume, read from
 * `preferences.get` and written one field at a time through `preferences.set` with an optimistic update, so they follow
 * the user to every device and the Preferences popover's rows stay in step with the dice box's toggles.
 *
 * While the account loads (and on the server render) the old per-device defaults apply: 3D on unless the device asks
 * for reduced motion, sound off, volume 60. Signed-out visitors never reach a dice box (the proxy sends them to
 * /signin). Nothing here reads or writes localStorage; the old `dcm.dice.settings` key is read only by
 * `src/lib/config/legacy-prefs.ts` for the one-time import (IMP).
 */
export type DiceSettings = { threeD: boolean; sound: boolean; /** 0-100. */ volume: number };

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

function subscribeReducedMotion(onChange: () => void): () => void {
  try {
    const query = window.matchMedia(REDUCED_MOTION);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  } catch {
    return () => undefined;
  }
}

/** The volume the last mounted dice settings read, for `playRollSound` (sound.ts) and the 3D scene that calls it. */
let currentVolume: number = PREFERENCE_DEFAULTS.diceVolume;

/** The account's dice volume (0-100), or the default before any dice settings have loaded. */
export function rollVolume(): number {
  return currentVolume;
}

/** The account's dice settings and a setter that saves the changed fields (one `preferences.set` per field). */
export function useDiceSettings(): [DiceSettings, (change: Partial<DiceSettings>) => void] {
  const preferences = usePreferences();
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const settings: DiceSettings =
    preferences === undefined
      ? { threeD: !reduced, sound: PREFERENCE_DEFAULTS.diceSound, volume: PREFERENCE_DEFAULTS.diceVolume }
      : { threeD: preferences.dice3d, sound: preferences.diceSound, volume: preferences.diceVolume };
  const volume = settings.volume;
  // Syncs an outside value (the sound module's volume), not React state (rule 13 allows it).
  useEffect(() => {
    currentVolume = volume;
  }, [volume]);

  const set = useSetPreference();
  const update = useCallback(
    (change: Partial<DiceSettings>) => {
      // A refused write rolls the optimistic value back; the toggle shows the account's value again.
      const ignore = () => undefined;
      if (change.threeD !== undefined) set({ key: "dice3d", value: change.threeD }).catch(ignore);
      if (change.sound !== undefined) set({ key: "diceSound", value: change.sound }).catch(ignore);
      if (change.volume !== undefined) set({ key: "diceVolume", value: clampVolume(change.volume) }).catch(ignore);
    },
    [set],
  );
  return [settings, update];
}

/** Whether rolls may animate in 3D right now: the toggle is on and the device doesn't ask for reduced motion (CL14). */
export function canAnimate3d(settings: DiceSettings): boolean {
  return settings.threeD && !prefersReducedMotion();
}
