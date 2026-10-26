"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { NOTE_LIMITS, normalizeQuery } from "@/lib/domain/notes";

import { api } from "../../../../convex/_generated/api";
import type { JournalSearchArgs, NotesSlotProps } from "../slots";

/** How long the typing settles before the server search runs (the row highlight follows every key, N3). */
export const SEARCH_DEBOUNCE_MS = 250;

/** 'Search the journal' (B2, B9), wired to `onSearch`; at most 80 characters (the server's limit). */
export function JournalSearch({ search, onSearch }: NotesSlotProps) {
  return (
    <input
      className="bj-in"
      type="search"
      placeholder="Search the journal"
      aria-label="Search the journal"
      maxLength={NOTE_LIMITS.TITLE_MAX}
      value={search}
      onChange={(event) => onSearch(event.target.value)}
    />
  );
}

/** `value` once it has stayed the same for `delay` ms (the timer's callback sets state; nothing is copied in render). */
function useDebounced(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * The own page ids matching the search (B9, Q13): `notesThreads.search` on the debounced text, own journal only.
 * Null while there is no search and while an answer loads (the index then shows every page, slots.ts); a blank
 * search skips the query.
 */
export function useJournalSearch({ campaignId, search }: JournalSearchArgs): ReadonlySet<string> | null {
  const text = normalizeQuery(search).slice(0, NOTE_LIMITS.TITLE_MAX);
  const settled = useDebounced(text, SEARCH_DEBOUNCE_MS);
  // While new typing settles, the last settled search keeps filtering; clearing the box clears the filter at once.
  const ids = useQuery(api.notesThreads.search, text !== "" && settled !== "" ? { campaignId, text: settled } : "skip");
  return useMemo(() => (ids === undefined ? null : new Set<string>(ids)), [ids]);
}
