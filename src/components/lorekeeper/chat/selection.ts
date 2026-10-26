import { useCallback, useSyncExternalStore } from "react";

import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Which conversation the chat shows, shared by the 'Conversations' menu (chat header) and the chat body, which the
 * page mounts as two slots, and by the drawer (L7) in the same tab. Per campaign:
 *
 * - `undefined` (nothing picked): the caller's most recent conversation, else a new one. After a reload the chat
 *   opens on the last conversation again, so the history stays.
 * - `"new"`: an empty conversation; the first question creates it.
 * - an id: that conversation (the caller's own, or another member's public one, read only).
 */
export type Selection = Id<"lorekeeperConversations"> | "new" | undefined;

const picked = new Map<string, Selection>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Picks the conversation the chat shows for `campaignId`. */
export function selectConversation(campaignId: string, selection: Selection): void {
  if (picked.get(campaignId) === selection) return;
  picked.set(campaignId, selection);
  for (const listener of listeners) listener();
}

/** The picked conversation of `campaignId` and a setter. */
export function useSelection(campaignId: string): [Selection, (selection: Selection) => void] {
  const selection = useSyncExternalStore(
    subscribe,
    () => picked.get(campaignId),
    () => undefined,
  );
  const select = useCallback((next: Selection) => selectConversation(campaignId, next), [campaignId]);
  return [selection, select];
}

/** What the chat shows: the picked conversation, else the caller's most recent one, else a new one. */
export function resolveSelection(selection: Selection, mine: readonly { _id: Id<"lorekeeperConversations"> }[] | undefined): Id<"lorekeeperConversations"> | "new" | undefined {
  if (selection !== undefined) return selection;
  if (mine === undefined) return undefined;
  return mine[0]?._id ?? "new";
}
