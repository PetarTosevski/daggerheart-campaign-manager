"use client";

import { useMutation, useQuery } from "convex/react";

import {
  addUpdate,
  cycleUpdate,
  moveUpUpdate,
  removeUpdate,
  setTextUpdate,
  toggleStarUpdate,
} from "@/lib/optimistic/notes-entries";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PageRef } from "../../../../convex/lib/validators/notes";
import { toPageRef } from "../slots";

/** The page ref a slot's `?page=` names; without one the first default page (N2 passes the page it shows). */
export function pageRefOf(pageId: string | null): PageRef {
  return toPageRef(pageId) ?? { template: 0 };
}

/** The page's entries (`undefined` while loading). Rows and the Migrate button share this one subscription. */
export function usePageEntries(campaignId: Id<"campaigns">, page: PageRef) {
  return useQuery(api.notesEntries.entries, { campaignId, page });
}

/** The entry intents, each with its optimistic update (CL3, CL4). */
export function useEntryMutations() {
  return {
    add: useMutation(api.notesEntries.add).withOptimisticUpdate(addUpdate),
    setText: useMutation(api.notesEntries.setText).withOptimisticUpdate(setTextUpdate),
    cycle: useMutation(api.notesEntries.cycle).withOptimisticUpdate(cycleUpdate),
    toggleStar: useMutation(api.notesEntries.toggleStar).withOptimisticUpdate(toggleStarUpdate),
    moveUp: useMutation(api.notesEntries.moveUp).withOptimisticUpdate(moveUpUpdate),
    remove: useMutation(api.notesEntries.remove).withOptimisticUpdate(removeUpdate),
  };
}
