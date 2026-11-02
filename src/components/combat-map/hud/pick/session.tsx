"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";

import type { Id } from "../../../../../convex/_generated/dataModel";
import { useHud } from "../state";
import { initialOptions } from "./model";
import type { PickPatch, PickSelection, PickSessionSpec } from "./types";

/**
 * The one active pick session (plan combat-hud H3.0). `PickProvider` sits inside the shell's `HudProvider` and keeps
 * the session's spec and its selection; `useHud().pick` (H0's slot) says which one is open, so the root gets
 * `hud-pk-open` and other parts can step aside. A session is active only while the slot names it: whoever clears the
 * slot ends the session too.
 *
 * Every change here happens in an event handler (open from a click, a tap on a row or ring, Esc, the primary), never in
 * an effect (best-practices rule 13).
 */

/** The live session: the spec as opened (and updated) plus what the player picked. */
export type PickLive = {
  spec: PickSessionSpec<unknown>;
  picked: readonly Id<"combatTokens">[];
  options: Readonly<Record<string, boolean>>;
  sending: boolean;
  /** The last refusal or `stay` message, under the primary. */
  message: string | null;
};

export type PickApi = {
  /** The open session, or null. */
  session: PickLive | null;
  /** Opens a session (ending any other: its `onCancel` runs) and moves the HUD slot to it. Call from a click handler. */
  open: <D>(spec: PickSessionSpec<D>) => void;
  /** Ends the session without sending (✕, Esc): runs `onCancel`, gives focus back to what opened it. */
  cancel: () => void;
  /** Ends the session after a send (no `onCancel`). */
  finish: () => void;
  /** Sets the picks (the panel and the ring layer call this with `togglePick`'s result). */
  setPicked: (picked: readonly Id<"combatTokens">[]) => void;
  setOption: (id: string, on: boolean) => void;
  /** Changes the open session (a picker's extra rows: another weapon, new options, data). */
  update: <D>(patch: PickPatch<D>) => void;
  /** Runs the primary with the selection the panel shows. */
  send: (selection: PickSelection) => Promise<void>;
};

const PickContext = createContext<PickApi | null>(null);

function anchorOf(spec: PickSessionSpec<unknown>, picked: readonly Id<"combatTokens">[]): Id<"combatTokens"> | null {
  return picked[0] ?? spec.actor?.tokenId ?? null;
}

export function PickProvider({ children }: { children: ReactNode }) {
  const hud = useHud();
  const [live, setLive] = useState<PickLive | null>(null);
  // What had focus when the session opened, to give it back on cancel (not state: never rendered).
  const opener = useRef<HTMLElement | null>(null);
  const active = live !== null && hud.pick?.id === live.spec.id ? live : null;
  const setPick = hud.setPick;

  const api = useMemo<PickApi>(() => {
    const restoreFocus = () => {
      const el = opener.current;
      opener.current = null;
      if (el && el.isConnected) el.focus();
    };
    const end = (cancelled: boolean) => {
      if (cancelled) active?.spec.onCancel?.();
      setLive(null);
      setPick(null);
      if (cancelled) restoreFocus();
    };
    return {
      session: active,
      open: (spec) => {
        const next = spec as PickSessionSpec<unknown>;
        if (active && active.spec.id !== next.id) active.spec.onCancel?.();
        if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
        const picked = [...(next.picked ?? [])];
        setLive({ spec: next, picked, options: initialOptions(next.options), sending: false, message: null });
        setPick({ id: next.id, anchorTokenId: anchorOf(next, picked) });
      },
      cancel: () => end(true),
      finish: () => end(false),
      setPicked: (picked) => {
        if (!active) return;
        setLive({ ...active, picked: [...picked], message: null });
        setPick({ id: active.spec.id, anchorTokenId: anchorOf(active.spec, picked) });
      },
      setOption: (id, on) => {
        if (!active) return;
        setLive({ ...active, options: { ...active.options, [id]: on }, message: null });
      },
      update: (patch) => {
        if (!active) return;
        const spec = { ...active.spec, ...(patch as PickPatch<unknown>) };
        // New options start from their defaults; ones already set keep the player's choice.
        const options = patch.options ? { ...initialOptions(patch.options), ...pickKnown(active.options, patch.options.map((o) => o.id)) } : active.options;
        setLive({ ...active, spec, options });
      },
      send: async (selection) => {
        if (!active || active.sending) return;
        const id = active.spec.id;
        setLive({ ...active, sending: true, message: null });
        try {
          const out = await active.spec.primary.send(selection);
          if (out.kind === "stay") {
            setLive((now) => (now && now.spec.id === id ? { ...now, sending: false, message: out.message ?? null } : now));
            return;
          }
          // done / pending: the session ends; a pending use shows as "Waiting for the GM" from the server's open requests.
          setLive((now) => (now && now.spec.id === id ? null : now));
          setPick(null);
          opener.current = null;
        } catch (error) {
          setLive((now) => (now && now.spec.id === id ? { ...now, sending: false, message: errorMessage(error) } : now));
        }
      },
    };
  }, [active, setPick]);

  return <PickContext.Provider value={api}>{children}</PickContext.Provider>;
}

function pickKnown(options: Readonly<Record<string, boolean>>, ids: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(ids.filter((id) => id in options).map((id) => [id, options[id]!]));
}

/** The pick-session API (see types.ts). Throws outside the HUD shell (a picker mounted by the classic page is a bug). */
export function usePick(): PickApi {
  const api = useContext(PickContext);
  if (api === null) throw new Error("usePick() needs a <PickProvider> (the HUD shell mounts it inside HudProvider).");
  return api;
}
