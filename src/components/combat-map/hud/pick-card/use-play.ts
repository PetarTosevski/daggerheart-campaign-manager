"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { refusalFor, type Refusal, type RefusalContext } from "@/lib/errors/refusals";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { DialogRequest } from "../../actions/hand/dialog";
import type { CardChoice, NeedsChoice, UseOutcome } from "../../actions/hand/model";
import { hudToasts } from "../toasts/store";

/**
 * The HUD's card writes (plan combat-hud H3.1): one `combatCards.useCard` per click with a fresh idempotency key (rule
 * 12), as the classic `useCardActions`, except that `send` lets a refusal throw, so the picking panel shows it under its
 * primary (CmpBlocked layer 2; H3.0 `PickOutcome`). `trySend` keeps the refusal as `refusal` (H6.2: the refusal table's
 * words, `refusalFor`) for the paths without a panel (a card that asks nothing, the after-the-roll answer); one the table
 * places in a toast goes to the toast host instead. A `needsChoice` answer is kept as `waiting` until answered.
 */

type Waiting = { request: DialogRequest; asks: NeedsChoice["asks"] };

export function useCardPlay({ campaignId, mapId, characterId }: { campaignId: Id<"campaigns">; mapId: Id<"combatMaps">; characterId: Id<"characters"> }) {
  const run = useMutation(api.combatCards.useCard);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);

  /** Sends the use; a refusal throws (the panel shows it). */
  async function send(request: DialogRequest): Promise<UseOutcome | null> {
    setRefusal(null);
    setPending(true);
    try {
      const out: UseOutcome | null = await run({ campaignId, characterId, mapId, ...request, idempotencyKey: crypto.randomUUID() });
      setWaiting(out?.status === "needsChoice" ? { request, asks: out.asks } : null);
      return out;
    } finally {
      setPending(false);
    }
  }

  /** Sends the use; a refusal becomes `refusal` (or a toast), undefined back. `ctx` names the card ("Wall Walk"). */
  async function trySend(request: DialogRequest, ctx: RefusalContext = {}): Promise<UseOutcome | null | undefined> {
    try {
      return await send(request);
    } catch (e) {
      const resolved = refusalFor(e, ctx);
      if (resolved.place === "toast") hudToasts.refusal(resolved);
      else setRefusal(resolved);
      return undefined;
    }
  }

  /** Resubmits the waiting use with the after-the-roll answers. */
  async function answer(extra: CardChoice[], ctx: RefusalContext = {}): Promise<{ request: DialogRequest; out: UseOutcome | null | undefined } | undefined> {
    if (!waiting) return undefined;
    const ids = new Set(extra.map((c) => c.id));
    const request = { ...waiting.request, choices: [...waiting.request.choices.filter((c) => !ids.has(c.id)), ...extra] };
    return { request, out: await trySend(request, ctx) };
  }

  return { send, trySend, answer, waiting, cancelWaiting: () => setWaiting(null), pending, refusal, clearError: () => setRefusal(null) };
}

export type CardPlay = ReturnType<typeof useCardPlay>;
