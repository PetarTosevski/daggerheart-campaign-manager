import type { JournalView } from "../../../../../convex/notes";
import { useJournalData } from "../journal/data";

/**
 * The caller's notes journal (`notes.journal`). Notes lives in the Journal's Notes sub-tab, which subscribes once for
 * the whole screen (the 'Notes N pages' count reads it too); Convex dedupes on the web, the test harness does not.
 */
export function useJournal(): JournalView | undefined {
  return useJournalData().notesJournal;
}
