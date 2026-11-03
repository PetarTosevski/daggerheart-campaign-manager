import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, type ReactMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useState } from "react";

import { errorMessage } from "../../../../../../src/lib/convex-errors";
import { applyTerrainCells } from "../../../../../../src/lib/world/terrain";
import { api } from "../../../convex";
import type { Id } from "../../../convex";
import { useIntent } from "../../trackers/intent";

function withOptimistic<M extends FunctionReference<"mutation">>(
  mutation: ReactMutation<M>,
  update: (store: OptimisticLocalStore, args: FunctionArgs<M>) => void,
): ReactMutation<M> {
  if (!("withOptimisticUpdate" in mutation)) return mutation;
  return mutation.withOptimisticUpdate(update);
}

const PAINT_CHUNK = 8000;

/** Maps mutations for GM world editing (same surface as the website board). */
export function useMapActions(campaignId: Id<"campaigns">) {
  const [error, setError] = useState<string | null>(null);
  const addToken = useIntent(api.maps.addToken);
  const moveParty = useIntent(api.maps.moveParty);
  const addType = useIntent(api.maps.addCustomType);

  const updateToken = useMutation(api.maps.updateToken);
  const removeToken = useMutation(api.maps.removeToken);
  const paintCells = withOptimistic(useMutation(api.maps.paintCells), (store, { campaignId: id, indexes, codes }) => {
    const view = store.getQuery(api.maps.get, { campaignId: id });
    if (view) {
      store.setQuery(api.maps.get, { campaignId: id }, {
        ...view,
        state: { ...view.state, terrain: applyTerrainCells(view.state.terrain, indexes, codes) },
      });
    }
  });
  const setTerrain = useMutation(api.maps.setTerrain);
  const renameType = useMutation(api.maps.renameType);

  async function run<T>(p: Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await p;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    }
  }

  function keyed<T>(fire: () => Promise<T>): Promise<T> {
    setError(null);
    return fire();
  }

  const c = { campaignId };
  return {
    error: error ?? addToken.error ?? moveParty.error ?? addType.error,
    clearError: () => {
      setError(null);
      addToken.clearError();
      moveParty.clearError();
      addType.clearError();
    },
    addToken: (type: string, x: number, y: number) => keyed(() => addToken.fire({ ...c, type, x, y })),
    moveParty: (x: number, y: number, via?: { x: number; y: number }[]) => keyed(() => moveParty.fire({ ...c, x, y, via })),
    addCustomType: (label: string, icon: string, color: string) => keyed(() => addType.fire({ ...c, label, icon, color })),
    updateToken: (id: number, patch: Parameters<typeof updateToken>[0]["patch"]) => run(updateToken({ ...c, id, patch })),
    removeToken: (id: number) => run(removeToken({ ...c, id })),
    paintCells: async (indexes: number[], codes: string) => {
      for (let i = 0; i < indexes.length; i += PAINT_CHUNK) {
        const ok = await run(
          paintCells({ ...c, indexes: indexes.slice(i, i + PAINT_CHUNK), codes: codes.slice(i, i + PAINT_CHUNK) }).then(() => true),
        );
        if (ok === undefined) return;
      }
    },
    resetTerrain: () => run(setTerrain({ ...c, reset: true })),
    renameType: (typeId: string, label: string) => run(renameType({ ...c, typeId, label })),
  };
}

export type MapActions = ReturnType<typeof useMapActions>;
