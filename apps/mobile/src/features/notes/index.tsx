import { useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { useCampaign } from "../../shell/campaign-provider";
import { colors } from "../../theme/colors";
import { space } from "../../theme/spacing";
import { TornOutPages } from "./bin";
import { DownloadJournalButton } from "./export";
import { PageGroups } from "./index-column";
import { JournalsList } from "./journals";
import { PaperColumn } from "./paper-column";
import { NotesSlotBoundary } from "./query-boundary";
import { JournalSearch, useJournalSearch } from "./search";
import { SharedSection } from "./shared";
import type { NotesSlotProps, NotesView } from "./slots";
import { notesStyles } from "./styles";
import { selectedPage, useJournal } from "./use-journal";

/** Rewrites the Notes params of the Journal's URL (null removes one). */
export type NotesNavigate = (next: { view?: string | null; page?: string | null }) => void;

/**
 * The Journal's Notes sub-tab (website: src/components/journal/notes-tab, the Notes UI without its hero; the Journal
 * header holds the title and Open threads, 'Download my journal' sits with the index). The view and the page are the
 * Journal's URL params (`view`, `page`), so 'Open threads' and Threads raised' 'In Notes' land here; `header` (the
 * Journal header and sub-tabs) scrolls with the notes. Lives inside the Journal's data provider (`notes.journal`,
 * `notesThreads.threads` and `sessionRecords.list`, subscribed once for the screen).
 */
export function NotesScreen({
  view,
  pageId,
  onNavigate,
  header,
}: {
  view: NotesView;
  pageId: string | null;
  onNavigate: NotesNavigate;
  header?: ReactNode;
}) {
  return (
    <NotesSlotBoundary label="Notes">
      <NotesBody header={header} onNavigate={onNavigate} pageId={pageId} view={view} />
    </NotesSlotBoundary>
  );
}

function NotesBody({
  view,
  pageId,
  onNavigate,
  header,
}: {
  view: NotesView;
  pageId: string | null;
  onNavigate: NotesNavigate;
  header?: ReactNode;
}) {
  const campaign = useCampaign();
  const campaignId = campaign._id;
  const isGm = campaign.role === "gm";
  const [search, setSearch] = useState("");
  const [journalId, setJournalId] = useState<string | null>(null);
  const matchingPageIds = useJournalSearch({ campaignId, search });
  const journal = useJournal();
  const current = view === "page" && journal ? selectedPage(journal, pageId) : null;

  function onPage(nextPageId: string | null, nextView?: NotesView) {
    onNavigate({ page: nextPageId, ...(nextView ? { view: nextView === "page" ? null : nextView } : {}) });
  }

  function onView(nextView: NotesView, nextJournalId?: string | null) {
    if (nextJournalId !== undefined) setJournalId(nextJournalId);
    onNavigate({ view: nextView === "page" ? null : nextView });
  }

  const slot: NotesSlotProps = {
    campaignId,
    access: { isGm },
    journalId,
    pageId,
    view,
    search,
    matchingPageIds,
    onPage,
    onView,
    onSearch: setSearch,
  };

  return (
    <ScrollView contentContainerStyle={[notesStyles.screen, { paddingHorizontal: space[4] }]}>
      {header}
      <View style={notesStyles.indexBlock}>
        <NotesSlotBoundary label="Search">
          <JournalSearch {...slot} />
        </NotesSlotBoundary>
        <NotesSlotBoundary label="Your pages">
          <PageGroups {...slot} />
        </NotesSlotBoundary>
        <NotesSlotBoundary label="Shared pages">
          <SharedSection {...slot} />
        </NotesSlotBoundary>
        <NotesSlotBoundary label="Journals">
          <JournalsList {...slot} />
        </NotesSlotBoundary>
        <NotesSlotBoundary label="Torn-out pages">
          <TornOutPages {...slot} />
        </NotesSlotBoundary>
        <NotesSlotBoundary label="Download">
          <DownloadJournalButton {...slot} />
        </NotesSlotBoundary>
        <View style={notesStyles.card}>
          <Text style={notesStyles.label}>Quick keys</Text>
          <Text style={notesStyles.cardText}>Start a line with * task · o event · - note · ! idea · + Hope · ^ Fear</Text>
          <Text style={notesStyles.cardText}>Type @name to link someone or somewhere from Characters & Locations.</Text>
        </View>
      </View>

      <View style={{ gap: space[2] }}>
        {current ? <Text style={{ color: colors.subtle, fontSize: 13 }}>Viewing: {current.title}</Text> : null}
        <PaperColumn {...slot} />
      </View>
    </ScrollView>
  );
}
