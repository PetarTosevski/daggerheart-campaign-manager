// The action table (D11 N1; analysis 3.2; Q3, Q11, Q12, D2, D5). Pure module, used by N0's pageAccess
// (convex/lib/notes.ts) to decide every write and by the UI to show only the controls a viewer may use.
//
// Analysis 3.2:
//   read page and entries                                   per the visibility table
//   edit page (title, tape, visibility, recipients, session
//     link), migrate, star, reorder                         owner, journal not departed
//   add entry                                               anyone who can read, journal not departed (Q3, D2)
//   edit text of an entry                                   its author, journal not departed
//   cycle bullet                                            owner or author, journal not departed (D5)
//   delete entry                                            its author or the page owner, journal not departed
//   tear out (bin)                                          owner (journal not departed); the GM for a non-private page
//                                                           of a departed journal (Q12, D2)
//   restore from bin                                        whoever tore it out, while they still have access
//
// ```ts
// const page = pageActions({ isOwner: false, canRead: true, departed: false, viewerIsGm: true, visibility: "gm" });
// page.canAdd;       // true  (the GM adds to a player's 'gm' page, Q3)
// page.canEditPage;  // false (owner only)
// entryActions({ isOwner: true, isAuthor: false, canRead: true, departed: false }).canEditEntry;   // false (D5)
// ```

import type { Visibility } from "./types";

export type PageActionInput = {
  /** The caller owns the page. */
  isOwner: boolean;
  /**
   * The caller may read the page by the visibility table (visibility.ts canReadPage), ignoring the bin. For a binned
   * page this is whether the binner would still read it if it were not binned ("while they still have access").
   */
  canRead: boolean;
  /** The page's journal is departed (D1). Never true for the GM journal. */
  departed: boolean;
  /** The caller is the campaign's GM. */
  viewerIsGm: boolean;
  /** The page's stored visibility. */
  visibility: Visibility;
  /** The page is in the bin. */
  binned?: boolean;
  /** The caller is the one who binned it (`journalPages.binnedBy`). */
  isBinner?: boolean;
};

export type EntryActionInput = {
  /** The caller owns the entry's page. */
  isOwner: boolean;
  /** The caller wrote the entry (`journalEntries.authorId`). */
  isAuthor: boolean;
  /** The caller may read the page (and the page is not binned). */
  canRead: boolean;
  /** The page's journal is departed (D1). */
  departed: boolean;
};

/** Live page: readable, not binned. */
function live(input: { canRead: boolean; binned?: boolean }): boolean {
  return input.canRead && !input.binned;
}

/** Title, tape, visibility, recipients, session link, migrate, star and reorder: the owner of a present journal. */
export function canEditPage(input: PageActionInput): boolean {
  return live(input) && input.isOwner && !input.departed;
}

/** Add an entry: anyone who can read the page, unless the journal is departed (Q3, D2). */
export function canAdd(input: PageActionInput): boolean {
  return live(input) && !input.departed;
}

/**
 * Tear out: the owner of a present journal; the GM (not the owner) for a non-private page of a departed journal (Q12,
 * D2).
 */
export function canBin(input: PageActionInput): boolean {
  if (!live(input)) return false;
  if (input.isOwner) return !input.departed;
  return input.viewerIsGm && input.departed && input.visibility !== "private";
}

/** Restore from the bin: whoever binned it, while they still have access. */
export function canRestore(input: PageActionInput): boolean {
  return !!input.binned && !!input.isBinner && input.canRead;
}

/** Edit an entry's text: its author only, journal present (Q3, D5). */
export function canEditEntry(input: EntryActionInput): boolean {
  return input.canRead && input.isAuthor && !input.departed;
}

/** Cycle an entry's bullet: the page owner or the entry's author, journal present (D5). */
export function canCycle(input: EntryActionInput): boolean {
  return input.canRead && (input.isOwner || input.isAuthor) && !input.departed;
}

/** Delete an entry: its author or the page owner, journal present (Q3). */
export function canDeleteEntry(input: EntryActionInput): boolean {
  return input.canRead && (input.isOwner || input.isAuthor) && !input.departed;
}

/** Star or move an entry: the page owner only, journal present (D5). */
export function canArrangeEntry(input: EntryActionInput): boolean {
  return input.canRead && input.isOwner && !input.departed;
}

export type PageActions = {
  canEditPage: boolean;
  canMigrate: boolean;
  canAdd: boolean;
  canBin: boolean;
  canRestore: boolean;
};

/** Every page-level flag at once. `canMigrate` equals `canEditPage` (whether open tasks exist is the caller's check). */
export function pageActions(input: PageActionInput): PageActions {
  const edit = canEditPage(input);
  return {
    canEditPage: edit,
    canMigrate: edit,
    canAdd: canAdd(input),
    canBin: canBin(input),
    canRestore: canRestore(input),
  };
}

export type EntryActions = {
  canEditEntry: boolean;
  canCycle: boolean;
  canDeleteEntry: boolean;
  /** Star and move up (owner only). */
  canStar: boolean;
  canMove: boolean;
};

/** Every entry-level flag at once. */
export function entryActions(input: EntryActionInput): EntryActions {
  const arrange = canArrangeEntry(input);
  return {
    canEditEntry: canEditEntry(input),
    canCycle: canCycle(input),
    canDeleteEntry: canDeleteEntry(input),
    canStar: arrange,
    canMove: arrange,
  };
}
