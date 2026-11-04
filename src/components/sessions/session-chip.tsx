"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { Component, type ReactNode } from "react";

import { brandButton } from "@/components/brand/buttons";
import { journalHref } from "@/components/journal/slots";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Sessions as the hub (TASK-SESSIONS-HUB): the 'Session N' chip that links the encounter tracker and the Combat Map
 * back to that session in the Journal (JX1). Styled with utility classes (not `ss-*`), since it sits on other pages.
 */

/** One session's Log & recap view in the Journal (`?s=<id>&sv=log`, src/components/journal/slots.ts). */
export function sessionPlayHref(campaignId: string, sessionId: string): string {
  return journalHref(campaignId, { s: sessionId, sv: "log" });
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
      aria-label={`Session ${n}${live ? ", live" : ""}: open it in the Journal`}
      data-testid="session-chip"
      className={brandButton({ variant: "neutral", className: "shrink-0 no-underline" })}
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
