import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Which conversation the Lorekeeper chat shows, per campaign: a tiny external store shared by the 'Conversations'
 * menu and the chat body (and the drawer). Framework-free so the website and the phone app share it; each app wraps
 * it in its own `useSyncExternalStore` hook.
 *
 * - `undefined` (nothing picked): the caller's most recent conversation, else a new one. After a reload the chat
 *   opens on the last conversation again, so the history stays.
 * - `"new"`: an empty conversation; the first question creates it.
 * - an id: that conversation (the caller's own, or another member's public one, read only).
 */
export type Selection = Id<"lorekeeperConversations"> | "new" | undefined;

const picked = new Map<string, Selection>();
const listeners = new Set<() => void>();

/** Subscribes to selection changes (any campaign); returns the unsubscribe. */
export function subscribeSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The picked conversation of `campaignId`. */
export function pickedSelection(campaignId: string): Selection {
  return picked.get(campaignId);
}

/** Picks the conversation the chat shows for `campaignId`. */
export function selectConversation(campaignId: string, selection: Selection): void {
  if (picked.get(campaignId) === selection) return;
  picked.set(campaignId, selection);
  for (const listener of listeners) listener();
}

/** What the chat shows: the picked conversation, else the caller's most recent one, else a new one. */
export function resolveSelection(
  selection: Selection,
  mine: readonly { _id: Id<"lorekeeperConversations"> }[] | undefined,
): Id<"lorekeeperConversations"> | "new" | undefined {
  if (selection !== undefined) return selection;
  if (mine === undefined) return undefined;
  return mine[0]?._id ?? "new";
}

/** Clears every pick (tests only). */
export function resetSelectionForTests(): void {
  picked.clear();
  for (const listener of listeners) listener();
}
