import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { useCampaign } from "../../shell/campaign-provider";
import { colors } from "../../theme/colors";
import { space } from "../../theme/spacing";
import { TornOutPages } from "./bin";
import { DownloadJournalButton } from "./export";
import { JournalHeading } from "./header";
import { PageGroups } from "./index-column";
import { JournalsList } from "./journals";
import { PaperColumn } from "./paper-column";
import { NotesSlotBoundary } from "./query-boundary";
import { JournalSearch, useJournalSearch } from "./search";
import { SharedSection } from "./shared";
import type { NotesSlotProps, NotesView } from "./slots";
import { notesStyles } from "./styles";
import { ThreadsButton } from "./threads";
import { NotesJournalProvider } from "./journal-context";
import { selectedPage, useJournal } from "./use-journal";

export function NotesScreen({ initialPageId }: { initialPageId?: string | null }) {
  return (
    <NotesSlotBoundary label="Notes">
      <NotesBody initialPageId={initialPageId ?? null} />
    </NotesSlotBoundary>
  );
}

function NotesBody({ initialPageId }: { initialPageId: string | null }) {
  const campaign = useCampaign();
  const campaignId = campaign._id;
  const isGm = campaign.role === "gm";
  const [search, setSearch] = useState("");
  const [view, setView] = useState<NotesView>("page");
  const [pageId, setPageId] = useState<string | null>(initialPageId);
  const [journalId, setJournalId] = useState<string | null>(null);
  const matchingPageIds = useJournalSearch({ campaignId, search });
  return (
    <NotesJournalProvider campaignId={campaignId}>
      <NotesBodyInner
        campaign={campaign}
        campaignId={campaignId}
        isGm={isGm}
        journalId={journalId}
        matchingPageIds={matchingPageIds}
        pageId={pageId}
        search={search}
        setJournalId={setJournalId}
        setPageId={setPageId}
        setSearch={setSearch}
        setView={setView}
        view={view}
      />
    </NotesJournalProvider>
  );
}

function NotesBodyInner({
  campaign,
  campaignId,
  isGm,
  search,
  setSearch,
  view,
  setView,
  pageId,
  setPageId,
  journalId,
  setJournalId,
  matchingPageIds,
}: {
  campaign: ReturnType<typeof useCampaign>;
  campaignId: NotesSlotProps["campaignId"];
  isGm: boolean;
  search: string;
  setSearch: (text: string) => void;
  view: NotesView;
  setView: (view: NotesView) => void;
  pageId: string | null;
  setPageId: (id: string | null) => void;
  journalId: string | null;
  setJournalId: (id: string | null) => void;
  matchingPageIds: ReadonlySet<string> | null;
}) {
  const journal = useJournal();
  const current = view === "page" && journal ? selectedPage(journal, pageId) : null;

  function onPage(nextPageId: string | null, nextView?: NotesView) {
    setPageId(nextPageId);
    if (nextView) setView(nextView);
  }

  function onView(nextView: NotesView, nextJournalId?: string | null) {
    setView(nextView);
    if (nextJournalId !== undefined) setJournalId(nextJournalId);
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
      <View style={notesStyles.hero}>
        <Text style={notesStyles.campaign}>{campaign.name}</Text>
        <NotesSlotBoundary label="The journal heading">
          <JournalHeading {...slot} />
        </NotesSlotBoundary>
        <View style={notesStyles.actions}>
          <NotesSlotBoundary label="Open threads">
            <ThreadsButton {...slot} />
          </NotesSlotBoundary>
          <NotesSlotBoundary label="Download">
            <DownloadJournalButton {...slot} />
          </NotesSlotBoundary>
        </View>
      </View>

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
        <View style={notesStyles.card}>
          <Text style={notesStyles.label}>Quick keys</Text>
          <Text style={notesStyles.cardText}>
            Start a line with * task · o event · - note · ! idea · + Hope · ^ Fear
          </Text>
          <Text style={notesStyles.cardText}>Type @name to link someone or somewhere from Characters & Locations.</Text>
        </View>
      </View>

      <View style={{ gap: space[2] }}>
        {current ? (
          <Text style={{ color: colors.subtle, fontSize: 13 }}>
            Viewing: {current.title}
          </Text>
        ) : null}
        <PaperColumn {...slot} />
      </View>
    </ScrollView>
  );
}
