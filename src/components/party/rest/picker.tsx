"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { errorMessage } from "@/lib/convex-errors";
import { ALLY_MOVES, MOVE_LABELS, MOVES_PER_REST, REST_MOVES, type RestKind, type RestMove } from "@/lib/domain/rest/moves";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../convex/characters";
import type { SlotProps } from "../slots";

type Pick = { move: RestMove; targetId?: Id<"characters">; countdownId?: Id<"countdowns"> };

const SELECT = "min-h-10 rounded-md border border-[#c9b083] bg-[#fbf3e1] px-2 text-[15px]";
const BTN = "min-h-10 cursor-pointer rounded-md border border-[#5b2b2b] bg-transparent px-3 text-[14px] disabled:cursor-not-allowed disabled:opacity-50";
const cardName = (id: string) => DOMAIN_CARDS.find((c) => c.id === id)?.name ?? id;

/** The sheet's downtime-move picker while a party rest is open (CB 105). */
export function Picker({ campaignId, character, canEdit }: SlotProps) {
  const state = useQuery(api.rests.current, { campaignId });
  const party = useQuery(api.characters.listByCampaign, { campaignId });
  if (state === undefined || party === undefined) {
    return (
      <p role="status" className="cs-small m-0">
        Loading the rest…
      </p>
    );
  }
  const open = state.open;
  if (open === null) return null;
  const choice = open.choices.find((c) => c.characterId === character._id);
  const kindLabel = open.kind === "short" ? "Short rest" : "Long rest";
  const unavailable =
    character.status !== "active" ? character.status : character.sheet.conditions?.includes("unconscious") ? "unconscious" : null;

  return (
    <section className="cs-box" aria-label="Downtime moves">
      <h3 className="cs-h">{kindLabel}: downtime moves</h3>
      {!canEdit || unavailable !== null ? (
        <p className="cs-small m-0">
          {unavailable !== null
            ? `${character.sheet.name} is ${unavailable} and can't pick downtime moves.`
            : choice
              ? `Picked: ${choice.moves.map((m) => MOVE_LABELS[m.move]).join(", ")}`
              : "Still choosing."}
        </p>
      ) : (
        <>
          <MoveForm
            key={`${open._id}-${character._id}`}
            restId={open._id}
            kind={open.kind}
            character={character}
            allies={party.filter((c) => c._id !== character._id && c.status === "active")}
            initial={choice?.moves ?? []}
          />
          <CardSwaps character={character} />
        </>
      )}
    </section>
  );
}

function MoveForm({
  restId,
  kind,
  character,
  allies,
  initial,
}: {
  restId: Id<"rests">;
  kind: RestKind;
  character: CharacterView;
  allies: CharacterView[];
  initial: Pick[];
}) {
  const choose = useIntent(api.rests.choose);
  const projects = useQuery(api.rests.projects, kind === "long" ? { characterId: character._id } : "skip");
  const [picks, setPicks] = useState<Pick[]>(() =>
    Array.from({ length: MOVES_PER_REST }, (_, i) => initial[i] ?? { move: REST_MOVES[kind][0] }),
  );
  const [saved, setSaved] = useState(initial.length > 0);
  const set = (i: number, next: Pick) => {
    setSaved(false);
    setPicks((all) => all.map((p, k) => (k === i ? next : p)));
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void choose.fire({ restId, characterId: character._id, moves: picks }).then((r) => setSaved(r !== undefined));
      }}
    >
      {picks.map((pick, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="cs-lbl">Move {i + 1}</span>
            <select className={SELECT} value={pick.move} onChange={(e) => set(i, { move: e.target.value as RestMove })}>
              {REST_MOVES[kind].map((m) => (
                <option key={m} value={m}>
                  {MOVE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          {ALLY_MOVES.includes(pick.move) && allies.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="cs-lbl">On</span>
              <select
                className={SELECT}
                value={pick.targetId ?? ""}
                onChange={(e) => {
                  const ally = allies.find((a) => a._id === e.target.value);
                  set(i, ally ? { move: pick.move, targetId: ally._id } : { move: pick.move });
                }}
              >
                <option value="">Myself</option>
                {allies.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.sheet.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {pick.move === "workOnProject" ? (
            <label className="flex items-center gap-2">
              <span className="cs-lbl">Project</span>
              <select
                className={SELECT}
                value={pick.countdownId ?? ""}
                onChange={(e) => {
                  const project = projects?.find((p) => p._id === e.target.value);
                  set(i, project ? { move: pick.move, countdownId: project._id } : { move: pick.move });
                }}
              >
                <option value="">GM asks for a roll</option>
                {(projects ?? [])
                  .filter((p) => p.status === "active")
                  .map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.name} ({p.currentValue} left)
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </div>
      ))}
      {picks.some((p) => p.move === "workOnProject" && p.countdownId === undefined) ? (
        <p className="cs-small m-0">The GM asks for an action roll to gauge the project&apos;s progress: roll it in the dice box.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={BTN} disabled={choose.pending}>
          Save moves
        </button>
        {saved ? <span className="cs-small">Saved. The GM applies them when the rest ends.</span> : null}
      </div>
      <p aria-live="polite" className="m-0 text-[14px] text-[#8a1c1c]">
        {choose.error ?? ""}
      </p>
      {kind === "long" ? <NewProject characterId={character._id} /> : null}
    </form>
  );
}

/** Establish a project: a Progress Countdown owned by the character (CB 105). */
function NewProject({ characterId }: { characterId: Id<"characters"> }) {
  const create = useIntent(api.rests.createProject);
  const [name, setName] = useState("");
  const [start, setStart] = useState(4);
  return (
    <fieldset className="flex flex-wrap items-end gap-2 border-0 p-0">
      <legend className="cs-lbl mb-1">New project</legend>
      <label className="flex flex-col gap-1">
        <span className="cs-small">Name</span>
        <input className={SELECT} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="cs-small">Countdown</span>
        <input className={`${SELECT} w-20`} type="number" min={1} max={20} value={start} onChange={(e) => setStart(Number(e.target.value))} />
      </label>
      <button
        type="button"
        className={BTN}
        disabled={create.pending || name.trim() === ""}
        onClick={() => void create.fire({ characterId, name, startingValue: start }).then((r) => r && setName(""))}
      >
        Create project
      </button>
      <span aria-live="polite" className="text-[14px] text-[#8a1c1c]">
        {create.error ?? ""}
      </span>
    </fieldset>
  );
}

/** Free loadout ↔ vault swaps during a rest (CB 105: "swap any domain cards in their loadout for cards in their vault"). */
function CardSwaps({ character }: { character: CharacterView }) {
  const move = useMutation(api.characters.moveCard);
  const [error, setError] = useState<string | null>(null);
  const { owned, loadout } = character.sheet.domainCards;
  const vault = owned.filter((id) => !loadout.includes(id));
  if (owned.length === 0) return null;
  const run = (cardId: string, to: "loadout" | "vault") => {
    setError(null);
    move({ characterId: character._id, cardId, to, duringRest: true }).catch((e: unknown) => setError(errorMessage(e)));
  };
  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-[#c9b083] pt-3">
      <span className="cs-lbl">Swap domain cards (free during a rest)</span>
      <div className="flex flex-wrap gap-4">
        <ul aria-label="Rest loadout" className="m-0 flex list-none flex-col gap-1 p-0">
          {loadout.map((id) => (
            <li key={id} className="flex items-center gap-2 text-[14px]">
              {cardName(id)}
              <button type="button" className={BTN} onClick={() => run(id, "vault")}>
                To vault
              </button>
            </li>
          ))}
        </ul>
        <ul aria-label="Rest vault" className="m-0 flex list-none flex-col gap-1 p-0">
          {vault.map((id) => (
            <li key={id} className="flex items-center gap-2 text-[14px]">
              {cardName(id)}
              <button type="button" className={BTN} disabled={loadout.length >= 5} onClick={() => run(id, "loadout")}>
                To loadout
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p aria-live="polite" className="m-0 text-[14px] text-[#8a1c1c]">
        {error ?? ""}
      </p>
    </div>
  );
}
