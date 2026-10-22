import type { Id } from "../../../convex/_generated/dataModel";
import type { PageRef } from "../../../convex/lib/validators/notes";

/**
 * Props of the feature slots the Notes page mounts (D11, plan `.omc/plans/d11-notes.yaml`). The page (N0,
 * `src/app/(gm)/campaigns/[campaignId]/notes/page.tsx`) owns the layout, the hero frame (campaign line), the Quick keys
 * card and the URL state below; each feature tracer owns only its folder and fills the components its `index.tsx`
 * exports, keeping their names and props:
 *
 * | Folder          | Tracer | Exports (where the page mounts them)                                                  |
 * |-----------------|--------|---------------------------------------------------------------------------------------|
 * | `header/`       | N2     | `JournalHeading` (hero: H1 '<whoName>’s Journal' and the sub line, B1)                |
 * | `threads/`      | N4     | `ThreadsButton` (hero actions), `ThreadsView` (paper column, view 'threads')          |
 * | `export/`       | N4     | `DownloadJournalButton` (hero actions)                                                |
 * | `search/`       | N4     | `JournalSearch` (index column, top), `useJournalSearch` (feeds `matchingPageIds`)     |
 * | `index-column/` | N2     | `PageGroups` (index column: the three groups of own pages, B2)                        |
 * | `shared/`       | N6     | `SharedSection` (index column: tabs 'Shared by players' / 'Shared by GM'),            |
 * |                 |        | `SharedPageView` (paper column, views 'shared-players' / 'shared-gm')                 |
 * | `journals/`     | N8     | `JournalsList` (index column: 'Players’ journals' (GM), 'Past journals'),             |
 * |                 |        | `JournalView` (paper column, view 'journal')                                          |
 * | `bin/`          | N7     | `TornOutPages` (index column), `BinView` (paper column, view 'bin'), `TearOutButton`  |
 * | `page/`         | N2     | `JournalPage` (paper column, view 'page'; mounts the toolbar slots and `Entries`)     |
 * | `entries/`      | N3     | `Entries` (rows, add row, KEY), `MigrateButton` (page toolbar)                         |
 * | `sharing/`      | N6     | `SharingChip` (page toolbar)                                                          |
 * | `mentions/`     | N5     | `EntryText`, `MentionInput` (used by `entries/`)                                      |
 *
 * Page layout (board Notes.dc.html l.48-180): hero (campaign line, `JournalHeading`, actions `ThreadsButton` +
 * `DownloadJournalButton`), then a 300 px index column (`JournalSearch`, `PageGroups`, `SharedSection`,
 * `JournalsList`, `TornOutPages`, Quick keys card) and the paper column, which shows one view. Dropped from the board:
 * the 'Writing as' switcher (A2) and every PIN control (A1). At 390 px one column.
 *
 * URL state (the page keeps it, so a reload or a shared link opens the same view):
 * `?view=page|threads|shared-players|shared-gm|journal|bin&page=<page id or template-<i>>&journal=<journal id>`.
 * A missing or bad view means 'page'; no `page` means the slot picks its default (N2: the journal's first page).
 * Ids from the URL are untrusted: the server checks them (`pageAccess`: NOTE_PAGE_NOT_FOUND); the slot's boundary
 * shows the error.
 *
 * Rules for every slot:
 * - The page wraps each slot in its own error boundary (CL1); a slot shows its own loading line
 *   (`<p role="status" className="bj-muted">Loading …</p>`) while its `useQuery` is `undefined`.
 * - Cross-slot state changes only through the callbacks (`onPage`, `onView`, `onSearch`).
 * - Styles: the board's classes from the page's `notes.css` (`bj-paper`, `bj-tape`, `bj-row`, `bj-bul`, `bj-text`,
 *   `bj-act`, `bj-ib`, `bj-chip`, `bj-mention`, `bj-add`, `bj-edit`, `bj-key`, `bj-in`, `bj-ghost`, `bj-lbl`,
 *   `bj-added` (added-entry colour, Q3), `bj-muted`, `bj-card`, `bj-tabs`, `bj-alert`; variables `--bj-*`, the accent
 *   `--bj-acc`); a feature adds CSS only in a colocated `.css` in its folder.
 */

/** What the paper column shows. */
export type NotesView = "page" | "threads" | "shared-players" | "shared-gm" | "journal" | "bin";
export const NOTES_VIEWS: readonly NotesView[] = ["page", "threads", "shared-players", "shared-gm", "journal", "bin"];

/** The view a `?view=` value names; anything else is 'page'. */
export function parseView(value: string | null | undefined): NotesView {
  return NOTES_VIEWS.includes(value as NotesView) ? (value as NotesView) : "page";
}

/** `?page=` for the i-th default page before the journal exists (CL6: the first write creates it). */
export function templateParam(index: number): string {
  return `template-${index}`;
}

/** The page ref (convex/lib/validators/notes.ts `pageRefValidator`) a `?page=` value names, or null for none. */
export function toPageRef(pageParam: string | null): PageRef | null {
  if (!pageParam) return null;
  const template = /^template-(\d+)$/.exec(pageParam);
  if (template) return { template: Number(template[1]) };
  return pageParam as Id<"journalPages">;
}

/** Who is looking. `isGm` = `useCampaign().role === "gm"` (UI only; the server decides every read and action). */
export type NotesAccess = { isGm: boolean };

/** The props every slot gets. */
export type NotesSlotProps = {
  campaignId: Id<"campaigns">;
  access: NotesAccess;
  /** `?journal=` (view 'journal'), untrusted. */
  journalId: string | null;
  /** `?page=`: a page id or `template-<i>`, untrusted; `toPageRef` turns it into a page ref. */
  pageId: string | null;
  view: NotesView;
  /** The search box's text (B9); '' when empty. */
  search: string;
  /** Own page ids matching `search` (N4 `useJournalSearch`); null while there is no search (or it loads). */
  matchingPageIds: ReadonlySet<string> | null;
  /** Opens a page (own, shared, a journal's or a torn-out one) in a view; null page clears `?page`. */
  onPage: (pageId: string | null, view?: NotesView) => void;
  /** Switches the view; `journalId` sets (or with null clears) `?journal`. */
  onView: (view: NotesView, journalId?: string | null) => void;
  onSearch: (text: string) => void;
};

/** `useJournalSearch(args)`: the own pages matching the search (N4). */
export type JournalSearchArgs = { campaignId: Id<"campaigns">; search: string };

/** `EntryText` (N5): an entry's text with D7 mention tokens rendered for the viewer. */
export type EntryTextProps = { campaignId: Id<"campaigns">; text: string };

/** `MentionInput` (N5): the add / edit field with the @ picker (Q6); mentions show as name chips (dcm-bxp.106). */
export type MentionInputProps = {
  campaignId: Id<"campaigns">;
  label: string;
  placeholder: string;
  className?: string;
  /** The stored text (with D7 tokens) the field starts with. */
  defaultValue?: string;
  /** Focus the field with the caret at the end when it mounts (the edit row). */
  autoFocus?: boolean;
  /** Enter with text: the token-carrying text to save. */
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  /** The field lost focus: its token-carrying text (the edit row saves on blur). */
  onBlurText?: (text: string) => void;
};
