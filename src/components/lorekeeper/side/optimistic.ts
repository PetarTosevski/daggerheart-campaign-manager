import type { OptimisticLocalStore } from "convex/browser";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * Optimistic updaters for the sidebar cards (D13 L7, CL4): a book switch flips, an unpinned ruling and a resolved
 * ask leave their card, and an edited ruling shows its new text before the server answers. Each mirrors one intent
 * (lorekeeperLibrary.setEnabled, lorekeeperRulings.unpin / update, lorekeeperAsks.resolve), never mutates a store
 * object and skips a query that is not loaded.
 */

type Campaign = { campaignId: Id<"campaigns"> };

/** `lorekeeperLibrary.setEnabled`: the book's pill and the header's '<N> books indexed'. */
export function setEnabledLocally(store: OptimisticLocalStore, args: Campaign & { bookId: Id<"lorekeeperBooks">; enabled: boolean }): void {
  const library = store.getQuery(api.lorekeeperLibrary.list, { campaignId: args.campaignId });
  if (library === undefined) return;
  const books = library.books.map((book) => (book.bookId === args.bookId ? { ...book, enabled: args.enabled } : book));
  store.setQuery(api.lorekeeperLibrary.list, { campaignId: args.campaignId }, { books, indexedCount: books.filter((book) => book.enabled).length });
}

/** `lorekeeperRulings.unpin`: the ruling leaves the card. */
export function unpinLocally(store: OptimisticLocalStore, args: Campaign & { rulingId: Id<"lorekeeperRulings"> }): void {
  const rulings = store.getQuery(api.lorekeeperRulings.list, { campaignId: args.campaignId });
  if (rulings === undefined) return;
  store.setQuery(
    api.lorekeeperRulings.list,
    { campaignId: args.campaignId },
    rulings.filter((ruling) => ruling._id !== args.rulingId),
  );
}

/** `lorekeeperRulings.update`: the given fields change (trimmed, as the server stores them). */
export function updateRulingLocally(
  store: OptimisticLocalStore,
  args: Campaign & { rulingId: Id<"lorekeeperRulings">; title?: string; text?: string },
): void {
  const rulings = store.getQuery(api.lorekeeperRulings.list, { campaignId: args.campaignId });
  if (rulings === undefined) return;
  store.setQuery(
    api.lorekeeperRulings.list,
    { campaignId: args.campaignId },
    rulings.map((ruling) =>
      ruling._id === args.rulingId
        ? {
            ...ruling,
            ...(args.title !== undefined ? { title: args.title.trim() } : {}),
            ...(args.text !== undefined ? { text: args.text.trim() } : {}),
          }
        : ruling,
    ),
  );
}

/** `lorekeeperAsks.resolve`: the ask leaves the GM's open list (pinned or dismissed). */
export function resolveLocally(store: OptimisticLocalStore, args: Campaign & { askId: Id<"lorekeeperAsks"> }): void {
  const open = store.getQuery(api.lorekeeperAsks.listOpen, { campaignId: args.campaignId });
  if (open === undefined) return;
  store.setQuery(
    api.lorekeeperAsks.listOpen,
    { campaignId: args.campaignId },
    open.filter((ask) => ask._id !== args.askId),
  );
}
