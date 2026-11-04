/**
 * Errors of the spotlight (plan combat-hud H1.S, user answer 1c; CB p.100). Contract: see `actionLog.ts`; add this
 * domain's codes here only. The HUD's blocked states (H6.1 / H6.2) key on the code, never the text.
 */
export const spotlightMessages = {
  /**
   * A player's action or token move while the GM holds the spotlight: only reactions are allowed until the GM hands it
   * back (answer 1c; user answer 2026-11-01, spotlight and movement).
   */
  SPOTLIGHT_WITH_GM: "The GM has the spotlight. Only reactions until it comes back to you.",
} as const satisfies Record<string, string>;

export type SpotlightErrorCode = keyof typeof spotlightMessages;
