"use client";

import "./rest.css";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { Label, paperField, Pill, Small } from "@/components/party/sheet-ui";
import { errorMessage } from "@/lib/convex-errors";
import { ALLY_MOVES, MOVE_LABELS, MOVES_PER_REST, REST_MOVES, type RestKind, type RestMove } from "@/lib/domain/rest/moves";
import { DOMAIN_CARDS } from "@/lib/srd/domain-cards";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { CharacterView } from "../../../../convex/characters";
import type { SlotProps } from "../slots";

type Pick = { move: RestMove; targetId?: Id<"characters">; countdownId?: Id<"countdowns"> };

const cardName = (id: string) => DOMAIN_CARDS.find((c) => c.id === id)?.name ?? id;

/** The sheet's downtime-move picker while a party rest is open (CB 105). */
export function Picker({ campaignId, character, canEdit }: SlotProps) {
  const state = useQuery(api.rests.current, { campaignId });
  const party = useQuery(api.characters.listByCampaign, { campaignId });
  if (state === undefined || party === undefined) {
    return (
      <Small as="p" role="status">
        Loading the rest…
      </Small>
    );
  }
  const open = state.open;
  if (open === null) return null;
  const choice = open.choices.find((c) => c.characterId === character._id);
  const kindLabel = open.kind === "short" ? "Short rest" : "Long rest";
  const unavailable =
    character.status !== "active" ? character.status : character.sheet.conditions?.includes("unconscious") ? "unconscious" : null;

  return (
    <section className="rp" aria-label="Downtime moves">
      <h4 className="rp-h">{kindLabel}: downtime moves</h4>
      {!canEdit || unavailable !== null ? (
        <Small as="p">
          {unavailable !== null
            ? `${character.sheet.name} is ${unavailable} and can't pick downtime moves.`
            : choice
              ? `Picked: ${choice.moves.map((m) => MOVE_LABELS[m.move]).join(", ")}`
              : "Still choosing."}
        </Small>
      ) : (
        <>
          <MoveForm
            key={`${open._id}-${character._id}`}
            restId={open._id}
            kind={open.kind}
            moves={open.moves.find((m) => m.characterId === character._id)?.moves ?? REST_MOVES[open.kind]}
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
  moves,
  character,
  allies,
  initial,
}: {
  restId: Id<"rests">;
  kind: RestKind;
  /** The moves this PC can pick: the rest's core moves with the frame and class moves (Make a Feast, Keep Watch, halt lycanthropy, Tribute, Martial Preparation). */
  moves: readonly RestMove[];
  character: CharacterView;
  allies: CharacterView[];
  initial: Pick[];
}) {
  const choose = useIntent(api.rests.choose);
  const projects = useQuery(api.rests.projects, kind === "long" ? { characterId: character._id } : "skip");
  const [picks, setPicks] = useState<Pick[]>(() =>
    Array.from({ length: MOVES_PER_REST }, (_, i) => initial[i] ?? { move: moves[0] }),
  );
  const [saved, setSaved] = useState(initial.length > 0);
  const uid = useId();
  const set = (i: number, next: Pick) => {
    setSaved(false);
    setPicks((all) => all.map((p, k) => (k === i ? next : p)));
  };

  return (
    <form
      className="rp-form"
      onSubmit={(e) => {
        e.preventDefault();
        void choose.fire({ restId, characterId: character._id, moves: picks }).then((r) => setSaved(r !== undefined));
      }}
    >
      {picks.map((pick, i) => (
        <div key={i} className="rp-slot">
          <div role="group" aria-labelledby={`${uid}-move-${i}`} className="rp-chips">
            <Label id={`${uid}-move-${i}`} className="rp-slot-lbl">
              Move {i + 1}
            </Label>
            {moves.map((m) => (
              <button key={m} type="button" className="rp-chip" aria-pressed={pick.move === m} onClick={() => set(i, { move: m })}>
                {MOVE_LABELS[m]}
              </button>
            ))}
          </div>
          {ALLY_MOVES.includes(pick.move) && allies.length > 0 ? (
            <label className="rp-field">
              <Label>On</Label>
              <select
                className={paperField.input}
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
            <label className="rp-field">
              <Label>Project</Label>
              <select
                className={paperField.input}
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
        <Small as="p">The GM asks for an action roll to gauge the project&apos;s progress: roll it in the dice box.</Small>
      ) : null}
      {picks.some((p) => p.move === "martialPreparation") ? (
        <Small as="p">
          Martial Preparation (CB 48): describe how you train with the party. You gain a d6 Slayer Die, up to your Proficiency, to spend on an
          attack or damage roll in the dice box. Unspent dice clear at the end of the session for a Hope each.
        </Small>
      ) : null}
      <div className="rp-actions">
        <Pill type="submit" variant="solid" disabled={choose.pending}>
          Save moves
        </Pill>
        {saved ? <Small>Saved. The GM applies them when the rest ends.</Small> : null}
      </div>
      <p aria-live="polite" className="rp-error">
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
    <fieldset className="rp-project">
      <legend className="sh-lbl">New project</legend>
      <label className="rp-field rp-grow">
        <Small>Name</Small>
        <input className={paperField.input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="rp-field">
        <Small>Countdown</Small>
        <input className={`${paperField.input} rp-count`} type="number" min={1} max={20} value={start} onChange={(e) => setStart(Number(e.target.value))} />
      </label>
      <Pill
        disabled={create.pending || name.trim() === ""}
        onClick={() => void create.fire({ characterId, name, startingValue: start }).then((r) => r && setName(""))}
      >
        Create project
      </Pill>
      <span aria-live="polite" className="rp-error">
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
    <div className="rp-swaps">
      <Label>Swap domain cards (free during a rest)</Label>
      <div className="rp-swap-lists">
        <ul aria-label="Rest loadout" className="rp-swap-list">
          {loadout.map((id) => (
            <li key={id}>
              {cardName(id)}
              <Pill onClick={() => run(id, "vault")}>To vault</Pill>
            </li>
          ))}
        </ul>
        <ul aria-label="Rest vault" className="rp-swap-list">
          {vault.map((id) => (
            <li key={id}>
              {cardName(id)}
              <Pill disabled={loadout.length >= 5} onClick={() => run(id, "loadout")}>
                To loadout
              </Pill>
            </li>
          ))}
        </ul>
      </div>
      <p aria-live="polite" className="rp-error">
        {error ?? ""}
      </p>
    </div>
  );
}
