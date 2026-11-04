"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { useCampaign } from "@/app/(gm)/campaigns/[campaignId]/campaign-shell";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The Dice pop-over's content (plan combat-hud H1.2): the app's own dice box (`DiceBox`, as the classic map's
 * `MapDice` mounts it) for one character. A player rolls for their PC on the map. The GM gets both (user answer
 * 2026-11-02, TASK-HUD-H1.2 QUESTIONS 1): a plain GM roller (the dashboard's secret GM roll, any mix of dice, the GM's
 * own rolls) and, while a PC token is selected on the map, "For <PC>" with that PC's dice box. A player also gets
 * "Free dice" (user 2026-11-04), a public roll of mixed dice.
 */

function DiceLoading() {
  return (
    <p role="status" className="hud-muted">
      Loading the dice box…
    </p>
  );
}

// CL8: the dice box carries the class-feature registry and the sheet schema; load it only when the pop-over opens.
const DiceBox = dynamic(() => import("@/components/party/dice/dice-box").then((m) => m.DiceBox), { loading: DiceLoading });
// The GM's roller brings the 3D dice; the same.
const GmRollForm = dynamic(() => import("@/components/party/dice/roll-feed").then((m) => m.GmRollForm), { loading: DiceLoading });
// A player's free roll of mixed dice (user 2026-11-04), public; the same 3D dice.
const FreeRollForm = dynamic(() => import("@/components/party/dice/free-roll").then((m) => m.FreeRollForm), { loading: DiceLoading });

export function HudDice({ campaignId, characterId, gm }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> | null; gm: boolean }) {
  if (gm) return <GmDice campaignId={campaignId} characterId={characterId} />;
  return <PlayerDice campaignId={campaignId} characterId={characterId} />;
}

/**
 * A player's Dice: their character's dice box (the default) and "Free dice", a public roll of any mix of dice
 * (user 2026-11-04: "3d6 + 1d8"). Without a character on the map, only the free roller.
 */
function PlayerDice({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> | null }) {
  const [free, setFree] = useState(false);
  const pc = useQuery(api.charactersReads.get, characterId ? { characterId } : "skip");
  const freeRoller = (
    <div className="hud-gm-roller" data-testid="hud-free-roller">
      <FreeRollForm campaignId={campaignId} mode="public" showResult />
    </div>
  );
  if (characterId === null) {
    return (
      <div className="hud-gm-dice">
        <p className="hud-muted">Your character isn’t on this map.</p>
        {freeRoller}
      </div>
    );
  }
  return (
    <div className="hud-gm-dice">
      <div role="group" aria-label="Roll as" className="hud-seg hud-gm-dice-as">
        <button type="button" aria-pressed={!free} onClick={() => setFree(false)}>
          {pc?.sheet.name ?? "Your character"}
        </button>
        <button type="button" aria-pressed={free} onClick={() => setFree(true)}>
          Free dice
        </button>
      </div>
      {free ? freeRoller : <CharacterDice campaignId={campaignId} characterId={characterId} />}
    </div>
  );
}

/** The GM's Dice: "GM roll" (the default) and, with a PC token selected, "For <PC>". */
function GmDice({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> | null }) {
  // The PC the GM chose to roll for; another selection (or none) falls back to the GM's own roller.
  const [forPc, setForPc] = useState<Id<"characters"> | null>(null);
  const pc = useQuery(api.charactersReads.get, characterId ? { characterId } : "skip");
  const rollingFor = characterId !== null && forPc === characterId ? characterId : null;
  const pcName = pc?.sheet.name ?? "the selected PC";
  return (
    <div className="hud-gm-dice">
      {characterId !== null ? (
        <div role="group" aria-label="Roll as" className="hud-seg hud-gm-dice-as">
          <button type="button" aria-pressed={rollingFor === null} onClick={() => setForPc(null)}>
            GM roll
          </button>
          <button type="button" aria-pressed={rollingFor !== null} onClick={() => setForPc(characterId)}>
            For {pcName}
          </button>
        </div>
      ) : (
        <p className="hud-muted">Select a PC token on the map to roll for them instead.</p>
      )}
      {rollingFor !== null ? (
        <CharacterDice campaignId={campaignId} characterId={rollingFor} />
      ) : (
        <div className="hud-gm-roller" data-testid="hud-gm-roller">
          <GmRollForm campaignId={campaignId} showResult />
        </div>
      )}
    </div>
  );
}

function CharacterDice({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> }) {
  const campaign = useCampaign();
  const character = useQuery(api.charactersReads.get, { characterId });
  if (character === undefined) return <DiceLoading />;
  if (character === null || !character.canEdit || character.corrupt) return <p className="hud-muted">This character’s dice box isn’t available.</p>;
  return (
    <div className="cma-dice hud-dice" data-testid="hud-dice-box">
      <DiceBox campaignId={campaignId} character={character} hopeAndFear={Boolean(campaign.options.hopeAndFear)} />
    </div>
  );
}
