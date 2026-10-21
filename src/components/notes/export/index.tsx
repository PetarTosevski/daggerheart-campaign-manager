"use client";

import type { NotesSlotProps } from "../slots";

/** Hero action 'Download my journal' (Q9): one Markdown file of the caller's own pages. N0 stub: disabled; N4 wires it. */
export function DownloadJournalButton(props: NotesSlotProps) {
  void props; // N0 stub: the feature tracer uses them.
  return (
    <button type="button" className="bj-threads" disabled>
      Download my journal
    </button>
  );
}
