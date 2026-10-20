"use client";

import "./wrap.css";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SESSION_TEXT_MAX } from "../../../../convex/lib/validators/sessions";
import type { SessionWrap } from "../../../../convex/sessionWrap";
import type { WrapStageProps } from "../slots";

/**
 * Wrap-up slot (D10 S6, board Sessions.dc.html l.186-207, rule B5): Recap (shows on the dashboard as Last Session, and
 * to players, Q4), 'Loot & gold' and 'Countdowns & threads' (GM-only), and the milestone row (Q5: one way, it runs the
 * roster's 'Party levels up' and then links to the Party tab). Text saves on blur and after a pause in typing, one
 * field per write.
 */

/** How long typing must pause before a text field saves (it also saves on blur). */
const SAVE_DELAY_MS = 800;

type TextField = "recap" | "loot" | "threads";

/** Patches the cached `sessionWrap.get` of one session (optimistic updates for the stage's intents). */
function patchWrap(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string, patch: Partial<SessionWrap>) {
  const current = store.getQuery(api.sessionWrap.get, { campaignId, sessionId });
  if (current) store.setQuery(api.sessionWrap.get, { campaignId, sessionId }, { ...current, ...patch });
}

const orUndefined = (text: string) => text.trim() || undefined;

export function WrapStage({ campaignId, sessionId }: WrapStageProps) {
  const wrap = useQuery(api.sessionWrap.get, { campaignId, sessionId });
  if (wrap === undefined) {
    return (
      <section className="ss-card" aria-label="Wrap-up stage">
        <p role="status" className="ss-muted ss-m0">
          Loading…
        </p>
      </section>
    );
  }
  if (wrap === null) {
    return (
      <section className="ss-card ss-start" aria-label="Wrap-up stage">
        <p className="ss-muted ss-m0">That session isn&apos;t in this campaign anymore. Pick another one on the left.</p>
      </section>
    );
  }
  // One body per session, so a draft typed in one session never shows in another.
  return <WrapBody key={wrap.sessionId} campaignId={campaignId} wrap={wrap} />;
}

function WrapBody({ campaignId, wrap }: { campaignId: Id<"campaigns">; wrap: SessionWrap }) {
  const setRecap = useMutation(api.sessionWrap.setRecap).withOptimisticUpdate((store, args) =>
    patchWrap(store, campaignId, args.sessionId, { recap: orUndefined(args.recap) }),
  );
  const setLoot = useMutation(api.sessionWrap.setLoot).withOptimisticUpdate((store, args) =>
    patchWrap(store, campaignId, args.sessionId, { loot: orUndefined(args.loot) }),
  );
  const setThreads = useMutation(api.sessionWrap.setThreads).withOptimisticUpdate((store, args) =>
    patchWrap(store, campaignId, args.sessionId, { threads: orUndefined(args.threads) }),
  );
  const sessionId = wrap.sessionId;
  const save: Record<TextField, (text: string) => Promise<null>> = {
    recap: (recap) => setRecap({ campaignId, sessionId, recap }),
    loot: (loot) => setLoot({ campaignId, sessionId, loot }),
    threads: (threads) => setThreads({ campaignId, sessionId, threads }),
  };

  return (
    <section className="sw-grid" aria-label="Wrap-up stage">
      <TextCard
        field="recap"
        title="Recap"
        hint='Where the party stands, who they met, and what threat looms next. This shows on the dashboard as "Last Session".'
        placeholder="The party crossed the river at dawn…"
        rows={10}
        stored={wrap.recap}
        save={save.recap}
      />
      <div className="sw-side">
        <TextCard field="loot" title="Loot & gold" placeholder="Items found, handfuls / bags / chests of gold…" rows={4} stored={wrap.loot} save={save.loot} />
        <TextCard
          field="threads"
          title="Countdowns & threads"
          placeholder="Which countdowns ticked or ended, what changed in the world…"
          rows={4}
          stored={wrap.threads}
          save={save.threads}
        />
        <Milestone campaignId={campaignId} wrap={wrap} />
      </div>
    </section>
  );
}

/** One text card: saves on blur and after SAVE_DELAY_MS without typing; shows the server's text when not editing. */
function TextCard(props: {
  field: TextField;
  title: string;
  hint?: string;
  placeholder: string;
  rows: number;
  stored: string | undefined;
  save: (text: string) => Promise<null>;
}) {
  const { field, title, hint, placeholder, rows, stored, save } = props;
  // The text being typed (null: show the server's).
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function flush(text: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // The optimistic update makes `stored` the text just sent, so a blur after a debounced save sends nothing.
    if (text.trim() === (stored ?? "")) return;
    setError(null);
    save(text).catch((e: unknown) => setError(errorMessage(e)));
  }

  const headingId = `sw-${field}-h`;
  const errorId = `sw-${field}-error`;
  return (
    <section className="ss-card" aria-labelledby={headingId}>
      <h2 id={headingId} className="ss-h">
        {title}
      </h2>
      {hint ? <p className="ss-muted ss-m0">{hint}</p> : null}
      <textarea
        className="ss-ta"
        aria-labelledby={headingId}
        aria-describedby={error ? errorId : undefined}
        rows={rows}
        maxLength={SESSION_TEXT_MAX[field]}
        placeholder={placeholder}
        value={draft ?? stored ?? ""}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(text), SAVE_DELAY_MS);
        }}
        onBlur={() => {
          if (draft !== null) flush(draft);
          setDraft(null);
        }}
      />
      {error ? (
        <p id={errorId} role="alert" className="sw-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Optimistic tick of the milestone box (the server's stamp replaces the time). */
function tickMilestone(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string) {
  patchWrap(store, campaignId, sessionId, { milestoneAt: Date.now() });
}

/** 'Milestone reached: the party levels up' (Q5): one way; once called the box stays ticked and the Party link shows. */
function Milestone({ campaignId, wrap }: { campaignId: Id<"campaigns">; wrap: SessionWrap }) {
  const call = useMutation(api.sessionWrap.callMilestone).withOptimisticUpdate((store, args) => tickMilestone(store, campaignId, args.sessionId));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const called = wrap.milestoneAt !== undefined;

  async function onCall() {
    setError(null);
    setBusy(true);
    try {
      const result = await call({ campaignId, sessionId: wrap.sessionId, idempotencyKey: crypto.randomUUID() });
      if (result.called) setNotice(result.flagged === 1 ? "1 character can level up." : `${result.flagged} characters can level up.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ss-card" aria-label="Milestone">
      <button
        type="button"
        className="sw-row"
        aria-pressed={called}
        disabled={called || busy}
        title={called ? "The party was told to level up. This can't be undone." : undefined}
        onClick={onCall}
      >
        <span className="sw-box" aria-hidden="true">
          {called ? "✓" : ""}
        </span>
        <span className="sw-row-label">Milestone reached: the party levels up</span>
      </button>
      <p role="status" className="ss-muted ss-m0 sw-status">
        {notice}
      </p>
      {error ? (
        <p role="alert" className="sw-error">
          {error}
        </p>
      ) : null}
      {called ? (
        <Link href={`/campaigns/${campaignId}/party`} className="ss-ghost sw-link">
          Open Party to level up →
        </Link>
      ) : null}
    </section>
  );
}
