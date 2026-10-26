import type { OptimisticLocalStore } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PageRef } from "../../../convex/lib/validators/notes";
import { BIN_DAYS } from "../domain/notes/limits";

/**
 * Optimistic updaters for the bin (D11 N7, CL4): a torn-out page leaves the own journal and joins 'Torn-out pages' at
 * once; a restored page leaves 'Torn-out pages' (the journal's answer brings it back). They never mutate store objects
 * and skip a query that is not loaded.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `notesBin.binPage` with a page id: out of `notes.journal` (and its counters), into `notesBin.bin`. */
export function binPageLocally(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; page: PageRef }): void {
  if (typeof args.page !== "string") return; // a default page before the journal exists: the server answers fast
  const pageId = args.page;
  const view = store.getQuery(api.notes.journal, { campaignId: args.campaignId });
  if (view === undefined || view.journal === null) return;
  const item = view.pages.find((p) => p._id === pageId);
  if (item === undefined) return;
  store.setQuery(
    api.notes.journal,
    { campaignId: args.campaignId },
    {
      ...view,
      journal: {
        ...view.journal,
        pageCount: Math.max(0, view.journal.pageCount - 1),
        entryCount: Math.max(0, view.journal.entryCount - item.entryCount),
        openCount: Math.max(0, view.journal.openCount - item.openCount),
      },
      pages: view.pages.filter((p) => p._id !== pageId),
    },
  );
  const bin = store.getQuery(api.notesBin.bin, { campaignId: args.campaignId });
  if (bin === undefined) return;
  const now = Date.now();
  store.setQuery(api.notesBin.bin, { campaignId: args.campaignId }, [
    { _id: pageId, title: item.title, kind: item.kind, tape: item.tape, binnedAt: now, purgeAt: now + BIN_DAYS * DAY_MS, from: null },
    ...bin.filter((row) => row._id !== pageId),
  ]);
}

/** `notesBin.restorePage`: out of `notesBin.bin`. */
export function restorePageLocally(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; page: PageRef }): void {
  const bin = store.getQuery(api.notesBin.bin, { campaignId: args.campaignId });
  if (bin === undefined) return;
  store.setQuery(
    api.notesBin.bin,
    { campaignId: args.campaignId },
    bin.filter((row) => row._id !== args.page),
  );
}
