import { ConvexError } from "convex/values";

import { adminMessages } from "../../../../../src/lib/errors/admin";
import { authMessages } from "../../../../../src/lib/errors/auth";

const RATE_LIMIT_TEXT = "Too many tries for this email. Wait a few minutes, then try again.";

/**
 * The text for a failed auth call, worded as the website's `authErrorText` (`src/app/signin/password-form.tsx`).
 * `fallback` covers opaque errors, such as a wrong password.
 */
export function authErrorText(error: unknown, fallback: string): string {
  const data: unknown = error instanceof ConvexError ? error.data : null;
  let code: unknown = typeof data === "object" && data !== null ? (data as { code?: unknown }).code : undefined;
  if (code === undefined && error instanceof Error) code = /"code":"([A-Z_]+)"/.exec(error.message)?.[1];
  if (code === "RATE_LIMITED") return RATE_LIMIT_TEXT;
  if (code === "EMAIL_TAKEN" || code === "PASSWORD_TOO_SHORT" || code === "CODE_INVALID" || code === "SIGN_IN_UNAVAILABLE") {
    return authMessages[code];
  }
  if (code === "SIGN_UP_CLOSED" || code === "SIGN_UP_INVITE_ONLY" || code === "ACCOUNT_SUSPENDED") {
    return adminMessages[code];
  }
  return fallback;
}

/**
 * The join code of the `/join/<code>` link that sent a signed-out visitor to sign-in (`?next=/join/<code>`), or null.
 * Sign-up passes it so invite-only mode (config AD4) lets the account be created; the server checks it. The same parse
 * as the website's `joinCodeFromNext`.
 */
export function joinCodeFromNext(next: string | null | undefined): string | null {
  const match = /^\/join\/([^/?#]{1,64})\/?$/.exec(next ?? "");
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
