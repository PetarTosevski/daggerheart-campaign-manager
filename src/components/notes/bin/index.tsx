"use client";

import type { NotesSlotProps } from "../slots";

/** 'Torn-out pages' in the index column (Q11): title, 'N days left', 'Restore'. N0 stub: empty; N7 fills it. */
export function TornOutPages(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <section className="bj-group" aria-labelledby="bj-bin-h">
      <div id="bj-bin-h" className="bj-lbl">
        Torn-out pages
      </div>
      <div className="bj-empty">Nothing torn out.</div>
    </section>
  );
}

/** A torn-out page read-only (view 'bin'). N0 stub: an empty paper; N7 fills it. */
export function BinView(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <article className="bj-paper" aria-label="Torn-out page">
      <div className="bj-tape bj-tape-2">Torn out</div>
      <p className="bj-line">Pick a page under Torn-out pages.</p>
    </article>
  );
}

/** 'Tear out page' → 'Click again to tear out' for the page toolbar (B3, B8). N0 stub: disabled; N7 wires it. */
export function TearOutButton(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <button type="button" className="bj-ghost bj-paper-btn bj-danger" disabled>
      Tear out page
    </button>
  );
}
