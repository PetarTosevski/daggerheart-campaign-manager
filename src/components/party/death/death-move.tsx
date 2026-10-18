"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { DEATH_MOVE_LABELS, type AwayReason, type DeathMove } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SlotProps } from "../slots";

import { DeathBadges } from "./badges";

// Short reminders of CB 106; the book has the full text.
const MOVE_HINTS: Record<DeathMove, string> = {
  blazeOfGlory: "Take one last action, which critically succeeds, then cross through the veil.",
  avoidDeath: "Drop unconscious until an ally clears a Hit Point or the party finishes a long rest. Roll the Hope Die: at or under your level, gain a scar.",
  riskItAll: "Roll the Duality Dice. Hope higher: clear Hit Points and Stress worth the Hope Die. Fear higher: death. Matching: clear all.",
};

const FIELD = "rounded-lg border border-line-2 bg-black/30 px-3 py-2 text-[15px] text-parchment";

/** The death-move strip and modal on the sheet (CB 106): badges for everyone, the moves for the owner and the GM. */
export function DeathMoveSheet(props: SlotProps) {
  const { character, canEdit } = props;
  return (
    <section aria-label="Death moves" className="flex flex-col gap-2 empty:hidden">
      <DeathBadges {...props} showAway={false} tone="paper" />
      {canEdit ? <DeathMoveControls characterId={character._id} name={character.sheet.name} updatedAt={character.updatedAt} sheet={character.sheet} /> : null}
    </section>
  );
}

function DeathMoveControls({ characterId, name, updatedAt, sheet }: { characterId: Id<"characters">; name: string; updatedAt: number; sheet: SlotProps["character"]["sheet"] }) {
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
        <div className="flex flex-wrap items-center gap-2">
          <BrandButton size="sm" variant="dangerSolid" onClick={() => setDismissedAt(null)}>
            {state.pending ? `Finish ${DEATH_MOVE_LABELS[state.pending.move]}` : "Make a death move"}
          </BrandButton>
        </div>
      ) : null}
      {result || state.undoEntryId ? (
        <div className="flex flex-wrap items-center gap-3 text-[15px]">
          {result ? (
            <p role="status" className="m-0">
              {result}
            </p>
          ) : null}
          {state.undoEntryId ? (
            <BrandButton
              size="sm"
              variant="outline"
              className="border-[#8a6a3a] text-[#3a2a14]"
              disabled={undo.pending}
              onClick={() =>
                void undo.fire({ entryId: state.undoEntryId! }).then((r) => {
                  if (r) setResult("Death move undone.");
                })
              }
            >
              Undo death move
            </BrandButton>
          ) : null}
          {undo.error ? (
            <span role="alert" className="text-[14px]">
              {undo.error}
            </span>
          ) : null}
        </div>
      ) : null}
      <Modal open={open} onClose={() => setDismissedAt(updatedAt)} title="Death move">
        {state.pending?.move === "blazeOfGlory" ? (
          <FinishBlaze characterId={characterId} name={name} lessLethal={state.lessLethal} onDone={setResult} />
        ) : state.pending?.move === "riskItAll" ? (
          <SplitRiskItAll key={state.undoEntryId ?? "risk"} characterId={characterId} value={state.pending.value} hp={sheet.hp} stress={sheet.stress} onDone={setResult} />
        ) : (
          <ChooseMove characterId={characterId} name={name} level={sheet.level} lessLethal={state.lessLethal} onDone={setResult} />
        )}
      </Modal>
    </>
  );
}

function AwayReasonPicker({ value, onChange }: { value: AwayReason; onChange: (r: AwayReason) => void }) {
  return (
    <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
      <legend className="mb-1 text-[14px] text-muted-text">Less lethal (Castle High): instead of dying, the character is…</legend>
      {(["infirmary", "sentHome"] as const).map((r) => (
        <label key={r} className="flex items-center gap-2 text-[15px]">
          <input type="radio" name="away-reason" checked={value === r} onChange={() => onChange(r)} />
          {r === "infirmary" ? "In the infirmary" : "Sent home"}
        </label>
      ))}
    </fieldset>
  );
}

function ChooseMove({ characterId, name, level, lessLethal, onDone }: { characterId: Id<"characters">; name: string; level: number; lessLethal: boolean; onDone: (text: string) => void }) {
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
      onDone(lead + (r.status !== "active" ? (r.status === "away" ? "away instead of dead." : "death.") : r.pending ? "clear Hit Points and Stress." : "matching dice, everything cleared."));
    } else onDone("Blaze of Glory: the action critically succeeds.");
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[15px] text-muted-text">{name} has marked their last Hit Point. Choose a death move.</p>
      {lessLethal ? <AwayReasonPicker value={awayReason} onChange={setAwayReason} /> : null}
      <div className="flex flex-col gap-3">
        {(["blazeOfGlory", "avoidDeath", "riskItAll"] as const).map((move) => (
          <div key={move} className="flex flex-col gap-2 rounded-xl border border-line-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <BrandButton size="sm" variant={move === "blazeOfGlory" ? "dangerSolid" : "solid"} disabled={choose.pending} onClick={() => void pick(move)}>
                {DEATH_MOVE_LABELS[move]}
              </BrandButton>
            </div>
            <p className="m-0 text-[14px] text-muted-text">{MOVE_HINTS[move]}</p>
            {move === "blazeOfGlory" ? (
              <label className="flex flex-col gap-1 text-[14px]">
                Last action (optional)
                <input className={FIELD} value={action} maxLength={200} onChange={(e) => setAction(e.target.value)} />
              </label>
            ) : null}
          </div>
        ))}
      </div>
      {choose.error ? (
        <p role="alert" className="m-0 text-[14px] text-danger">
          {choose.error}
        </p>
      ) : null}
    </div>
  );
}

function FinishBlaze({ characterId, name, lessLethal, onDone }: { characterId: Id<"characters">; name: string; lessLethal: boolean; onDone: (text: string) => void }) {
  const finish = useIntent(api.deathMoves.finishBlaze);
  const [awayReason, setAwayReason] = useState<AwayReason>("infirmary");
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[15px]">{name} takes their last action, which critically succeeds. When it is done, they cross through the veil.</p>
      {lessLethal ? <AwayReasonPicker value={awayReason} onChange={setAwayReason} /> : null}
      <BrandButton
        variant="dangerSolid"
        disabled={finish.pending}
        onClick={() =>
          void finish.fire({ characterId, ...(lessLethal ? { awayReason } : {}) }).then((r) => {
            if (r) onDone(r.status === "away" ? `${name} is away instead of dead.` : `${name} has crossed through the veil.`);
          })
        }
      >
        {lessLethal ? "End the action" : "Cross through the veil"}
      </BrandButton>
      {finish.error ? (
        <p role="alert" className="m-0 text-[14px] text-danger">
          {finish.error}
        </p>
      ) : null}
    </div>
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
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[15px]">
        The Hope Die shows {value}: clear {total} in total, split between Hit Points and Stress.
      </p>
      <label className="flex items-center gap-3 text-[15px]">
        Hit Points to clear
        <input type="number" className={`${FIELD} w-20`} min={minHp} max={maxHp} value={hpClear} onChange={(e) => setHpClear(Math.max(minHp, Math.min(maxHp, Math.round(Number(e.target.value) || 0))))} />
      </label>
      <p className="m-0 text-[15px]" data-testid="risk-stress">
        Stress to clear: {stressClear}
      </p>
      <BrandButton
        variant="solid"
        disabled={resolve.pending}
        onClick={() =>
          void resolve.fire({ characterId, hp: hpClear, stress: stressClear }).then((r) => {
            if (r) onDone(`Cleared ${hpClear} Hit Points and ${stressClear} Stress.`);
          })
        }
      >
        Clear them
      </BrandButton>
      {resolve.error ? (
        <p role="alert" className="m-0 text-[14px] text-danger">
          {resolve.error}
        </p>
      ) : null}
    </div>
  );
}
