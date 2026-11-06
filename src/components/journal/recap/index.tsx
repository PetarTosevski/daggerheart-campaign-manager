"use client";

import "./recap.css";

import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Users } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FocusEvent, type KeyboardEvent } from "react";

import { brandButton } from "@/components/brand/buttons";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SESSION_TEXT_MAX } from "../../../../convex/lib/validators/sessions";
import type { SessionAfter } from "../../../../convex/sessionWrap";
import { dayMonth, useSessionList } from "../session-list";
import type { AfterSessionProps, RecapProps } from "../slots";
import { Card, Parchment } from "../ui";

/**
 * Recap and After the session (JR, contract: ../slots.ts; design reference/designs/journal/journal_views.jpg, Log &
 * recap: the 'Recap' parchment under the log, 'After the session' last in the right column).
 *
 * - Recap (Q4, user 2026-11-03: everyone writes it, always visible to the table). There is no share gate, so the
 *   design's 'Share with players' button is replaced by a plain 'Visible to the table' note. 'Edit recap' turns the
 *   parchment into a textarea; Save, or moving focus out of the editor, saves it (`sessionWrap.setRecap`, one intent,
 *   optimistic); Cancel / Escape drops the draft. The GM reads it from `sessionWrap.get`, a player from their
 *   `sessionRecords.list` row (players see live and played sessions only; the server refuses a planned one).
 * - After the session (`sessionWrap.after`, every member since JF2, dcm-z9rz.32, user 2026-11-06: players read it, only
 *   the GM edits): 'Level-ups' (the characters' names, else 'None'), 'Milestone' (dcm-z9rz.29: 'Reached 2 Nov' with a
 *   link to the Party tab, or 'Not yet'; the GM also gets 'Call milestone', which asks to confirm and runs
 *   `sessionWrap.callMilestone`: one way, every active character gets a level-up) and 'Loot' (the GM's inline edit,
 *   `sessionWrap.setLoot`, optimistic; a player reads the text).
 */

/**
 * The recap paper keeps ink-on-paper buttons (plan glass-buttons Q5 a: dark glass looks out of place on parchment):
 * the main action is filled ink, the others an ink outline (brandButton ink, src/components/brand/ink-button.css).
 */
const btn = (main = false) => brandButton({ variant: main ? "confirm" : "neutral", ink: true });

/** The text the server stores for a write: trimmed, empty clears it (as `cleanText`). */
const stored = (text: string) => text.trim() || undefined;

// ---------------------------------------------------------------- Recap

/** Patches the cached recap: the GM's `sessionWrap.get` and a player's `sessionRecords.list` row. */
function patchRecap(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string, recap: string | undefined) {
  const wrap = store.getQuery(api.sessionWrap.get, { campaignId, sessionId });
  if (wrap) store.setQuery(api.sessionWrap.get, { campaignId, sessionId }, { ...wrap, recap });
  const list = store.getQuery(api.sessionRecords.list, { campaignId });
  if (list) store.setQuery(api.sessionRecords.list, { campaignId }, list.map((s) => (s._id === sessionId ? { ...s, recap } : s)));
}

/** The session's recap as this caller reads it: string | null (none), `undefined` loading, `"gone"` for a stale id. */
function useRecapText(campaignId: Id<"campaigns">, sessionId: Id<"sessions">, isGm: boolean): string | null | undefined | "gone" {
  const wrap = useQuery(api.sessionWrap.get, isGm ? { campaignId, sessionId } : "skip");
  const list = useSessionList(campaignId);
  if (isGm) {
    if (wrap === undefined) return undefined;
    return wrap === null ? "gone" : (wrap.recap ?? null);
  }
  if (list === undefined) return undefined;
  const row = list.find((s) => s._id === sessionId);
  return row === undefined ? "gone" : (row.recap ?? null);
}

/** Centre, under the log: the recap parchment with 'Edit recap'. */
export function Recap({ campaignId, sessionId, isGm }: RecapProps) {
  const text = useRecapText(campaignId, sessionId, isGm);
  return (
    <Card
      heading="Recap"
      className="jrr-recap"
      actions={
        <span className="jrr-shared">
          <Users aria-hidden="true" />
          Visible to the table
        </span>
      }
    >
      {text === undefined ? (
        <p role="status" className="jr-muted jr-m0">
          Loading the recap…
        </p>
      ) : text === "gone" ? (
        <p className="jr-muted jr-m0">That session isn&apos;t in this campaign anymore.</p>
      ) : (
        // One editor per session, so a draft typed for one session never shows in another.
        <RecapBody key={sessionId} campaignId={campaignId} sessionId={sessionId} text={text} />
      )}
    </Card>
  );
}

function RecapBody({ campaignId, sessionId, text }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions">; text: string | null }) {
  const setRecap = useMutation(api.sessionWrap.setRecap).withOptimisticUpdate((store, args) =>
    patchRecap(store, campaignId, args.sessionId, stored(args.recap)),
  );
  // The text being edited; null: reading.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  function save(value: string) {
    setDraft(null);
    if ((stored(value) ?? null) === text) return;
    setError(null);
    setRecap({ campaignId, sessionId, recap: value }).catch((e: unknown) => {
      setError(errorMessage(e));
      setDraft(value);
    });
  }

  function onBlur(e: FocusEvent<HTMLDivElement>) {
    // Focus left the editor (not to its own Save / Cancel): save what was typed.
    if (draft !== null && !e.currentTarget.contains(e.relatedTarget as Node | null)) save(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
      setError(null);
    }
  }

  const errorEl = error ? (
    <p id={`${id}-error`} role="alert" className="jrr-error">
      {error}
    </p>
  ) : null;

  if (draft !== null) {
    return (
      <Parchment className="jrr-parchment">
        <div className="jrr-editor" onBlur={onBlur} onKeyDown={onKeyDown}>
          <label htmlFor={`${id}-text`} className="jrr-sr">
            Recap
          </label>
          <textarea
            id={`${id}-text`}
            className="jrr-textarea"
            rows={6}
            maxLength={SESSION_TEXT_MAX.recap}
            placeholder="Where the party went, who they met, and what threat looms next…"
            aria-describedby={error ? `${id}-error` : undefined}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {errorEl}
          <div className="jrr-row">
            <button type="button" className={btn(true)} onClick={() => save(draft)}>
              Save recap
            </button>
            <button
              type="button"
              className={btn()}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </Parchment>
    );
  }

  return (
    <Parchment className="jrr-parchment">
      {text ? <p className="jrr-text">{text}</p> : <p className="jrr-text jrr-empty">No recap yet. Anyone at the table can write it.</p>}
      {errorEl}
      <button type="button" className={btn()} onClick={() => setDraft(text ?? "")}>
        <Pencil aria-hidden="true" />
        {text ? "Edit recap" : "Write the recap"}
      </button>
    </Parchment>
  );
}

// ---------------------------------------------------------------- After the session

/** 'Level-ups': the characters' names joined with ', ', else 'None'. A character missing from the party shows its feed line. */
export function levelUpLine(levelUps: SessionAfter["levelUps"], names: ReadonlyMap<string, string>): string {
  if (levelUps.length === 0) return "None";
  return levelUps.map((l) => names.get(l.characterId) ?? l.summary).join(", ");
}

function patchLoot(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string, loot: string | null) {
  const after = store.getQuery(api.sessionWrap.after, { campaignId, sessionId });
  if (after) store.setQuery(api.sessionWrap.after, { campaignId, sessionId }, { ...after, loot });
}

/** Right column, last: 'After the session' (the GM edits it; players read it, JF2). */
export function AfterSession({ campaignId, sessionId, isGm }: AfterSessionProps) {
  return <AfterCard campaignId={campaignId} sessionId={sessionId} isGm={isGm} />;
}

function AfterCard({ campaignId, sessionId, isGm }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions">; isGm: boolean }) {
  const after = useQuery(api.sessionWrap.after, { campaignId, sessionId });
  const party = useQuery(api.charactersReads.partySummary, { campaignId });
  const names = new Map((party ?? []).map((c) => [c._id as string, c.sheet.name]));
  return (
    <Card heading="After the session" kind="label" className="jrr-after">
      {after === undefined ? (
        <p role="status" className="jr-muted jr-m0">
          Loading…
        </p>
      ) : after === null ? (
        <p className="jr-muted jr-m0">That session isn&apos;t in this campaign anymore.</p>
      ) : (
        <>
          <dl className="jrr-dl">
            <div className="jrr-dl-row">
              <dt>Level-ups</dt>
              <dd>{levelUpLine(after.levelUps, names)}</dd>
            </div>
            {isGm ? (
              <>
                <Milestone key={`m-${sessionId}`} campaignId={campaignId} sessionId={sessionId} milestoneAt={after.milestoneAt} />
                <Loot key={sessionId} campaignId={campaignId} sessionId={sessionId} loot={after.loot} />
              </>
            ) : (
              <>
                <div className="jrr-dl-row jrr-milestone">
                  <dt>Milestone</dt>
                  <dd>
                    <span>{milestoneLine(after.milestoneAt)}</span>
                    {after.milestoneAt !== null ? <PartyLink campaignId={campaignId} /> : null}
                  </dd>
                </div>
                <div className="jrr-dl-row jrr-loot">
                  <dt>Loot</dt>
                  <dd>{after.loot ?? "None"}</dd>
                </div>
              </>
            )}
          </dl>
          {after.truncated ? <p className="jr-muted jr-m0 jrr-note">A long session: later level-ups may be missing.</p> : null}
        </>
      )}
    </Card>
  );
}

/** The milestone line's text: 'Reached 2 Nov', else 'Not yet'. */
export function milestoneLine(milestoneAt: number | null): string {
  return milestoneAt === null ? "Not yet" : `Reached ${dayMonth(milestoneAt)}`;
}

function PartyLink({ campaignId }: { campaignId: Id<"campaigns"> }) {
  return (
    <Link href={`/campaigns/${campaignId}/party`} className="jrr-link">
      Open Party to level up
    </Link>
  );
}

/** Optimistic: the milestone shows as reached at once (the server's stamp replaces the time). */
function stampMilestone(store: OptimisticLocalStore, campaignId: Id<"campaigns">, sessionId: string) {
  const after = store.getQuery(api.sessionWrap.after, { campaignId, sessionId });
  if (after && after.milestoneAt === null) store.setQuery(api.sessionWrap.after, { campaignId, sessionId }, { ...after, milestoneAt: Date.now() });
}

/**
 * 'Milestone' (dcm-z9rz.29): reached on this session, with the Party link, or 'Call milestone' behind a confirm step
 * (one way: `sessionWrap.callMilestone` flags every active character for a level-up, as the Party tab's 'Party levels
 * up', and stamps the session).
 */
function Milestone({ campaignId, sessionId, milestoneAt }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions">; milestoneAt: number | null }) {
  const call = useMutation(api.sessionWrap.callMilestone).withOptimisticUpdate((store, args) => stampMilestone(store, campaignId, args.sessionId));
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onCall() {
    setConfirming(false);
    setError(null);
    call({ campaignId, sessionId, idempotencyKey: crypto.randomUUID() })
      .then((result) => {
        if (result.called) setNotice(result.flagged === 1 ? "1 character can level up." : `${result.flagged} characters can level up.`);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }

  return (
    <div className="jrr-dl-row jrr-milestone">
      <dt>Milestone</dt>
      <dd>
        <span>{milestoneLine(milestoneAt)}</span>
        {milestoneAt !== null ? (
          <PartyLink campaignId={campaignId} />
        ) : confirming ? (
          <span className="jrr-confirm" role="group" aria-label="Confirm the milestone">
            <span className="jr-muted">Every active character gets a level-up. This can&apos;t be undone.</span>
            <button type="button" className={brandButton({ variant: "confirm", size: "sm" })} onClick={onCall}>
              Level up the party
            </button>
            <button type="button" className={brandButton({ variant: "neutral", size: "sm" })} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button type="button" className={brandButton({ variant: "neutral", size: "sm" })} onClick={() => setConfirming(true)}>
            Call milestone
          </button>
        )}
        <span role="status" className="jr-muted jrr-note">
          {notice}
        </span>
        {error ? (
          <p role="alert" className="jrr-error">
            {error}
          </p>
        ) : null}
      </dd>
    </div>
  );
}

function Loot({ campaignId, sessionId, loot }: { campaignId: Id<"campaigns">; sessionId: Id<"sessions">; loot: string | null }) {
  const setLoot = useMutation(api.sessionWrap.setLoot).withOptimisticUpdate((store, args) =>
    patchLoot(store, campaignId, args.sessionId, stored(args.loot) ?? null),
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  function save(value: string) {
    setDraft(null);
    if ((stored(value) ?? null) === loot) return;
    setError(null);
    setLoot({ campaignId, sessionId, loot: value }).catch((e: unknown) => {
      setError(errorMessage(e));
      setDraft(value);
    });
  }

  return (
    <div className="jrr-dl-row jrr-loot">
      <dt>{draft === null ? "Loot" : <label htmlFor={`${id}-loot`}>Loot</label>}</dt>
      <dd>
        {draft === null ? (
          <button type="button" className="jrr-inline" aria-label={`Edit loot: ${loot ?? "none"}`} onClick={() => setDraft(loot ?? "")}>
            <span>{loot ?? "None"}</span>
            <Pencil aria-hidden="true" />
          </button>
        ) : (
          <input
            id={`${id}-loot`}
            className="jrr-input"
            maxLength={SESSION_TEXT_MAX.loot}
            placeholder="Items found, handfuls of gold…"
            aria-describedby={error ? `${id}-error` : undefined}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => save(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraft(null);
                setError(null);
              }
            }}
          />
        )}
        {error ? (
          <p id={`${id}-error`} role="alert" className="jrr-error">
            {error}
          </p>
        ) : null}
      </dd>
    </div>
  );
}
