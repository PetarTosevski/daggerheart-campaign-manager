"use client";

import "./toasts.css";

import { useEffect, useState, type ReactNode } from "react";

import type { HudPartProps } from "../state";
import { hudToasts, useHudToasts, type HudToast } from "./store";

export { TOAST_MAX, TOAST_TTL, TOAST_TTL_HINT, hudToasts, useHudToasts } from "./store";
export type { HudToast, ToastInput, ToastTone } from "./store";

/** The lock (a refusal) and the hourglass (nothing went wrong, it moved on) of the board's toasts. */
function ToastIcon({ tone }: { tone: HudToast["tone"] }) {
  return (
    <span className="hud-toast-i" aria-hidden="true">
      {tone === "block" ? (
        <svg className="hud-ic" viewBox="0 0 16 16" fill="currentColor">
          <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
          <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : (
        <svg className="hud-ic" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 1h6l-1 4.5 3.5 9.5h-11L6 5.5z" opacity=".35" />
          <circle cx="8" cy="3" r="2" />
        </svg>
      )}
    </span>
  );
}

/** One toast: closes itself after its `ttl`, paused while the pointer or focus is on it (WCAG 2.2.1). */
function ToastItem({ toast }: { toast: HudToast }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const paused = hover || focus;
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => hudToasts.dismiss(toast.id), toast.ttl);
    return () => clearTimeout(timer);
  }, [paused, toast.id, toast.ttl]);
  return (
    <li
      className={toast.tone === "neutral" ? "hud-toast hud-toast-neutral" : "hud-toast"}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <ToastIcon tone={toast.tone} />
      <div className="hud-toast-body">
        <b>{toast.title}</b>
        <p>{toast.message}</p>
        {toast.hint ? <small>{toast.hint}</small> : null}
      </div>
      <button type="button" className="hud-toast-x" aria-label={`Dismiss: ${toast.title}`} onClick={() => hudToasts.dismiss(toast.id)}>
        <span aria-hidden="true">✕</span>
      </button>
    </li>
  );
}

/**
 * Layer 3 of the blocked-state system (board CmpBlocked "After, elsewhere"): the toasts near the hand for a refusal or
 * result that comes later or from someone else. The live region is always mounted (`role="status"`, polite), so a new
 * toast is announced; they stack (newest nearest the hand, at most `TOAST_MAX`), auto-dismiss, and stop moving under
 * reduced motion (device or account). Senders call `hudToasts.push(...)` / `hudToasts.refusal(...)`, or `useRefusal()`
 * does.
 */
export const HudToasts: (props: HudPartProps) => ReactNode = () => {
  const toasts = useHudToasts();
  return (
    <div className="hud-toasts" role="status" aria-label="Notices">
      {toasts.length > 0 ? (
        <ol className="hud-toasts-list">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} />
          ))}
        </ol>
      ) : null}
    </div>
  );
};
