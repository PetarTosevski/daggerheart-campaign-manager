"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { Component, type ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Sessions as the hub (TASK-SESSIONS-HUB): the 'Session N' chip that links the encounter tracker and the Combat Map
 * back to that session's Play stage. Styled with utility classes (not `ss-*`), since it sits on other pages.
 */

/** The Play stage of one session (the Sessions page's URL state, slots.ts). */
export function sessionPlayHref(campaignId: string, sessionId: string): string {
  return `/campaigns/${campaignId}/sessions?s=${sessionId}&stage=play`;
}

/** The encounter tracker's deep link (the Adversaries page's `?tab=encounters&encounter=`). */
export function encounterTrackerHref(campaignId: string, encounterId: string): string {
  return `/campaigns/${campaignId}/adversaries?tab=encounters&encounter=${encounterId}`;
}

/** A chip is decoration: if its query fails, it disappears instead of taking its host down (CL1). */
class ChipBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function SessionChip({ campaignId, sessionId, n, live }: { campaignId: string; sessionId: string; n: number; live: boolean }) {
  return (
    <Link
      href={sessionPlayHref(campaignId, sessionId)}
      aria-label={`Session ${n}${live ? ", live" : ""}: open its Play stage`}
      data-testid="session-chip"
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-[#3f6a4a] bg-black/45 px-4 text-[14px] whitespace-nowrap text-[#d8f0e0] no-underline hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5fd38d]"
    >
      <span aria-hidden="true" className={live ? "size-2 rounded-full bg-[#56e0a8] shadow-[0_0_8px_#3fd39a]" : "size-2 rounded-full bg-[#4a5c62]"} />
      Session {n}
    </Link>
  );
}

function TrackerChip({ campaignId, encounterId }: { campaignId: Id<"campaigns">; encounterId: string }) {
  const current = useQuery(api.sessionPrep.current, { campaignId });
  if (!current || current.encounterId !== encounterId) return null;
  return <SessionChip campaignId={campaignId} sessionId={current.sessionId} n={current.n} live={current.live} />;
}

/** GM, encounter tracker: the chip when the open encounter is the live (else newest planned) session's encounter. */
export function TrackerSessionChip(props: { campaignId: Id<"campaigns">; encounterId: string }) {
  return (
    <ChipBoundary>
      <TrackerChip {...props} />
    </ChipBoundary>
  );
}

function LiveChip({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const summary = useQuery(api.sessionWrap.dashboard, { campaignId });
  if (!summary?.live) return null;
  return <SessionChip campaignId={campaignId} sessionId={summary.live.sessionId} n={summary.live.n} live />;
}

/** GM, Combat Map header: the chip while a session is live. */
export function LiveSessionChip(props: { campaignId: Id<"campaigns"> }) {
  return (
    <ChipBoundary>
      <LiveChip {...props} />
    </ChipBoundary>
  );
}
