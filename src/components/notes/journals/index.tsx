"use client";

import "./journals.css";

import { useQuery } from "convex/react";

import { pageCountLabel, pageMeta } from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import type { JournalViewPage } from "../../../../convex/notesJournals";
import { TearOutButton } from "../bin";
import { Entries } from "../entries";
import type { NotesSlotProps } from "../slots";

/**
 * Other people's journals (D11 N8; Q2, Q3, Q8, Q12, D1, D2; not on the board, in its look):
 * - `JournalsList` (index column): 'Players’ journals' for the GM (Q2: every present player journal, named after its
 *   character, with the pages the GM can read) and 'Past journals' for everyone (Q12: departed characters' journals).
 *   A row opens the journal view (?view=journal&journal=<id>).
 * - `JournalView` (paper column, view 'journal'): '<character>’s Journal' with 'read only' or 'Past journal · read
 *   only', the journal's pages the viewer can read, and the chosen page (?page=, else the first) with its entries
 *   through N3's `Entries` (the add row only where the server allows it, none on a past journal, D2) and, for the GM on
 *   a past journal's page, N7's 'Tear out page'.
 * The server decides every page and flag (`notesJournals`, permissionFor per page); the UI only shows them.
 */

function pagesLabel(count: number): string {
  return count === 1 ? "1 page" : `${count} pages`;
}

/** The journals lists of the index column. */
export function JournalsList({ campaignId, access, view, journalId, onView }: NotesSlotProps) {
  const players = useQuery(api.notesJournals.playerJournals, access.isGm ? { campaignId } : "skip");
  const past = useQuery(api.notesJournals.pastJournals, { campaignId });
  const current = (id: string) => (view === "journal" && journalId === id ? "page" : undefined);

  return (
    <>
      {access.isGm ? (
        <section className="bj-group bj-jl" aria-labelledby="bj-players-h">
          <div id="bj-players-h" className="bj-lbl">
            Players’ journals
          </div>
          {players === undefined ? (
            <p role="status" className="bj-muted">
              Loading journals…
            </p>
          ) : players.length === 0 ? (
            <div className="bj-empty">No player has written yet.</div>
          ) : (
            <ul className="bj-jl-list" aria-labelledby="bj-players-h">
              {players.map((row) => (
                <li key={row.journalId}>
                  <button type="button" className="bj-jl-btn" aria-current={current(row.journalId)} onClick={() => onView("journal", row.journalId)}>
                    <span aria-hidden="true" className="bj-jl-mark">
                      ✎
                    </span>
                    <span className="bj-jl-text">
                      <span className="bj-jl-name">{row.name}</span>
                      <span className="bj-jl-sub">
                        {row.sub} · {pagesLabel(row.pageCount)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <section className="bj-group bj-jl" aria-labelledby="bj-past-h">
        <div id="bj-past-h" className="bj-lbl">
          Past journals
        </div>
        {past === undefined ? (
          <p role="status" className="bj-muted">
            Loading past journals…
          </p>
        ) : past.length === 0 ? (
          <div className="bj-empty">No past journals.</div>
        ) : (
          <ul className="bj-jl-list" aria-labelledby="bj-past-h">
            {past.map((row) => (
              <li key={row.journalId}>
                <button type="button" className="bj-jl-btn" aria-current={current(row.journalId)} onClick={() => onView("journal", row.journalId)}>
                  <span aria-hidden="true" className="bj-jl-mark bj-jl-mark-past">
                    ❦
                  </span>
                  <span className="bj-jl-text">
                    <span className="bj-jl-name">{row.name}</span>
                    <span className="bj-jl-sub">{pagesLabel(row.pageCount)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Another person's journal, read only (view 'journal', `journalId`). */
export function JournalView(props: NotesSlotProps) {
  const { campaignId, journalId, pageId, onPage } = props;
  const data = useQuery(api.notesJournals.journalView, journalId ? { campaignId, journalId } : "skip");
  if (journalId === null) {
    return (
      <article className="bj-paper" aria-label="Journal">
        <div className="bj-tape bj-tape-3">Journal</div>
        <p className="bj-line">Pick a journal from the list.</p>
      </article>
    );
  }
  if (data === undefined) {
    return (
      <article className="bj-paper" aria-label="Journal">
        <p role="status" className="bj-line">
          Loading the journal…
        </p>
      </article>
    );
  }
  const selected: JournalViewPage | null = data.pages.find((p) => p._id === pageId) ?? data.pages[0] ?? null;
  const status = data.departed ? "Past journal · read only" : "read only";

  return (
    <div className="bj-jv">
      <header className="bj-jv-head">
        <h2 className="bj-jv-title">{data.title}</h2>
        <p className="bj-jv-status">{status}</p>
      </header>
      {data.pages.length > 0 ? (
        <nav aria-label={`Pages of ${data.title}`}>
          <ul className="bj-jv-pages">
            {data.pages.map((page) => (
              <li key={page._id}>
                <button
                  type="button"
                  className="bj-jv-page"
                  aria-current={selected?._id === page._id ? "page" : undefined}
                  onClick={() => onPage(page._id, "journal")}
                >
                  <span aria-hidden="true" className={`bj-jv-tab bj-tape-${page.tape}`} />
                  <span className="bj-jv-page-title">{page.title}</span>
                  {pageCountLabel(page) ? <span className="bj-jv-count">{pageCountLabel(page)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {selected === null ? (
        <article className="bj-paper" aria-label="Journal">
          <div className="bj-tape bj-tape-2">Nothing to read</div>
          <p className="bj-line">No page of this journal is shared with you.</p>
        </article>
      ) : (
        <article className="bj-paper" aria-label="Read-only page">
          <div className={`bj-tape bj-tape-${selected.tape}`}>{selected.title}</div>
          <div className="bj-toolbar">
            <h3 className="bj-jv-heading">{selected.title}</h3>
            <span className="bj-page-meta">{pageMeta({ kind: selected.kind, createdAt: selected.createdAt }, selected.session ?? null)}</span>
            <span className="bj-chip bj-jv-chip">
              <span aria-hidden="true">👁</span>
              {selected.chip}
            </span>
            {selected.canBin && !data.own ? <TearOutButton {...props} pageId={selected._id} view="journal" onPage={onPage} /> : null}
          </div>
          <Entries {...props} pageId={selected._id} />
        </article>
      )}
    </div>
  );
}
