import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, type ReactMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useState } from "react";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { applyCondition, applyMark } from "../../../../../src/lib/domain/encounters/damage";
import { applySpotlight } from "../../../../../src/lib/domain/encounters/spotlight";
import { api, type Id } from "../../convex";

import { newKey } from "./intent";
import type { EncounterInstance, EncounterView } from "./types";

export type Condition = EncounterInstance["conditions"][number];
export type FearReason = "interrupt" | "move" | "feature" | "experience";

/** The optimistic update, when the client supports one (the test harness's mutations are plain functions). */
export function withOptimistic<M extends FunctionReference<"mutation">>(
  mutation: ReactMutation<M>,
  update: (store: OptimisticLocalStore, args: FunctionArgs<M>) => void,
): ReactMutation<M> {
  if (!("withOptimisticUpdate" in mutation)) return mutation;
  return mutation.withOptimisticUpdate(update);
}

/**
 * The tracker's intents (D8 A4). HP, Stress, conditions, spotlight and End GM turn update `encounters.get` at once
 * with the same pure rules as the server; Spend Fear lowers `campaigns.fear` at once. Each call gets its own key.
 */
export function useTracker(campaignId: Id<"campaigns">, encounterId: string) {
  const [error, setError] = useState<string | null>(null);
  const viewArgs = { campaignId, encounterId };

  function patchInstance(store: OptimisticLocalStore, instanceId: string, change: (i: EncounterInstance, view: EncounterView) => EncounterInstance) {
    const view = store.getQuery(api.encounters.get, viewArgs);
    if (!view) return;
    store.setQuery(api.encounters.get, viewArgs, { ...view, instances: view.instances.map((i) => (i._id === instanceId ? change(i, view) : i)) });
  }

  const markHp = withOptimistic(useMutation(api.encounterTracking.markHp), (store, { instanceId, delta }) =>
    patchInstance(store, instanceId, (i) => applyMark(i, "hp", delta)),
  );
  const markStress = withOptimistic(useMutation(api.encounterTracking.markStress), (store, { instanceId, delta }) =>
    patchInstance(store, instanceId, (i) => applyMark(i, "stress", delta)),
  );
  const toggleCondition = withOptimistic(useMutation(api.encounterTracking.toggleCondition), (store, { instanceId, condition }) =>
    patchInstance(store, instanceId, (i) => applyCondition(i, condition)),
  );
  const spotlight = withOptimistic(useMutation(api.encounterTracking.spotlight), (store, { instanceId }) =>
    patchInstance(store, instanceId, (i, view) => applySpotlight(i, view.encounter.gmTurn)),
  );
  const endGmTurn = withOptimistic(useMutation(api.encounterTracking.endGmTurn), (store) => {
    const view = store.getQuery(api.encounters.get, viewArgs);
    if (!view) return;
    store.setQuery(api.encounters.get, viewArgs, { ...view, encounter: { ...view.encounter, gmTurn: view.encounter.gmTurn + 1 } });
  });
  const spendFear = withOptimistic(useMutation(api.encounterTracking.spendFear), (store, { amount }) => {
    const fear = store.getQuery(api.campaigns.fear, { campaignId });
    if (fear === undefined || fear < amount) return;
    store.setQuery(api.campaigns.fear, { campaignId }, fear - amount);
  });
  const applyDamage = useMutation(api.encounterTracking.applyDamage);
  const defeatMinions = useMutation(api.encounterTracking.defeatMinions);

  async function run<T>(call: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await call();
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    }
  }

  return {
    error,
    markHp: (instanceId: string, delta: number) => run(() => markHp({ campaignId, instanceId, delta, idempotencyKey: newKey() })),
    markStress: (instanceId: string, delta: number) => run(() => markStress({ campaignId, instanceId, delta, idempotencyKey: newKey() })),
    toggleCondition: (instanceId: string, condition: Condition) =>
      run(() => toggleCondition({ campaignId, instanceId, condition, idempotencyKey: newKey() })),
    spotlight: (instanceId: string) => run(() => spotlight({ campaignId, instanceId, idempotencyKey: newKey() })),
    endGmTurn: () => run(() => endGmTurn({ campaignId, encounterId, idempotencyKey: newKey() })),
    spendFear: (amount: number, reason: FearReason) => run(() => spendFear({ campaignId, encounterId, amount, reason, idempotencyKey: newKey() })),
    applyDamage: (instanceId: string, amount: number, resistant: boolean) =>
      run(() => applyDamage({ campaignId, instanceId, amount, resistant, idempotencyKey: newKey() })),
    defeatMinions: (instanceId: string, count: number) => run(() => defeatMinions({ campaignId, instanceId, count, idempotencyKey: newKey() })),
  };
}

export type TrackerActions = ReturnType<typeof useTracker>;
