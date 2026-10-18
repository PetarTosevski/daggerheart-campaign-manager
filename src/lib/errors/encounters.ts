/** Errors of adversaries, encounters and Fear spending (D8). Contract: see `actionLog.ts`; add this domain's codes here only. */
export const encounterMessages = {
  ENCOUNTER_RULE: "That encounter change isn't allowed.",
  ENCOUNTER_FULL: "This encounter already holds 60 adversaries. Remove one first.",
  ENCOUNTER_LIMIT: "This campaign already has 200 encounters. Delete one first.",
  ENCOUNTER_RUNNING: "Another encounter is already running. End it first.",
  ENCOUNTER_NOT_RUNNING: "Start the encounter first.",
  ADVERSARY_UNKNOWN: "That adversary isn't in this campaign's catalogue.",
  CUSTOM_ADVERSARY_LIMIT: "This campaign already has 100 custom adversaries. Delete one first.",
  FEAR_EMPTY: "There isn't enough Fear to spend.",
} as const satisfies Record<string, string>;
