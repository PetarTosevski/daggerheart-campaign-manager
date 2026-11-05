/**
 * The flood cap of native Sign in with Apple (dcm-gdzi.6). The caller is anonymous and the token's subject is not
 * trusted until it is verified, so there is no per-person key: one global bucket over every `apple-native` attempt that
 * gets past the token's shape check, like `authSignUpGlobal` for password sign-ups (`authRateLimit.ts`). Past it the
 * call fails with `RATE_LIMITED`. Skipped on the local e2e backend, as the other auth limits are.
 */
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";

import { appError } from "../../src/lib/errors/app-error";
import { components } from "../_generated/api";
import { env } from "../_generated/server";
import { fakeCodeMode } from "./authEmail";

export const APPLE_SIGN_IN_LIMITS = {
  authAppleNativeGlobal: { kind: "token bucket", rate: 600, period: HOUR, capacity: 60 },
} as const;

const appleLimiter = new RateLimiter(components.rateLimiter, APPLE_SIGN_IN_LIMITS);

type LimitCtx = Parameters<RateLimiter<typeof APPLE_SIGN_IN_LIMITS>["limit"]>[0];

/** Spends one token of the apple-native bucket; throws `RATE_LIMITED` when none is left. */
export async function enforceAppleSignInLimit(ctx: LimitCtx): Promise<void> {
  if (fakeCodeMode(env)) return;
  const result = await appleLimiter.limit(ctx, "authAppleNativeGlobal");
  if (!result.ok) throw appError("RATE_LIMITED");
}
