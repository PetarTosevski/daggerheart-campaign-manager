"use client";

import "./death.css";

import { Pill } from "@/components/party/sheet-ui";
import { AWAY_REASON_LABELS, DEATH_MOVE_LABELS, type AwayReason, type DeathMove } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** `deathMoves.state`'s `request`: a player's death move waiting for the GM's confirm (HD4, answer 15b). */
export type DeathRequestView = { move: DeathMove; action?: string; awayReason?: AwayReason; entryId: Id<"actionLog">; at: number };

/** The result of a death move as one line, from `choose` / `confirm`'s return (CB 106). */
export function deathResultText(
  move: DeathMove,
  r: { status: string; pending: unknown; hopeDie: number | null; fearDie: number | null; scarred: boolean; journeyEnds: boolean },
  level: number,
  awayRequested: boolean,
): string {
  if (move === "avoidDeath") {
    return `Hope Die ${r.hopeDie} against level ${level}: ${r.scarred ? "a scar" : "no scar"}.${r.journeyEnds ? " The last Hope slot is gone: the journey ends." : ""}`;
  }
  if (move === "riskItAll") {
    const lead = `Hope ${r.hopeDie}, Fear ${r.fearDie}: `;
    if (r.status === "away") return `${lead}away instead of dead${awayRequested ? " (requested; the GM decides)" : ""}.`;
    if (r.status !== "active") return `${lead}death.`;
    return lead + (r.pending ? "clear Hit Points and Stress." : "matching dice, everything cleared.");
  }
  return "Blaze of Glory: the action critically succeeds.";
}

/**
 * The wait on the sheet's death-move strip (HD4). The player sees "Waiting for the GM to confirm …" with Take it back
 * (an undo of the request row); the GM sees the confirm card: the move, its last action, the less-lethal request, and
 * Confirm the death move / Send it back. `onDone` gets the confirmed move's result line.
 */
export function DeathMoveWait({
  characterId,
  name,
  level,
  request,
  isGm,
  onDone,
}: {
  characterId: Id<"characters">;
  name: string;
  level: number;
  request: DeathRequestView;
  isGm: boolean;
  onDone: (text: string) => void;
}) {
  const label = DEATH_MOVE_LABELS[request.move];
  if (!isGm) return <PlayerWait request={request} label={label} />;
  return <GmConfirm characterId={characterId} name={name} level={level} request={request} label={label} onDone={onDone} />;
}

function PlayerWait({ request, label }: { request: DeathRequestView; label: string }) {
  const undo = useIntent(api.deathMoves.undo);
  return (
    <div className="db-row db-wait" data-testid="death-waiting">
      <p role="status" className="m-0">
        Waiting for the GM to confirm {label}.
      </p>
      <Pill disabled={undo.pending} onClick={() => void undo.fire({ entryId: request.entryId })}>
        Take it back
      </Pill>
      {undo.error ? (
        <span role="alert" className="db-alert">
          {undo.error}
        </span>
      ) : null}
    </div>
  );
}

function GmConfirm({
  characterId,
  name,
  level,
  request,
  label,
  onDone,
}: {
  characterId: Id<"characters">;
  name: string;
  level: number;
  request: DeathRequestView;
  label: string;
  onDone: (text: string) => void;
}) {
  const confirm = useIntent(api.deathMoves.confirm);
  const decline = useIntent(api.deathMoves.decline);
  const busy = confirm.pending || decline.pending;
  const error = confirm.error ?? decline.error;
  return (
    <div role="group" aria-label="Death move to confirm" className="db-confirm" data-testid="death-confirm">
      <p className="m-0">
        {name} chose <strong>{label}</strong>
        {request.action ? `: ${request.action}` : ""}.
      </p>
      {request.awayReason ? <p className="m-0 sh-small">Less lethal: the player asks to be {AWAY_REASON_LABELS[request.awayReason]} instead of dying.</p> : null}
      <div className="db-row">
        <Pill
          variant="solid"
          disabled={busy}
          onClick={() =>
            void confirm.fire({ characterId }).then((r) => {
              if (r) onDone(deathResultText(request.move, r, level, request.awayReason !== undefined));
            })
          }
        >
          Confirm the death move
        </Pill>
        <Pill
          disabled={busy}
          onClick={() =>
            void decline.fire({ characterId }).then((r) => {
              if (r !== undefined) onDone(`${label} sent back: ${name} chooses again.`);
            })
          }
        >
          Send it back
        </Pill>
      </div>
      {error ? (
        <p role="alert" className="db-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
