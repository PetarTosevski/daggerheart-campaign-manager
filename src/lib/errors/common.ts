/** Errors from sign-in, access checks, validation and rate limits, shared by every domain. */
export const commonMessages = {
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  FORBIDDEN: "This account can't use the campaign ledger.",
  NOT_FOUND: "That no longer exists.",
  MECHANIC_DISABLED: "That rule isn't part of this campaign's frame.",
  INVALID: "That request isn't valid.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
} as const satisfies Record<string, string>;
