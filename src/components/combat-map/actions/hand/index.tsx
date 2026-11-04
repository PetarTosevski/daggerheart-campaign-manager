import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The Hand on the Combat Map (plan combat-actions CA6, hand-fan HF1). The HUD's hand (plan combat-hud H2.3,
 * `hud/hand`) shows it now; the classic column card, docked fan, GM hand and Use dialog went with the cut-over (H8.1).
 * What stays here is shared with the HUD: the "Hide cards" key below, and beside it the card face (`face.tsx`), the
 * model (`model.ts`), the card writes (`use-card.ts`), the card result (`result.tsx`), the vault deck (`dock.tsx`), the
 * card-use helpers (`dialog.tsx`) and hand sharing (`sharing.tsx`).
 */

/** localStorage key of the "Hide cards" choice: per campaign and character, in this browser only (HF1). */
export const handHiddenKey = (campaignId: Id<"campaigns">, characterId: Id<"characters">) => `dh.combat.handHidden:${campaignId}:${characterId}`;
