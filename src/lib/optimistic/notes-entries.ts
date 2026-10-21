import type { OptimisticLocalStore } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { EntryRow, PageEntries } from "../../../convex/notesEntries";
import type { PageRef } from "../../../convex/lib/validators/notes";
import { isOpenThread, nextState } from "../domain/notes/bullets";
import type { EntryKind } from "../domain/notes/types";

/**
 * Optimistic updates for the Notes entries (D11 N3; CL4): each updater patches the cached `notesEntries.entries`
 * results the way the server will, with the same N1 rules (nextState, isOpenThread), so a second click right after the
 * first acts on the new state and every click shows at once. Store objects are never mutated; a query that is not
 * loaded (`value` undefined) is left alone. The server's answer replaces the guess.
 */

type EntriesQuery = typeof api.notesEntries.entries;

/** Rewrites every loaded `entries` result that holds the entry. */
function patchEntries(store: OptimisticLocalStore, entryId: Id<"journalEntries">, fn: (rows: EntryRow[], index: number) => EntryRow[]) {
  for (const { args, value } of store.getAllQueries(api.notesEntries.entries as EntriesQuery)) {
    if (value === undefined) continue;
    const index = value.entries.findIndex((e) => e._id === entryId);
    if (index === -1) continue;
    store.setQuery(api.notesEntries.entries, args, { ...value, entries: fn(value.entries, index) });
  }
}

function patchOne(store: OptimisticLocalStore, entryId: Id<"journalEntries">, patch: (row: EntryRow) => Partial<EntryRow>) {
  patchEntries(store, entryId, (rows, index) => rows.map((row, i) => (i === index ? { ...row, ...patch(row) } : row)));
}

/** Bullet click: the next state (B4) and the open-thread flag (B5). */
export function cycleUpdate(store: OptimisticLocalStore, { entryId }: { entryId: Id<"journalEntries"> }) {
  patchOne(store, entryId, (row) => {
    const state = nextState(row.kind, row.state);
    return { state, open: isOpenThread({ kind: row.kind, state }) };
  });
}

/** ★ on / off. */
export function toggleStarUpdate(store: OptimisticLocalStore, { entryId }: { entryId: Id<"journalEntries"> }) {
  patchOne(store, entryId, (row) => ({ star: !row.star }));
}

/** The edited text (trimmed, as the server stores it). */
export function setTextUpdate(store: OptimisticLocalStore, { entryId, text }: { entryId: Id<"journalEntries">; text: string }) {
  patchOne(store, entryId, () => ({ text: text.trim() }));
}

/** × removes the row. */
export function removeUpdate(store: OptimisticLocalStore, { entryId }: { entryId: Id<"journalEntries"> }) {
  patchEntries(store, entryId, (rows, index) => rows.filter((_, i) => i !== index));
}

/** ↑ swaps the row with the one above (orders too); the first row stays. */
export function moveUpUpdate(store: OptimisticLocalStore, { entryId }: { entryId: Id<"journalEntries"> }) {
  patchEntries(store, entryId, (rows, index) => {
    if (index === 0) return rows;
    const next = rows.slice();
    const above = next[index - 1]!;
    const row = next[index]!;
    next[index - 1] = { ...row, order: above.order };
    next[index] = { ...above, order: row.order };
    return next;
  });
}

let pending = 0;

/** Same page ref (a page id, or the same template index). */
function samePage(a: PageRef, b: PageRef): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.template === b.template;
}

/**
 * A new row at the end of the page, open, without actions until the server answers (its id is not real yet). The
 * owner's row is their own; a reader's is added (Q3), its author label filled in by the server.
 */
export function addUpdate(
  store: OptimisticLocalStore,
  { campaignId, page, kind, text }: { campaignId: Id<"campaigns">; page: PageRef; kind: EntryKind; text: string },
) {
  for (const { args, value } of store.getAllQueries(api.notesEntries.entries as EntriesQuery)) {
    if (value === undefined || args.campaignId !== campaignId || !samePage(args.page, page)) continue;
    const last = value.entries[value.entries.length - 1];
    const row: EntryRow = {
      _id: `optimistic-${++pending}` as unknown as EntryRow["_id"],
      kind,
      state: "open",
      star: false,
      text: text.trim(),
      order: last === undefined ? 0 : last.order + 1,
      open: isOpenThread({ kind, state: "open" }),
      added: !value.canArrange,
      authorLabel: "",
      canEdit: false,
      canCycle: false,
      canDelete: false,
      canStar: false,
      canMove: false,
    };
    const next: PageEntries = { ...value, entries: [...value.entries, row] };
    store.setQuery(api.notesEntries.entries, args, next);
  }
}

/** A row the optimistic add made, still waiting for its real id. */
export function isPendingRow(row: Pick<EntryRow, "_id">): boolean {
  return String(row._id).startsWith("optimistic-");
}
