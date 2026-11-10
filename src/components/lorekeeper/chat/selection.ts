import { useCallback, useSyncExternalStore } from "react";

import { pickedSelection, selectConversation, subscribeSelection, type Selection } from "@/lib/lorekeeper/selection";

/**
 * The website's hook over the shared conversation selection (src/lib/lorekeeper/selection.ts): the 'Conversations'
 * menu (chat header), the chat body (the page mounts them as two slots) and the drawer (L7) read one pick per campaign.
 */

/** The picked conversation of `campaignId` and a setter. */
export function useSelection(campaignId: string): [Selection, (selection: Selection) => void] {
  const selection = useSyncExternalStore(
    subscribeSelection,
    () => pickedSelection(campaignId),
    () => undefined,
  );
  const select = useCallback((next: Selection) => selectConversation(campaignId, next), [campaignId]);
  return [selection, select];
}
