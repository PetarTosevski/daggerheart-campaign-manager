/**
 * Errors of adversary actions against PCs and of combat requests (plan combat-actions Part B: GM sanctions, reaction
 * windows, adversary attacks and features). Contract: see `actionLog.ts`; add this domain's codes here only (tracer
 * AA0). A Part B tracer that needs a code missing here stops and asks the orchestrator. Messages never name an
 * adversary's attack roll or stats (Q14, U1).
 */
export const adversaryActionMessages = {
  /** An adversary action without the spotlight (CB p.194: "For an adversary to use an action, they must have the spotlight"). */
  ADVERSARY_NOT_SPOTLIT: "Spotlight that adversary first.",
  /** A feature this adversary doesn't have, or one used up for the scene, or whose condition doesn't hold. */
  ADVERSARY_FEATURE_UNAVAILABLE: "That feature can't be used right now.",
  /** A Fear cost (a Fear feature, an extra spotlight, an Experience) above the GM's Fear (CB p.154). */
  NOT_ENOUGH_FEAR: "You don't have enough Fear for that.",
  /** Answering, approving or resolving a combat request that is already resolved or declined. */
  REQUEST_NOT_OPEN: "That request has already been answered.",
  /** A character that isn't listed as a responder of the reaction window, or has already answered. */
  NOT_A_RESPONDER: "That character can't answer this hit.",
} as const satisfies Record<string, string>;

export type AdversaryActionErrorCode = keyof typeof adversaryActionMessages;
