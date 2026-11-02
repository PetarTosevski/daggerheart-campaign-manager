import { useQuery } from "convex/react";
import { createContext, useContext, type ReactNode } from "react";

import type { JournalView } from "../../../../../convex/notes";
import { api, type Id } from "../../convex";

const JournalContext = createContext<JournalView | undefined>(undefined);

/** One `notes.journal` subscription for the whole notes tree (Convex dedupes on web; the test harness does not). */
export function NotesJournalProvider({
  campaignId,
  children,
}: {
  campaignId: Id<"campaigns">;
  children: ReactNode;
}) {
  const journal = useQuery(api.notes.journal, { campaignId });
  return <JournalContext.Provider value={journal}>{children}</JournalContext.Provider>;
}

export function useJournal(): JournalView | undefined {
  return useContext(JournalContext);
}
