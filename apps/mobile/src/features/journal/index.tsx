import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { space } from "../../theme/spacing";
import { NotesScreen } from "../notes";
import { parseView } from "../notes/slots";
import { JournalDataProvider, useJournalData } from "./data";
import { JournalHeader } from "./header";
import { SessionLog } from "./log";
import { PlanView } from "./plan";
import { AfterSession, Recap } from "./recap";
import { SessionHeading } from "./session-head";
import { CampaignSoFar, PlanSessionButton, SessionList } from "./session-list";
import { js } from "./styles";
import { JOURNAL_TAB_LABEL, JOURNAL_TABS, parseJournalTab, parseSessionView, SESSION_VIEWS, type JournalTab, type SessionView } from "./tabs";
import { SessionTally, Spotlight } from "./tally";
import { ThreadsRaised } from "./threads";
import { Button } from "../../ui/button";
import { Slot, Tabs } from "./ui";
import { defaultSessionId } from "../../../../../src/components/journal/slots";

export { JOURNAL_TABS, journalHref, parseJournalTab, type JournalTab } from "./tabs";

/**
 * `?s=all`: the session list. With no `s` the Journal opens, like the website, on the live session, else the newest the
 * caller may see (`defaultSessionId`); '‹ All sessions' writes this value so the list stays reachable on a phone.
 */
export const ALL_SESSIONS = "all";

/** The Journal's URL params as the route reads them (each first value, or undefined). */
export type JournalParams = { tab?: string; s?: string; sv?: string; view?: string; page?: string };

/** Rewrites the given params (null removes one) and keeps the rest; the route turns it into `router.setParams`. */
export type JournalNavigate = (next: Partial<Record<keyof JournalParams, string | null>>) => void;

/**
 * The Journal (the website's /journal page, src/app/(gm)/campaigns/[campaignId]/journal/page.tsx, design
 * reference/designs/journal/journal_views.jpg): the header with the live session and Start / End, the Sessions /
 * Notes sub-tabs, and on Sessions the live session (else the newest; no session at all, or `?s=all`, shows the list:
 * 'All sessions', '+ Plan session N', 'Campaign so far'); a session opens as its own screen with its heading, the GM's Plan / Log & recap toggle and 'Play on the Combat Map'. On a phone the
 * website's columns stack: Plan is the scenes, the GM prep and the Battle Points; Log & recap is the log, the recap,
 * then the GM's tally, the spotlight (players only when the GM's setting allows; the server decides), Threads raised
 * and the GM's After the session. Players never get the toggle, the plan, the tally or After the session (Q5).
 * All state is in the URL (`tab`, `s`, `sv`, and the Notes params `view`, `page`), owned by the route.
 */
export function JournalScreen({ params, onNavigate }: { params: JournalParams; onNavigate: JournalNavigate }) {
  const campaignId = useCampaign()._id;
  return (
    <Slot label="The journal">
      <JournalDataProvider campaignId={campaignId}>
        <JournalBody onNavigate={onNavigate} params={params} />
      </JournalDataProvider>
    </Slot>
  );
}

function JournalBody({ params, onNavigate }: { params: JournalParams; onNavigate: JournalNavigate }) {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  const { sessions, notesJournal } = useJournalData();
  const tab = parseJournalTab(params.tab);
  const view = parseSessionView(params.sv, isGm);
  const urlId = params.s && params.s !== ALL_SESSIONS ? (params.s as Id<"sessions">) : null;
  const defaultId = params.s === ALL_SESSIONS ? null : defaultSessionId(sessions);
  // undefined: no `s` and the list is still loading.
  const selectedId = urlId ?? defaultId;

  const openSession = (id: Id<"sessions">, sv?: SessionView) => onNavigate({ tab: "sessions", s: id, ...(sv ? { sv } : {}) });
  const openPage = (pageId: string) => onNavigate({ tab: "notes", view: null, page: pageId });
  const pageCount = notesJournal === undefined ? undefined : notesJournal.journal === null ? notesJournal.templates.length : notesJournal.journal.pageCount;
  const count: Record<JournalTab, string> = {
    sessions: sessions === undefined ? "" : ` ${sessions.length}`,
    notes: pageCount === undefined ? "" : ` · ${pageCount} ${pageCount === 1 ? "page" : "pages"}`,
  };

  const top = (
    <View style={{ gap: space[3] }}>
      <JournalHeader onOpenSession={openSession} onThreads={() => onNavigate({ tab: "notes", view: "threads" })} selectedId={selectedId ?? null} />
      <Tabs
        label="Journal"
        onSelect={(next) => onNavigate({ tab: next })}
        selected={tab}
        tabs={JOURNAL_TABS.map((id) => ({ id, label: `${JOURNAL_TAB_LABEL[id]}${count[id]}` }))}
      />
    </View>
  );

  if (tab === "notes") {
    return (
      <NotesScreen
        header={top}
        onNavigate={(next) => onNavigate(next)}
        pageId={params.page ?? null}
        view={parseView(params.view)}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={[js.scroll, { paddingHorizontal: space[4] }]}>
      {top}
      {selectedId === undefined ? (
        <Text style={js.muted}>Loading the session…</Text>
      ) : selectedId === null ? (
        <>
          <Slot label="The session list">
            <SessionList onSelect={(id) => openSession(id)} selectedId={null} />
          </Slot>
          {isGm ? (
            <Slot label="Plan session">
              <PlanSessionButton onCreated={(id) => openSession(id, "plan")} />
            </Slot>
          ) : null}
          <Slot label="Campaign so far">
            <CampaignSoFar />
          </Slot>
        </>
      ) : (
        <SessionScreen
          onBack={() => onNavigate({ s: ALL_SESSIONS, sv: null })}
          onOpenPage={openPage}
          onView={(sv) => onNavigate({ s: selectedId, sv })}
          sessionId={selectedId}
          view={view}
        />
      )}
    </ScrollView>
  );
}

function SessionScreen({
  sessionId,
  view,
  onView,
  onBack,
  onOpenPage,
}: {
  sessionId: Id<"sessions">;
  view: SessionView;
  onView: (view: SessionView) => void;
  onBack: () => void;
  onOpenPage: (pageId: string) => void;
}) {
  const campaign = useCampaign();
  const router = useRouter();
  const isGm = campaign.role === "gm";
  const { sessions } = useJournalData();
  const ids = { campaignId: campaign._id, sessionId };
  const back = (
    <Pressable accessibilityLabel="All sessions" accessibilityRole="button" onPress={onBack} style={js.link}>
      <Text style={js.linkText}>‹ All sessions</Text>
    </Pressable>
  );
  if (sessions === undefined) {
    return (
      <>
        {back}
        <Text style={js.muted}>Loading the session…</Text>
      </>
    );
  }
  // An id from the URL is untrusted: only a session of the caller's list opens (players never get planned ones).
  const session = sessions.find((s) => s._id === sessionId);

  let columns: ReactNode = null;
  if (session !== undefined && view === "plan") {
    columns = (
      <Slot label="The plan">
        <PlanView ids={ids} status={session.status} />
      </Slot>
    );
  } else if (session !== undefined) {
    columns = (
      <>
        <Slot label="The session log">
          <SessionLog ids={ids} isGm={isGm} />
        </Slot>
        <Slot label="The recap">
          <Recap ids={ids} isGm={isGm} session={session} />
        </Slot>
        {isGm ? (
          <Slot label="The session tally">
            <SessionTally ids={ids} />
          </Slot>
        ) : null}
        <Slot label="The spotlight">
          <Spotlight ids={ids} isGm={isGm} />
        </Slot>
        <Slot label="Threads raised">
          <ThreadsRaised ids={ids} onOpenPage={onOpenPage} />
        </Slot>
        {isGm ? (
          <Slot label="After the session">
            <AfterSession ids={ids} />
          </Slot>
        ) : null}
      </>
    );
  }

  return (
    <>
      {back}
      <Slot label="The session">
        <SessionHeading onDeleted={onBack} session={session} />
      </Slot>
      {session !== undefined ? (
        <>
          {isGm ? <Tabs label="Session view" onSelect={onView} selected={view} tabs={SESSION_VIEWS} /> : null}
          <Button accessibilityLabel="Play on the Combat Map" onPress={() => router.push(`/campaign/${campaign._id}/combat-map`)} variant="solid">
            Play on the Combat Map →
          </Button>
        </>
      ) : null}
      {columns}
    </>
  );
}
