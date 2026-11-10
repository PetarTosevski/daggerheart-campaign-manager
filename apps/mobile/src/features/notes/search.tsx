import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { TextInput } from "react-native";

import { NOTE_LIMITS, normalizeQuery } from "../../../../../src/lib/domain/notes";
import { api } from "../../convex";
import type { JournalSearchArgs, NotesSlotProps } from "./slots";
import { notesStyles } from "./styles";

export const SEARCH_DEBOUNCE_MS = 250;

export function JournalSearch({ search, onSearch }: NotesSlotProps) {
  return (
    <TextInput
      accessibilityLabel="Search the journal"
      maxLength={NOTE_LIMITS.TITLE_MAX}
      onChangeText={onSearch}
      placeholder="Search the journal"
      placeholderTextColor={notesStyles.muted.color}
      style={notesStyles.pageTitle}
      value={search}
    />
  );
}

function useDebounced(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function useJournalSearch({ campaignId, search }: JournalSearchArgs): ReadonlySet<string> | null {
  const text = normalizeQuery(search).slice(0, NOTE_LIMITS.TITLE_MAX);
  const settled = useDebounced(text, SEARCH_DEBOUNCE_MS);
  const ids = useQuery(api.notesThreads.search, text !== "" && settled !== "" ? { campaignId, text: settled } : "skip");
  return useMemo(() => (ids === undefined ? null : new Set<string>(ids)), [ids]);
}
