"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { FearConfirm } from "./model";

type AttackArgs = Omit<FunctionArgs<typeof api.adversaryActions.attack>, "campaignId" | "idempotencyKey">;
type FeatureArgs = Omit<FunctionArgs<typeof api.adversaryActions.useFeature>, "campaignId" | "idempotencyKey">;
export type Resolved = Extract<FunctionReturnType<typeof api.adversaryActions.attack>, { status: "resolved" }>;

/** One GM intent: the standard attack or a feature use, with what the panel shows about it. */
export type Intent = ({ kind: "attack"; args: AttackArgs } | { kind: "feature"; args: FeatureArgs }) & { label: string; actor: string };

/** The result the panel shows, with the label of the action that made it ("Bear attacks", "Bear uses Bite"). */
export type ActionResult = { label: string; actor: string; instanceId: string; result: Resolved };

/**
 * The Encounter tab's adversary actions (AA2's server API): `fire` sends one attack or feature use; when the server
 * answers `confirmFear` (Q19: Fear only on the GM's tap) nothing was rolled or written, the question is kept in
 * `confirm`, and `spend` sends the same intent again with `spendFear`. Fear spent lowers `campaigns.fear` at once
 * (optimistic, CL4). Each call gets its own idempotency key.
 */
export function useAdversaryActions(campaignId: Id<"campaigns">) {
  const [confirm, setConfirm] = useState<{ intent: Intent; fear: FearConfirm } | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function lowerFear(store: OptimisticLocalStore, spendFear: number | undefined) {
    if (!spendFear) return;
    const fear = store.getQuery(api.campaigns.fear, { campaignId });
    if (fear === undefined || fear < spendFear) return;
    store.setQuery(api.campaigns.fear, { campaignId }, fear - spendFear);
  }
  const attack = useMutation(api.adversaryActions.attack).withOptimisticUpdate((store, args) => lowerFear(store, args.spendFear));
  const featureUse = useMutation(api.adversaryActions.useFeature).withOptimisticUpdate((store, args) => lowerFear(store, args.spendFear));
  const resolveHit = useMutation(api.adversaryActions.resolve);

  async function send(intent: Intent, spendFear?: number) {
    setError(null);
    setPending(true);
    try {
      const base = { campaignId, idempotencyKey: crypto.randomUUID(), ...(spendFear ? { spendFear } : {}) };
      const answer = intent.kind === "attack" ? await attack({ ...intent.args, ...base }) : await featureUse({ ...intent.args, ...base });
      if (answer.status === "confirmFear") {
        setConfirm({ intent, fear: { fear: answer.fear, spotlight: answer.spotlight, feature: answer.feature, experience: answer.experience } });
        return null;
      }
      setConfirm(null);
      setResult({ label: intent.label, actor: intent.actor, instanceId: intent.args.instanceId, result: answer });
      return answer;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setPending(false);
    }
  }

  return {
    confirm,
    result,
    error,
    pending,
    fire: (intent: Intent) => send(intent),
    /** The GM taps "Spend N Fear" on the question: the same intent again, paying it. */
    spend: () => (confirm ? send(confirm.intent, confirm.fear.fear) : Promise.resolve(null)),
    cancel: () => setConfirm(null),
    dismiss: () => setResult(null),
    /** The GM's "Resolve now" on an open reaction window (Q17). */
    resolve: async (requestId: Id<"combatRequests">) => {
      setError(null);
      try {
        return await resolveHit({ campaignId, requestId, idempotencyKey: crypto.randomUUID() });
      } catch (e) {
        setError(errorMessage(e));
        return null;
      }
    },
  };
}

export type AdversaryActions = ReturnType<typeof useAdversaryActions>;
