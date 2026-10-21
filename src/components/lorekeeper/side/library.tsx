"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { ADD_PDF_LABEL, BOOK_INDEXED, BOOK_OFF, LIBRARY_COPY, LIBRARY_EMPTY, LIBRARY_TITLE, booksIndexedLabel } from "@/lib/lorekeeper/copy";

import { api } from "../../../../convex/_generated/api";
import type { LibraryBook } from "../../../../convex/lorekeeperLibrary";
import type { LorekeeperSideProps } from "../slots";
import { setEnabledLocally } from "./optimistic";

/** The spine's class: `lk-cover-<token>` from lorekeeper.css; unknown tokens fall back to the frame's green. */
const COVERS = new Set(["core", "hopeFear", "frame", "houseRules"]);
function coverClass(cover: string): string {
  return `lk-book lk-cover-${COVERS.has(cover) ? cover : "frame"}`;
}

/**
 * The Library card (board Lorekeeper.dc.html, page variant): every book the campaign shows with its spine, name,
 * subtitle and the green 'Indexed' / red 'Off' pill. The GM's pill is a switch (optimistic, lorekeeperLibrary.setEnabled);
 * players read it. '＋ Add PDF' (GM) explains the local ingest script (Q6).
 */
export function LibraryCard({ campaignId, access }: LorekeeperSideProps) {
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  const setEnabled = useMutation(api.lorekeeperLibrary.setEnabled).withOptimisticUpdate(setEnabledLocally);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(book: LibraryBook) {
    setError(null);
    try {
      await setEnabled({ campaignId, bookId: book.bookId, enabled: !book.enabled });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <section className="lk-card" aria-label={LIBRARY_TITLE}>
      <div className="lk-cardhead">
        <h2 className="lk-h">{LIBRARY_TITLE}</h2>
        {access.isGm ? (
          <button type="button" className="lk-act lk-act-dark" aria-haspopup="dialog" onClick={() => setAddOpen(true)}>
            {ADD_PDF_LABEL}
          </button>
        ) : null}
      </div>
      <span className="lk-muted">{LIBRARY_COPY}</span>
      {library === undefined ? (
        <span role="status" className="lk-muted">
          Loading…
        </span>
      ) : library.books.length === 0 ? (
        <span className="lk-muted">{LIBRARY_EMPTY}.</span>
      ) : (
        <ul className="lk-books">
          {library.books.map((book) => {
            const state = book.enabled ? BOOK_INDEXED : BOOK_OFF;
            const pill = `lk-pill ${book.enabled ? "lk-ok" : "lk-red"}`;
            return (
              <li key={book.bookId} className="lk-src">
                <span className={coverClass(book.cover)} aria-hidden="true" />
                <div className="lk-srctext">
                  <div className="lk-srcname">{book.title}</div>
                  <div className="lk-muted lk-srcsub">{book.subtitle}</div>
                </div>
                {access.isGm ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={book.enabled}
                    aria-label={`${book.title}: ${state}`}
                    title={book.enabled ? "Turn off to leave this book out" : "Turn on to answer from this book"}
                    className={`${pill} lk-pillswitch`}
                    onClick={() => void toggle(book)}
                  >
                    {state}
                  </button>
                ) : (
                  <span className={pill}>{state}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p role="alert" className="lk-alert">
          {error}
        </p>
      ) : null}
      {access.isGm ? <AddPdfDialog open={addOpen} onClose={() => setAddOpen(false)} /> : null}
    </section>
  );
}

/** Q6: books are added on the GM's computer with `pnpm lorekeeper:ingest`; the dialog says how. */
function AddPdfDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a PDF" className="lk-dialog">
      <div className="lk-help">
        <p className="lk-dialog-text">
          Books are added from your computer, so their text stays on your machine and in your own server. Nothing is uploaded here.
        </p>
        <ol className="lk-steps">
          <li>
            Extract the PDF&apos;s text into a file outside the project folder, one <code>===== PAGE N =====</code> block per
            printed page.
          </li>
          <li>
            In the project folder, run:
            <pre className="lk-code">
              <code>pnpm lorekeeper:ingest &lt;book&gt; &lt;text file&gt;</code>
            </pre>
            for example <code>pnpm lorekeeper:ingest core ~/books/core.txt</code>.
          </li>
          <li>
            The book is one of <code>core</code>, <code>hopeFear</code>, <code>frame:&lt;frame id&gt;</code> or{" "}
            <code>houseRules</code>. Add <code>--prod</code> for the live server.
          </li>
          <li>Running it again replaces that book&apos;s text. The book then shows here as Indexed.</li>
        </ol>
        <p className="lk-muted">
          <code>pnpm lorekeeper:ingest --help</code> lists every option.
        </p>
        <div className="lk-formacts">
          <button type="button" className="lk-send" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The chat header's '<N> books indexed' pill (board: green, 12 px). Nothing until the library has loaded. */
export function IndexPillView({ campaignId }: LorekeeperSideProps) {
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  if (library === undefined) return null;
  return <span className="lk-pill lk-ok lk-indexpill">{booksIndexedLabel(library.indexedCount)}</span>;
}
