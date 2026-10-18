"use client";

import { useSyncExternalStore } from "react";

/**
 * Per-device dice settings (decision 3), kept in localStorage: 3D dice (on by
 * default, off by default when the device asks for reduced motion) and sound
 * (off by default). Storage can be missing or throw (private windows,
 * blocked site data); the defaults apply then.
 */
export type DiceSettings = { threeD: boolean; sound: boolean };

const KEY = "dcm.dice.settings";
const EVENT = "dcm-dice-settings";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): DiceSettings {
  const defaults = { threeD: !prefersReducedMotion(), sound: false };
  if (raw === null) return defaults;
  try {
    const stored = JSON.parse(raw) as Partial<DiceSettings>;
    return {
      threeD: typeof stored.threeD === "boolean" ? stored.threeD : defaults.threeD,
      sound: typeof stored.sound === "boolean" ? stored.sound : defaults.sound,
    };
  } catch {
    return defaults;
  }
}

let cache: { raw: string | null; value: DiceSettings } | null = null;

function snapshot(): DiceSettings {
  const raw = readRaw();
  if (cache === null || cache.raw !== raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

const SERVER: DiceSettings = { threeD: false, sound: false };

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The device's dice settings and a setter that saves them. */
export function useDiceSettings(): [DiceSettings, (change: Partial<DiceSettings>) => void] {
  const settings = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  const update = (change: Partial<DiceSettings>) => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ ...snapshot(), ...change }));
    } catch {
      // Storage is unavailable: the setting lasts until the page reloads.
      cache = { raw: cache?.raw ?? null, value: { ...snapshot(), ...change } };
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [settings, update];
}

/** Whether rolls may animate in 3D right now: the toggle is on and the device doesn't ask for reduced motion (CL14). */
export function canAnimate3d(settings: DiceSettings): boolean {
  return settings.threeD && !prefersReducedMotion();
}
