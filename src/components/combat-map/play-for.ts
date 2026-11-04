"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * The GM's "Play for this character" switch (plan drawer-answers DA6, user answers 2026-10-30): one switch per PC, shared
 * by the map Hand and the sheet drawer, stored on the server (`convex/playFor.ts`) so it follows the GM to every device,
 * and on until the GM turns it off. Both places read the same `playFor.list` subscription, so they never disagree and
 * nothing is copied into state (CL7). The switch sends an intent (on / off for one character) with an optimistic update
 * (CL3, CL4).
 *
 * `gm` false (a player's view) skips the query: the switch is the GM's only.
 */
export function usePlayFor(campaignId: Id<"campaigns">, characterId: Id<"characters">, gm: boolean): { on: boolean; set: (on: boolean) => void; error: string | null } {
  const playingFor = useQuery(api.playFor.list, gm ? { campaignId } : "skip");
  const [error, setError] = useState<string | null>(null);
  const mutate = useMutation(api.playFor.set).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.playFor.list, { campaignId: args.campaignId });
    if (current === undefined) return;
    const others = current.filter((id) => id !== args.characterId);
    store.setQuery(api.playFor.list, { campaignId: args.campaignId }, args.on ? [...others, args.characterId] : others);
  });
  return {
    on: playingFor?.includes(characterId) ?? false,
    set: (on) => {
      setError(null);
      mutate({ campaignId, characterId, on }).catch((e: unknown) => setError(errorMessage(e)));
    },
    error,
  };
}
