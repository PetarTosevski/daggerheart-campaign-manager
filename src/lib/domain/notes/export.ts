// 'Download my journal' as one Markdown document (D11 N1; Q9). Pure module; N4 builds the file in the browser from the
// caller's own pages.
//
// Q9: "'Download my journal' exports your own pages as one Markdown file, generated in the browser from data you can
// read". Plan N1: "page headings with kind and date, bullet glyphs and states, mentions as plain names, added entries
// with their author".
//
// Shape:
//   # <whoName>’s Journal
//
//   ## <page title>
//   _<kind word> · <date>_            (pageMeta: the linked session's date, else the creation date)
//
//   - • open task
//   - × done task
//   - – ~~resolved note~~            (struck lines: a struck task, a resolved non-task)
//   - ★ ✦ starred Hope - GM          (added entries end with ' - <author>')
//
// A page without entries gets '_No entries._'. Line breaks inside entry text become spaces.

import { glyphFor, isStruck } from "./bullets";
import { authorSuffix, journalTitle } from "./authors";
import { toPlainText } from "./mentions";
import { pageMeta, type DateOptions } from "./summary";
import type { EntryKind, EntryState, PageKind } from "./types";

export type ExportPage = {
  id: string;
  kind: PageKind;
  title: string;
  createdAt: number;
  /** The linked session the caller can see (its date shows in the meta), else null / absent. */
  session?: { date?: string | null } | null;
};

export type ExportEntry = {
  pageId: string;
  kind: EntryKind;
  state: EntryState;
  star: boolean;
  text: string;
  order: number;
  /** The author label for an added entry (authors.ts authorLabel); absent for the owner's own entries. */
  addedBy?: string | null;
};

/** One entry as a Markdown list item. */
export function entryToMarkdown(entry: Omit<ExportEntry, "pageId" | "order">): string {
  const text = toPlainText(entry.text).replace(/[\r\n]+/g, " ").trim();
  const body = isStruck(entry) && text ? `~~${text}~~` : text;
  const star = entry.star ? "★ " : "";
  const by = entry.addedBy ? authorSuffix(entry.addedBy) : "";
  return `- ${star}${glyphFor(entry)} ${body}${by}`;
}

/**
 * The whole journal: a title, then each page in the given order with its meta line and its entries sorted by `order`.
 * Entries whose page is not in `pages` are left out.
 */
export function journalToMarkdown(input: {
  whoName: string;
  pages: readonly ExportPage[];
  entries: readonly ExportEntry[];
  options?: DateOptions;
}): string {
  const byPage = new Map<string, ExportEntry[]>();
  for (const e of input.entries) {
    const list = byPage.get(e.pageId);
    if (list) list.push(e);
    else byPage.set(e.pageId, [e]);
  }
  const blocks = [`# ${journalTitle(input.whoName)}`];
  for (const page of input.pages) {
    const entries = [...(byPage.get(page.id) ?? [])].sort((a, b) => a.order - b.order);
    const lines = [`## ${page.title}`, `_${pageMeta(page, page.session, input.options)}_`, ""];
    if (entries.length === 0) lines.push("_No entries._");
    else lines.push(...entries.map(entryToMarkdown));
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n") + "\n";
}
