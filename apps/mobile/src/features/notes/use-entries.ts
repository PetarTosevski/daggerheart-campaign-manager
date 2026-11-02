import { useMutation, useQuery } from "convex/react";

import type { PageRef } from "../../../../../convex/lib/validators/notes";
import { api, type Id } from "../../convex";
import { toPageRef } from "./slots";

export function pageRefOf(pageId: string | null): PageRef {
  return toPageRef(pageId) ?? { template: 0 };
}

export function usePageEntries(campaignId: Id<"campaigns">, page: PageRef) {
  return useQuery(api.notesEntries.entries, { campaignId, page });
}

export function useEntryMutations() {
  return {
    add: useMutation(api.notesEntries.add),
    setText: useMutation(api.notesEntries.setText),
    cycle: useMutation(api.notesEntries.cycle),
    toggleStar: useMutation(api.notesEntries.toggleStar),
    moveUp: useMutation(api.notesEntries.moveUp),
    remove: useMutation(api.notesEntries.remove),
  };
}
