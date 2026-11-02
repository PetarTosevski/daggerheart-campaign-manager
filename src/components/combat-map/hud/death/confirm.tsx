"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { deathResultText } from "@/components/party/death/waiting";
import { AWAY_REASON_LABELS, DEATH_MOVE_LABELS } from "@/lib/domain/death/index";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../../convex/_generated/api";
import type { CharacterView } from "../../../../../convex/characters";
import { Popup, hudButtonClass } from "../ui";
import { SKULL_ICON } from "./own";

/**
 * The GM's confirm of one PC's death move (plan combat-hud H4.3; HD4, answer 15b), a HUD popup on the GM view until
 * H5.1's request queue takes it: "<name> chose <move>", the Blaze of Glory action and the less-lethal request when
 * there are any, Confirm the death move / Send it back. The same mutations and result line as the sheet's confirm card
 * (`DeathMoveWait`). After the confirm the outcome stays until Done; the player sees it too (`OwnDeath`).
 */
export function GmDeathConfirm({ character }: { character: CharacterView }) {
  const characterId = character._id;
  const name = character.sheet.name;
  const state = useQuery(api.deathMoves.state, { characterId });
  const confirm = useIntent(api.deathMoves.confirm);
  const decline = useIntent(api.deathMoves.decline);
  const [outcome, setOutcome] = useState<string | null>(null);
  if (state === undefined) return null;
  const request = state.request;

  if (request !== null) {
    const label = DEATH_MOVE_LABELS[request.move];
    const busy = confirm.pending || decline.pending;
    const error = confirm.error ?? decline.error;
    return (
      <Popup
        icon={SKULL_ICON}
        tone="gm"
        title="Death move to confirm"
        sub={`${name} chose ${label}`}
        testId="hud-death-confirm"
        className="hud-death-confirm"
        primary={{
          label: "Confirm the death move",
          disabled: busy,
          onClick: () =>
            void confirm.fire({ characterId }).then((r) => {
              if (r) setOutcome(deathResultText(request.move, r, character.sheet.level, request.awayReason !== undefined));
            }),
        }}
        secondary={
          <button type="button" className={hudButtonClass()} disabled={busy} onClick={() => void decline.fire({ characterId })}>
            Send it back
          </button>
        }
      >
        <p>
          {name} marked their last Hit Point and chose <strong>{label}</strong>
          {request.action ? `: ${request.action}` : ""}. The dice roll when you confirm.
        </p>
        {request.awayReason ? <p>Less lethal: the player asks to be {AWAY_REASON_LABELS[request.awayReason]} instead of dying.</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </Popup>
    );
  }

  if (outcome === null) return null;
  return (
    <Popup
      icon={SKULL_ICON}
      tone="gm"
      title={`${name}’s death move`}
      testId="hud-death-outcome"
      primary={{ label: "Done", onClick: () => setOutcome(null) }}
    >
      <p role="status">{outcome}</p>
    </Popup>
  );
}
