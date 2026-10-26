import { cardAvailability } from "@/lib/domain/card-effects/availability";
import { cardEffect } from "@/lib/srd/card-effects";
import type { FeatureUse } from "@/lib/validation/characters";

// A grimoire's used spells (plan followups-6, tracer G3; bead dcm-bxp.99.20). A grimoire whose one spell is used
// (featureUses `card:<id>:<useId>`, written on the map by CA4) stays ready, as CA7 built, but lists that spell:
// "Used: Arcane Barrage - back after a rest". Only the card's own key (`card:<id>`) greys the whole card.
//
// ```ts
// usedSpellLines({ featureUses: [{ key: "card:book-of-illiat:arcane-barrage", until: "rest" }] }, "book-of-illiat");
// // ["Used: Arcane Barrage - back after a rest"]
// ```

/**
 * One line per used spell of a card, in the card's printed order: `Used: <spell> - <reset label>`. A spell with
 * `times: n` is used once all n uses are spent; a per-target limit counts only its untargeted key.
 */
export function usedSpellLines(sheet: { readonly featureUses?: readonly FeatureUse[] }, cardId: string): string[] {
  const uses = cardEffect(cardId)?.uses ?? [];
  const lines: string[] = [];
  for (const use of uses) {
    if (use.id === "main") continue;
    const limit = use.limit ? { ...use.limit, perTarget: false } : undefined;
    const state = cardAvailability(sheet, cardId, { useId: use.id, limit });
    if (state.state === "exhausted") lines.push(`Used: ${use.name} - ${state.label.charAt(0).toLowerCase()}${state.label.slice(1)}`);
  }
  return lines;
}
