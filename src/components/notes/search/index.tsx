"use client";

import type { JournalSearchArgs, NotesSlotProps } from "../slots";

/** 'Search the journal' (B2, B9), wired to `onSearch`. */
export function JournalSearch({ search, onSearch }: NotesSlotProps) {
  return (
    <input
      className="bj-in"
      type="search"
      placeholder="Search the journal"
      aria-label="Search the journal"
      value={search}
      onChange={(event) => onSearch(event.target.value)}
    />
  );
}

/** The own page ids matching the search (B9, Q13). N0 stub: null (no filter); N4 fills it from the `search` query. */
export function useJournalSearch(args: JournalSearchArgs): ReadonlySet<string> | null {
  void args; // N0 stub: the feature tracer uses them.
  return null;
}
