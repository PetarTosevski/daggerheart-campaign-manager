// Countdowns that tick on rests (plan rest-ticks, RT1; bead dcm-674k). Pure and framework-free: the server's rest path
// (convex/rests.ts, convex/countdownTracks.ts) and the clients share these types and maths.
//
// User decisions 2026-11-12: every dashboard countdown type may tick on a FINISHED long rest (`onLongRest`) and on a
// short rest (`onShortRest`), each by a fixed number, the PCs who took part, a die, or a die plus those PCs, set to
// Automatic (ticks by itself) or Reminder (the GM gets "Tick X?" with the amount already rolled). An interrupted long
// rest does not count as a long rest: it fires the short-rest setting (Q1). The feed row of a tick is public only for a
// Public countdown (no hidden field); Private and Partly hidden countdowns tick in GM-only rows.
//
// Core Book p.164 (long-term countdowns): "During a long rest, you should generally tick down a relevant long-term
// countdown once." Before this plan a long-term countdown's `armed` + `restMode` meant exactly that; `restTicksOf` keeps
// reading those rows as "On long rest: 1, Automatic / Reminder" until the migration moved them (rule 7).
//
// ```ts
// restTickAmount({ kind: "diePlusPcs", sides: 6 }, 2, () => 3); // { amount: 5, pcs: 2, die: { sides: 6, rolled: 3 } }
// restTickText({ amount: 5, pcs: 2, die: { sides: 6, rolled: 3 } }); // "5 (1d6 3 + 2 PCs)"
// ```

import { COUNTDOWN_DICE_SIDES, type CountdownDiceSides, type CountdownMode, type CountdownRestMode } from "./advanced";
import { MAX_COUNTDOWN_START, type CountdownVisibility } from "./index";

/** The four ways a rest setting counts its ticks. */
export const REST_TICK_KINDS = ["fixed", "pcs", "die", "diePlusPcs"] as const;
export type RestTickKind = (typeof REST_TICK_KINDS)[number];

/** The dice a rest setting may roll (the randomized start's dice, R5). */
export const REST_TICK_DICE_SIDES = COUNTDOWN_DICE_SIDES;

/** A fixed amount is 1..this. */
export const MAX_REST_TICK_FIXED = MAX_COUNTDOWN_START;

/** How much a rest ticks a countdown. */
export type RestTickAmount =
  | { kind: "fixed"; n: number }
  | { kind: "pcs" }
  | { kind: "die"; sides: CountdownDiceSides }
  | { kind: "diePlusPcs"; sides: CountdownDiceSides };

/** One rest setting: the amount and Automatic ("auto") or Reminder ("remind"). */
export type RestTick = { amount: RestTickAmount; mode: CountdownRestMode };

/** Which setting a rest uses. */
export type RestTickRest = "long" | "short";

/** A countdown's effective settings; null = off. */
export type RestTickSettings = { long: RestTick | null; short: RestTick | null };

/** The stored fields `restTicksOf` reads (new fields, plus the legacy long-term `armed` / `restMode`). */
export type RestTickRow = {
  mode?: CountdownMode;
  armed?: boolean;
  restMode?: CountdownRestMode;
  onLongRest?: RestTick;
  onShortRest?: RestTick;
};

/** The legacy long-term setting: once per finished long rest. */
export const LEGACY_LONG_TERM_AMOUNT: RestTickAmount = { kind: "fixed", n: 1 };

/**
 * The effective settings of a countdown: the new fields when set, else (long rests only) the legacy long-term mapping:
 * a long-term row with `armed: true` ticks 1 per finished long rest, Automatic or Reminder by `restMode` (absent =
 * Automatic); unarmed = off. Narrow step (follow-up): the legacy branch goes once the migration ran everywhere.
 */
export function restTicksOf(row: RestTickRow): RestTickSettings {
  const legacy: RestTick | null =
    row.mode === "longTerm" && row.armed === true ? { amount: LEGACY_LONG_TERM_AMOUNT, mode: row.restMode ?? "auto" } : null;
  return { long: row.onLongRest ?? legacy, short: row.onShortRest ?? null };
}

/**
 * Which setting an ended rest fires: a finished long rest the long-rest one; a finished short rest and an interrupted
 * long rest (short-rest benefits, CB 105; Q1) the short-rest one; an interrupted short rest (or an open rest) none.
 */
export function restTickRestFor(rest: { kind: "short" | "long"; status: "open" | "finished" | "interrupted" }): RestTickRest | null {
  if (rest.status === "finished") return rest.kind;
  if (rest.status === "interrupted" && rest.kind === "long") return "short";
  return null;
}

/** A computed amount with what it came from: the PCs counted and the die rolled. */
export type RestTickResult = { amount: number; pcs?: number; die?: { sides: number; rolled: number } };

/**
 * The ticks a setting gives for a rest of `pcs` resting PCs, rolling with `rng` (the server's `rollDie`). 0 PCs gives 0
 * for "pcs" and the die alone for "diePlusPcs". An amount of 0 ticks nothing (applyTick's contract).
 */
export function restTickAmount(amount: RestTickAmount, pcs: number, rng: (sides: number) => number): RestTickResult {
  const party = Math.max(0, Math.floor(pcs));
  switch (amount.kind) {
    case "fixed":
      return { amount: amount.n };
    case "pcs":
      return { amount: party, pcs: party };
    case "die": {
      const rolled = rng(amount.sides);
      return { amount: rolled, die: { sides: amount.sides, rolled } };
    }
    case "diePlusPcs": {
      const rolled = rng(amount.sides);
      return { amount: rolled + party, pcs: party, die: { sides: amount.sides, rolled } };
    }
  }
}

const pcsText = (n: number) => `${n} ${n === 1 ? "PC" : "PCs"}`;

/** What the amount came from ("1d6 3 + 2 PCs", "2 PCs", "1d6 3"), or null for a fixed amount. */
export function restTickRollText(result: RestTickResult): string | null {
  const parts = [
    ...(result.die !== undefined ? [`1d${result.die.sides} ${result.die.rolled}`] : []),
    ...(result.pcs !== undefined ? [pcsText(result.pcs)] : []),
  ];
  return parts.length === 0 ? null : parts.join(" + ");
}

/** The amount for the feed: "5 (1d6 3 + 2 PCs)", "2 (2 PCs)", "3 (1d6 3)", or just "1" for a fixed amount. */
export function restTickText(result: RestTickResult): string {
  const roll = restTickRollText(result);
  return roll === null ? `${result.amount}` : `${result.amount} (${roll})`;
}

/** Who sees a rest tick's roll and feed row: everyone for a Public countdown, else the GM only (Private, Partly hidden). */
export function restTickFeedAudience(visibility: CountdownVisibility | undefined): "public" | "gm" {
  if (visibility === undefined) return "public";
  return visibility.mode === "public" && visibility.hidden.length === 0 ? "public" : "gm";
}

/** The setting's label for the GM ("Fixed 2", "PCs who rested", "d6", "d6 + PCs who rested"). */
export function restTickAmountLabel(amount: RestTickAmount): string {
  switch (amount.kind) {
    case "fixed":
      return `Fixed ${amount.n}`;
    case "pcs":
      return "PCs who rested";
    case "die":
      return `d${amount.sides}`;
    case "diePlusPcs":
      return `d${amount.sides} + PCs who rested`;
  }
}
