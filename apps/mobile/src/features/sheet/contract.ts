import type { SheetCharacter } from "./types";

/**
 * Props for a sheet slot. Dice, level-up, death, incoming hit, rest, and
 * features each own one folder and replace the stub that receives these props.
 * Mount each slot once. A slot reads anything else with its own query.
 */
export type SheetSlotProps = {
  campaignId: string;
  isGm: boolean;
  hopeAndFear: boolean;
  character: SheetCharacter;
  canEdit: boolean;
};

export const SHEET_SLOT_IDS = ["dice", "level-up", "death", "incoming", "rest", "features"] as const;

export type SheetSlotId = (typeof SHEET_SLOT_IDS)[number];
