"use client";

import "./sessions.css";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Component, Suspense, useRef, type KeyboardEvent, type ReactNode } from "react";

import { NoSessionSelected, PlayerSessionView, SessionHeaderCard } from "@/components/sessions/detail";
import { NewSessionButton, SessionHeaderLine, SessionList, useDefaultSessionId } from "@/components/sessions/list";
import { LiveCard } from "@/components/sessions/live";
import { PlayStage } from "@/components/sessions/play";
import { PrepStage } from "@/components/sessions/prep";
import { parseStage, SESSION_STAGES, type SessionSlotProps, type SessionStage } from "@/components/sessions/slots";
import { WrapStage } from "@/components/sessions/wrap";

import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { CampaignSummary } from "../../../../../../convex/campaigns";
import { useCampaign } from "../campaign-shell";

/**
 * Sessions (D10): the page shell. S0 owns the layout, the header, the stage tabs and the URL state
 * (`?s=<session id>&stage=prep|play|wrap`); every feature lives in a slot under src/components/sessions/ (contract:
 * slots.ts). Players are not refused (the tab is not gmOnly): they get the list and a read-only view of the selected
 * session, never the stage tabs (Q4), and the server decides what they read.
 */

/** Keeps a failing slot (a `useQuery` that throws) from blanking the page (CL1); "Try again" remounts it. */
class SlotBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean; message: string }> {
  state: { failed: boolean; message: string } = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.label} failed to load`, error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="ss-alert">
        <span>
          {this.props.label} failed to load{this.state.message ? `: ${this.state.message}` : "."}
        </span>
        <button type="button" className="ss-ghost" onClick={() => this.setState({ failed: false, message: "" })}>
          Try again
        </button>
      </div>
    );
  }
}

const tabId = (stage: SessionStage) => `ss-tab-${stage}`;
const PANEL_ID = "ss-stage-panel";

/** The board's Prep / Play / Wrap-up tabs (B2, GM only): arrow keys, Home and End move between them (ARIA tabs). */
function StageTabs({ stage, onStage }: { stage: SessionStage; onStage: (stage: SessionStage) => void }) {
  const refs = useRef<Partial<Record<SessionStage, HTMLButtonElement | null>>>({});
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const i = SESSION_STAGES.findIndex((s) => s.id === stage);
    const last = SESSION_STAGES.length - 1;
    const next =
      event.key === "ArrowRight" ? (i + 1) % SESSION_STAGES.length
      : event.key === "ArrowLeft" ? (i + last) % SESSION_STAGES.length
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const target = SESSION_STAGES[next]!.id;
    onStage(target);
    refs.current[target]?.focus();
  }
  return (
    <div role="tablist" aria-label="Session stage" className="ss-tabs" onKeyDown={onKeyDown}>
      {SESSION_STAGES.map(({ id, label }) => (
        <button
          key={id}
          ref={(el) => {
            refs.current[id] = el;
          }}
          type="button"
          role="tab"
          id={tabId(id)}
          aria-selected={stage === id}
          aria-controls={PANEL_ID}
          tabIndex={stage === id ? 0 : -1}
          onClick={() => onStage(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** GM detail column: header card, live card, stage tabs and the selected stage. */
function GmDetail({ slot, onDeleted }: { slot: SessionSlotProps; onDeleted: () => void }) {
  return (
    <>
      <SlotBoundary label="The session">
        <SessionHeaderCard {...slot} onDeleted={onDeleted} />
      </SlotBoundary>
      <SlotBoundary label="The live session">
        <LiveCard {...slot} />
      </SlotBoundary>
      <StageTabs stage={slot.stage} onStage={slot.onStage} />
      <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(slot.stage)} className="ss-panel">
        {slot.stage === "prep" ? (
          <SlotBoundary label="Prep">
            <PrepStage {...slot} />
          </SlotBoundary>
        ) : slot.stage === "play" ? (
          <SlotBoundary label="Play">
            <PlayStage {...slot} />
          </SlotBoundary>
        ) : (
          <SlotBoundary label="Wrap-up">
            <WrapStage {...slot} />
          </SlotBoundary>
        )}
      </div>
    </>
  );
}

/** Everything that depends on the URL (`useSearchParams` needs the Suspense boundary of the page). */
function SessionsBody({ campaign, isGm }: { campaign: CampaignSummary; isGm: boolean }) {
  const campaignId = campaign._id;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const defaultId = useDefaultSessionId({ campaignId, isGm });
  const urlId = params.get("s");
  // An id from the URL is untrusted: the slots' queries load it with loadSession (SESSION_NOT_FOUND otherwise).
  const selectedId = urlId ? (urlId as Id<"sessions">) : (defaultId ?? null);
  const stage = parseStage(params.get("stage"));

  /** Rewrites `?s` / `?stage` (null removes one) without a scroll jump or a new history entry. */
  function navigate(next: { s?: string | null; stage?: SessionStage | null }) {
    const query = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) continue;
      if (value === null) query.delete(name);
      else query.set(name, value);
    }
    const text = query.toString();
    router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
  }

  const onStage = (next: SessionStage) => navigate({ s: selectedId, stage: next });

  return (
    <>
      <header className="ss-head">
        <div className="ss-head-text">
          <div className="ss-campaign">{campaign.name}</div>
          <h1 className="ss-title">Sessions</h1>
          <div className="ss-headline">
            <SlotBoundary label="The header line">
              <SessionHeaderLine campaignId={campaignId} isGm={isGm} />
            </SlotBoundary>
          </div>
        </div>
        {isGm ? (
          <SlotBoundary label="New session">
            <NewSessionButton campaignId={campaignId} isGm={isGm} onCreated={(id) => navigate({ s: id, stage: "prep" })} />
          </SlotBoundary>
        ) : null}
      </header>
      <main className="ss-main">
        <aside className="ss-aside" aria-label="Session list">
          <div className="ss-lbl">All sessions</div>
          <SlotBoundary label="The session list">
            <SessionList campaignId={campaignId} isGm={isGm} selectedId={selectedId} onSelect={(id) => navigate({ s: id })} />
          </SlotBoundary>
        </aside>
        <section className="ss-detail" aria-label="Session detail">
          {urlId === null && defaultId === undefined ? (
            <p role="status" className="ss-muted ss-m0">
              Loading sessions…
            </p>
          ) : selectedId === null ? (
            <NoSessionSelected campaignId={campaignId} isGm={isGm} />
          ) : isGm ? (
            <GmDetail
              slot={{ campaignId, isGm, sessionId: selectedId, stage, onStage }}
              onDeleted={() => navigate({ s: null, stage: null })}
            />
          ) : (
            <SlotBoundary label="The session">
              <PlayerSessionView campaignId={campaignId} isGm={isGm} sessionId={selectedId} />
            </SlotBoundary>
          )}
        </section>
      </main>
    </>
  );
}

export default function SessionsPage() {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  return (
    <div className="ss-root" data-role={isGm ? "gm" : "player"}>
      <title>{`Sessions · ${campaign.name}`}</title>
      <SlotBoundary label="Sessions">
        <Suspense
          fallback={
            <p role="status" className="ss-muted ss-head">
              Loading sessions…
            </p>
          }
        >
          <SessionsBody campaign={campaign} isGm={isGm} />
        </Suspense>
      </SlotBoundary>
    </div>
  );
}
