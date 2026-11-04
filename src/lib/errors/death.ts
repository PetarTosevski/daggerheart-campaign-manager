/** Errors of death moves (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const deathMessages = {
  DEATH_MOVE_RULE: "That death move isn't allowed.",
  /** HD4: `deathMoves.confirm` / `decline` with no player's death move waiting for the GM. */
  DEATH_MOVE_NOT_WAITING: "No death move is waiting for the GM.",
} as const satisfies Record<string, string>;
