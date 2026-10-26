/** Errors of Wither tokens (D5, Witherwild). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const witherMessages = {
  WITHER_RULE: "That Wither change isn't allowed.",
} as const satisfies Record<string, string>;
