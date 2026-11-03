import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "../../../../../../src/lib/convex-errors";
import { api, type Id } from "../../../convex";
import { withOptimistic } from "../../adversaries/use-tracker";

import { newKey } from "../../adversaries/intent";

type AttackArgs = Omit<FunctionArgs<typeof api.adversaryActions.attack>, "campaignId" | "idempotencyKey">;
type FeatureArgs = Omit<FunctionArgs<typeof api.adversaryActions.useFeature>, "campaignId" | "idempotencyKey">;
export type Resolved = Extract<FunctionReturnType<typeof api.adversaryActions.attack>, { status: "resolved" }>;

export type FearConfirm = {
  fear: number;
  spotlight: number;
  feature: number;
  experience: number;
};

export type Intent = ({ kind: "attack"; args: AttackArgs } | { kind: "feature"; args: FeatureArgs }) & {
  label: string;
  actor: string;
};

function lowerFear(store: OptimisticLocalStore, campaignId: Id<"campaigns">, spendFear: number | undefined) {
  if (!spendFear) return;
  const fear = store.getQuery(api.campaigns.fear, { campaignId });
  if (fear === undefined || fear < spendFear) return;
  store.setQuery(api.campaigns.fear, { campaignId }, fear - spendFear);
}

/** Same intents as the website combat map adversary panel (`useAdversaryActions`). */
export function useAdversaryActions(campaignId: Id<"campaigns">) {
  const [confirm, setConfirm] = useState<{ intent: Intent; fear: FearConfirm } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const attack = withOptimistic(useMutation(api.adversaryActions.attack), (store, args) =>
    lowerFear(store, campaignId, args.spendFear),
  );
  const featureUse = withOptimistic(useMutation(api.adversaryActions.useFeature), (store, args) =>
    lowerFear(store, campaignId, args.spendFear),
  );
  const resolveHit = useMutation(api.adversaryActions.resolve);

  async function send(intent: Intent, spendFear?: number) {
    setError(null);
    setPending(true);
    try {
      const base = { campaignId, idempotencyKey: newKey(), ...(spendFear ? { spendFear } : {}) };
      const answer =
        intent.kind === "attack"
          ? await attack({ ...intent.args, ...base })
          : await featureUse({ ...intent.args, ...base });
      if (answer.status === "confirmFear") {
        setConfirm({
          intent,
          fear: {
            fear: answer.fear,
            spotlight: answer.spotlight,
            feature: answer.feature,
            experience: answer.experience,
          },
        });
        return null;
      }
      setConfirm(null);
      return answer;
    } catch (caught) {
      setError(errorMessage(caught));
      return null;
    } finally {
      setPending(false);
    }
  }

  return {
    confirm,
    error,
    pending,
    fire: (intent: Intent) => send(intent),
    spend: () => (confirm ? send(confirm.intent, confirm.fear.fear) : Promise.resolve(null)),
    cancel: () => setConfirm(null),
    resolve: async (requestId: Id<"combatRequests">) => {
      setError(null);
      try {
        return await resolveHit({ campaignId, requestId, idempotencyKey: newKey() });
      } catch (caught) {
        setError(errorMessage(caught));
        return null;
      }
    },
  };
}

export type AdversaryActions = ReturnType<typeof useAdversaryActions>;
