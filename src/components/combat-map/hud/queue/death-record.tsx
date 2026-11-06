"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { deathResultText } from "@/components/party/death/waiting";
import { DEATH_MOVE_LABELS, type DeathMove } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { CharacterView } from "../../../../../convex/characters";
import { SKULL_ICON } from "../death/own";
import { Popup, hudButtonClass } from "../ui";

const MOVES: readonly DeathMove[] = ["blazeOfGlory", "avoidDeath", "riskItAll"];

/**
 * X1 Manual (plan rule-switches DEF, bead dcm-jh6d.69; user 2026-11-06: "the GM may still record a death move in the
 * app"; CB p.106): nobody is asked for the death move, so while one is due (`deathMoves.state.gmRecord`) the GM's queue
 * shows "<name> marked their last HP" with the three moves; the one made at the table is recorded with
 * `deathMoves.choose` (X2 is Manual then: Avoid Death and Risk It All roll nothing, the GM's note says what to roll).
 * The outcome stays until Done, as the confirm's (`GmDeathConfirm`).
 */
export function GmDeathRecord({ character }: { character: CharacterView }) {
  const characterId = character._id;
  const name = character.sheet.name;
  const state = useQuery(api.deathMoves.state, { characterId });
  const choose = useIntent(api.deathMoves.choose);
  const [move, setMove] = useState<DeathMove | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  if (state === undefined) return null;

  if (state.gmRecord === true) {
    return (
      <Popup
        icon={SKULL_ICON}
        tone="gm"
        title="Death move at the table"
        sub={`${name} marked their last Hit Point`}
        testId="hud-death-record"
        primary={{
          label: "Record the death move",
          role: "allow",
          disabled: move === null || choose.pending,
          onClick: () => {
            if (move === null) return;
            void choose.fire({ characterId, move }).then((r) => {
              if (r) setOutcome(deathResultText(move, r, character.sheet.level, false));
            });
          },
        }}
      >
        <p>This campaign makes death moves at the table (House rules). Record the move {name} made:</p>
        <div role="group" aria-label={`${name}'s death move`}>
          {MOVES.map((m) => (
            <button key={m} type="button" className={hudButtonClass("secondary")} aria-pressed={move === m} onClick={() => setMove(m)}>
              {DEATH_MOVE_LABELS[m]}
            </button>
          ))}
        </div>
        {choose.error ? <p role="alert">{choose.error}</p> : null}
      </Popup>
    );
  }

  if (outcome === null) return null;
  return (
    <Popup icon={SKULL_ICON} tone="gm" title={`${name}’s death move`} testId="hud-death-record-outcome" primary={{ label: "Done", onClick: () => setOutcome(null) }}>
      <p role="status">{outcome}</p>
    </Popup>
  );
}
