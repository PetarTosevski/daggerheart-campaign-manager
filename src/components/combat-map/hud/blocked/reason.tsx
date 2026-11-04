"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { shortfallOf, type PayerRoom, type Shortfall } from "@/lib/domain/combat-actions/shortfall";
import type { Cost } from "@/lib/domain/card-effects/types";
import { beforeText, refusalForCode, type ClientRefusalCode, type Refusal, type RefusalCode, type RefusalContext } from "@/lib/errors/refusals";

/**
 * Layer 1 of the blocked-state system (board CmpBlocked "Before the click: known costs and limits disable the control
 * and say why, right beside it"). `blockedReason` decides why a control is blocked from what the client knows;
 * `useBlocked` wires the control's ARIA; `BlockedReason` and `BlockedTag` draw the board's `.why` and `.hs-no`.
 */

/** Why a control can't be used yet, as the table words it. */
export type Blocked = {
  code: RefusalCode | ClientRefusalCode;
  /** Beside the control ("Needs 3 Hope · you have 1", "Used · back after a rest"). */
  text: string;
  /** The short tag form on a card ("Needs 1 Hope"). */
  tag: string;
  /** The full refusal (title, sentence, hint) for a tooltip or a press anyway. */
  refusal: Refusal;
};

export type BlockedInput = RefusalContext & {
  /** The GM holds the spotlight (`combatSpotlight.state.reactionsOnly`, H1.S): only reactions are allowed. */
  spotlightWithGm?: boolean;
  /** This control is a reaction (stays enabled while the GM holds the spotlight; answer 1c). */
  reaction?: boolean;
  /** The use is spent (`ready: false`): a card ("CARD_EXHAUSTED") or a feature ("FEATURE_EXHAUSTED"). */
  used?: "card" | "feature" | null;
  /** The use's costs and what the payer can still give: pre-computes the shortfall (shortfall.ts `shortfallOf`). */
  costs?: readonly Cost[];
  room?: PayerRoom;
  /** The card or the feature (cost codes): "card" → CARD_COST_UNPAID, "feature" → FEATURE_COST_UNPAID, "fear" → NOT_ENOUGH_FEAR. */
  kind?: "card" | "feature" | "fear";
};

/**
 * The before-the-click reason for a control, or null when nothing the client knows blocks it. Order: the spotlight
 * (non-reactions), used up, then a cost the payer can't cover (`shortfall` given, else `costs` against `room`). Other
 * refusals (targets, sight, reach) come from the target rings and the server.
 */
export function blockedReason(input: BlockedInput): Blocked | null {
  const make = (code: RefusalCode | ClientRefusalCode, ctx: RefusalContext): Blocked => ({
    code,
    text: beforeText(code, ctx),
    tag: beforeText(code, { ...ctx, tag: true }),
    refusal: refusalForCode(code, ctx),
  });
  if (input.spotlightWithGm && !input.reaction) return make("SPOTLIGHT_WITH_GM", input);
  if (input.used) return make(input.used === "card" ? "CARD_EXHAUSTED" : "FEATURE_EXHAUSTED", input);
  const shortfall: readonly Shortfall[] = input.shortfall?.length ? input.shortfall : input.room ? shortfallOf(input.costs, input.room) : [];
  if (shortfall.length === 0) return null;
  const code = input.kind === "fear" || shortfall[0]!.resource === "fear" ? "NOT_ENOUGH_FEAR" : input.kind === "feature" ? "FEATURE_COST_UNPAID" : "CARD_COST_UNPAID";
  return make(code, { ...input, shortfall });
}

/**
 * The ARIA a blocked control needs: `aria-disabled` (it stays focusable, so the reason can be read and the tip shown)
 * and `aria-describedby` pointing at its reason. Spread `control` on the button and give `reasonId` to `BlockedReason`.
 * A blocked control's click must do nothing: guard the handler with `blocked`.
 */
export function useBlocked(reason: Blocked | string | null) {
  const reasonId = useId();
  const text = typeof reason === "string" ? reason : (reason?.text ?? null);
  const blocked = text !== null;
  return {
    blocked,
    text,
    reasonId,
    control: blocked ? ({ "aria-disabled": true, "aria-describedby": reasonId } as const) : ({} as const),
  };
}

const Lock = () => (
  <svg className="hud-ic" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
    <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** The reason beside a disabled control (board `.why`: lock + "Needs 3 Hope · you have 1"). Renders nothing for null. */
export function BlockedReason({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <span id={id} className={cn("hud-why", className)}>
      <Lock />
      {children}
    </span>
  );
}

/** The lock tag above a card or beside a feature (board `.hs.hs-no`: lock + "Needs 1 Hope"). */
export function BlockedTag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("hud-hs", "hud-hs-no", "hud-blocked-tag", className)}>
      <Lock />
      {children}
    </span>
  );
}
