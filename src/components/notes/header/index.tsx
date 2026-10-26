"use client";

import { journalTitle, subLine } from "@/lib/domain/notes";

import { useJournal } from "../page/use-journal";
import type { NotesSlotProps } from "../slots";

/**
 * Hero heading (B1, Q8): H1 '<whoName>’s Journal' ('Game Master’s Journal' for the GM, the journal's character for a
 * player, else the account name) and the sub line '<whoSub> · <N> pages · <M> entries'. Before the first write the
 * counts are the default pages'. No 'Writing as' switcher (A2), no PIN (A1). The actions (threads, download) are
 * other slots.
 */
export function JournalHeading({ campaignId }: NotesSlotProps) {
  const view = useJournal(campaignId);
  if (view === undefined) {
    return (
      <p role="status" className="bj-muted">
        Loading the journal…
      </p>
    );
  }
  const counts = view.journal ?? { pageCount: view.templates.length, entryCount: 0 };
  return (
    <>
      <h1 className="bj-title">{journalTitle(view.whoName)}</h1>
      <div className="bj-sub">{subLine(view.whoSub, counts)}</div>
    </>
  );
}
