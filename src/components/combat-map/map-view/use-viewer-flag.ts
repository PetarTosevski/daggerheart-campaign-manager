"use client";

import { useSyncExternalStore } from "react";

/**
 * A per-viewer on/off switch kept in localStorage (the board's "Names"; plan: range circles and names are
 * per-viewer conveniences, never stored on the server). Off on the server and whenever storage is unavailable.
 */

const listeners = new Set<() => void>();

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useViewerFlag(key: string): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  function set(next: boolean) {
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // Private window or blocked storage: the switch just doesn't persist.
    }
    for (const listener of listeners) listener();
  }
  return [on, set];
}
