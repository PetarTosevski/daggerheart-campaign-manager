import { ConvexError } from "convex/values";

import { authMessages } from "../../../../../src/lib/errors/auth";

const RATE_LIMIT_TEXT = "Too many tries for this email. Wait a few minutes, then try again.";

/** The text for a failed auth call. `fallback` covers opaque errors, such as a wrong password. */
export function authErrorText(error: unknown, fallback: string): string {
  const data: unknown = error instanceof ConvexError ? error.data : null;
  let code: unknown = typeof data === "object" && data !== null ? (data as { code?: unknown }).code : undefined;
  if (code === undefined && error instanceof Error) code = /"code":"([A-Z_]+)"/.exec(error.message)?.[1];
  if (code === "RATE_LIMITED") return RATE_LIMIT_TEXT;
  if (code === "EMAIL_TAKEN" || code === "PASSWORD_TOO_SHORT" || code === "CODE_INVALID") return authMessages[code];
  return fallback;
}
