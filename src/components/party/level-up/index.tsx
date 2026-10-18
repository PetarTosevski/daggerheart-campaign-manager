"use client";

import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { Modal } from "@/components/brand/modal";
import { MAX_LEVEL } from "@/lib/domain/characters";
import { useIntent } from "@/lib/use-intent";

import { api } from "../../../../convex/_generated/api";
import type { CampaignSlot, CharacterSlot } from "../slots";

import { CorrectLevel, TierGrid } from "./history";
import { fullSheet } from "./shared";
import { LevelUpStepper } from "./stepper";

// D5 level-up (T2). Contract: ../slots.ts.

const paperButton =
  "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 font-display text-[13px] font-bold tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-50";

/** The sheet header's level circle (66 px double ring). */
function LevelCircle({ level }: { level: number }) {
  return (
    <div className="cs-lvl" role="img" aria-label={`Level ${level}`}>
      <strong aria-hidden="true">{level}</strong>
      <span aria-hidden="true">LEVEL</span>
    </div>
  );
}

/** The sheet header's level circle with the level-up button and stepper beside it; plus undo, history and the GM correction. */
export const LevelUpButton: CharacterSlot = ({ character, canEdit, isGm, hopeAndFear }) => {
  const [open, setOpen] = useState<"stepper" | "history" | null>(null);
  const undo = useIntent(api.levelUp.undoLast);
  const sheet = fullSheet(character);
  if (!sheet) return <LevelCircle level={character.sheet.level} />;
  const name = sheet.name;
  const canLevel = canEdit && sheet.level < MAX_LEVEL && (sheet.levelUpPending || isGm);
  const latest = sheet.advancements.at(-1);
  const canUndo = canEdit && latest !== undefined && latest.level === sheet.level;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LevelCircle level={sheet.level} />
      {canLevel ? (
        <button type="button" className={`${paperButton} border-[#4f8a3a] bg-[#5b8c45] text-white`} onClick={() => setOpen("stepper")}>
          Level up to {sheet.level + 1}
        </button>
      ) : sheet.levelUpPending ? (
        <span className="rounded-full bg-[#5b8c45] px-3 py-1 text-[13px] font-semibold text-white">Level up pending</span>
      ) : null}
      {canUndo ? (
        <button type="button" className={`${paperButton} border-[#6b2b26] bg-[#fffaf0] text-[#6b2b26]`} disabled={undo.pending} onClick={() => void undo.fire({ characterId: character._id })}>
          Undo level {sheet.level}
        </button>
      ) : null}
      {canEdit ? (
        <button type="button" className={`${paperButton} border-[#8a6d4a] bg-[#fffaf0] text-[#3a2a14]`} onClick={() => setOpen("history")}>
          Advancements
        </button>
      ) : null}
      {undo.error ? (
        <span role="alert" className="text-[14px] text-[#8a1c1c]">
          {undo.error}
        </span>
      ) : null}

      <Modal open={open === "stepper"} onClose={() => setOpen(null)} title={`Level up to ${sheet.level + 1}`} className="max-w-[760px]">
        <LevelUpStepper characterId={character._id} sheet={sheet} hopeAndFear={hopeAndFear} onDone={() => setOpen(null)} />
      </Modal>
      <Modal open={open === "history"} onClose={() => setOpen(null)} title={`${name}'s advancements`} className="max-w-[900px]">
        <TierGrid sheet={sheet} />
        {isGm ? <CorrectLevel characterId={character._id} level={sheet.level} /> : null}
      </Modal>
    </div>
  );
};

/** The Level Up region on the sheet's Story & Advancement page (tier boxes and history). Mount point; S8 fills it. */
export const AdvancementTiers: CharacterSlot = () => null;

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
