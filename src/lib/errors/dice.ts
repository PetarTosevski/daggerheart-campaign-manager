/** Errors of dice rolls and the roll feed (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const diceMessages = {
  DICE_RULE: "That roll isn't allowed.",
} as const satisfies Record<string, string>;
