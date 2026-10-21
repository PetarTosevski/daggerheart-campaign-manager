"use client";

import { TearOutButton } from "../bin";
import { Entries, MigrateButton } from "../entries";
import { SharingChip } from "../sharing";
import type { NotesSlotProps } from "../slots";

/**
 * The paper for one own page (B3): washi tape with the title, title input, meta, '🎀 Tape', the toolbar slots
 * (`MigrateButton`, `SharingChip`, `TearOutButton`) and `Entries`. N0 stub: an empty paper with the toolbar slots;
 * N2 fills it from the `journal` query and the page ref in `pageId`.
 */
export function JournalPage(props: NotesSlotProps) {
  return (
    <article className="bj-paper" aria-label="Page">
      <div className="bj-tape bj-tape-0">Journal</div>
      <div className="bj-toolbar">
        <MigrateButton {...props} />
        <SharingChip {...props} />
        <TearOutButton {...props} />
      </div>
      <Entries {...props} />
    </article>
  );
}
