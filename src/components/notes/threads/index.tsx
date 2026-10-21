"use client";

import type { NotesSlotProps } from "../slots";

/** Hero action '🧵 Open threads · N' (B1): toggles the threads view. N0 stub: the count is 0; N4 fills it. */
export function ThreadsButton({ view, onView }: NotesSlotProps) {
  const on = view === "threads";
  return (
    <button type="button" className="bj-threads" aria-pressed={on} onClick={() => onView(on ? "page" : "threads")}>
      🧵 Open threads · 0
    </button>
  );
}

/** The threads view (B5). N0 stub: the empty paper; N4 fills it from the `threads` query. */
export function ThreadsView(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <article className="bj-paper" aria-label="Open threads">
      <div className="bj-tape bj-tape-4">Open threads</div>
      <p className="bj-intro">Every unfinished task and every looming Fear, from all pages.</p>
      <p className="bj-line">Nothing dangling. Suspicious…</p>
    </article>
  );
}
