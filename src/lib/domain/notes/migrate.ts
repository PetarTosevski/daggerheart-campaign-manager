// Migrating open tasks (D11 N1; board rule B6; D5, D6). Pure module.
//
// B6: "first later page of the same kind, else a new page ('Session <n>' / '<title> (cont.)'); open tasks copied as new
// open entries (author kept, D5), originals migrated; target opens." Board l.296, 328-333.
// D6: "migration to a new log page uses the board title and no link."
//
// Pass the journal's non-binned pages in any order; "later" means a larger `createdAt`, ties broken by array order.
//
// ```ts
// migrationTarget(session1, pages);          // the next session log created after Session 1, or null
// newContinuationTitle(rumors, pages);       // "Rumors & hooks (cont.)"
// const plan = planMigration(page, pages, entries);   // null when the page has no open task
// ```

import { clampTitle } from "./limits";
import type { EntryKind, EntryState, PageKind } from "./types";

/** The page fields migration reads. `id` is any string id (a Convex `Id<"journalPages">` passes). */
export type MigratablePage = { id: string; kind: PageKind; title: string; createdAt: number };

/** The open tasks of a page's entries, in the given order (board l.296). */
export function openTasks<T extends { kind: EntryKind; state: EntryState }>(entries: readonly T[]): T[] {
  return entries.filter((e) => e.kind === "task" && e.state === "open");
}

/** The first page of the same kind created after `page`, or null (a new page is then made). */
export function migrationTarget<P extends MigratablePage>(page: MigratablePage, pages: readonly P[]): P | null {
  const later = pages
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.kind === page.kind && p.id !== page.id && p.createdAt > page.createdAt)
    .sort((a, b) => a.p.createdAt - b.p.createdAt || a.i - b.i);
  return later[0]?.p ?? null;
}

/**
 * The title of the page a migration creates: 'Session <log pages + 1>' for a log, else '<title> (cont.)' (cut to
 * TITLE_MAX with the suffix kept).
 */
export function newContinuationTitle(page: MigratablePage, pages: readonly { kind: PageKind }[]): string {
  if (page.kind === "log") return `Session ${pages.filter((p) => p.kind === "log").length + 1}`;
  return clampTitle(page.title, " (cont.)");
}

/** The Migrate button's tooltip (board l.326). */
export function migrationTip(target: { title: string } | null): string {
  return target
    ? `Copy open tasks to “${target.title}” and mark them > here`
    : "Copy open tasks to a new page and mark them > here";
}

export type MigrationPlan<P, E> = {
  /** The existing target page, or null when a new page must be created with `newPage`. */
  target: P | null;
  /** The page to create when `target` is null: same kind, continuation title, no session link (D6). */
  newPage: { kind: PageKind; title: string } | null;
  /** The open tasks to copy, in page order; each becomes a new entry with state 'open', the same text, star and author. */
  copies: E[];
  /** The originals to set to 'migrated'. Same rows as `copies`. */
  migrate: E[];
};

/** Everything a migration does, or null when the page has no open task (the server answers NOTE_NOTHING_TO_MIGRATE). */
export function planMigration<P extends MigratablePage, E extends { kind: EntryKind; state: EntryState }>(
  page: MigratablePage,
  pages: readonly P[],
  entries: readonly E[],
): MigrationPlan<P, E> | null {
  const tasks = openTasks(entries);
  if (tasks.length === 0) return null;
  const target = migrationTarget(page, pages);
  return {
    target,
    newPage: target ? null : { kind: page.kind, title: newContinuationTitle(page, pages) },
    copies: tasks,
    migrate: tasks,
  };
}
