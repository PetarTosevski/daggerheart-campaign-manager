"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";

import { useCampaign } from "@/app/(gm)/campaigns/[campaignId]/campaign-shell";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * The Dice pop-over's content (plan combat-hud H1.2): the app's own dice box (`DiceBox`, as the classic map's
 * `MapDice` mounts it) for one character. A player rolls for their PC on the map; the GM for the PC token selected
 * on the map (QUESTIONS 1 in docs/tasks/TASK-HUD-H1.2.md), else a hint.
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

export function HudDice({ campaignId, characterId, gm }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> | null; gm: boolean }) {
  if (characterId === null) {
    return <p className="hud-muted">{gm ? "Select a PC token on the map to roll for them." : "Your character isn’t on this map."}</p>;
  }
  return <CharacterDice campaignId={campaignId} characterId={characterId} />;
}

function CharacterDice({ campaignId, characterId }: { campaignId: Id<"campaigns">; characterId: Id<"characters"> }) {
  const campaign = useCampaign();
  const character = useQuery(api.characters.get, { characterId });
  if (character === undefined) return <DiceLoading />;
  if (character === null || !character.canEdit || character.corrupt) return <p className="hud-muted">This character’s dice box isn’t available.</p>;
  return (
    <div className="cma-dice hud-dice" data-testid="hud-dice-box">
      <DiceBox campaignId={campaignId} character={character} hopeAndFear={Boolean(campaign.options.hopeAndFear)} />
    </div>
  );
}
