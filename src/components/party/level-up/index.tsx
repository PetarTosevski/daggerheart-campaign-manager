"use client";

import "./level-up.css";

import { useQuery } from "convex/react";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Badge } from "@/components/party/sheet-ui";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { CampaignSlot, CharacterSlot, SlotProps } from "../slots";

import { CorrectLevel, TierBoxes } from "./history";
import { canLevelUp, fullSheet } from "./shared";

// D5 level-up (T2); board look from the sheet redesign (S8). Contract: ../slots.ts.

/**
 * The header's lvl-wrap: the 66 px level circle (img "Level N"), a green ▲ badge that starts the guided level-up
 * (`onStart`, plan guided-level-up) when the viewer may level up, and the small − that undoes the latest level-up.
 * The ▲ hides while the level-up is under way (`leveling`). Viewers who cannot level see "Level up pending".
 * The − shows for the GM whenever there is a level-up to undo; for a player only while `levelUp.canUndo` allows it
 * (no session started or ended since, decision 33).
 */
export function LevelUpButton({ character, canEdit, isGm, onStart, leveling = false }: SlotProps & { onStart: () => void; leveling?: boolean }) {
  const undo = useIntent(api.levelUp.undoLast);
  const sheet = fullSheet(character);
  const level = sheet?.level ?? character.sheet.level;
  const canLevel = canLevelUp(sheet, canEdit, isGm);
  const latest = sheet?.advancements.at(-1);
  const undoable = canEdit && latest !== undefined && latest.level === level;
  const playerMayUndo = useQuery(api.levelUp.canUndo, undoable && !isGm ? { characterId: character._id } : "skip");
  const canUndo = undoable && (isGm || playerMayUndo === true);

  return (
    <div className="lvl-row">
      <div className="lvl-wrap">
        <div className="lvl-circle" role="img" aria-label={`Level ${level}`}>
          <span className="lv-n" aria-hidden="true">
            {level}
          </span>
          <span className="lv-l" aria-hidden="true">
            Level
          </span>
        </div>
        {canLevel && !leveling ? (
          <button type="button" className="lv-up" aria-label={`Level up to ${level + 1}`} title={`Level up to ${level + 1}`} onClick={onStart}>
            <span aria-hidden="true">▲</span>
          </button>
        ) : null}
        {canUndo ? (
          <button
            type="button"
            className="lvl-down"
            aria-label={`Undo level ${level}`}
            title={`Undo level ${level}`}
            disabled={undo.pending}
            onClick={() => void undo.fire({ characterId: character._id })}
          >
            <span aria-hidden="true">−</span>
          </button>
        ) : null}
      </div>
      {!canLevel && sheet?.levelUpPending ? <Badge tone="green">Level up pending</Badge> : null}
      {undo.error ? (
        <span role="alert" className="lvl-error">
          {undo.error}
        </span>
      ) : null}
    </div>
  );
}

/** The Level Up region on the sheet's Story & Advancement page: tier boxes with the history, and the GM correction under them. */
export const AdvancementTiers: CharacterSlot = ({ character, isGm, hopeAndFear }) => {
  const sheet = fullSheet(character);
  if (!sheet) return null;
  return (
    <div className="flex flex-col gap-3">
      <TierBoxes sheet={sheet} hopeAndFear={hopeAndFear} />
      {isGm ? <CorrectLevel characterId={character._id} level={sheet.level} /> : null}
    </div>
  );
};

function PendingBadge({ label }: { label: string }) {
  return (
    <span data-testid="level-up-pending" className="self-start rounded-full bg-[#2f5a2a] px-2.5 py-0.5 text-[12px] font-semibold text-[#e9f2e4]">
      {label}
    </span>
  );
}

/** "Level up pending" badge on the dashboard party card. */
export const LevelUpCardBadge: CharacterSlot = ({ character }) =>
  character.sheet.levelUpPending && !character.corrupt ? <PendingBadge label={`Level up pending (to ${character.sheet.level + 1})`} /> : null;

/** "Level up pending" badge on the roster card. */
export const LevelUpRosterBadge: CharacterSlot = ({ character }) =>
  character.sheet.levelUpPending && !character.corrupt ? <PendingBadge label="Level up pending" /> : null;

/** The GM's "Party levels up" button on the roster (CB 109: all party members level up together). */
export const PartyLevelUpButton: CampaignSlot = ({ campaignId, isGm }) => {
  const { fire, error, pending } = useIntent(api.levelUp.partyLevelUp);
  const [notice, setNotice] = useState<string | null>(null);
  if (!isGm) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <BrandButton
        size="xl"
        disabled={pending}
        onClick={async () => {
          const result = await fire({ campaignId });
          if (result) setNotice(result.flagged === 1 ? "1 character can level up." : `${result.flagged} characters can level up.`);
        }}
      >
        Party levels up
      </BrandButton>
      <span role="status" className="text-[14px] text-[#c9d2cf] empty:hidden">
        {error ?? notice}
      </span>
    </div>
  );
};
