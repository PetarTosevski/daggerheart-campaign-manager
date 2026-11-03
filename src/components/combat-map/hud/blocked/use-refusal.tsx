"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/utils";
import { refusalFor, type Refusal, type RefusalContext, type RefusalThen } from "@/lib/errors/refusals";

import { hudToasts } from "../toasts/store";

/**
 * Layer 2 of the blocked-state system (board CmpBlocked "At the click: when the server refuses, the message appears
 * under the control that was pressed"). `useRefusal()` sends through `run`, resolves whatever the mutation threw with
 * the refusal table, and holds it for `RefusalMessage` under the control. A refusal the table places in a toast
 * (`REQUEST_NOT_OPEN`, `FEATURE_NEEDS_MAP`, FALLBACK…) goes to the toast host instead (layer 3), and its `then`
 * ("refresh", "snap-back") reaches `onThen`.
 */

export type UseRefusalOptions = RefusalContext & {
  /** Runs after a refusal with a follow-up (an answered request: refresh; a blocked move: snap the token back). */
  onThen?: (then: RefusalThen, refusal: Refusal) => void;
  /** Force every refusal under the control (a dialog that must show it in place) or into a toast. */
  place?: "inline" | "toast";
};

export type RefusalState = {
  /** The refusal shown under the control, or null. */
  refusal: Refusal | null;
  /** Give it to `RefusalMessage` and as the control's `aria-describedby` while a refusal shows. */
  messageId: string;
  /**
   * Clears the last refusal, awaits `send`, and returns its result; on a throw shows the refusal and returns undefined.
   * `ctx` adds names known at the click ("the Lieutenant", the picked count).
   */
  run: <T>(send: () => Promise<T>, ctx?: RefusalContext) => Promise<T | undefined>;
  /** Shows a refusal from an error caught elsewhere (a `.catch` on a mutation). */
  fail: (error: unknown, ctx?: RefusalContext) => Refusal;
  clear: () => void;
};

export function useRefusal(options: UseRefusalOptions = {}): RefusalState {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const messageId = useId();
  const { onThen, place, ...base } = options;

  const fail = (error: unknown, ctx: RefusalContext = {}): Refusal => {
    const resolved = refusalFor(error, { ...base, ...ctx });
    if ((place ?? resolved.place) === "toast") {
      setRefusal(null);
      hudToasts.refusal(resolved);
    } else {
      setRefusal(resolved);
    }
    if (resolved.then) onThen?.(resolved.then, resolved);
    return resolved;
  };

  const run = async <T,>(send: () => Promise<T>, ctx?: RefusalContext): Promise<T | undefined> => {
    setRefusal(null);
    try {
      return await send();
    } catch (error) {
      fail(error, ctx);
      return undefined;
    }
  };

  return { refusal, messageId, run, fail, clear: () => setRefusal(null) };
}

/**
 * The refusal under the pressed control (board `.inl`: lock, the bold lead, the rest, then the hint). `role="alert"` so
 * it is announced at once; nothing renders while there is no refusal.
 */
export function RefusalMessage({ refusal, id, className }: { refusal: Refusal | null; id?: string; className?: string }) {
  if (!refusal) return null;
  return (
    <div id={id} role="alert" className={cn("hud-inl", className)} data-code={refusal.code}>
      <svg className="hud-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
        <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
        <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>
        <b>{refusal.lead}</b>
        {refusal.rest ? ` ${refusal.rest}` : null}
        {refusal.hint ? (
          <>
            {" "}
            <small>{refusal.hint}</small>
          </>
        ) : null}
      </span>
    </div>
  );
}
