"use client";

import "../result/result.css";
import "./ally-picks.css";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState, type ReactNode } from "react";

import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { HudPartProps } from "../state";
import { Popup, WaitingDots } from "../ui";
import { choseLine, myPicks, pickSub, reviewAllies, reviewRows, waitingOn, waitingRows, withAnswered, withSent, type MyPick } from "./model";

/**
 * Per-ally picks (plan finish-hud-lk FH-AP; bead dcm-bxp.99.32.24; board CmpPicking 'After the roll': "Rousing Strike ·
 * each ally picks their own", "2 of 3 chose", "waiting…"; user 2026-11-05). A card or feature whose choosers each pick
 * their own option (Rousing Strike, Critical Inspiration; an adversary's Locust Swarm, Awesome Size) waits on the
 * server until every pick is in (convex/lib/allyPicks.ts). On a player's screen:
 *
 * - each pick of their own character is a card: the option chips and "Choose" (`allyPicks.answer`, keyed, with an
 *   optimistic update that drops the card at once);
 * - a use of theirs still waiting shows "n of m chose · waiting…" with the names it waits on;
 * - before that, a use of theirs whose allies were computed shows the list to review (plan rule-switches CU2, bead
 *   dcm-bxp.99.32.46, user 2026-11-06): every ally ticked, the player unticks who can't see or hear them and sends the
 *   picks (`allyPicks.send`, keyed, optimistic). With Defined Ranges off the list is every PC on the map.
 *
 * The GM's outstanding picks (a player who doesn't answer) are cards in the GM queue (`hud/queue`, the same
 * `AllyPickCard`); here the GM gets only the reviews (a player who is away, or the GM playing for the PC). One read
 * (`allyPicksReads.open`); the server decides who may answer.
 */
export function HudAllyPicks({ state }: HudPartProps): ReactNode {
  if (state.role === "gm") return <GmReviews campaignId={state.campaignId} />;
  return <PlayerPicks campaignId={state.campaignId} />;
}

function GmReviews({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const rows = useQuery(api.allyPicksReads.open, { campaignId });
  const reviews = rows === undefined ? [] : reviewRows(rows);
  if (reviews.length === 0) return null;
  return (
    <div className="hud-ap" data-testid="hud-ally-picks">
      {reviews.map((row) => (
        <ReviewCard key={row.requestId} campaignId={campaignId} row={row} gm />
      ))}
    </div>
  );
}

type OpenRow = FunctionReturnType<typeof api.allyPicksReads.open>[number];

function PlayerPicks({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const rows = useQuery(api.allyPicksReads.open, { campaignId });
  if (rows === undefined) return null;
  const picks = myPicks(rows);
  const waiting = waitingRows(rows);
  const reviews = reviewRows(rows);
  if (picks.length === 0 && waiting.length === 0 && reviews.length === 0) return null;
  return (
    <div className="hud-ap" data-testid="hud-ally-picks">
      {reviews.map((row) => (
        <ReviewCard key={row.requestId} campaignId={campaignId} row={row} />
      ))}
      {picks.map((p) => (
        <AllyPickCard key={p.key} campaignId={campaignId} pick={p} />
      ))}
      {waiting.map((row) => (
        <WaitingCard key={row.requestId} row={row} />
      ))}
    </div>
  );
}

const PICK_ICON = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M8 2v5M8 7l-5 6M8 7l5 6" />
  </svg>
);

/** One chooser's pick: the use, whose it is, the option chips and Choose. The GM's queue renders it with `gm`. */
export function AllyPickCard({ campaignId, pick, gm = false }: { campaignId: Id<"campaigns">; pick: MyPick; gm?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = useMutation(api.allyPicks.answer).withOptimisticUpdate((store, args) => {
    const rows = store.getQuery(api.allyPicksReads.open, { campaignId });
    if (rows !== undefined) store.setQuery(api.allyPicksReads.open, { campaignId }, withAnswered(rows, args.requestId, args.stepId, args.chooserId));
  });
  const { row, chooser } = pick;

  async function send() {
    if (picked === null) return;
    setPending(true);
    setError(null);
    try {
      await answer({ campaignId, requestId: row.requestId as Id<"combatRequests">, stepId: chooser.stepId, chooserId: chooser.chooserId, options: [picked], idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Popup
      icon={PICK_ICON}
      tone={gm ? "gm" : "player"}
      title={row.name}
      sub={pickSub(pick, gm)}
      testId="hud-ally-pick"
      primary={{ label: pending ? "Sending…" : "Choose", ariaLabel: `Choose for ${chooser.name}: ${row.name}`, disabled: pending || picked === null, onClick: () => void send() }}
    >
      <p className="hud-ap-label">{chooser.label}</p>
      <span className="hud-res-chips" role="group" aria-label={`${chooser.name}: ${chooser.label}`}>
        {chooser.options.map((o) => (
          <button key={o.id} type="button" className="hud-res-chip" aria-pressed={picked === o.id} onClick={() => setPicked(o.id)}>
            {o.label}
          </button>
        ))}
      </span>
      {error ? (
        <p role="alert" className="hud-res-err">
          {error}
        </p>
      ) : null}
    </Popup>
  );
}

/** The actor's own use, still waiting: "2 of 3 chose · waiting…" and who it waits on. */
function WaitingCard({ row }: { row: OpenRow }) {
  return (
    <Popup icon={PICK_ICON} title={row.name} sub="Each ally picks their own" testId="hud-ally-waiting">
      <p className="hud-ap-wait" role="status">
        <b data-testid="hud-ally-chose">{choseLine(row)}</b> · waiting
        <WaitingDots /> <span className="hud-ap-on">{waitingOn(row)}</span>
      </p>
    </Popup>
  );
}

/**
 * The actor's review before the picks go out (CU2; Rousing Strike, CB p.342: "all allies who can see or hear you"): one
 * checkbox per ally, all ticked; Send drops the unticked ones (`allyPicks.send`). Unticking everyone with no own pick
 * left calls the card off.
 */
function ReviewCard({ campaignId, row, gm = false }: { campaignId: Id<"campaigns">; row: OpenRow; gm?: boolean }) {
  const allies = reviewAllies(row);
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendPicks = useMutation(api.allyPicks.send).withOptimisticUpdate((store, args) => {
    const rows = store.getQuery(api.allyPicksReads.open, { campaignId });
    if (rows !== undefined) store.setQuery(api.allyPicksReads.open, { campaignId }, withSent(rows, args.requestId, args.drop));
  });

  function toggle(id: string) {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    setPending(true);
    setError(null);
    try {
      await sendPicks({ campaignId, requestId: row.requestId, drop: [...dropped], idempotencyKey: crypto.randomUUID() });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Popup
      icon={PICK_ICON}
      tone={gm ? "gm" : "player"}
      title={row.name}
      sub={gm ? `${row.actorName}’s allies · untick who can’t see or hear them` : "Untick allies who can’t see or hear you"}
      testId="hud-ally-review"
      primary={{ label: pending ? "Sending…" : "Send", ariaLabel: `Send ${row.name} to the ticked allies`, disabled: pending, onClick: () => void send() }}
    >
      <fieldset className="hud-ap-review">
        <legend className="hud-ap-label">Who can pick</legend>
        {allies.map((c) => (
          <label key={c.chooserId} className="hud-ap-ally">
            <input type="checkbox" checked={!dropped.has(c.chooserId)} onChange={() => toggle(c.chooserId)} />
            {c.name}
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="hud-res-err">
          {error}
        </p>
      ) : null}
    </Popup>
  );
}
