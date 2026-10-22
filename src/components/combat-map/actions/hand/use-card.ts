"use client";

import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CardChoice, HandView, NeedsChoice, UseOutcome } from "./model";

/**
 * The Hand's writes (plan combat-actions CA6): one `combatCards.useCard` per click (a fresh idempotency key through
 * `useIntent`, rule 12) and `characters.moveCard` for a recall, with an optimistic update on the Hand.
 *
 * Choices after the roll live here and only here: CA4's server answers a use that still needs a `choose` option or a
 * damage split with `needsChoice` (nothing written); `answer` resubmits the same use with those choices added. When
 * CA4b makes the second call reuse the stored dice (keyed by the request), only `answer` changes.
 */

export type UseRequest = {
  cardId: string;
  spell?: string;
  targetTokenIds: Id<"combatTokens">[];
  choices: CardChoice[];
  roll?: FunctionArgs<typeof api.combatCards.useCard>["roll"];
};

type Waiting = { request: UseRequest; asks: NeedsChoice["asks"] };

export function useCardActions({ campaignId, mapId, characterId }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; characterId: Id<"characters"> }) {
  const intent = useIntent(api.combatCards.useCard);
  const [waiting, setWaiting] = useState<Waiting | null>(null);

  async function submit(request: UseRequest): Promise<UseOutcome | undefined> {
    const out = await intent.fire({ campaignId, characterId, mapId, ...request });
    setWaiting(out?.status === "needsChoice" ? { request, asks: out.asks } : null);
    return out;
  }

  /** Resubmits the waiting use with the after-the-roll answers. */
  async function answer(extra: CardChoice[]): Promise<UseOutcome | undefined> {
    if (!waiting) return undefined;
    const ids = new Set(extra.map((c) => c.id));
    return submit({ ...waiting.request, choices: [...waiting.request.choices.filter((c) => !ids.has(c.id)), ...extra] });
  }

  return {
    submit,
    answer,
    waiting,
    cancelWaiting: () => setWaiting(null),
    pending: intent.pending,
    error: intent.error,
    clearError: intent.clearError,
  };
}

export type CardActions = ReturnType<typeof useCardActions>;

/** Moves a vault card into the loadout (rule 12: the Hand shows it there at once; a refusal puts it back). */
export function useRecall({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> }) {
  const move = useMutation(api.characters.moveCard).withOptimisticUpdate((store, { cardId, to }) => {
    const hand: HandView | undefined = store.getQuery(api.combatCards.hand, { campaignId, characterId });
    if (hand === undefined || to !== "loadout") return;
    const card = hand.vault.find((c) => c.cardId === cardId);
    if (!card) return;
    store.setQuery(api.combatCards.hand, { campaignId, characterId }, {
      ...hand,
      loadout: [...hand.loadout, { ...card, place: "loadout" }],
      vault: hand.vault.filter((c) => c.cardId !== cardId),
    });
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function recall(cardId: string, duringRest: boolean) {
    setError(null);
    setPending(cardId);
    try {
      await move({ characterId, cardId, to: "loadout", duringRest });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(null);
    }
  }

  return { recall, error, pending };
}
