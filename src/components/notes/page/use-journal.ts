"use client";

import { useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { PageRef } from "../../../../convex/lib/validators/notes";
import type { JournalPageItem, JournalTemplateItem, JournalView } from "../../../../convex/notes";
import { templateParam } from "../slots";

/**
 * The caller's current journal (`notes.journal`, D3) for the hero, the index column and the page (N2). One query,
 * shared by the three slots (the Convex client dedupes it). `undefined` while loading.
 */
export function useJournal(campaignId: Id<"campaigns">): JournalView | undefined {
  return useQuery(api.notes.journal, { campaignId });
}

/** An own page as the slots show it: a real page, or a default page before the journal exists (CL6). */
export type OwnPage = JournalPageItem | JournalTemplateItem;

/** The journal's pages, or the templates before the first write. */
export function ownPages(view: JournalView): OwnPage[] {
  return view.journal === null ? view.templates : view.pages;
}

/** The `?page=` value for an own page: its id, or `template-<i>` before the journal exists. */
export function pageParam(page: OwnPage): string {
  return "_id" in page ? page._id : templateParam(page.template);
}

/** The ref a write sends for an own page (`pageRefValidator`). */
export function pageRef(page: OwnPage): PageRef {
  return "_id" in page ? page._id : { template: page.template };
}

/**
 * The own page `?page=` names: an id, or `template-<i>` (a default page, before or after the journal exists). No
 * `?page` means the first page. Null when the value names no own page (another person's page, or one torn out).
 */
export function selectedPage(view: JournalView, param: string | null): OwnPage | null {
  const pages = ownPages(view);
  if (!param) return pages[0] ?? null;
  const template = /^template-(\d+)$/.exec(param);
  if (template) return pages.find((p) => p.template === Number(template[1])) ?? null;
  return pages.find((p) => "_id" in p && p._id === param) ?? null;
}
