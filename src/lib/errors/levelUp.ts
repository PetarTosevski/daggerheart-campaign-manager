/** Errors of level-up (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const levelUpMessages = {
  LEVEL_UP_RULE: "That level-up choice isn't allowed.",
} as const satisfies Record<string, string>;
