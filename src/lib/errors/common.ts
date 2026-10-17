/** Errors from sign-in and campaign access checks, shared by every domain. */
export const commonMessages: Record<string, string> = {
  UNAUTHENTICATED: "Your session has ended. Sign in again.",
  FORBIDDEN: "This account can't use the campaign ledger.",
  NOT_FOUND: "That campaign no longer exists.",
  MECHANIC_DISABLED: "That rule isn't part of this campaign's frame.",
};
