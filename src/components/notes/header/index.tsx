"use client";

import type { NotesSlotProps } from "../slots";

/**
 * Hero heading (B1, Q8): H1 '<whoName>’s Journal' and the sub line '<whoSub> · <N> pages · <M> entries'. N0 stub:
 * the GM / player wording without counts; N2 fills it from the `journal` query.
 */
export function JournalHeading({ access }: NotesSlotProps) {
  return (
    <>
      <h1 className="bj-title">{access.isGm ? "Game Master’s Journal" : "Your Journal"}</h1>
      <div className="bj-sub">{access.isGm ? "GM journal · private to the GM" : "Player journal"}</div>
    </>
  );
}
