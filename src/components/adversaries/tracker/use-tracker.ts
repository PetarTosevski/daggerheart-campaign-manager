"use client";

import { useMutation } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { applyCondition, applyMark } from "@/lib/domain/encounters/damage";
import { applySpotlight } from "@/lib/domain/encounters/spotlight";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** `encounters.get` for an encounter that exists. */
export type TrackerView = NonNullable<FunctionReturnType<typeof api.encounters.get>>;
export type TrackerInstance = TrackerView["instances"][number];
export type Condition = TrackerInstance["conditions"][number];
export type FearReason = "interrupt" | "move" | "feature" | "experience";

/**
 * The tracker's mutations (convex/encounterTracking.ts) with optimistic updates on `encounters.get` (CL4): pips,
 * conditions, spotlights and the GM turn use the same pure rules as the server, so a double click on "+" marks 2;
 * Fear spending lowers `campaigns.fear` at once. Each call gets its own idempotency key; a failure is kept in
 * `error` for the tracker's alert line.
 */
export function useTracker(campaignId: Id<"campaigns">, encounterId: string) {
  const [error, setError] = useState<string | null>(null);
  const viewArgs = { campaignId, encounterId };

  function patchInstance(store: OptimisticLocalStore, instanceId: string, change: (i: TrackerInstance, view: TrackerView) => TrackerInstance) {
    const view = store.getQuery(api.encounters.get, viewArgs);
    if (!view) return;
    store.setQuery(api.encounters.get, viewArgs, { ...view, instances: view.instances.map((i) => (i._id === instanceId ? change(i, view) : i)) });
  }

  const markHp = useMutation(api.encounterTracking.markHp).withOptimisticUpdate((store, { instanceId, delta }) =>
    patchInstance(store, instanceId, (i) => applyMark(i, "hp", delta)),
  );
  const markStress = useMutation(api.encounterTracking.markStress).withOptimisticUpdate((store, { instanceId, delta }) =>
    patchInstance(store, instanceId, (i) => applyMark(i, "stress", delta)),
  );
  const toggleCondition = useMutation(api.encounterTracking.toggleCondition).withOptimisticUpdate((store, { instanceId, condition }) =>
    patchInstance(store, instanceId, (i) => applyCondition(i, condition)),
  );
  const spotlight = useMutation(api.encounterTracking.spotlight).withOptimisticUpdate((store, { instanceId }) =>
    patchInstance(store, instanceId, (i, view) => applySpotlight(i, view.encounter.gmTurn)),
  );
  const endGmTurn = useMutation(api.encounterTracking.endGmTurn).withOptimisticUpdate((store) => {
    const view = store.getQuery(api.encounters.get, viewArgs);
    if (!view) return;
    store.setQuery(api.encounters.get, viewArgs, { ...view, encounter: { ...view.encounter, gmTurn: view.encounter.gmTurn + 1 } });
  });
  const spendFear = useMutation(api.encounterTracking.spendFear).withOptimisticUpdate((store, { amount }) => {
    const fear = store.getQuery(api.campaigns.fear, { campaignId });
    if (fear === undefined || fear < amount) return;
    store.setQuery(api.campaigns.fear, { campaignId }, fear - amount);
  });
  const applyDamage = useMutation(api.encounterTracking.applyDamage);
  const defeatMinions = useMutation(api.encounterTracking.defeatMinions);
  const setTags = useMutation(api.encounterTracking.setTags);

  async function run<T>(call: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await call();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    }
  }
  const idempotencyKey = () => crypto.randomUUID();

  return {
    error,
    clearError: () => setError(null),
    markHp: (instanceId: string, delta: number) => run(() => markHp({ campaignId, instanceId, delta, idempotencyKey: idempotencyKey() })),
    markStress: (instanceId: string, delta: number) => run(() => markStress({ campaignId, instanceId, delta, idempotencyKey: idempotencyKey() })),
    toggleCondition: (instanceId: string, condition: Condition) =>
      run(() => toggleCondition({ campaignId, instanceId, condition, idempotencyKey: idempotencyKey() })),
    spotlight: (instanceId: string) => run(() => spotlight({ campaignId, instanceId, idempotencyKey: idempotencyKey() })),
    endGmTurn: () => run(() => endGmTurn({ campaignId, encounterId, idempotencyKey: idempotencyKey() })),
    spendFear: (amount: number, reason: FearReason, instanceId?: string) =>
      run(() => spendFear({ campaignId, encounterId, amount, reason, ...(instanceId ? { instanceId } : {}), idempotencyKey: idempotencyKey() })),
    applyDamage: (instanceId: string, amount: number, resistant: boolean) =>
      run(() => applyDamage({ campaignId, instanceId, amount, resistant, idempotencyKey: idempotencyKey() })),
    defeatMinions: (instanceId: string, count: number) => run(() => defeatMinions({ campaignId, instanceId, count, idempotencyKey: idempotencyKey() })),
    setTags: (instanceId: string, tags: string[]) => run(() => setTags({ campaignId, instanceId, tags, idempotencyKey: idempotencyKey() })),
  };
}

export type TrackerActions = ReturnType<typeof useTracker>;
