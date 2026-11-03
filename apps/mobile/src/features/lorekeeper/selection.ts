import { useCallback, useSyncExternalStore } from "react";

import type { Id } from "../../convex";

export type Selection = Id<"lorekeeperConversations"> | "new" | undefined;

const picked = new Map<string, Selection>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function selectConversation(campaignId: string, selection: Selection): void {
  if (picked.get(campaignId) === selection) return;
  picked.set(campaignId, selection);
  for (const listener of listeners) listener();
}

export function useSelection(campaignId: string): [Selection, (selection: Selection) => void] {
  const selection = useSyncExternalStore(
    subscribe,
    () => picked.get(campaignId),
    () => undefined,
  );
  const select = useCallback((next: Selection) => selectConversation(campaignId, next), [campaignId]);
  return [selection, select];
}

export function resolveSelection(
  selection: Selection,
  mine: readonly { _id: Id<"lorekeeperConversations"> }[] | undefined,
): Id<"lorekeeperConversations"> | "new" | undefined {
  if (selection !== undefined) return selection;
  if (mine === undefined) return undefined;
  return mine[0]?._id ?? "new";
}

/** Clears selection between tests. */
export function resetSelectionForTests(): void {
  picked.clear();
  for (const listener of listeners) listener();
}
