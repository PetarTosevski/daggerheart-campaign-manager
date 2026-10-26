"use client";

import "./death.css";

import { useQuery } from "convex/react";
import { useId, useState } from "react";

import { Label, PaperInput, PaperModal, PaperNumber, Pill } from "@/components/party/sheet-ui";
import { DEATH_MOVE_LABELS, type AwayReason, type DeathMove } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SlotProps } from "../slots";

// Short reminders of CB 106; the book has the full text.
const MOVE_HINTS: Record<DeathMove, string> = {
  blazeOfGlory: "Take one last action, which critically succeeds, then cross through the veil.",
  avoidDeath: "Drop unconscious until an ally clears a Hit Point or the party finishes a long rest. Roll the Hope Die: at or under your level, gain a scar.",
  riskItAll: "Roll the Duality Dice. Hope higher: clear Hit Points and Stress worth the Hope Die. Fear higher: death. Matching: clear all.",
};

/** The death-move strip and parchment modal on the sheet (CB 106), for the owner and the GM. The badges sit in the banner. */
export function DeathMoveSheet({ character, canEdit, isGm }: SlotProps) {
  return (
    <section aria-label="Death moves" className="db-strip">
      {canEdit ? <DeathMoveControls characterId={character._id} name={character.sheet.name} updatedAt={character.updatedAt} sheet={character.sheet} isGm={isGm} /> : null}
    </section>
  );
}

function DeathMoveControls({
  characterId,
  name,
  updatedAt,
  sheet,
  isGm,
}: {
  characterId: Id<"characters">;
  name: string;
  updatedAt: number;
  sheet: SlotProps["character"]["sheet"];
  isGm: boolean;
}) {
  const state = useQuery(api.deathMoves.state, { characterId });
  const undo = useIntent(api.deathMoves.undo);
  // Closing the modal hides it until the character changes again.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);
  if (state === undefined) return null;

  const due = state.awaitingMove || state.pending !== null;
  const open = due && dismissedAt !== updatedAt;

  return (
    <>
      {due && !open ? (
        <div className="db-row">
          <Pill variant="solid" onClick={() => setDismissedAt(null)}>
            {state.pending ? `Finish ${DEATH_MOVE_LABELS[state.pending.move]}` : "Make a death move"}
          </Pill>
        </div>
      ) : null}
      {result || state.undoEntryId ? (
        <div className="db-row sh-small">
          {result ? (
            <p role="status" className="m-0">
              {result}
            </p>
          ) : null}
          {state.undoEntryId ? (
            <Pill
              disabled={undo.pending}
              onClick={() =>
                void undo.fire({ entryId: state.undoEntryId! }).then((r) => {
                  if (r) setResult("Death move undone.");
                })
              }
            >
              Undo death move
            </Pill>
          ) : null}
          {undo.error ? (
            <span role="alert" className="db-alert">
              {undo.error}
            </span>
          ) : null}
        </div>
      ) : null}
      <PaperModal open={open} onClose={() => setDismissedAt(updatedAt)} title="Death move">
        {state.pending?.move === "blazeOfGlory" ? (
          <FinishBlaze characterId={characterId} name={name} lessLethal={state.lessLethal} request={!isGm} onDone={setResult} />
        ) : state.pending?.move === "riskItAll" ? (
          <SplitRiskItAll key={state.undoEntryId ?? "risk"} characterId={characterId} value={state.pending.value} hp={sheet.hp} stress={sheet.stress} onDone={setResult} />
        ) : (
          <ChooseMove characterId={characterId} name={name} level={sheet.level} lessLethal={state.lessLethal} request={!isGm} onDone={setResult} />
        )}
      </PaperModal>
    </>
  );
}

/** Where a Castle High character goes instead of dying (HF 127). A player's pick is a request the GM settles (LL1). */
function AwayReasonPicker({ value, onChange, request }: { value: AwayReason; onChange: (r: AwayReason) => void; request: boolean }) {
  return (
    <fieldset className="db-reason">
      <legend className="sh-small">
        {request ? "Less lethal (Castle High): instead of dying, the character is… — the GM decides" : "Less lethal (Castle High): instead of dying, the character is…"}
      </legend>
      {(["infirmary", "sentHome"] as const).map((r) => (
        <label key={r}>
          <input type="radio" name="away-reason" checked={value === r} onChange={() => onChange(r)} />
          {request ? "Request: " : ""}
          {r === "infirmary" ? "In the infirmary" : "Sent home"}
        </label>
      ))}
    </fieldset>
  );
}

/** One death move as a large option button: the move's name is its accessible name, the reminder its description. */
function MoveOption({ move, disabled, onPick }: { move: DeathMove; disabled: boolean; onPick: () => void }) {
  const id = useId();
  return (
    <button
      type="button"
      className={`db-opt${move === "blazeOfGlory" ? " blaze" : ""}`}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-hint`}
      disabled={disabled}
      onClick={onPick}
    >
      <span id={`${id}-name`} className="db-opt-name">
        {DEATH_MOVE_LABELS[move]}
      </span>
      <span id={`${id}-hint`} className="db-opt-hint">
        {MOVE_HINTS[move]}
      </span>
    </button>
  );
}

function ChooseMove({
  characterId,
  name,
  level,
  lessLethal,
  request,
  onDone,
}: {
  characterId: Id<"characters">;
  name: string;
  level: number;
  lessLethal: boolean;
  request: boolean;
  onDone: (text: string) => void;
}) {
  const choose = useIntent(api.deathMoves.choose);
  const [action, setAction] = useState("");
  const [awayReason, setAwayReason] = useState<AwayReason>("infirmary");

  async function pick(move: DeathMove) {
    const r = await choose.fire({ characterId, move, ...(move === "blazeOfGlory" && action.trim() ? { action: action.trim() } : {}), ...(lessLethal ? { awayReason } : {}) });
    if (!r) return;
    if (move === "avoidDeath") {
      onDone(`Hope Die ${r.hopeDie} against level ${level}: ${r.scarred ? "a scar" : "no scar"}.${r.journeyEnds ? " The last Hope slot is gone: the journey ends." : ""}`);
    } else if (move === "riskItAll") {
      const lead = `Hope ${r.hopeDie}, Fear ${r.fearDie}: `;
      onDone(lead + (r.status !== "active" ? (r.status === "away" ? `away instead of dead${request ? " (requested; the GM decides)" : ""}.` : "death.") : r.pending ? "clear Hit Points and Stress." : "matching dice, everything cleared."));
    } else onDone("Blaze of Glory: the action critically succeeds.");
  }

  return (
    <>
      <p className="db-lede">{name} has marked their last Hit Point. Choose a death move.</p>
      {lessLethal ? <AwayReasonPicker value={awayReason} onChange={setAwayReason} request={request} /> : null}
      <div className="db-moves">
        {(["blazeOfGlory", "avoidDeath", "riskItAll"] as const).map((move) => (
          <div key={move} className="db-move">
            <MoveOption move={move} disabled={choose.pending} onPick={() => void pick(move)} />
            {move === "blazeOfGlory" ? (
              <label className="db-field">
                <Label>Last action (optional)</Label>
                <PaperInput value={action} maxLength={200} onChange={(e) => setAction(e.target.value)} />
              </label>
            ) : null}
          </div>
        ))}
      </div>
      {choose.error ? (
        <p role="alert" className="db-alert">
          {choose.error}
        </p>
      ) : null}
    </>
  );
}

function FinishBlaze({
  characterId,
  name,
  lessLethal,
  request,
  onDone,
}: {
  characterId: Id<"characters">;
  name: string;
  lessLethal: boolean;
  request: boolean;
  onDone: (text: string) => void;
}) {
  const finish = useIntent(api.deathMoves.finishBlaze);
  const [awayReason, setAwayReason] = useState<AwayReason>("infirmary");
  return (
    <>
      <p className="db-lede">{name} takes their last action, which critically succeeds. When it is done, they cross through the veil.</p>
      {lessLethal ? <AwayReasonPicker value={awayReason} onChange={setAwayReason} request={request} /> : null}
      <div className="sh-modal-actions">
        <Pill
          variant="solid"
          disabled={finish.pending}
          onClick={() =>
            void finish.fire({ characterId, ...(lessLethal ? { awayReason } : {}) }).then((r) => {
              if (r) onDone(r.status === "away" ? `${name} is away instead of dead${request ? " (requested; the GM decides)" : ""}.` : `${name} has crossed through the veil.`);
            })
          }
        >
          {lessLethal ? "End the action" : "Cross through the veil"}
        </Pill>
      </div>
      {finish.error ? (
        <p role="alert" className="db-alert">
          {finish.error}
        </p>
      ) : null}
    </>
  );
}

function SplitRiskItAll({ characterId, value, hp, stress, onDone }: { characterId: Id<"characters">; value: number; hp: number; stress: number; onDone: (text: string) => void }) {
  const resolve = useIntent(api.deathMoves.resolveRiskItAll);
  const total = Math.min(value, hp + stress);
  const minHp = Math.max(0, total - stress);
  const maxHp = Math.min(hp, total);
  const [hpClear, setHpClear] = useState(maxHp);
  const stressClear = total - hpClear;
  return (
    <>
      <p className="db-lede">
        The Hope Die shows {value}: clear {total} in total, split between Hit Points and Stress.
      </p>
      <label className="db-split">
        <Label>Hit Points to clear</Label>
        <PaperNumber type="number" min={minHp} max={maxHp} value={hpClear} onChange={(e) => setHpClear(Math.max(minHp, Math.min(maxHp, Math.round(Number(e.target.value) || 0))))} />
      </label>
      <p className="db-lede" data-testid="risk-stress">
        Stress to clear: {stressClear}
      </p>
      <div className="sh-modal-actions">
        <button
          type="button"
          className="sh-modal-ok"
          disabled={resolve.pending}
          onClick={() =>
            void resolve.fire({ characterId, hp: hpClear, stress: stressClear }).then((r) => {
              if (r) onDone(`Cleared ${hpClear} Hit Points and ${stressClear} Stress.`);
            })
          }
        >
          Clear them
        </button>
      </div>
      {resolve.error ? (
        <p role="alert" className="db-alert">
          {resolve.error}
        </p>
      ) : null}
    </>
  );
}
