import type { PageRef } from "../../../../../convex/lib/validators/notes";
import type { JournalPageItem, JournalTemplateItem, JournalView } from "../../../../../convex/notes";
import { templateParam } from "./slots";

export { useJournal } from "./journal-context";

export type OwnPage = JournalPageItem | JournalTemplateItem;

export function ownPages(view: JournalView): OwnPage[] {
  return view.journal === null ? view.templates : view.pages;
}

export function pageParam(page: OwnPage): string {
  return "_id" in page ? page._id : templateParam(page.template);
}

export function pageRef(page: OwnPage): PageRef {
  return "_id" in page ? page._id : { template: page.template };
}

export function selectedPage(view: JournalView, param: string | null): OwnPage | null {
  const pages = ownPages(view);
  if (!param) return pages[0] ?? null;
  const template = /^template-(\d+)$/.exec(param);
  if (template) return pages.find((p) => p.template === Number(template[1])) ?? null;
  return pages.find((p) => "_id" in p && p._id === param) ?? null;
}
