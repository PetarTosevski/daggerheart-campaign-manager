/**
 * Rate limits for password sign-up and emailed codes (open-signup plan, OS3). Callers are anonymous, so every limit
 * is keyed by the normalised email (or is one global bucket), never by a user. `convex/lib/functions.ts` keeps its
 * own per-user limiter and is not touched.
 *
 * - `authCodeSend`: 5 emailed codes per hour per email (bead answer 2026-10-26), sign-up, sign-in resend and reset.
 * - `authSignUp`: 10 sign-up attempts per hour per email.
 * - `authSignUpGlobal`: one flood cap over all sign-ups, so scripted sign-ups cannot burn the email quota.
 *
 * Skipped on the local e2e backend (every spec signs up from one address, as `functions.ts` does for users);
 * covered by convex-test. Past a limit the call fails with `RATE_LIMITED`.
 */
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";

import { appError } from "../../src/lib/errors/app-error";
import { components } from "../_generated/api";
import { env } from "../_generated/server";
import { normalizeEmail } from "./allowlist";
import { fakeCodeMode } from "./authEmail";

export const AUTH_RATE_LIMITS = {
  authCodeSend: { kind: "fixed window", rate: 5, period: HOUR },
  authSignUp: { kind: "fixed window", rate: 10, period: HOUR },
  authSignUpGlobal: { kind: "token bucket", rate: 300, period: HOUR, capacity: 60 },
} as const;

export type AuthRateLimitName = keyof typeof AUTH_RATE_LIMITS;

const authLimiter = new RateLimiter(components.rateLimiter, AUTH_RATE_LIMITS);

type LimitCtx = Parameters<RateLimiter<typeof AUTH_RATE_LIMITS>["limit"]>[0];

/** Consumes one token of `name` for `email` (the global limit takes no email); throws `RATE_LIMITED` when none is left. */
export async function enforceAuthLimit(ctx: LimitCtx, name: AuthRateLimitName, email?: string): Promise<void> {
  if (fakeCodeMode(env)) return;
  const result =
    name === "authSignUpGlobal"
      ? await authLimiter.limit(ctx, name)
      : await authLimiter.limit(ctx, name, { key: normalizeEmail(email ?? "") });
  if (!result.ok) throw appError("RATE_LIMITED");
}
