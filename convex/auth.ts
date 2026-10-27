import Google from "@auth/core/providers/google";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import {
  convexAuth,
  createAccount,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { env, type ActionCtx, type MutationCtx } from "./_generated/server";
import { buildE2EProfile, normalizeEmail } from "./lib/allowlist";
import { resendCodeProvider } from "./lib/authEmail";
import { enforceAuthLimit } from "./lib/authRateLimit";
import { createOrUpdateUser, PASSWORD_PROVIDER_ID, type SignInArgs } from "./lib/users";

const E2E_PROVIDER_ID = "e2e";

// Test-only sign-in. Always registered, so no env var is read at module scope;
// `buildE2EProfile` refuses every call unless this is a local backend with e2e
// auth enabled and the secret matches.
const e2eProvider = ConvexCredentials({
  id: E2E_PROVIDER_ID,
  authorize: async (credentials, ctx) => {
    const profile = buildE2EProfile(credentials, env);
    if (profile === null) return null;
    const existing = await retrieveAccount(ctx, {
      provider: E2E_PROVIDER_ID,
      account: { id: profile.email },
    }).catch(() => null);
    if (existing !== null) return { userId: existing.user._id };
    const { user } = await createAccount(ctx, {
      provider: E2E_PROVIDER_ID,
      account: { id: profile.email },
      profile,
    });
    return { userId: user._id };
  },
});

/** Passwords need 8 characters; the error is a `ConvexError` so the client gets its own code. */
function validatePasswordRequirements(password: unknown): void {
  if (typeof password !== "string" || password.length < 8) throw appError("PASSWORD_TOO_SHORT");
  if (password.length > 1024) throw appError("INVALID");
}

/** An email provider whose every send first spends one of the 5 hourly codes of that address. */
function limitedCodeProvider(id: string) {
  const base = resendCodeProvider(id);
  const send = base.sendVerificationRequest as unknown as (p: unknown, c: unknown) => Promise<void>;
  const sendLimited = async (params: { identifier: string }, ctx: unknown) => {
    await enforceAuthLimit(ctx as ActionCtx, "authCodeSend", params.identifier);
    await send(params, ctx);
  };
  const options = (base as unknown as { options: Record<string, unknown> }).options;
  return {
    ...base,
    sendVerificationRequest: sendLimited,
    options: { ...options, sendVerificationRequest: sendLimited },
  } as unknown as typeof base;
}

type Authorize = (params: Record<string, unknown>, ctx: ActionCtx) => Promise<unknown>;

/**
 * Convex Auth throws plain `Error`s from the password flows, and a plain `Error` reaches the browser in production
 * as "Server Error" with no message. This wraps the provider's `authorize` so each expected failure is a
 * `ConvexError<AppError>` with its own code (TASK-OS-OS3 has the spike):
 * - wrong, expired or unknown-account code -> `CODE_INVALID` (same answer for all three, no account probing);
 * - an existing email on sign-up -> `EMAIL_TAKEN`, except an abandoned UNVERIFIED account, which is replaced: its
 *   password becomes the new one and a fresh code is sent;
 * - a reset for an unknown email answers like a known one (no error, no email), so reset reveals nothing;
 * - too many wrong passwords -> `RATE_LIMITED`.
 * It also lower-cases `params.email`, because Convex Auth compares the raw value with the stored account id.
 */
function withAuthErrors(base: ReturnType<typeof Password>) {
  const options = (base as unknown as { options: { authorize: Authorize } }).options;
  const inner = options.authorize;
  const authorize: Authorize = async (raw, ctx) => {
    const flow = raw.flow;
    const email = typeof raw.email === "string" ? normalizeEmail(raw.email) : undefined;
    const params = email === undefined ? raw : { ...raw, email };
    try {
      if (flow === "signUp" && email !== undefined) {
        validatePasswordRequirements(params.password);
        await enforceAuthLimit(ctx, "authSignUp", email);
        await enforceAuthLimit(ctx, "authSignUpGlobal");
        const found = await retrieveAccount(ctx, { provider: PASSWORD_PROVIDER_ID, account: { id: email } }).catch(
          (error: unknown) => {
            if (error instanceof Error && error.message === "InvalidAccountId") return null;
            throw error;
          },
        );
        if (found !== null) {
          if (found.account.emailVerified !== undefined || found.user.emailVerificationTime !== undefined) {
            throw appError("EMAIL_TAKEN");
          }
          await modifyAccountCredentials(ctx, {
            provider: PASSWORD_PROVIDER_ID,
            account: { id: email, secret: params.password as string },
          });
        }
      }
      return await inner(params, ctx);
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      const message = error instanceof Error ? error.message : "";
      const isCodeFlow = flow === "email-verification" || flow === "reset-verification";
      if (message === "Could not verify code" || message === "Invalid code") throw appError("CODE_INVALID");
      if (message === "InvalidAccountId" && isCodeFlow) throw appError("CODE_INVALID");
      if (message === "InvalidAccountId" && flow === "reset") return null;
      if (message === "TooManyFailedAttempts") throw appError("RATE_LIMITED");
      throw error;
    }
  };
  return { ...base, options: { ...options, authorize } } as unknown as typeof base;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      // The default Google profile drops `email_verified`; keep it so the
      // `createOrUpdateUser` can require a verified email.
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
          emailVerified: profile.email_verified === true,
        };
      },
    }),
    // Email + password. Sign-up is open; a new account works only after the emailed 6-digit code is entered
    // (`verify`), and a forgotten password is reset by another emailed code (`reset`).
    withAuthErrors(
      Password({
        id: PASSWORD_PROVIDER_ID,
        verify: limitedCodeProvider("resend-otp"),
        reset: limitedCodeProvider("resend-reset"),
        validatePasswordRequirements,
        profile(params) {
          const email = typeof params.email === "string" ? normalizeEmail(params.email) : "";
          const name = typeof params.name === "string" ? params.name.trim().slice(0, 80) : "";
          return { email, ...(name ? { name } : {}) };
        },
      }),
    ),
    e2eProvider,
  ],
  jwt: {
    // dcm-bxp.125: a random id per access token. Convex Auth signs only
    // { sub, iss, aud, iat, exp } with `iat` in whole seconds, so two tokens
    // minted for one session in the same second were byte-identical and the
    // Convex client refused the refresh as "not new" (dcm-bxp.123). Convex
    // Auth reserves the `jti` name in customClaims (it throws on it), so the
    // id goes in `token_id`. Verification is unchanged: the server still
    // checks the signature, issuer, audience and expiry of every token.
    customClaims: async () => ({ token_id: crypto.randomUUID() }),
  },
  callbacks: {
    // The callback's ctx is typed for any data model; this app's schema is
    // the one in convex/schema.ts.
    createOrUpdateUser: (ctx, args) =>
      createOrUpdateUser(ctx as unknown as MutationCtx, args as unknown as SignInArgs),
  },
});
