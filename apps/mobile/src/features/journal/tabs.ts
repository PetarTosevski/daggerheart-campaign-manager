/**
 * The Journal's sub-tabs, as on the website (`?tab=sessions|notes`, src/components/journal/slots.ts): Sessions is the
 * default and any other value falls back to it. The old /sessions and /notes routes redirect here with `tab` set.
 */
export const JOURNAL_TABS = ["sessions", "notes"] as const;

export type JournalTab = (typeof JOURNAL_TABS)[number];

export const JOURNAL_TAB_LABEL: Record<JournalTab, string> = { sessions: "Sessions", notes: "Notes" };

export function parseJournalTab(value: string | null | undefined): JournalTab {
  return value === "notes" ? "notes" : "sessions";
}

export function journalHref(campaignId: string, tab: JournalTab): string {
  return `/campaign/${campaignId}/journal?tab=${tab}`;
}
