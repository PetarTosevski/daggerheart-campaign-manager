import { useCallback, useSyncExternalStore } from "react";

import {
  pickedSelection,
  selectConversation,
  subscribeSelection,
  type Selection,
} from "../../../../../src/lib/lorekeeper/selection";

export {
  resetSelectionForTests,
  resolveSelection,
  selectConversation,
  type Selection,
} from "../../../../../src/lib/lorekeeper/selection";

/** The picked conversation of `campaignId` and a setter (the shared store in src/lib, as a React hook). */
export function useSelection(campaignId: string): [Selection, (selection: Selection) => void] {
  const selection = useSyncExternalStore(
    subscribeSelection,
    () => pickedSelection(campaignId),
    () => undefined,
  );
  const select = useCallback((next: Selection) => selectConversation(campaignId, next), [campaignId]);
  return [selection, select];
}
