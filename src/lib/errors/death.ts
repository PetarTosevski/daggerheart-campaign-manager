/** Errors of death moves (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const deathMessages = {
  DEATH_MOVE_RULE: "That death move isn't allowed.",
} as const satisfies Record<string, string>;
