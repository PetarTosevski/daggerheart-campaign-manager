import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Small read-only marks of the HUD (boards Main / CmpTokens / CmpCards): Tag (`.hs`), CostPill (`.pk-cost`), Pips
 * (`.pp`), Seal (`.bn-seal`), BandLabel (`.tg-l`), StatTile (`.sh-stats span`) and WaitingDots (`.q-dots`).
 */

/** The state tag above a hand card (HANDOFF hard rule 1: states live around the card face, never on it). */
export type TagKind = "play" | "no" | "used" | "limit" | "cost";

export function Tag({ kind, children, className }: { kind: TagKind; children: ReactNode; className?: string }) {
  return <span className={cn("hud-hs", `hud-hs-${kind}`, className)}>{children}</span>;
}

export type CostResource = "hope" | "stress" | "fear" | "hp" | "armor";

const COST_NOUN: Record<CostResource, [string, string]> = {
  hope: ["Hope", "Hope"],
  stress: ["Stress", "Stress"],
  fear: ["Fear", "Fear"],
  hp: ["Hit Point", "Hit Points"],
  armor: ["Armor Slot", "Armor Slots"],
};

/** Short glyphs beside the number (the boards' icons); the accessible name spells the cost out. */
const COST_GLYPH: Record<CostResource, string> = { hope: "★", stress: "✶", fear: "◆", hp: "♥", armor: "⛨" };

export function costLabel(amount: number, resource: CostResource): string {
  const [one, many] = COST_NOUN[resource];
  return `${amount} ${amount === 1 ? one : many}`;
}

/** A cost pill ("★1"): gold for Hope, purple for Fear, blue for Stress, red for HP, grey for Armor. */
export function CostPill({ amount, resource, className }: { amount: number; resource: CostResource; className?: string }) {
  return (
    <span className={cn("hud-cost", resource !== "hope" && `hud-cost-${resource}`, className)} role="img" aria-label={costLabel(amount, resource)}>
      <span aria-hidden="true">{COST_GLYPH[resource]}</span>
      <span aria-hidden="true">{amount}</span>
    </span>
  );
}

export type PipKind = "hp" | "stress" | "armor" | "hope" | "fear";

/**
 * A pip row: `on` of `max` filled. What "on" means is the caller's (answer 2: HP pips show HP left), and so is the
 * accessible `label` ("2 of 6 Hit Points marked"), which the row announces as one image.
 */
export function Pips({ kind, on, max, label, className }: { kind: PipKind; on: number; max: number; label: string; className?: string }) {
  const filled = Math.max(0, Math.min(on, max));
  return (
    <span className={cn("hud-pp", `hud-pp-${kind}`, className)} role="img" aria-label={label}>
      {Array.from({ length: Math.max(0, max) }, (_, i) => (
        <i key={i} className={i < filled ? "on" : undefined} />
      ))}
    </span>
  );
}

/** The Hope seal at a banner's tip: the number with a star; `empty` greys it at 0 ("Can't afford"). */
export function Seal({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <span className={cn("hud-seal", value === 0 && "hud-seal-empty", className)} role="img" aria-label={label}>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 0.8 7.5 4.3 11.2 4.6 8.4 7 9.3 10.7 6 8.7 2.7 10.7 3.6 7 0.8 4.6 4.5 4.3Z" fill="currentColor" />
      </svg>
      <b aria-hidden="true">{value}</b>
    </span>
  );
}

/** A target's range state (HANDOFF "Tokens" target ring states). */
export type BandState = "picked" | "in" | "out" | "los";

/** The band label above a target ring ("Far", "Very Far · GM", "No line of sight"). */
export function BandLabel({ state = "in", children, className }: { state?: BandState; children: ReactNode; className?: string }) {
  return <span className={cn("hud-band", state !== "in" && `hud-band-${state}`, className)}>{children}</span>;
}

/** A sheet stat tile: small label over a big Cinzel number (Evasion, Armor, thresholds). */
export function StatTile({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <span className={cn("hud-stat", className)}>
      <b>{value}</b>
      {label}
    </span>
  );
}

/** Three pulsing dots ("Asking the GM…"); decorative, the text beside them says what is pending. */
export function WaitingDots({ className }: { className?: string }) {
  return (
    <span className={cn("hud-dots", className)} aria-hidden="true" data-testid="hud-waiting-dots">
      <i />
      <i />
      <i />
    </span>
  );
}
