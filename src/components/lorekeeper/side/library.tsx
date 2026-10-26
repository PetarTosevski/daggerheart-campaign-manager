"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { ABOUT_BOOKS_LABEL, ABOUT_BOOKS_NOTE, ABOUT_BOOKS_TITLE, BOOK_INDEXED, BOOK_OFF, LIBRARY_COPY, LIBRARY_EMPTY, LIBRARY_TITLE, booksIndexedLabel } from "@/lib/lorekeeper/copy";

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
 * players read it. 'About books' (GM) opens a plain note on where books come from (dcm-bxp.82.4).
 */
export function LibraryCard({ campaignId, access }: LorekeeperSideProps) {
  const library = useQuery(api.lorekeeperLibrary.list, { campaignId });
  const setEnabled = useMutation(api.lorekeeperLibrary.setEnabled).withOptimisticUpdate(setEnabledLocally);
  const [aboutOpen, setAboutOpen] = useState(false);
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
          <button type="button" className="lk-act lk-act-dark" aria-haspopup="dialog" onClick={() => setAboutOpen(true)}>
            {ABOUT_BOOKS_LABEL}
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
      {access.isGm ? <AboutBooksDialog open={aboutOpen} onClose={() => setAboutOpen(false)} /> : null}
    </section>
  );
}

/**
 * dcm-bxp.82.4 (user answer 2026-10-22): every GM sees the same plain note; there is no admin role. How the server's
 * admin ingests a book (commands, --prod, page numbers) is in docs/lorekeeper.md.
 */
function AboutBooksDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={ABOUT_BOOKS_TITLE} className="lk-dialog">
      <div className="lk-help">
        <p className="lk-dialog-text">{ABOUT_BOOKS_NOTE}</p>
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
