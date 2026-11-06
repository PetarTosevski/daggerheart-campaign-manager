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
import { choseLine, myPicks, pickSub, waitingOn, waitingRows, withAnswered, type MyPick } from "./model";

/**
 * Per-ally picks (plan finish-hud-lk FH-AP; bead dcm-bxp.99.32.24; board CmpPicking 'After the roll': "Rousing Strike ·
 * each ally picks their own", "2 of 3 chose", "waiting…"; user 2026-11-05). A card or feature whose choosers each pick
 * their own option (Rousing Strike, Critical Inspiration; an adversary's Locust Swarm, Awesome Size) waits on the
 * server until every pick is in (convex/lib/allyPicks.ts). On a player's screen:
 *
 * - each pick of their own character is a card: the option chips and "Choose" (`allyPicks.answer`, keyed, with an
 *   optimistic update that drops the card at once);
 * - a use of theirs still waiting shows "n of m chose · waiting…" with the names it waits on.
 *
 * The GM's outstanding picks (a player who doesn't answer) are cards in the GM queue (`hud/queue`, the same
 * `AllyPickCard`), so the GM gets nothing here. One read (`allyPicksReads.open`); the server decides who may answer.
 */
export function HudAllyPicks({ state }: HudPartProps): ReactNode {
  if (state.role === "gm") return null;
  return <PlayerPicks campaignId={state.campaignId} />;
}

type OpenRow = FunctionReturnType<typeof api.allyPicksReads.open>[number];

function PlayerPicks({ campaignId }: { campaignId: Id<"campaigns"> }) {
  const rows = useQuery(api.allyPicksReads.open, { campaignId });
  if (rows === undefined) return null;
  const picks = myPicks(rows);
  const waiting = waitingRows(rows);
  if (picks.length === 0 && waiting.length === 0) return null;
  return (
    <div className="hud-ap" data-testid="hud-ally-picks">
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
