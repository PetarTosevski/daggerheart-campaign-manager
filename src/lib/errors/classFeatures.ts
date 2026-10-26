/** Errors of Hope and class features (D5). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const classFeatureMessages = {
  CLASS_FEATURE_RULE: "That feature can't be used now.",
  NOT_ENOUGH_HOPE: "Not enough Hope.",
} as const satisfies Record<string, string>;
