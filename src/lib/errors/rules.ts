/**
 * Errors of the rule switches (plan rule-switches; House rules in Campaign settings). Contract: see `actionLog.ts`;
 * add this domain's codes here only. Tests and the UI key on the code, never the text.
 */
export const ruleMessages = {
  /**
   * A rule switch or campaign option changed while a session is live (user 2026-11-05: switches change between
   * sessions only; Q17 a: today's campaign options too).
   */
  RULES_LOCKED: "Rule switches change between sessions. End the session first.",
} as const satisfies Record<string, string>;

export type RuleErrorCode = keyof typeof ruleMessages;
