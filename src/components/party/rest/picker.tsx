"use client";

import "./rest.css";

import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";

import { Label, paperField, Pill, Small } from "@/components/party/sheet-ui";
import { errorMessage } from "@/lib/convex-errors";
import { ALLY_MOVES, MOVE_LABELS, MOVES_PER_REST, REST_MOVES, type RestKind, type RestMove } from "@/lib/domain/rest/moves";
import { loadoutMax } from "@/lib/domain/transformations";
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
  const state = useQuery(api.restsReads.current, { campaignId });
  const party = useQuery(api.charactersReads.listByCampaign, { campaignId });
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
  const mine = open.moves.find((m) => m.characterId === character._id);
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
            moves={mine?.moves ?? REST_MOVES[open.kind]}
            efficient={mine?.efficient ?? []}
            slots={mine?.slots ?? MOVES_PER_REST}
            trance={mine?.trance}
            extraMoves={mine?.extraMoves ?? 0}
            oasis={mine?.oasis ?? false}
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

/**
 * Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take the
 * higher result." On a holder's sheet after a short rest until that holder closes it (DA5; DA15, user 2026-10-30): the
 * party's downtime dice, each with its kept result and a "Reroll (keep higher)" button while the party's pool (one
 * reroll per Duneborne) holds one; the same die can be rerolled again. "Close Oasis" closes this holder's panel and
 * withdraws their unused reroll. The server rolls, so the result shows when the rest's row updates; the buttons are
 * disabled while a call runs.
 */
export function OasisDice({ campaignId, character, canEdit }: SlotProps) {
  const state = useQuery(api.restsReads.current, { campaignId });
  const party = useQuery(api.charactersReads.listByCampaign, { campaignId });
  const reroll = useIntent(api.rests.oasisReroll);
  const close = useIntent(api.rests.closeOasis);
  const uid = useId();
  if (state === undefined || party === undefined) {
    return (
      <Small as="p" role="status">
        Loading the rest…
      </Small>
    );
  }
  const last = state.last;
  if (last === null || !last.resultsOpen || !last.oasisHolders.includes(character._id) || last.oasisClosed.includes(character._id)) return null;
  const nameOf = (id: Id<"characters">) => party.find((c) => c._id === id)?.sheet.name ?? "A PC";
  const left = last.oasisLeft;
  const can = canEdit && left > 0;
  const busy = reroll.pending || close.pending;

  return (
    <section className="rp" aria-label="Oasis">
      <h4 className="rp-h">Oasis: reroll a downtime die</h4>
      <Small as="p">
        Oasis (HF 27): reroll a die used for a downtime move, yours or an ally&apos;s, and take the higher result. The party has
        one reroll per Duneborne; a die can be rerolled again while rerolls remain.
      </Small>
      <Small as="p" data-testid="oasis-left">
        {left === 0 ? "No rerolls left for the party." : `${left} ${left === 1 ? "reroll" : "rerolls"} left for the party.`}
      </Small>
      <ul aria-label="Downtime dice" className="rp-dice">
        {last.dice.map((d, i) => {
          const on = d.targetId !== undefined ? ` on ${nameOf(d.targetId)}` : "";
          const rerolls = d.rerolls.map((r) => `${nameOf(r.holderId)} rerolled ${r.rolled}, kept ${r.kept}`).join("; ");
          const descId = `${uid}-die-${i}`;
          return (
            // The dice never move or go away: the roll order is their identity (the mutation's `die`), so the index is stable.
            <li key={i}>
              <span id={descId}>
                {nameOf(d.characterId)}: {MOVE_LABELS[d.move]}
                {on}, d{d.sides} <strong>{d.value}</strong> + tier {d.bonus}
                {rerolls !== "" ? ` (first ${d.rolled}; ${rerolls})` : ""}
              </span>
              {can ? (
                <Pill
                  aria-describedby={descId}
                  disabled={busy}
                  onClick={() => void reroll.fire({ restId: last._id, characterId: character._id, die: i })}
                >
                  Reroll (keep higher)
                </Pill>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <div>
          <Pill disabled={busy} aria-describedby={`${uid}-close`} onClick={() => void close.fire({ restId: last._id, characterId: character._id })}>
            Close Oasis
          </Pill>{" "}
          <Small id={`${uid}-close`}>Closing gives up {character.sheet.name}&apos;s unused reroll, if any.</Small>
        </div>
      ) : null}
      <p aria-live="polite" className="rp-error">
        {reroll.error ?? close.error ?? ""}
      </p>
    </section>
  );
}

function MoveForm({
  restId,
  kind,
  moves,
  efficient,
  slots,
  trance,
  extraMoves,
  oasis,
  character,
  allies,
  initial,
}: {
  restId: Id<"rests">;
  kind: RestKind;
  /** The moves this PC can pick: the rest's core moves with the frame and class moves (Make a Feast, Keep Watch, halt lycanthropy, Tribute, Martial Preparation). */
  moves: readonly RestMove[];
  /** Efficient (CB 53): the long rest moves this PC can take one of on a short rest. */
  efficient: readonly RestMove[];
  /** Most moves: 2, +1 with Celestial Trance (CB 56), +1 per extra move granted (Eloquent, CB 29). */
  slots: number;
  /** The PC holds Celestial Trance (CB 56): one optional slot, added with "Drop into a trance" (absent: any slot past the granted ones). */
  trance?: boolean;
  /** Extra moves granted for this rest (Eloquent, CB 29: "an additional downtime move during their next rest"; dcm-bxp.99.19.2). */
  extraMoves: number;
  /** Oasis (HF 27): after this short rest the PC can reroll one downtime die and keep the higher result (`OasisDice`). */
  oasis: boolean;
  character: CharacterView;
  allies: CharacterView[];
  initial: Pick[];
}) {
  const choose = useIntent(api.rests.choose);
  const [picks, setPicks] = useState<Pick[]>(() =>
    Array.from({ length: Math.min(slots, Math.max(MOVES_PER_REST + extraMoves, initial.length)) }, (_, i) => initial[i] ?? { move: moves[0] }),
  );
  // Efficient (CB 53): "you can choose a long rest move instead of a short rest move", one per short rest, once the
  // player uses it (a saved choice with a long rest move reopens with it on).
  const [efficientOn, setEfficientOn] = useState(() => initial.some((p) => efficient.includes(p.move)));
  const shown = efficientOn ? [...moves, ...efficient] : moves;
  // Work on a Project is a long rest move, or Efficient's on a short rest.
  const projects = useQuery(api.restsReads.projects, shown.includes("workOnProject") ? { characterId: character._id } : "skip");
  // The two moves, then the granted extra moves (shown from the start), then the trance's optional one.
  const base = MOVES_PER_REST + extraMoves;
  const hasTrance = trance ?? slots > base;
  const tranced = hasTrance && picks.length > base;
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
        void choose
          .fire({ restId, characterId: character._id, moves: picks, ...(efficientOn ? { efficient: true } : {}) })
          .then((r) => setSaved(r !== undefined));
      }}
    >
      {picks.map((pick, i) => (
        <div key={i} className="rp-slot">
          <div role="group" aria-labelledby={`${uid}-move-${i}`} className="rp-chips">
            <Label id={`${uid}-move-${i}`} className="rp-slot-lbl">
              {i < MOVES_PER_REST ? `Move ${i + 1}` : i < base ? "Extra move" : "Trance move"}
            </Label>
            {shown.map((m) => (
              <button
                key={m}
                type="button"
                className="rp-chip"
                aria-pressed={pick.move === m}
                disabled={efficient.includes(m) && picks.some((p, k) => k !== i && efficient.includes(p.move))}
                onClick={() => set(i, { move: m })}
              >
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
      {hasTrance ? (
        <div className="rp-actions">
          <Pill
            aria-pressed={tranced}
            onClick={() => {
              setSaved(false);
              setPicks((all) => (all.length > base ? all.slice(0, base) : [...all, { move: moves[0] }]));
            }}
          >
            {tranced ? "Leave the trance" : "Drop into a trance"}
          </Pill>
          <Small>Celestial Trance (CB 56): choose an additional downtime move.</Small>
        </div>
      ) : null}
      {extraMoves > 0 ? (
        <Small as="p">
          {extraMoves === 1 ? "An additional downtime move" : `${extraMoves} additional downtime moves`} granted for this rest (Eloquent,
          CB 29).
        </Small>
      ) : null}
      {efficient.length > 0 ? (
        <div className="rp-actions">
          <Pill
            aria-pressed={efficientOn}
            onClick={() => {
              setSaved(false);
              if (efficientOn) setPicks((all) => all.map((p) => (efficient.includes(p.move) ? { move: moves[0] } : p)));
              setEfficientOn(!efficientOn);
            }}
          >
            {efficientOn ? "Stop using Efficient" : "Use Efficient"}
          </Pill>
          <Small>Efficient (CB 53): you can choose a long rest move instead of a short rest move.</Small>
        </div>
      ) : null}
      {oasis ? (
        <Small as="p">
          Oasis (HF 27): once the GM ends this rest and the downtime dice are shown, you add one reroll to the party&apos;s pool: any Duneborne can spend it on any downtime die, yours or an ally&apos;s, and keep the higher result.
        </Small>
      ) : null}
      {picks.some((p) => p.move === "workOnProject" && p.countdownId === undefined) ? (
        <Small as="p">The GM asks for an action roll to gauge the project&apos;s progress: roll it in the dice box.</Small>
      ) : null}
      {picks.some((p) => p.move === "martialPreparation") ? (
        <Small as="p">
          Martial Preparation (CB 48): describe how you train with the party. You gain a d6 Slayer Die, up to your Proficiency, to spend on an
          attack or damage roll in the dice box. Unspent dice clear at the end of the session for a Hope each.
        </Small>
      ) : null}
      {picks.some((p) => p.move === "locateSoulEchoes") ? (
        <Small as="p">
          Locate Soul Echoes (HF 176): you commune with the Vessel. When the rest ends, the GM tells you the direction of the nearest sanctuary
          with a Soul Echo at its shrine.
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
              <Pill disabled={loadout.length >= loadoutMax(character.sheet)} onClick={() => run(id, "loadout")}>
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
