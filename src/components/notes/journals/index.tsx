"use client";

import type { NotesSlotProps } from "../slots";

/**
 * The journals lists of the index column: 'Players’ journals' for the GM (Q2) and 'Past journals' for everyone (Q12).
 * N0 stub: the empty lists; N8 fills them.
 */
export function JournalsList({ access }: NotesSlotProps) {
  return (
    <>
      {access.isGm ? (
        <section className="bj-group" aria-labelledby="bj-players-h">
          <div id="bj-players-h" className="bj-lbl">
            Players’ journals
          </div>
          <div className="bj-empty">No player has written yet.</div>
        </section>
      ) : null}
      <section className="bj-group" aria-labelledby="bj-past-h">
        <div id="bj-past-h" className="bj-lbl">
          Past journals
        </div>
        <div className="bj-empty">No past journals.</div>
      </section>
    </>
  );
}

/** Another person's journal, read-only (view 'journal', `journalId`). N0 stub: an empty paper; N8 fills it. */
export function JournalView(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <article className="bj-paper" aria-label="Journal">
      <div className="bj-tape bj-tape-3">Journal</div>
      <p className="bj-line">Pick a journal from the list.</p>
    </article>
  );
}
