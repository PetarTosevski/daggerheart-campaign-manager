"use client";

import "./index-column.css";

import { useMutation } from "convex/react";
import { Eye, Globe, Lock, UserCheck, Users, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { groupEmptyText, matches, PAGE_GROUPS, pageCountLabel, visibilityLabel, type PageKind, type Visibility } from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SessionPicker } from "../page/session-picker";
import { ownPages, pageParam, selectedPage, useJournal, type OwnPage } from "../page/use-journal";
import type { NotesSlotProps } from "../slots";

/** The visibility mark on an index button (A3-A5, Q14 keeps the full wording on the sharing chip). */
const VISIBILITY_ICON: Record<Visibility, LucideIcon> = {
  gm: Eye,
  private: Lock,
  players: Users,
  everyone: Globe,
  chosen: UserCheck,
};

/**
 * The index column's own pages (B2): 'Session logs' / 'Collections' / 'Future log', each with '＋' ('New session log'
 * opens the session picker, Q5) and its page buttons: tape tab, title, visibility mark, count ('N open' / entry count
 * / nothing); 'Nothing here yet.' / 'No matches.' (B9: `matchingPageIds` filters while searching). At 390 px the
 * groups sit behind a 'Pages' disclosure.
 */
export function PageGroups(props: NotesSlotProps) {
  const { campaignId, search, matchingPageIds, onPage, view: currentView } = props;
  const view = useJournal(campaignId);
  const createPage = useMutation(api.notes.createPage);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<PageKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  if (view === undefined) {
    return (
      <p role="status" className="bj-muted">
        Loading pages…
      </p>
    );
  }

  const pages = ownPages(view);
  const current = currentView === "page" ? selectedPage(view, props.pageId) : null;
  const searching = search.trim() !== "";
  // While searching, N4's matches decide; a default page before the first write has no entries, so its title decides.
  const shown = (page: OwnPage) =>
    !searching || matchingPageIds === null || ("_id" in page ? matchingPageIds.has(page._id) : matches(page.title, search));

  async function add(kind: PageKind, sessionId?: Id<"sessions"> | null) {
    setBusy(kind);
    setError(null);
    try {
      const id = await createPage({ campaignId, kind, ...(sessionId ? { sessionId } : {}) });
      onPage(id, "page");
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  function pick(page: OwnPage) {
    onPage(pageParam(page), "page");
    setOpen(false);
  }

  return (
    <nav className="bj-pages" aria-label="Your pages">
      <button type="button" className="bj-ghost bj-pages-toggle" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> Pages
        {current ? <span className="bj-pages-current">· {current.title}</span> : null}
      </button>
      <div id={listId} className="bj-pages-list" data-open={open}>
        {PAGE_GROUPS.map((group) => {
          const items = pages.filter((p) => p.kind === group.kind && shown(p));
          return (
            <div key={group.kind} className="bj-group" role="group" aria-label={group.label}>
              <div className="bj-lbl bj-group-head">
                <span>{group.label}</span>
                <button
                  type="button"
                  className="bj-ghost bj-plus"
                  aria-label={group.addLabel}
                  title={group.addLabel}
                  disabled={busy !== null}
                  onClick={() => {
                    if (group.kind === "log") setPicking(true);
                    else add(group.kind).catch((e: unknown) => setError(errorMessage(e)));
                  }}
                >
                  ＋
                </button>
              </div>
              {items.map((page) => {
                const Icon = VISIBILITY_ICON[page.visibility];
                const label = visibilityLabel(page.visibility, view.isGm);
                const count = pageCountLabel("entryCount" in page ? page : { openCount: 0, entryCount: 0 });
                const isCurrent = current !== null && pageParam(current) === pageParam(page);
                return (
                  <button
                    key={pageParam(page)}
                    type="button"
                    className="bj-page-btn"
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={() => pick(page)}
                  >
                    <span aria-hidden="true" className={`bj-page-tab bj-tape-${page.tape}`} />
                    <span className="bj-page-name">{page.title}</span>
                    <span className="bj-page-vis" title={label}>
                      <Icon aria-hidden="true" size={13} />
                      <span className="sr-only">{label}</span>
                    </span>
                    {count ? <span className="bj-page-count">{count}</span> : null}
                  </button>
                );
              })}
              {items.length === 0 ? <div className="bj-empty">{groupEmptyText(searching)}</div> : null}
            </div>
          );
        })}
        {error ? (
          <p role="alert" className="bj-pages-error">
            {error}
          </p>
        ) : null}
      </div>
      <SessionPicker
        campaignId={campaignId}
        open={picking}
        title="New session log"
        confirmLabel="Add the page"
        onClose={() => setPicking(false)}
        onPick={(sessionId) => add("log", sessionId)}
      />
    </nav>
  );
}
