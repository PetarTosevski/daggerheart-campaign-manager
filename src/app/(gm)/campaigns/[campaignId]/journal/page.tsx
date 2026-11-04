"use client";

import "@/components/journal/journal.css";

import { useQuery } from "convex/react";
import { ArrowRight, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, type KeyboardEvent } from "react";

import { brandButton } from "@/components/brand/buttons";
import { JournalHeaderActions } from "@/components/journal/header";
import { NotesTab } from "@/components/journal/notes-tab";
import { PlanAside, PlanView } from "@/components/journal/plan";
import { AfterSession, Recap } from "@/components/journal/recap";
import { SessionLog } from "@/components/journal/log";
import { SessionHeading } from "@/components/journal/session-head";
import { CampaignSoFar, PlanSessionButton, SessionList, useSessionList } from "@/components/journal/session-list";
import {
  defaultSessionId,
  JOURNAL_TABS,
  parseSessionView,
  parseTab,
  SESSION_VIEWS,
  type JournalSessionProps,
  type JournalTab,
  type SessionView,
} from "@/components/journal/slots";
import { SessionTally, Spotlight } from "@/components/journal/tally";
import { ThreadsRaised } from "@/components/journal/threads";
import { Card, Chip, SlotBoundary } from "@/components/journal/ui";
import { frameName } from "@/lib/campaign-display";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { useCampaign } from "../campaign-shell";

/**
 * Journal (plan `.omc/plans/journal.yaml`, J1): one tab for Sessions and Notes (design
 * reference/designs/journal/journal_views.jpg). The page owns the header frame, the Sessions / Notes sub-tabs, the
 * Sessions columns, the Plan / Log & recap toggle, the 'Play on the Combat Map' link and the URL state
 * (`?tab=sessions|notes&s=<session id>&sv=plan|log`, plus the Notes params it never touches); every feature lives in
 * a slot under src/components/journal/ (contract: slots.ts). Players get the list, the heading, the log and the recap
 * (Q5), never the toggle; the server decides what each reads.
 */

const TAB_LABEL: Record<JournalTab, string> = { sessions: "Sessions", notes: "Notes" };
const tabId = (tab: JournalTab) => `jr-tab-${tab}`;
const TAB_PANEL = "jr-tab-panel";
const viewId = (view: SessionView) => `jr-view-${view}`;
const VIEW_PANEL = "jr-view-panel";

/** Arrow keys, Home and End move between the tabs of a tablist (ARIA tabs); returns the target index or null. */
function nextTabIndex(key: string, index: number, count: number): number | null {
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The caller's journal page count for the 'Notes N pages' tab (the default pages before the first write). */
function useNotesPageCount(campaignId: Id<"campaigns">): number | undefined {
  const journal = useQuery(api.notes.journal, { campaignId });
  if (journal === undefined) return undefined;
  return journal.journal === null ? journal.templates.length : journal.journal.pageCount;
}

/** 'Sessions N' / 'Notes N pages' (ARIA tabs). */
function SubTabs({
  tab,
  onTab,
  sessionCount,
  pageCount,
}: {
  tab: JournalTab;
  onTab: (tab: JournalTab) => void;
  sessionCount: number | undefined;
  pageCount: number | undefined;
}) {
  const refs = useRef<Partial<Record<JournalTab, HTMLButtonElement | null>>>({});
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(event.key, JOURNAL_TABS.indexOf(tab), JOURNAL_TABS.length);
    if (next === null) return;
    event.preventDefault();
    const target = JOURNAL_TABS[next]!;
    onTab(target);
    refs.current[target]?.focus();
  }
  const count: Record<JournalTab, string | null> = {
    sessions: sessionCount === undefined ? null : String(sessionCount),
    notes: pageCount === undefined ? null : `${pageCount} ${pageCount === 1 ? "page" : "pages"}`,
  };
  return (
    <div role="tablist" aria-label="Journal" className="jr-tabs" onKeyDown={onKeyDown}>
      {JOURNAL_TABS.map((id) => (
        <button
          key={id}
          ref={(el) => {
            refs.current[id] = el;
          }}
          type="button"
          role="tab"
          id={tabId(id)}
          aria-selected={tab === id}
          aria-controls={TAB_PANEL}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => onTab(id)}
        >
          {TAB_LABEL[id]}
          {count[id] !== null ? <> <Chip>{count[id]}</Chip></> : null}
        </button>
      ))}
    </div>
  );
}

/** The GM's Plan / Log & recap toggle (ARIA tabs over the session columns). */
function ViewToggle({ view, onView }: { view: SessionView; onView: (view: SessionView) => void }) {
  const refs = useRef<Partial<Record<SessionView, HTMLButtonElement | null>>>({});
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(event.key, SESSION_VIEWS.findIndex((v) => v.id === view), SESSION_VIEWS.length);
    if (next === null) return;
    event.preventDefault();
    const target = SESSION_VIEWS[next]!.id;
    onView(target);
    refs.current[target]?.focus();
  }
  return (
    <div role="tablist" aria-label="Session view" className="jr-toggle" onKeyDown={onKeyDown}>
      {SESSION_VIEWS.map(({ id, label }) => (
        <button
          key={id}
          ref={(el) => {
            refs.current[id] = el;
          }}
          type="button"
          role="tab"
          id={viewId(id)}
          aria-selected={view === id}
          aria-controls={VIEW_PANEL}
          tabIndex={view === id ? 0 : -1}
          onClick={() => onView(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The two session columns of a view: Plan (GM) or Log & recap (GM and players, Q5). */
function SessionColumns({ slot, view, onOpenPage }: { slot: JournalSessionProps; view: SessionView; onOpenPage: (pageId: string) => void }) {
  if (view === "plan") {
    return (
      <div className="jr-cols">
        <div className="jr-centre">
          <SlotBoundary label="The plan">
            <PlanView {...slot} />
          </SlotBoundary>
        </div>
        <div className="jr-right">
          <SlotBoundary label="Battle points">
            <PlanAside {...slot} />
          </SlotBoundary>
        </div>
      </div>
    );
  }
  return (
    <div className="jr-cols">
      <div className="jr-centre">
        <SlotBoundary label="The session log">
          <SessionLog {...slot} />
        </SlotBoundary>
        <SlotBoundary label="The recap">
          <Recap {...slot} />
        </SlotBoundary>
      </div>
      <div className="jr-right">
        {slot.isGm ? (
          <SlotBoundary label="The session tally">
            <SessionTally {...slot} />
          </SlotBoundary>
        ) : null}
        <SlotBoundary label="The spotlight">
          <Spotlight {...slot} />
        </SlotBoundary>
        <SlotBoundary label="Threads raised">
          <ThreadsRaised {...slot} onOpenPage={onOpenPage} />
        </SlotBoundary>
        <SlotBoundary label="After the session">
          <AfterSession {...slot} />
        </SlotBoundary>
      </div>
    </div>
  );
}

/** Everything that depends on the URL (`useSearchParams` needs the Suspense boundary of the page). */
function JournalBody({ campaign, isGm }: { campaign: CampaignSummary; isGm: boolean }) {
  const campaignId = campaign._id;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sessions = useSessionList(campaignId);
  const pageCount = useNotesPageCount(campaignId);

  const tab = parseTab(params.get("tab"));
  const view = parseSessionView(params.get("sv"), isGm);
  const urlId = params.get("s");
  const defaultId = defaultSessionId(sessions);
  // An id from the URL is untrusted: the slots' queries load it with loadSession (SESSION_NOT_FOUND otherwise).
  const selectedId = urlId ? (urlId as Id<"sessions">) : (defaultId ?? null);

  /** Rewrites the given params (null removes one) without a scroll jump or a new history entry; keeps the rest. */
  function navigate(next: Record<string, string | null | undefined>) {
    const query = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) continue;
      if (value === null) query.delete(name);
      else query.set(name, value);
    }
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  const openSession = (id: Id<"sessions">, sv?: SessionView) => navigate({ tab: null, s: id, ...(sv ? { sv } : {}) });
  const openPage = (pageId: string) => navigate({ tab: "notes", view: null, page: pageId });
  const page = { campaignId, isGm };
  const campaignLine = campaign.frameId === "custom" ? campaign.name : frameName(campaign.frameId);

  return (
    <>
      <header className="jr-head">
        <div className="jr-head-text">
          <div className="jr-campaign">{campaignLine}</div>
          <h1 className="jr-title">Journal</h1>
          <p className="jr-sub">Every session and every note, in one place.</p>
        </div>
        <div className="jr-actions">
          <SlotBoundary label="The header actions">
            <JournalHeaderActions
              {...page}
              selectedId={selectedId}
              onOpenSession={openSession}
              onNotesView={(notesView) => navigate({ tab: "notes", view: notesView })}
            />
          </SlotBoundary>
        </div>
      </header>
      <div className="jr-tabbar">
        <SubTabs tab={tab} onTab={(next) => navigate({ tab: next === "sessions" ? null : next })} sessionCount={sessions?.length} pageCount={pageCount} />
      </div>
      <div role="tabpanel" id={TAB_PANEL} aria-labelledby={tabId(tab)} className="jr-band">
        {tab === "notes" ? (
          <SlotBoundary label="Notes">
            <NotesTab {...page} />
          </SlotBoundary>
        ) : (
          <div className="jr-sessions">
            <aside className="jr-aside" aria-label="All sessions">
              <div className="jr-lbl">All sessions</div>
              <SlotBoundary label="The session list">
                <SessionList {...page} selectedId={selectedId} onSelect={(id) => openSession(id)} />
              </SlotBoundary>
              {isGm ? (
                <SlotBoundary label="Plan session">
                  <PlanSessionButton {...page} onCreated={(id) => openSession(id, "plan")} />
                </SlotBoundary>
              ) : null}
              <SlotBoundary label="Campaign so far">
                <CampaignSoFar {...page} />
              </SlotBoundary>
            </aside>
            <section className="jr-session" aria-label="Session">
              {urlId === null && defaultId === undefined ? (
                <p role="status" className="jr-muted jr-m0">
                  Loading sessions…
                </p>
              ) : selectedId === null ? (
                <Card heading="No sessions yet" className="jr-empty">
                  <p className="jr-muted jr-m0">
                    {isGm
                      ? "Plan the first session on the left. Each session has a plan for before you play, and a log and recap that fill in while you play on the Combat Map."
                      : "Sessions show here once the GM starts the first one."}
                  </p>
                </Card>
              ) : (
                <>
                  <div className="jr-session-top">
                    <div className="jr-heading-slot">
                      <SlotBoundary label="The session">
                        <SessionHeading {...page} sessionId={selectedId} onDeleted={() => navigate({ s: null })} />
                      </SlotBoundary>
                    </div>
                    <div className="jr-session-tools">
                      {isGm ? <ViewToggle view={view} onView={(sv) => navigate({ s: selectedId, sv })} /> : null}
                      <Link
                        href={`/campaigns/${campaignId}/combat-map`}
                        className={brandButton({ variant: "confirm", className: "jr-play" })}
                      >
                        <MapIcon aria-hidden="true" />
                        Play on the Combat Map
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                  {isGm ? (
                    <div role="tabpanel" id={VIEW_PANEL} aria-labelledby={viewId(view)}>
                      <SessionColumns slot={{ ...page, sessionId: selectedId }} view={view} onOpenPage={openPage} />
                    </div>
                  ) : (
                    <SessionColumns slot={{ ...page, sessionId: selectedId }} view="log" onOpenPage={openPage} />
                  )}
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

export default function JournalPage() {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  return (
    <div className="jr-root" data-role={isGm ? "gm" : "player"}>
      <title>{`Journal · ${campaign.name}`}</title>
      <SlotBoundary label="The journal">
        <Suspense
          fallback={
            <p role="status" className="jr-muted jr-head">
              Loading the journal…
            </p>
          }
        >
          <JournalBody campaign={campaign} isGm={isGm} />
        </Suspense>
      </SlotBoundary>
    </div>
  );
}
