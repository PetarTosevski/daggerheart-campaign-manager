/**
 * Errors of password sign-up, sign-in and reset (open-signup plan, OS3). Each failure reaches the client as its own
 * code (bead dcm-bxp.128: separate and clear errors; this overrides the enumeration wording of CF20, which OS6 amends).
 */
export const authMessages = {
  EMAIL_TAKEN: "This email already has an account. Sign in instead.",
  PASSWORD_TOO_SHORT: "The password needs at least 8 characters.",
  CODE_INVALID: "That code is wrong or has expired. Request a new one.",
  /** A sign-in provider cannot be reached (Apple's signing keys could not be fetched): an outage, so try again. */
  SIGN_IN_UNAVAILABLE: "Sign in with Apple is unavailable right now. Try again in a moment.",
} as const satisfies Record<string, string>;
