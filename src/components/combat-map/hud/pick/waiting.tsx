"use client";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { refusalFor, type Refusal } from "@/lib/errors/refusals";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActor } from "../../actions/targets";
import type { CombatPageState } from "../../slots";
import { RefusalMessage, hudToasts } from "../blocked";
import { Popup, WaitingDots } from "../ui";
import { waitingReason, waitingUses } from "./model";

/**
 * "Waiting for the GM" (plan combat-hud H3.0; CmpPromptsPlayer `.pc.wait`; answer 8a): one card per use of the player's
 * that went out of range and waits on the GM's approval (an attack, a card or a feature: `combatRequests.mine`
 * sanctions, `combatCards.pending`, `combatFeatures.pending`). Nothing was rolled or paid. Withdraw sends
 * `combatWithdraw.withdraw` (HD3) and drops the card at once (optimistic update on the three reads); the GM's queue
 * item disappears with it. The cards come from the server's open requests, so a reload keeps them and the GM's
 * answer (Allow / Decline) removes them live.
 */

const HOURGLASS = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M5 1h6l-1 4.5 3.5 9.5h-11L6 5.5z" opacity=".35" />
    <circle cx="8" cy="3" r="2" />
  </svg>
);

/** Drops a withdrawn request from the three open-request reads (HD3: they drop it on the server too). */
export function dropWithdrawn(store: OptimisticLocalStore, campaignId: Id<"campaigns">, requestId: Id<"combatRequests">): void {
  const mine = store.getQuery(api.combatRequests.mine, { campaignId });
  if (mine !== undefined) store.setQuery(api.combatRequests.mine, { campaignId }, mine.filter((r) => r.requestId !== requestId));
  const cards = store.getQuery(api.combatCards.pending, { campaignId });
  if (cards !== undefined) store.setQuery(api.combatCards.pending, { campaignId }, cards.filter((r) => r.requestId !== requestId));
  const features = store.getQuery(api.combatFeatures.pending, { campaignId });
  if (features !== undefined) store.setQuery(api.combatFeatures.pending, { campaignId }, features.filter((r) => r.requestId !== requestId));
}

export function PickWaiting({ state }: { state: CombatPageState }) {
  if (state.role !== "player") return null;
  return <PlayerWaiting state={state} />;
}

function PlayerWaiting({ state }: { state: CombatPageState }) {
  const { campaignId } = state;
  const actor = useActor(state);
  const attacks = useQuery(api.combatRequests.mine, { campaignId });
  const cards = useQuery(api.combatCards.pending, { campaignId });
  const features = useQuery(api.combatFeatures.pending, { campaignId });
  const withdraw = useMutation(api.combatWithdraw.withdraw).withOptimisticUpdate((store, args) => dropWithdrawn(store, args.campaignId, args.requestId));
  const [errors, setErrors] = useState<Readonly<Record<string, Refusal>>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const sanctions = attacks?.flatMap((a) => (a.kind === "sanction" ? [a] : []));
  const rows = waitingUses({ attacks: sanctions, cards, features, characterId: actor?.characterId ?? null });
  if (rows.length === 0) return null;

  async function onWithdraw(requestId: Id<"combatRequests">, use: string) {
    setBusy((b) => new Set(b).add(requestId));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== requestId)));
    try {
      await withdraw({ campaignId, requestId, idempotencyKey: crypto.randomUUID() });
    } catch (error) {
      // H6.2: the table's words; an answered request ("Already answered") is a toast, the card goes with the refresh.
      const refusal = refusalFor(error, { subject: use });
      if (refusal.place === "toast") hudToasts.refusal(refusal);
      else setErrors((e) => ({ ...e, [requestId]: refusal }));
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(requestId);
        return next;
      });
    }
  }

  return (
    <ul className="hud-pk-wait" aria-label="Waiting for the GM" data-testid="hud-pick-waiting">
      {rows.map((w) => (
        <li key={w.requestId}>
          <Popup
            icon={HOURGLASS}
            tone="wait"
            title="Waiting for the GM"
            sub={`${w.use} · out of range`}
            testId="hud-pick-wait"
            primary={{
              label: "Withdraw",
              ariaLabel: `Withdraw ${w.use}`,
              disabled: busy.has(w.requestId),
              onClick: () => void onWithdraw(w.requestId, w.use),
            }}
          >
            <p>{waitingReason(w)} Nothing is rolled or paid until the GM decides.</p>
            <p className="hud-pk-asking">
              <WaitingDots />
              Asking the GM…
            </p>
            <RefusalMessage refusal={errors[w.requestId] ?? null} />
          </Popup>
        </li>
      ))}
    </ul>
  );
}
