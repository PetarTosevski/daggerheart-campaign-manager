"use client";

import "./play.css";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import { Component, useState, type FormEvent, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { spotlight as spotlightEntries, TALLY_ROWS } from "@/lib/domain/sessions";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SessionLogEntry, SpotlightEntry } from "../../../../convex/sessionPlay";
import { SESSION_TEXT_MAX } from "../../../../convex/lib/validators/sessions";
import type { PlayStageProps } from "../slots";

import { EncounterCard } from "./encounter-card";

/**
 * Play slot (D10 S5, board Sessions.dc.html l.144-183, rule B4): the Spotlight (K7, Q12), the read-only Session
 * tally (Q3), the Encounter card (TASK-SESSIONS-HUB: the session's linked D8 encounter) and the Session log. Each card reads its own GM-only query (convex/sessionPlay.ts) inside its own error
 * boundary; spotlight taps and log adds / removes update the cached query optimistically (CL4).
 */
export function PlayStage({ campaignId, sessionId }: PlayStageProps) {
  return (
    <section className="ss-play" aria-label="Play stage">
      <div className="ss-play-col">
        <CardBoundary label="Spotlight">
          <SpotlightCard campaignId={campaignId} sessionId={sessionId} />
        </CardBoundary>
        <CardBoundary label="Session tally">
          <TallyCard campaignId={campaignId} sessionId={sessionId} />
        </CardBoundary>
      </div>
      <div className="ss-play-col">
        <CardBoundary label="Encounter">
          <EncounterCard campaignId={campaignId} sessionId={sessionId} />
        </CardBoundary>
        <CardBoundary label="Session log">
          <LogCard campaignId={campaignId} sessionId={sessionId} />
        </CardBoundary>
      </div>
    </section>
  );
}

type CardProps = { campaignId: Id<"campaigns">; sessionId: Id<"sessions"> };

/** One card's error boundary (CL1): a failing query blanks only its own card. */
class CardBoundary extends Component<{ children: ReactNode; label: string }, { message: string | null }> {
  override state: { message: string | null } = { message: null };
  static getDerivedStateFromError(error: unknown) {
    return { message: errorMessage(error) };
  }
  override render() {
    if (this.state.message === null) return this.props.children;
    return (
      <section className="ss-card" aria-label={this.props.label}>
        <h2 className="ss-h">{this.props.label}</h2>
        <p role="alert" className="ss-play-error">
          {this.state.message}
        </p>
      </section>
    );
  }
}

function Loading({ label }: { label: string }) {
  return (
    <section className="ss-card" aria-label={label}>
      <h2 className="ss-h">{label}</h2>
      <p role="status" className="ss-muted ss-m0">
        Loading…
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- spotlight

/** Rewrites the cached spotlight with new counts, recomputing who is due (S1 `spotlight`). */
function setSpotlightCounts(store: OptimisticLocalStore, args: CardProps, count: (entry: SpotlightEntry) => number) {
  const current = store.getQuery(api.sessionPlay.spotlight, args);
  if (current === undefined) return;
  const counted = current.map((e) => ({ ...e, count: count(e) }));
  const names = new Map(counted.map((e) => [e.characterId, e.name]));
  store.setQuery(
    api.sessionPlay.spotlight,
    args,
    spotlightEntries(
      counted.map((e) => e.characterId),
      counted,
    ).map((e) => ({ ...e, name: names.get(e.characterId) ?? "" })),
  );
}

function SpotlightCard({ campaignId, sessionId }: CardProps) {
  const args = { campaignId, sessionId };
  const entries = useQuery(api.sessionPlay.spotlight, args);
  const [error, setError] = useState<string | null>(null);
  const bump = useMutation(api.sessionPlay.bumpSpotlight).withOptimisticUpdate((store, a) =>
    setSpotlightCounts(store, { campaignId: a.campaignId, sessionId }, (e) => (e.characterId === a.characterId ? e.count + 1 : e.count)),
  );
  const reset = useMutation(api.sessionPlay.resetSpotlight).withOptimisticUpdate((store, a) =>
    setSpotlightCounts(store, { campaignId: a.campaignId, sessionId }, () => 0),
  );

  if (entries === undefined) return <Loading label="Spotlight" />;

  function run(op: Promise<unknown>) {
    setError(null);
    op.catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <section className="ss-card" aria-labelledby="ss-spot-h">
      <h2 id="ss-spot-h" className="ss-h">
        Spotlight
      </h2>
      <p className="ss-muted ss-m0">Tap a character each time they get a moment. Daggerheart has no initiative, so this helps you share the spotlight.</p>
      {entries.length === 0 ? <p className="ss-muted ss-m0">No characters in the party yet.</p> : null}
      {entries.length > 0 ? (
        <ul className="ss-spot-list" aria-label="Characters">
          {entries.map((e) => (
            <li key={e.characterId}>
              <button
                type="button"
                className="ss-spot"
                data-due={e.due ? "true" : "false"}
                aria-label={`${e.name}, ${e.count} spotlight ${e.count === 1 ? "moment" : "moments"}${e.due ? ", due" : ""}`}
                onClick={() => run(bump({ campaignId, sessionId, characterId: e.characterId, idempotencyKey: crypto.randomUUID() }))}
              >
                <span>{e.name}</span>
                <span className="ss-spot-n">{e.count}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="ss-ghost ss-play-tall ss-self-start" onClick={() => run(reset({ campaignId, sessionId }))}>
        Reset spotlight
      </button>
      {error ? (
        <p role="alert" className="ss-play-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- tally

function TallyCard({ campaignId, sessionId }: CardProps) {
  const view = useQuery(api.sessionPlay.tally, { campaignId, sessionId });
  if (view === undefined) return <Loading label="Session tally" />;
  const { tally, live, truncated } = view;
  return (
    <section className="ss-card" aria-labelledby="ss-tally-h">
      <h2 id="ss-tally-h" className="ss-h">
        Session tally
      </h2>
      <dl className="ss-tally">
        {TALLY_ROWS.map((row) => (
          <div key={row.key} className="ss-tally-row">
            <dt>{row.label}</dt>
            <dd className="ss-num">{tally === null ? "—" : tally[row.key]}</dd>
          </div>
        ))}
      </dl>
      <p className="ss-muted ss-m0 ss-play-note">
        {tally === null
          ? "Counts itself once the session starts: Fear gained and spent on the dashboard, and finished rests."
          : live
            ? "Counting while the session runs: Fear gained and spent on the dashboard, and finished rests."
            : "Counted from the Fear history and the finished rests while the session ran."}
        {truncated ? " Very busy session: these are at least the counts shown." : ""}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- log

/** 'HH:MM' in the viewer's time, as on the board. */
function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const OPTIMISTIC = "optimistic-";

/** Shows a line being added at the top of the cached log until the server's row replaces it (CL4). */
function addPending(store: OptimisticLocalStore, a: { campaignId: Id<"campaigns">; sessionId: string; text: string; idempotencyKey: string }) {
  const args = { campaignId: a.campaignId, sessionId: a.sessionId };
  const current = store.getQuery(api.sessionPlay.log, args);
  if (current === undefined) return;
  const pending: SessionLogEntry = { _id: `${OPTIMISTIC}${a.idempotencyKey}` as SessionLogEntry["_id"], at: Date.now(), text: a.text.trim(), auto: false };
  store.setQuery(api.sessionPlay.log, args, [pending, ...current]);
}

function LogCard({ campaignId, sessionId }: CardProps) {
  const args = { campaignId, sessionId };
  const entries = useQuery(api.sessionPlay.log, args);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useMutation(api.sessionPlay.addLog).withOptimisticUpdate(addPending);
  const remove = useMutation(api.sessionPlay.removeLog).withOptimisticUpdate((store, a) => {
    const current = store.getQuery(api.sessionPlay.log, { campaignId: a.campaignId, sessionId });
    if (current === undefined) return;
    store.setQuery(
      api.sessionPlay.log,
      { campaignId: a.campaignId, sessionId },
      current.filter((l) => l._id !== a.logId),
    );
  });

  if (entries === undefined) return <Loading label="Session log" />;

  function submit(e: FormEvent) {
    e.preventDefault();
    const line = text.trim();
    if (line === "") return;
    setText("");
    setError(null);
    add({ campaignId, sessionId, text: line, idempotencyKey: crypto.randomUUID() }).catch((err: unknown) => {
      setError(errorMessage(err));
      setText((now) => (now === "" ? line : now));
    });
  }

  function onRemove(logId: Id<"sessionLog">) {
    setError(null);
    remove({ campaignId, sessionId, logId }).catch((err: unknown) => setError(errorMessage(err)));
  }

  const inputId = `ss-log-in-${sessionId}`;
  return (
    <section className="ss-card" aria-labelledby="ss-log-h">
      <h2 id="ss-log-h" className="ss-h">
        Session log
      </h2>
      <form className="ss-log-form" onSubmit={submit}>
        <label htmlFor={inputId} className="sr-only">
          New log entry
        </label>
        <input
          id={inputId}
          className="ss-in ss-log-in"
          type="text"
          placeholder="What just happened?"
          maxLength={SESSION_TEXT_MAX.log}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="ss-ghost ss-play-tall">
          Add
        </button>
      </form>
      {error ? (
        <p role="alert" className="ss-play-error">
          {error}
        </p>
      ) : null}
      {entries.length === 0 ? <p className="ss-muted ss-m0">Quick notes as you play: who did what, names you invented, things to follow up.</p> : null}
      {entries.length > 0 ? (
        <ol className="ss-log" aria-label="Log entries, newest first">
          {entries.map((l) => (
            <li key={l._id} className="ss-log-row" data-auto={l.auto ? "true" : "false"}>
              <time className="ss-log-time" dateTime={new Date(l.at).toISOString()}>
                {clock(l.at)}
              </time>
              <span className="ss-log-text">{l.text}</span>
              {l.auto ? null : (
                // Automatic Start/End lines stay (the server refuses them too).
                <button
                  type="button"
                  className="ss-x ss-log-x"
                  aria-label={`Remove log entry: ${l.text}`}
                  disabled={l._id.startsWith(OPTIMISTIC)}
                  onClick={() => onRemove(l._id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
