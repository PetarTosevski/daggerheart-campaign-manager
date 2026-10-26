"use client";

import { useSyncExternalStore } from "react";

/**
 * Range circles per token (R3): which tokens show their Melee / Very Close / Close / Far rings. A per-viewer
 * convenience kept in localStorage (plan data model: never stored on the server), so the GM and each player switch
 * their own. Off on the server and whenever storage is unavailable.
 */

const KEY = "dh.combat.rings";
/** Token ids remembered at most (oldest dropped first). */
const MAX_REMEMBERED = 200;

const listeners = new Set<() => void>();

function readRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function parse(raw: string): string[] {
  if (raw === "") return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX_REMEMBERED)));
  } catch {
    // Private window or blocked storage: the circles just don't persist.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export type Rings = {
  /** Whether this token shows its range circles. */
  on: (tokenId: string) => boolean;
  toggle: (tokenId: string) => void;
  /** Switches every token's circles off ("Hide all circles"). */
  hideAll: (tokenIds: readonly string[]) => void;
};

export function useRings(): Rings {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const ids = new Set(parse(raw));
  return {
    on: (tokenId) => ids.has(tokenId),
    toggle: (tokenId) => {
      const current = parse(readRaw());
      write(current.includes(tokenId) ? current.filter((id) => id !== tokenId) : [...current, tokenId]);
    },
    hideAll: (tokenIds) => {
      const off = new Set(tokenIds);
      write(parse(readRaw()).filter((id) => !off.has(id)));
    },
  };
}
