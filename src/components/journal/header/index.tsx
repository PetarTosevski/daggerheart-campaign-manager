"use client";

import "./header.css";

import { useMutation, useQuery } from "convex/react";
import { BookOpen, Ellipsis, Spool, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { useOpenTome } from "@/app/(gm)/campaigns/[campaignId]/campaign-shell";
import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
// The live helpers stay in the old Sessions folder until JX2 moves them (plan journal.yaml, JH: imported, not copied).
import { endDialogText, endReportLines, startReportLines, useWitherChoice, WitherChoiceField } from "@/components/journal/end-session";
import { errorMessage } from "@/lib/convex-errors";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionListItem } from "../../../../convex/sessionRecords";
import { useSessionList } from "../session-list";
import type { JournalHeaderActionsProps } from "../slots";
import { SlotBoundary } from "../ui";

/**
 * Header actions slot (JH, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, header right):
 * - the live chip 'Session N · live' (green dot). GM: 'End session' (the End dialog with the Wither choice) and a '⋯'
 *   menu with 'Allow extra characters this session' (Q10 default). Players: the chip only, read only.
 * - nothing live: the GM's 'Start session N' (the selected planned session, else the newest planned; without one the
 *   server creates the next). After the Start the page opens that session's Log & recap.
 * - the round tome button (everyone): opens the campaign Tome.
 * - 'Open threads N' (everyone, Q1): the caller's open threads (`notesThreads.threads`); opens Notes on its threads view.
 * The Start / End report shows in a polite status under the actions.
 */

type Report = { lines: string[]; doomTier?: number };

/** Who may start which session: the selected planned one, else the newest planned (the list is newest first). */
export function startTarget(sessions: readonly SessionListItem[], selectedId: Id<"sessions"> | null): SessionListItem | null {
  const selected = sessions.find((s) => s._id === selectedId && s.status === "planned");
  return selected ?? sessions.find((s) => s.status === "planned") ?? null;
}

/** The number 'Start session N' names: the target's, else the one the server will create (highest + 1). */
export function startNumber(sessions: readonly SessionListItem[], target: SessionListItem | null): number {
  return target?.n ?? sessions.reduce((max, s) => Math.max(max, s.n), 0) + 1;
}

/** GM menu on the live chip: the 'Allow extra characters this session' switch (XC1, moved here by Q10). */
function LiveMenu({ campaignId, extraCharacters }: { campaignId: Id<"campaigns">; extraCharacters: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const allowExtras = useMutation(api.sessions.allowExtraCharacters).withOptimisticUpdate((store, { allow }) => {
    const value = store.getQuery(api.sessions.current, { campaignId });
    if (value) store.setQuery(api.sessions.current, { campaignId }, { ...value, extraCharacters: allow });
  });

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(allow: boolean) {
    setError(null);
    allowExtras({ campaignId, allow, idempotencyKey: crypto.randomUUID() }).catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <div ref={root} className="jh-menu">
      <BrandButton variant="neutral" icon round aria-label="Session options" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <Ellipsis aria-hidden="true" />
      </BrandButton>
      <div id={panelId} className="jh-menu-panel" hidden={!open}>
        <label className="jh-switch">
          <input type="checkbox" role="switch" checked={extraCharacters} onChange={(e) => toggle(e.target.checked)} />
          <span>
            Allow extra characters this session
            <span className="jh-hint">Players may have more than one active character until the session ends. Characters made active stay active.</span>
          </span>
        </label>
      </div>
      {error ? (
        <p role="alert" className="jh-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The live chip with End / Start (GM) or the read-only chip (players). */
function SessionControl({
  campaignId,
  isGm,
  selectedId,
  onOpenSession,
  onReport,
}: Pick<JournalHeaderActionsProps, "campaignId" | "isGm" | "selectedId" | "onOpenSession"> & { onReport: (report: Report | null) => void }) {
  const sessions = useSessionList(campaignId);
  const current = useQuery(api.sessions.current, { campaignId });
  const start = useIntent(api.sessions.start);
  const end = useIntent(api.sessions.end);
  const wither = useWitherChoice(campaignId);
  const [confirm, setConfirm] = useState<"start" | "end" | null>(null);

  if (sessions === undefined || current === undefined) {
    return (
      <p role="status" className="jr-muted jr-m0">
        Loading the session…
      </p>
    );
  }

  const liveRow = sessions.find((s) => s.status === "live");
  // A session running from before the Sessions board has no live row; it still ends with End.
  const live = liveRow !== undefined || current.startedAt !== null;
  const liveN = liveRow?.n ?? current.n;
  const target = startTarget(sessions, selectedId);
  const n = startNumber(sessions, target);
  const error = start.error ?? end.error;

  async function run() {
    const which = confirm;
    setConfirm(null);
    onReport(null);
    if (which === "start") {
      const result = await start.fire(target ? { campaignId, sessionId: target._id } : { campaignId });
      if (!result) return;
      onReport({ lines: result.alreadyStarted ? ["The session is already running."] : startReportLines(result) });
      if (result.sessionId) onOpenSession(result.sessionId, "log");
    } else if (which === "end") {
      const result = await end.fire({ campaignId, ...wither.args });
      if (!result) return;
      onReport({ lines: endReportLines(result), doomTier: result.doomTier });
    }
  }

  if (!live && !isGm) return null;

  return (
    <>
      {live ? (
        <div className="jh-chip" data-testid="journal-live-chip">
          <span aria-hidden="true" className="jh-dot" />
          <span className="jh-chip-text">
            <strong>{liveN === undefined ? "Session" : `Session ${liveN}`}</strong>
            <span> · live</span>
          </span>
          {isGm ? (
            <>
              <BrandButton
                variant="danger"
                disabled={end.pending}
                onClick={() => {
                  wither.reset();
                  setConfirm("end");
                }}
              >
                End session
              </BrandButton>
              <LiveMenu campaignId={campaignId} extraCharacters={current.extraCharacters} />
            </>
          ) : null}
        </div>
      ) : (
        <BrandButton variant="confirm" disabled={start.pending} onClick={() => setConfirm("start")}>
          <span aria-hidden="true" className="jh-dot jh-dot-off" />
          Start session {n}
        </BrandButton>
      )}
      {error ? (
        <p role="alert" className="jh-error">
          {error}
        </p>
      ) : null}
      {isGm ? (
        <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "end" ? "End the session?" : `Start session ${n}?`} className="max-w-[480px]">
          <div className="jh-dialog">
            {confirm === "end" ? (
              <>
                <p className="jr-m0">
                  {endDialogText(wither)}
                  {current.extraCharacters ? " Extra characters are no longer allowed; the ones in play stay active." : ""}
                </p>
                <WitherChoiceField choice={wither} />
              </>
            ) : (
              <>
                <p className="jr-m0">Start-of-session features are given out: Prayer Dice, Luckbringer’s Hope and the moon die.</p>
                {target === null ? <p className="jr-m0">No session is planned, so Session {n} is created.</p> : null}
              </>
            )}
            <div className="jh-dialog-actions">
              <BrandButton variant="cancel" onClick={() => setConfirm(null)}>
                Cancel
              </BrandButton>
              <BrandButton variant={confirm === "end" ? "danger" : "confirm"} onClick={() => void run()}>
                {confirm === "end" ? "End session" : "Start session"}
              </BrandButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** The round tome button: opens the campaign Tome at its overview (as the dashboard's 'Open the Tome'). */
function TomeButton() {
  const openTome = useOpenTome();
  return (
    <BrandButton variant="neutral" icon round aria-label="Open the Campaign Tome" title="Open the Campaign Tome" onClick={() => openTome("overview")}>
      <BookOpen aria-hidden="true" />
    </BrandButton>
  );
}

/** 'Open threads N' (Q1): the caller's open tasks and unresolved Fear in their own journal. */
function OpenThreads({ campaignId, onNotesView }: Pick<JournalHeaderActionsProps, "campaignId" | "onNotesView">) {
  const threads = useQuery(api.notesThreads.threads, { campaignId });
  const count = threads?.length;
  return (
    <BrandButton
      variant="neutral"
      aria-label={count === undefined ? "Open threads (loading)" : `Open threads: ${count}`}
      onClick={() => onNotesView("threads")}
    >
      <Spool aria-hidden="true" />
      <span>Open threads</span>
      <span aria-hidden="true" className="jh-count">
        {count ?? "…"}
      </span>
    </BrandButton>
  );
}

export function JournalHeaderActions({ campaignId, isGm, selectedId, onOpenSession, onNotesView }: JournalHeaderActionsProps) {
  const [report, setReport] = useState<Report | null>(null);
  return (
    <div className="jh">
      <div className="jh-row">
        <SlotBoundary label="The live session">
          <SessionControl campaignId={campaignId} isGm={isGm} selectedId={selectedId} onOpenSession={onOpenSession} onReport={setReport} />
        </SlotBoundary>
        <TomeButton />
        <SlotBoundary label="Open threads">
          <OpenThreads campaignId={campaignId} onNotesView={onNotesView} />
        </SlotBoundary>
      </div>
      <div className="jh-report-row">
        <div role="status" aria-live="polite" className="jh-report" data-shown={report !== null}>
          {report ? (
            <>
              {report.lines.map((line, i) => (
                <p key={i} className="jr-m0">
                  {line}
                </p>
              ))}
              {report.doomTier !== undefined ? (
                <p className="jr-m0">
                  Mark a Doom Track box (Tier ≤ {report.doomTier}).{" "}
                  <Link href={`/campaigns/${campaignId}#tr-doom-track`} className="jh-link">
                    Open the Doom Track
                  </Link>
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        {report ? (
          <BrandButton variant="cancel" icon round className="flex-none" aria-label="Dismiss the session report" onClick={() => setReport(null)}>
            <X aria-hidden="true" />
          </BrandButton>
        ) : null}
      </div>
    </div>
  );
}
