import { useQuery } from "convex/react";
import { createContext, useContext, type ReactNode } from "react";

import type { JournalView } from "../../../../../convex/notes";
import type { ThreadRow } from "../../../../../convex/notesThreads";
import type { SessionListItem } from "../../../../../convex/sessionRecords";
import { api, type Id } from "../../convex";

/**
 * The reads several Journal slots share, subscribed once for the whole screen: the session list (sub-tab count, the
 * list, the heading, the header's Start, the recap for players, the Notes session picker), the caller's open threads
 * (header button, Campaign so far, the Notes threads view) and the caller's notes journal (the 'Notes N pages' count
 * and every Notes slot). Convex dedupes identical subscriptions on the web; the phone test harness does not, and one
 * subscription per read keeps the screen honest about what it loads.
 */
export type JournalData = {
  sessions: SessionListItem[] | undefined;
  threads: ThreadRow[] | undefined;
  notesJournal: JournalView | undefined;
};

const JournalDataContext = createContext<JournalData | null>(null);

export function JournalDataProvider({ campaignId, children }: { campaignId: Id<"campaigns">; children: ReactNode }) {
  const sessions = useQuery(api.sessionRecords.list, { campaignId });
  const threads = useQuery(api.notesThreads.threads, { campaignId });
  const notesJournal = useQuery(api.notes.journal, { campaignId });
  return <JournalDataContext.Provider value={{ sessions, threads, notesJournal }}>{children}</JournalDataContext.Provider>;
}

export function useJournalData(): JournalData {
  const data = useContext(JournalDataContext);
  if (data === null) throw new Error("useJournalData must be used inside JournalDataProvider");
  return data;
}

/** The campaign's sessions newest first, as the caller may see them (players: live and played); undefined loading. */
export function useSessions(): SessionListItem[] | undefined {
  return useJournalData().sessions;
}

/** The caller's open threads (`notesThreads.threads`); undefined loading. */
export function useOpenThreads(): ThreadRow[] | undefined {
  return useJournalData().threads;
}
