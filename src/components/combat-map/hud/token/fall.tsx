"use client";

import "../scene/scene.css";
import "../revive/revive.css";
import "./token.css";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";

import { HAZARD_KINDS, HAZARDS, hazardFormula, type HazardKind } from "@/lib/domain/hazards";
import { refusalFor } from "@/lib/errors/refusals";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { hudToasts } from "../toasts/store";
import { hudButtonClass } from "../ui";

/**
 * Falling and collision damage (optional rule, CB p.168; plan rule-switches OFA; user answer Q10 a: "GM button in the
 * token menu; the app rolls and applies through the normal hit path (collision direct)"). GM only, HUD only, and only
 * while the campaign's switch is on; the server refuses anyone else (FORBIDDEN) and an off switch (MECHANIC_DISABLED).
 *
 * - `useFallingDamage`: whether the switch is on (`ruleSettings.get`, the subscription House rules shares).
 * - `FallButton`: the "Fall" pill on hover or keyboard focus of a PC's map token (`tokens-layer.tsx`), a sibling of the
 *   token button, never inside it (CL13), the Revive pill's look and place.
 * - `FallBox`: the modal "Fall or collision: <name>" with the book's four choices and their dice. A choice sends one
 *   keyed intent, `combatHazards.fall`, and closes; the hit then opens in the normal prompt (the PC's Armor Slot answer)
 *   and the feed. A refusal shows as a toast.
 */

export type FallTarget = { tokenId: Id<"combatTokens">; name: string };

/** The switch, for the GM's HUD; false while loading or off. */
export function useFallingDamage(campaignId: Id<"campaigns">, on: boolean): boolean {
  return useQuery(api.ruleSettings.get, on ? { campaignId } : "skip")?.modes.fallingDamage === true;
}

export function FallButton({ target, onOpen, style }: { target: FallTarget; onOpen: (target: FallTarget) => void; style?: CSSProperties }) {
  return (
    <button
      type="button"
      className={cn(hudButtonClass("cancel", "sm"), "hud-rv-btn hud-rv-tok hud-fall-tok")}
      style={style}
      aria-label={`Fall or collision: ${target.name}`}
      data-testid="hud-fall"
      // The map board pans on a pointer down it sees undisturbed (map-view/context.ts).
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => onOpen(target)}
    >
      Fall
    </button>
  );
}

/** What each choice says: "Close · 1d20+5 physical". */
export function fallChoiceText(kind: HazardKind): string {
  const h = HAZARDS[kind];
  return `${h.label} · ${hazardFormula(kind)} ${h.direct ? "direct " : ""}physical${h.deathAtDiscretion ? ", or death at your discretion" : ""}`;
}

/** Mount it to open it (the caller holds the target); it closes through `onClose` (Cancel, Escape, the backdrop, a choice). */
export function FallBox({ campaignId, target, onClose }: { campaignId: Id<"campaigns">; target: FallTarget; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const fall = useMutation(api.combatHazards.fall);
  // Opens as a modal on mount (DOM only, as the Revive box): focus trap, Escape and the backdrop from the browser.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function pick(kind: HazardKind) {
    onClose();
    fall({ campaignId, tokenId: target.tokenId, kind, idempotencyKey: crypto.randomUUID() }).catch((e: unknown) => hudToasts.refusal(refusalFor(e, { viewer: "gm" })));
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="hud-em hud-fall"
      data-testid="hud-fall-box"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      // The box may sit inside the map: its keys never reach the map's shortcuts and its pointer never starts a pan.
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="hud-em-k">Falling and collision · CB p.168</span>
      <h2 id={titleId}>Fall or collision: {target.name}</h2>
      <p className="hud-em-p">The app rolls the damage and hits {target.name} as usual (Armor Slot unless direct).</p>
      <ul className="hud-fall-list">
        {HAZARD_KINDS.map((kind) => (
          <li key={kind}>
            <button type="button" className={hudButtonClass("primary")} data-testid={`hud-fall-${kind}`} onClick={() => pick(kind)}>
              {fallChoiceText(kind)}
            </button>
          </li>
        ))}
      </ul>
      <div className="hud-em-f">
        <button type="button" className={hudButtonClass("cancel")} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
