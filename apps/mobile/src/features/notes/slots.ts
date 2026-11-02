import type { Id } from "../../convex";
import type { PageRef } from "../../../../../convex/lib/validators/notes";

/** What the paper column shows. */
export type NotesView = "page" | "threads" | "shared-players" | "shared-gm" | "journal" | "bin";
export const NOTES_VIEWS: readonly NotesView[] = ["page", "threads", "shared-players", "shared-gm", "journal", "bin"];

/** The view a stored view value names; anything else is `page`. */
export function parseView(value: string | null | undefined): NotesView {
  return NOTES_VIEWS.includes(value as NotesView) ? (value as NotesView) : "page";
}

/** `template-<i>` for a default page before the journal exists. */
export function templateParam(index: number): string {
  return `template-${index}`;
}

/** The page ref a page id names, or null for none. */
export function toPageRef(pageParam: string | null): PageRef | null {
  if (!pageParam) return null;
  const template = /^template-(\d+)$/.exec(pageParam);
  if (template) return { template: Number(template[1]) };
  return pageParam as Id<"journalPages">;
}

export type NotesAccess = { isGm: boolean };

/** Props every notes slot receives. */
export type NotesSlotProps = {
  campaignId: Id<"campaigns">;
  access: NotesAccess;
  journalId: string | null;
  pageId: string | null;
  view: NotesView;
  search: string;
  matchingPageIds: ReadonlySet<string> | null;
  onPage: (pageId: string | null, view?: NotesView) => void;
  onView: (view: NotesView, journalId?: string | null) => void;
  onSearch: (text: string) => void;
};

export type JournalSearchArgs = { campaignId: Id<"campaigns">; search: string };
