import type { OptimisticLocalStore } from "convex/browser";

import { isOpenThread, nextState } from "@/lib/domain/notes";
import { cycleUpdate } from "@/lib/optimistic/notes-entries";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * The bullet click in the threads view (B5, CL4): N3's `cycleUpdate` patches any loaded `entries` result, and the
 * thread list drops the row as soon as its next state is no longer an open thread (a done task, a resolved Fear), so
 * the view and the '🧵 Open threads · N' count change at once. Kept beside the threads slot because a
 * `src/lib/optimistic/notes-threads.ts` would be outside N4's owned files; it touches only `notesThreads.threads`.
 */
export function threadsCycleUpdate(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; entryId: Id<"journalEntries"> }) {
  cycleUpdate(store, args);
  for (const { args: queryArgs, value } of store.getAllQueries(api.notesThreads.threads)) {
    if (value === undefined) continue;
    const index = value.findIndex((row) => row._id === args.entryId);
    if (index === -1) continue;
    const row = value[index]!;
    const state = nextState(row.kind, row.state);
    const next = isOpenThread({ kind: row.kind, state })
      ? value.map((r, i) => (i === index ? { ...r, state } : r))
      : value.filter((_, i) => i !== index);
    store.setQuery(api.notesThreads.threads, queryArgs, next);
  }
}
