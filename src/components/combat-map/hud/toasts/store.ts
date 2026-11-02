import { useSyncExternalStore } from "react";

import type { Refusal } from "@/lib/errors/refusals";

/**
 * The toasts near the hand (plan combat-hud H6.1; board CmpBlocked layer 3, "Results that arrive later, or from someone
 * else, use a toast near the hand"). A tiny external store read through `useSyncExternalStore` (like result/store.ts),
 * because the senders (any HUD part, a refusal's `place: "toast"`) and the host (`HudToasts` in the hand region) live in
 * different regions. Client state only: nothing here reaches the server.
 */

export type ToastTone = "block" | "neutral";

export type HudToast = {
  /** Unique per shown toast (a repeat gets a new id, so its timer restarts). */
  id: number;
  /** Repeats of the same key replace the older toast instead of stacking a copy. */
  key: string;
  tone: ToastTone;
  /** Bold title ("Not enough Hope"). */
  title: string;
  /** The message ("Wall Walk costs 1 Hope. You have 0."). */
  message: string;
  /** How to fix it, or null. */
  hint: string | null;
  /** Auto-dismiss after this many ms (paused while hovered or focused). */
  ttl: number;
};

export type ToastInput = { title: string; message: string; hint?: string | null; tone?: ToastTone; key?: string; ttl?: number };

/** How long a toast stays: 6 s, plus time to read a hint (WCAG 2.2.1: hovering or focusing pauses it; ✕ closes it). */
export const TOAST_TTL = 6000;
export const TOAST_TTL_HINT = 8000;
/** At most this many at once; the oldest goes first. */
export const TOAST_MAX = 3;

let toasts: readonly HudToast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const fn of listeners) fn();
};

export const hudToasts = {
  get: (): readonly HudToast[] => toasts,
  /** Shows a toast; returns its id. A toast with the same key is replaced (moved to the newest place). */
  push: (input: ToastInput): number => {
    const hint = input.hint ?? null;
    const toast: HudToast = {
      id: nextId++,
      key: input.key ?? `${input.title}|${input.message}`,
      tone: input.tone ?? "block",
      title: input.title,
      message: input.message,
      hint,
      ttl: input.ttl ?? (hint ? TOAST_TTL_HINT : TOAST_TTL),
    };
    toasts = [...toasts.filter((t) => t.key !== toast.key), toast].slice(-TOAST_MAX);
    emit();
    return toast.id;
  },
  /** Shows a resolved refusal (refusals.ts) as CmpBlocked's toast: title, message, hint, tone. */
  refusal: (refusal: Refusal): number =>
    hudToasts.push({ title: refusal.title, message: refusal.text, hint: refusal.hint, tone: refusal.tone, key: `${refusal.code}|${refusal.text}` }),
  dismiss: (id: number): void => {
    if (!toasts.some((t) => t.id === id)) return;
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  },
  /** Tests: back to empty. */
  reset: (): void => {
    toasts = [];
    emit();
  },
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

const EMPTY: readonly HudToast[] = [];

export function useHudToasts(): readonly HudToast[] {
  return useSyncExternalStore(hudToasts.subscribe, hudToasts.get, () => EMPTY);
}
