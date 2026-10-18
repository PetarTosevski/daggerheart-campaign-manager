/** Errors of party rests and downtime moves (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const restMessages = {
  REST_RULE: "That rest action isn't allowed.",
} as const satisfies Record<string, string>;
