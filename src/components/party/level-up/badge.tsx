import type { CardSlot } from "../slots";

// The "Level up pending" badges, split from ./index.tsx so the dashboard party card does not pull the level-up
// history, its tier pickers and the SRD lists they name (CL8/CL9). Contract: ../slots.ts.

function PendingBadge({ label }: { label: string }) {
  return (
    <span data-testid="level-up-pending" className="self-start rounded-full bg-[#2f5a2a] px-2.5 py-0.5 text-[12px] font-semibold text-[#e9f2e4]">
      {label}
    </span>
  );
}

/** "Level up pending" badge on the dashboard party card. */
export const LevelUpCardBadge: CardSlot = ({ character }) =>
  character.sheet.levelUpPending && !character.corrupt ? <PendingBadge label={`Level up pending (to ${character.sheet.level + 1})`} /> : null;

/** "Level up pending" badge on the roster card. */
export const LevelUpRosterBadge: CardSlot = ({ character }) =>
  character.sheet.levelUpPending && !character.corrupt ? <PendingBadge label="Level up pending" /> : null;
