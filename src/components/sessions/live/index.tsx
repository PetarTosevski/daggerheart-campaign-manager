"use client";

import "./live.css";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";

import { Modal } from "@/components/brand/modal";
import { errorMessage } from "@/lib/convex-errors";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useSessionList } from "../list";
import type { LiveCardProps } from "../slots";

/**
 * Live slot (D10 S3, board Sessions.dc.html l.89-93, l.231-311): the live card of the selected session. Dot, 'Session
 * in progress' / 'Not running', the board's texts (live since, played, another session running), Start / End with
 * their confirm dialogs, the report of what the party sync did (B10, Q6, Q8) and, while live, the XC1 switch. Start
 * switches the stage to Play, End to Wrap-up (B2). GM only; the session comes from S2's list subscription, so an id
 * that is not one of the campaign's sessions (deleted, or the shell spec's placeholder) renders nothing.
 */

type StartResult = FunctionReturnType<typeof api.sessions.start>;
type EndResult = FunctionReturnType<typeof api.sessions.end>;
type Report = { sessionId: Id<"sessions">; lines: string[]; doomTier?: number };

/** 'HH:MM' as on the board. */
function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What the End told the GM (as the dashboard card): the Wither → Fear conversion (CB 261), dice lost, journeys that end (CB 106), Q8 reminders. */
export function endReportLines(r: EndResult): string[] {
  const first = r.tokens > 0 ? `Session ended. ${plural(r.tokens, "Wither token")} → +${r.fearGained} Fear${r.fearLost > 0 ? `, ${r.fearLost} Fear lost` : ""}.` : "Session ended.";
  return [
    first,
    ...(r.lostDice?.length ? [`${r.lostDice.join("; ")}.`] : []),
    ...(r.journeyEnds.length > 0 ? [`Journey ends: ${r.journeyEnds.map((c) => c.name).join(", ")}.`] : []),
    ...(r.reminders ?? []),
  ];
}

/** What the Start told the GM: the session ended first (B6), the Prayer Dice rolled (B10), Q8 reminders. */
function startReportLines(r: StartResult): string[] {
  const previous = r.ended?.n !== undefined ? `Session ${r.ended.n} ended first.` : "The running session ended first.";
  const ended = r.ended ? endReportLines(r.ended).map((line, i) => (i === 0 ? line.replace("Session ended.", previous) : line)) : [];
  const notes = r.notes ?? [];
  return [...ended, notes.length > 0 ? `Session started. ${notes.join("; ")}.` : "Session started.", ...(r.reminders ?? [])];
}

function Card({ campaignId, sessionId, onStage }: LiveCardProps) {
  const sessions = useSessionList(campaignId);
  const current = useQuery(api.sessions.current, { campaignId });
  const start = useIntent(api.sessions.start);
  const end = useIntent(api.sessions.end);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const allowExtras = useMutation(api.sessions.allowExtraCharacters).withOptimisticUpdate((store, { allow }) => {
    const value = store.getQuery(api.sessions.current, { campaignId });
    if (value) store.setQuery(api.sessions.current, { campaignId }, { ...value, extraCharacters: allow });
  });
  const [confirm, setConfirm] = useState<"start" | "end" | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  if (sessions === undefined || current === undefined) {
    return (
      <section className="ss-card ss-row-card" aria-label="Live session">
        <p role="status" className="ss-muted ss-m0">
          Loading the live session…
        </p>
      </section>
    );
  }
  const session = sessions.find((s) => s._id === sessionId);
  if (session === undefined) return null;

  const live = session.status === "live";
  const other = sessions.find((s) => s.status === "live" && s._id !== sessionId);
  // A session running from before the Sessions board (no live row until the backfill migration ran).
  const otherRunning = !live && (other !== undefined || current.startedAt !== null);
  const otherText = other ? `Session ${other.n} is still running. Starting this one ends it.` : "A session is still running. Starting this one ends it.";
  const since = session.startedAt ?? current.startedAt;
  const text = live
    ? `${since !== null ? `Live since ${hhmm(since)}` : "Live"}. Party sheets know the session is running.`
    : session.status === "played"
      ? "This session has been played. Starting it again re-rolls Prayer Dice and refreshes Rally."
      : "Start the session when you sit down at the table. Seraphs roll their Prayer Dice and the Bard’s Rally refreshes.";
  const shown = report !== null && report.sessionId === sessionId ? report : null;
  const error = start.error ?? end.error ?? extrasError;

  function toggleExtras(allow: boolean) {
    setExtrasError(null);
    allowExtras({ campaignId, allow, idempotencyKey: crypto.randomUUID() }).catch((e: unknown) => setExtrasError(errorMessage(e)));
  }

  async function run() {
    const which = confirm;
    setConfirm(null);
    setReport(null);
    if (which === "start") {
      const result = await start.fire({ campaignId, sessionId });
      if (!result) return;
      setReport({ sessionId, lines: result.alreadyStarted ? ["The session is already running."] : startReportLines(result) });
      onStage("play");
    } else if (which === "end") {
      const result = await end.fire({ campaignId });
      if (!result) return;
      setReport({ sessionId, lines: endReportLines(result), doomTier: result.doomTier });
      onStage("wrap");
    }
  }

  return (
    <section className="ss-card ss-row-card ss-live" data-live={live} aria-label="Live session">
      <span aria-hidden="true" className="ss-dot" data-live={live} />
      <div className="ss-grow ss-live-text">
        <strong className="ss-live-title">{live ? "Session in progress" : "Not running"}</strong>
        <span className="ss-muted">{text}</span>
        {otherRunning ? <span className="ss-live-other">{otherText}</span> : null}
      </div>
      {live ? (
        <button type="button" className="ss-live-btn ss-live-end" disabled={end.pending} onClick={() => setConfirm("end")}>
          <span aria-hidden="true">■ </span>End session
        </button>
      ) : (
        <button type="button" className="ss-live-btn ss-live-start" disabled={start.pending} onClick={() => setConfirm("start")}>
          <span aria-hidden="true">▶ </span>Start session
        </button>
      )}
      {live ? (
        <label className="ss-live-switch">
          <input type="checkbox" role="switch" checked={current.extraCharacters} onChange={(e) => toggleExtras(e.target.checked)} />
          <span>
            Allow extra characters this session
            <span className="ss-muted ss-live-hint">Players may have more than one active character until the session ends. Characters made active stay active.</span>
          </span>
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="ss-live-error">
          {error}
        </p>
      ) : null}
      <div role="status" aria-live="polite" className="ss-live-report">
        {shown ? (
          <>
            {shown.lines.map((line, i) => (
              <p key={i} className="ss-m0">
                {line}
              </p>
            ))}
            {shown.doomTier !== undefined ? (
              <p className="ss-m0">
                Mark a Doom Track box (Tier ≤ {shown.doomTier}).{" "}
                <Link href={`/campaigns/${campaignId}#tr-doom-track`} className="ss-live-link">
                  Open the Doom Track
                </Link>
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "end" ? "End the session?" : "Start the session?"} className="max-w-[480px]">
        <div className="ss-live-dialog">
          {confirm === "end" ? (
            <p className="ss-m0">
              Session effects end, unspent Rally and Prayer Dice are cleared, and every Wither token on the PCs&apos; sheets becomes GM Fear (up to 12).
              {current.extraCharacters ? " Extra characters are no longer allowed; the ones in play stay active." : ""}
            </p>
          ) : (
            <>
              <p className="ss-m0">Start-of-session features (such as Prayer Dice) are given out.</p>
              {session.status === "played" ? <p className="ss-m0">This session has been played. Starting it again re-rolls Prayer Dice and refreshes Rally.</p> : null}
              {otherRunning ? <p className="ss-m0 ss-live-other">{otherText}</p> : null}
            </>
          )}
          <div className="ss-live-actions">
            <button type="button" className="ss-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className={confirm === "end" ? "ss-live-btn ss-live-end" : "ss-live-btn ss-live-start"} onClick={() => void run()}>
              {confirm === "end" ? "End session" : "Start session"}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

/** GM: the live card under the header card (Start / End, B6, B7, B10). Players never get it (Q4, K10). */
export function LiveCard(props: LiveCardProps) {
  return props.isGm ? <Card {...props} /> : null;
}
