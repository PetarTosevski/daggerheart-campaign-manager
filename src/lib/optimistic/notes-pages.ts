import type { OptimisticLocalStore } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PageRef } from "../../../convex/lib/validators/notes";
import type { JournalPageItem, JournalTemplateItem, JournalView } from "../../../convex/notes";
import { normalizeTitle } from "../domain/notes/limits";
import { nextTape } from "../domain/notes/defaults";

/**
 * Optimistic updaters for the `notes.journal` query (D11 N2, CL4): rename and tape change show at once, the server's
 * answer replaces them. They never mutate store objects and skip a query that is not loaded. A page ref is a page id
 * or `{ template: i }` (a default page, before or after the journal exists).
 */

type Item = JournalPageItem | JournalTemplateItem;

function isRef(item: Item, ref: PageRef): boolean {
  if (typeof ref === "string") return "_id" in item && item._id === ref;
  return item.template === ref.template;
}

/** Applies `change` to the page `ref` names in the cached journal of the campaign. */
export function patchJournalPage(
  store: OptimisticLocalStore,
  campaignId: Id<"campaigns">,
  ref: PageRef,
  change: (item: Item) => Partial<Item>,
): void {
  const current = store.getQuery(api.notes.journal, { campaignId });
  if (current === undefined) return;
  let next: JournalView;
  if (current.journal === null) {
    next = { ...current, templates: current.templates.map((t) => (isRef(t, ref) ? ({ ...t, ...change(t) } as JournalTemplateItem) : t)) };
  } else {
    next = { ...current, pages: current.pages.map((p) => (isRef(p, ref) ? ({ ...p, ...change(p) } as JournalPageItem) : p)) };
  }
  store.setQuery(api.notes.journal, { campaignId }, next);
}

/** `notes.renamePage`: the trimmed title. */
export function renamePageLocally(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; page: PageRef; title: string }): void {
  patchJournalPage(store, args.campaignId, args.page, () => ({ title: normalizeTitle(args.title) }));
}

/** `notes.cycleTape`: the next tape (N1 `nextTape`). */
export function cycleTapeLocally(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; page: PageRef }): void {
  patchJournalPage(store, args.campaignId, args.page, (item) => ({ tape: nextTape(item.tape) }));
}
