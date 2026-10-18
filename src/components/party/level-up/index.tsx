import type { CampaignSlot, CharacterSlot } from "../slots";

// D5 level-up (T2 fills these). Contract: ../slots.ts.

/** The level-up button and stepper on the sheet header, next to the level. */
export const LevelUpButton: CharacterSlot = () => null;

/** "Level up pending" badge on the dashboard party card. */
export const LevelUpCardBadge: CharacterSlot = () => null;

/** "Level up pending" badge on the roster card. */
export const LevelUpRosterBadge: CharacterSlot = () => null;

/** The GM's "Party levels up" button on the roster. */
export const PartyLevelUpButton: CampaignSlot = () => null;
