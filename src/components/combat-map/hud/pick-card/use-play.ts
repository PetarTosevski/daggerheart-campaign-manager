"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { DialogRequest } from "../../actions/hand/dialog";
import type { CardChoice, NeedsChoice, UseOutcome } from "../../actions/hand/model";

/**
 * The HUD's card writes (plan combat-hud H3.1): one `combatCards.useCard` per click with a fresh idempotency key (rule
 * 12), as the classic `useCardActions`, except that `send` lets a refusal throw, so the picking panel shows it under its
 * primary (CmpBlocked layer 2; H3.0 `PickOutcome`). `trySend` keeps the refusal as `error` for the paths without a panel
 * (a card that asks nothing, the after-the-roll answer). A `needsChoice` answer is kept as `waiting` until answered.
 */

type Waiting = { request: DialogRequest; asks: NeedsChoice["asks"] };

export function useCardPlay({ campaignId, mapId, characterId }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; characterId: Id<"characters"> }) {
  const run = useMutation(api.combatCards.useCard);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);

  /** Sends the use; a refusal throws (the panel shows it). */
  async function send(request: DialogRequest): Promise<UseOutcome | null> {
    setError(null);
    setPending(true);
    try {
      const out: UseOutcome | null = await run({ campaignId, characterId, mapId, ...request, idempotencyKey: crypto.randomUUID() });
      setWaiting(out?.status === "needsChoice" ? { request, asks: out.asks } : null);
      return out;
    } finally {
      setPending(false);
    }
  }

  /** Sends the use; a refusal becomes `error` (undefined back). */
  async function trySend(request: DialogRequest): Promise<UseOutcome | null | undefined> {
    try {
      return await send(request);
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    }
  }

  /** Resubmits the waiting use with the after-the-roll answers. */
  async function answer(extra: CardChoice[]): Promise<{ request: DialogRequest; out: UseOutcome | null | undefined } | undefined> {
    if (!waiting) return undefined;
    const ids = new Set(extra.map((c) => c.id));
    const request = { ...waiting.request, choices: [...waiting.request.choices.filter((c) => !ids.has(c.id)), ...extra] };
    return { request, out: await trySend(request) };
  }

  return { send, trySend, answer, waiting, cancelWaiting: () => setWaiting(null), pending, error, clearError: () => setError(null) };
}

export type CardPlay = ReturnType<typeof useCardPlay>;
