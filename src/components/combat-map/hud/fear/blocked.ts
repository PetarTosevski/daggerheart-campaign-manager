import { refusalForCode } from "@/lib/errors/refusals";

import { blockedReason, type Blocked } from "../blocked";

/**
 * The GM's Fear shortfall before the click (plan combat-hud H6.3; CmpBlocked NOT_ENOUGH_FEAR, "Fear cost disabled"):
 * every GM control with a Fear cost (Spotlight · 1 Fear, End · n Fear, a Fear feature, an Experience, FearConfirm's
 * Spend) reads its reason here, so they all say the board's "This needs 2 Fear. You have 1." Words from H6.1's refusal
 * table (refusals.ts), numbers from the shortfall helper; null when the GM can pay or the Fear is not known yet.
 */
export function fearBlocked(need: number, fear: number | null | undefined): Blocked | null {
  if (need <= 0 || typeof fear !== "number" || fear >= need) return null;
  const blocked = blockedReason({ kind: "fear", viewer: "gm", shortfall: [{ resource: "fear", need, have: fear, payer: "gm" }] });
  // The board's GM row says the full sentence beside the control, not layer 1's short "Needs 2 Fear · you have 1".
  return blocked && { ...blocked, text: blocked.refusal.text };
}

/** The sentence a blocked Fear control shows ("This needs 2 Fear. You have 1."), or null. */
export function fearShortText(need: number, fear: number | null | undefined): string | null {
  return fearBlocked(need, fear)?.text ?? null;
}

/**
 * An adversary action the GM can't spotlight (CmpBlocked SPOTLIGHT_FIRST*, real code ADVERSARY_NOT_SPOTLIT, "attack
 * disabled"): the action needs the spotlight (CB p.194), the adversary doesn't hold it this GM turn and spotlighting it
 * costs Fear the GM doesn't have (`spotFear` > `fear`). "Spotlight the Lieutenant first." with the hint "Spotlighting
 * costs 1 Fear." Null when the action's own spotlight is free or affordable (the server then asks FearConfirm).
 */
export function spotlightFirst(adversary: string, spotFear: number, fear: number | null | undefined): Blocked | null {
  if (spotFear <= 0 || typeof fear !== "number" || fear >= spotFear) return null;
  const refusal = refusalForCode("ADVERSARY_NOT_SPOTLIT", { adversary, viewer: "gm" });
  return { code: "ADVERSARY_NOT_SPOTLIT", text: refusal.text, tag: refusal.lead, refusal };
}

/**
 * Why a Fear-costing adversary action is blocked: its own spotlight first (when even that can't be paid), then the whole
 * cost (`cost` + `spotFear`) against the GM's Fear.
 */
export function adversaryActBlocked(adversary: string, cost: number, spotFear: number, fear: number | null | undefined): Blocked | null {
  return spotlightFirst(adversary, spotFear, fear) ?? fearBlocked(cost + spotFear, fear);
}
