"use client";

import { useQuery } from "convex/react";
import { useId, useState } from "react";

import { Modal } from "@/components/brand/modal";
import { DeathMoveModal } from "@/components/party/death";
import { deathResultText } from "@/components/party/death/waiting";
import { DEATH_MOVE_LABELS, type DeathMove } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../../convex/characters";
import { Popup, WaitingDots, hudButtonClass } from "../ui";
import { DEATH_MOVE_RULES, DEATH_MOVES, deathPhase, requestFate, type RequestFate } from "./model";

/** How many feed rows the player's outcome is looked for in (the request row and what the GM wrote above it). */
export const DEATH_FEED_ROWS = 10;

/** The footer of the choose and wait views (Main 'Last Hit Point'). */
export const DEATH_FOOTER = "Your table can see this choice. The GM confirms the outcome.";

export const SKULL_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 1.5c-3.3 0-5.5 2.3-5.5 5.2 0 1.8.9 3.1 2 3.9V13a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.4c1.1-.8 2-2.1 2-3.9 0-2.9-2.2-5.2-5.5-5.2zM5.8 6.2a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zm4.4 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6zM7 10.5h2l-1 1.6z" />
  </svg>
);

type Watch = { entryId: Id<"actionLog">; move: DeathMove };

/**
 * The death move of one character the viewer plays (a player's own; the GM's own PCs on the GM view), plan combat-hud
 * H4.3 (Main 'Last Hit Point'):
 * - last Hit Point marked: 'Choose a death move' in a modal over the dimmed map (the native dialog's backdrop);
 * - a player's pick waits for the GM (HD4, answer 15b): the same modal reads 'Waiting for the GM to confirm' with
 *   Take it back (an undo of the request row, as the sheet's `DeathMoveWait`);
 * - the GM confirms: the outcome shows as a popup, read from the move's own feed row (`feed.list`); sent back: the
 *   choose view returns with a line saying so;
 * - a confirmed Blaze of Glory or Risk It All won with Hope finishes in the sheet's own modal (`DeathMoveModal`), as the
 *   classic map does; so does the whole choice in a less-lethal frame (Castle High), whose away reason the sheet asks.
 * Closing the modal hides it until the phase changes; a "Choose a death move" button brings it back.
 */
export function OwnDeath({ campaignId, character, gm }: { campaignId: Id<"campaigns">; character: CharacterView; gm: boolean }) {
  const characterId = character._id;
  const name = character.sheet.name;
  const state = useQuery(api.deathMoves.state, { characterId });
  // The request this view watches until its outcome is read. Kept from render to render (React's "information from
  // previous renders" pattern, no effect): a reload while waiting picks it up again from `state.request`.
  const [watch, setWatch] = useState<Watch | null>(null);
  // The phase key the player closed the modal on (`choose`, `wait:<entryId>`); another phase opens it again.
  const [hidden, setHidden] = useState<string | null>(null);
  // The GM's own PC: the move is made at once and `choose` returns the result.
  const [result, setResult] = useState<string | null>(null);
  const request = state?.request ?? null;
  if (request !== null && request.entryId !== watch?.entryId) setWatch({ entryId: request.entryId, move: request.move });
  const feed = useQuery(api.feed.list, watch !== null && request === null ? { campaignId, paginationOpts: { numItems: DEATH_FEED_ROWS, cursor: null } } : "skip");
  if (state === undefined) return null;

  const phase = deathPhase(state);
  const fate: RequestFate = watch !== null && request === null && feed !== undefined ? requestFate(feed.page, watch.entryId, characterId) : { kind: "none" };
  const key = phase === "wait" ? `wait:${request!.entryId}` : phase;
  const open = hidden !== key;
  const outcome = fate.kind === "outcome" ? fate.text : result;

  return (
    <>
      {phase === "finish" || (phase === "choose" && state.lessLethal) ? (
        <div className="hud-death-sheet" data-testid="hud-death-sheet">
          <DeathMoveModal campaignId={campaignId} character={character} canEdit={character.canEdit} isGm={false} hopeAndFear={false} />
        </div>
      ) : null}
      {(phase === "choose" && !state.lessLethal) || phase === "wait" ? (
        open ? (
          <Modal
            open
            onClose={() => setHidden(key)}
            title={phase === "wait" ? "Waiting for the GM to confirm" : "Choose a death move"}
            className="hud-dm"
          >
            {phase === "wait" ? (
              <WaitView name={name} request={request!} onTakenBack={() => setWatch(null)} />
            ) : (
              <ChooseView
                characterId={characterId}
                name={name}
                gm={gm}
                back={fate.kind === "back" && watch ? watch.move : null}
                onResult={(move, r) => {
                  if (!r.awaitingGm) setResult(deathResultText(move, r, character.sheet.level, false));
                }}
              />
            )}
          </Modal>
        ) : (
          <button type="button" className={`${hudButtonClass("primary")} hud-death-reopen`} onClick={() => setHidden(null)} data-testid="hud-death-reopen">
            {phase === "wait" ? `${name}: waiting for the GM` : `${name}: choose a death move`}
          </button>
        )
      ) : null}
      {outcome !== null && phase !== "wait" ? (
        <Popup
          icon={SKULL_ICON}
          tone="red"
          title={`${name}’s death move`}
          sub={watch ? `${DEATH_MOVE_LABELS[watch.move]} · confirmed by the GM` : undefined}
          testId="hud-death-outcome"
          primary={{
            label: "Got it",
            onClick: () => {
              setWatch(null);
              setResult(null);
            },
          }}
        >
          <p role="status">{outcome}</p>
        </Popup>
      ) : null}
    </>
  );
}

type ChooseResult = { status: string; pending: unknown; hopeDie: number | null; fearDie: number | null; scarred: boolean; journeyEnds: boolean; awaitingGm: boolean };

function ChooseView({
  characterId,
  name,
  gm,
  back,
  onResult,
}: {
  characterId: Id<"characters">;
  name: string;
  gm: boolean;
  /** The move the GM sent back (or whose confirm was undone), if any. */
  back: DeathMove | null;
  onResult: (move: DeathMove, r: ChooseResult) => void;
}) {
  const choose = useIntent(api.deathMoves.choose);
  const [action, setAction] = useState("");
  const actionId = useId();
  async function pick(move: DeathMove) {
    const last = move === "blazeOfGlory" && action.trim() ? { action: action.trim() } : {};
    const r = await choose.fire({ characterId, move, ...last });
    if (r) onResult(move, r);
  }
  return (
    <div className="hud-dm-body" data-testid="hud-death-choose">
      <p className="hud-dm-k">{name} marked their last Hit Point</p>
      {back ? (
        <p className="hud-dm-back" role="status">
          The GM sent back {DEATH_MOVE_LABELS[back]}. Choose again.
        </p>
      ) : null}
      {DEATH_MOVES.map((move) => (
        <MoveButton key={move} move={move} disabled={choose.pending} onPick={() => void pick(move)} />
      ))}
      <label className="hud-dm-field" htmlFor={actionId}>
        <span>Blaze of Glory: your last action (optional)</span>
        <input id={actionId} value={action} maxLength={200} onChange={(e) => setAction(e.target.value)} />
      </label>
      {choose.error ? (
        <p role="alert" className="hud-dm-alert">
          {choose.error}
        </p>
      ) : null}
      <p className="hud-dm-n">{gm ? "Your table can see this choice." : DEATH_FOOTER}</p>
    </div>
  );
}

/** One move: its name is the button's accessible name, its rule the description. */
function MoveButton({ move, disabled, onPick }: { move: DeathMove; disabled: boolean; onPick: () => void }) {
  const id = useId();
  return (
    <button type="button" className="hud-dm-o" aria-labelledby={`${id}-n`} aria-describedby={`${id}-r`} disabled={disabled} onClick={onPick}>
      <b id={`${id}-n`}>{DEATH_MOVE_LABELS[move]}</b>
      <span id={`${id}-r`}>{DEATH_MOVE_RULES[move]}</span>
    </button>
  );
}

function WaitView({ name, request, onTakenBack }: { name: string; request: { move: DeathMove; entryId: Id<"actionLog">; action?: string }; onTakenBack: () => void }) {
  const undo = useIntent(api.deathMoves.undo);
  const label = DEATH_MOVE_LABELS[request.move];
  return (
    <div className="hud-dm-body" data-testid="hud-death-waiting">
      <p className="hud-dm-k">{name} chose {label}</p>
      <p role="status" className="hud-dm-wait">
        <WaitingDots /> Waiting for the GM to confirm {label}.
      </p>
      {request.action ? <p className="hud-dm-action">Last action: {request.action}</p> : null}
      <div className="hud-dm-f">
        <button
          type="button"
          className={hudButtonClass("cancel")}
          disabled={undo.pending}
          onClick={() =>
            void undo.fire({ entryId: request.entryId }).then((r) => {
              if (r !== undefined) onTakenBack();
            })
          }
        >
          Take it back
        </button>
      </div>
      {undo.error ? (
        <p role="alert" className="hud-dm-alert">
          {undo.error}
        </p>
      ) : null}
      <p className="hud-dm-n">{DEATH_FOOTER}</p>
    </div>
  );
}
