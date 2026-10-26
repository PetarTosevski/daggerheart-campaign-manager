import type { OptimisticLocalStore } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PageRef, PageVisibility } from "../../../convex/lib/validators/notes";
import { patchJournalPage } from "./notes-pages";

/**
 * Optimistic updaters for sharing (D11 N6, CL4): the chip, the radios and the recipient checkboxes change at once and
 * the server's answer replaces them. They never mutate store objects and skip a query that is not loaded. Each
 * mirrors one intent of convex/notesSharing.ts: a visibility, or one recipient added or removed.
 */

type Args = { campaignId: Id<"campaigns">; page: PageRef };

/** Sets the `chosen` flag of the recipients the predicate names in the cached `recipients` query. */
function patchRecipients(store: OptimisticLocalStore, args: Args, chosen: (userId: string, was: boolean) => boolean): void {
  const query = { campaignId: args.campaignId, page: args.page };
  const current = store.getQuery(api.notesSharing.recipients, query);
  if (current === undefined) return;
  store.setQuery(
    api.notesSharing.recipients,
    query,
    current.map((row) => ({ ...row, chosen: chosen(row.userId, row.chosen) })),
  );
}

/** `notesSharing.setVisibility`: the page's new value; leaving 'chosen' unticks everyone (the server deletes the rows). */
export function setVisibilityLocally(store: OptimisticLocalStore, args: Args & { visibility: PageVisibility }): void {
  patchJournalPage(store, args.campaignId, args.page, () => ({ visibility: args.visibility }));
  if (args.visibility !== "chosen") patchRecipients(store, args, () => false);
}

/** `notesSharing.addRecipient`: ticks the user. */
export function addRecipientLocally(store: OptimisticLocalStore, args: Args & { userId: string }): void {
  patchRecipients(store, args, (userId, was) => was || userId === args.userId);
}

/** `notesSharing.removeRecipient`: unticks the user. */
export function removeRecipientLocally(store: OptimisticLocalStore, args: Args & { userId: string }): void {
  patchRecipients(store, args, (userId, was) => was && userId !== args.userId);
}
