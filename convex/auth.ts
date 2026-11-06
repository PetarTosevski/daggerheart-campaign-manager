import Google from "@auth/core/providers/google";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import {
  convexAuth,
  createAccount,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import { resumeSelfDeletedAccount } from "./accountSelfDelete";
import { buildE2EProfile, normalizeEmail } from "./lib/allowlist";
import { AppleKeyCache, appleTokenKeyId, verifyAppleIdentityToken } from "./lib/appleIdentity";
import { enforceAppleSignInLimit } from "./lib/appleSignInLimit";
import { resendCodeProvider } from "./lib/authEmail";
import { enforceAuthLimit } from "./lib/authRateLimit";
import { nativeRedirectTarget } from "./lib/nativeRedirect";
import {
  createOrUpdateUser,
  PASSWORD_PROVIDER_ID,
  signUpJoinCode,
  signUpRefusal,
  type SignInArgs,
} from "./lib/users";

/**
 * The sign-up mode's answer for a password sign-up (config AD4), asked by `withAuthErrors` before the email is looked
 * up: null when a new account would be allowed, else the refusal code. It depends only on the mode, the email's
 * invites and the join code, never on whether the email has an account.
 */
export const signUpGate = internalQuery({
  args: { email: v.string(), joinCode: v.union(v.string(), v.null()) },
  returns: v.union(v.literal("SIGN_UP_CLOSED"), v.literal("SIGN_UP_INVITE_ONLY"), v.null()),
  handler: (ctx, { email, joinCode }) => signUpRefusal(ctx, email, joinCode),
});

/**
 * Refuses a sign-in result whose account is suspended or waiting for the owner's deletion (config AD14), so the person
 * is turned away at the sign-in screen. Asked after a password, e2e (or phone Apple) sign-in of an existing account,
 * which Convex Auth finishes without calling `createOrUpdateUser`. A deletion the account asked for itself is cancelled
 * instead and the sign-in goes on (DEL1, `accountSelfDelete.signInAllowed`).
 */
async function refuseSuspendedSignIn<T>(ctx: ActionCtx, result: T): Promise<T> {
  const userId = (result as { userId?: unknown } | null)?.userId;
  if (typeof userId === "string" && !(await ctx.runMutation(internal.accountSelfDelete.signInAllowed, { userId }))) {
    throw appError("ACCOUNT_SUSPENDED");
  }
  return result;
}

const E2E_PROVIDER_ID = "e2e";
const APPLE_PROVIDER_ID = "apple-native";

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
    if (existing !== null) return refuseSuspendedSignIn(ctx as unknown as ActionCtx, { userId: existing.user._id });
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
 * - an existing password account on sign-up -> `EMAIL_TAKEN`, except one still UNVERIFIED (abandoned, or a link to a
 *   Google user waiting for its code), which is replaced: its password becomes the new one and a fresh code is sent;
 *   an email held only by a verified (Google) user is not an error: the sign-up creates a pending password account
 *   on that user (`createOrUpdateUser`) and the code links it;
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
        // Sign-up mode (AD4), after the rate limits (so join-code guesses spend tokens) and before the email is looked
        // up: a refused sign-up gets the same answer whether or not the email has an account. This also refuses a
        // Google user adding a password while sign-ups are refused (they keep signing in with Google).
        const refusal = await ctx.runQuery(internal.auth.signUpGate, {
          email,
          joinCode: signUpJoinCode(params.joinCode),
        });
        if (refusal !== null) throw appError(refusal);
        const found = await retrieveAccount(ctx, { provider: PASSWORD_PROVIDER_ID, account: { id: email } }).catch(
          (error: unknown) => {
            if (error instanceof Error && error.message === "InvalidAccountId") return null;
            throw error;
          },
        );
        if (found !== null) {
          // A password account whose code was never entered is pending, whoever holds the user (an abandoned
          // sign-up, or a Google user's link waiting for its code). A verified one belongs to its owner.
          if (found.account.emailVerified !== undefined) throw appError("EMAIL_TAKEN");
          await modifyAccountCredentials(ctx, {
            provider: PASSWORD_PROVIDER_ID,
            account: { id: email, secret: params.password as string },
          });
        }
      }
      return await refuseSuspendedSignIn(ctx, await inner(params, ctx));
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

/**
 * Native Sign in with Apple. The app sends the identity token from
 * `AppleAuthentication.signInAsync`; this does not use Apple's OAuth redirect
 * and does not read an Apple client secret. A verified email joins an existing
 * verified user. A Hide My Email address is a different email, so it creates
 * its own user. A later sign-in can omit the email when this Apple user id
 * already has an account.
 */
/** Apple's signing keys, kept for the life of the isolate so repeat sign-ins do not refetch them (dcm-gdzi.6). */
const appleKeys = new AppleKeyCache();

const appleNativeProvider = ConvexCredentials({
  id: APPLE_PROVIDER_ID,
  authorize: async (credentials, ctx) => {
    const identityToken = credentials.identityToken;
    const nonce = credentials.nonce;
    if (typeof identityToken !== "string" || typeof nonce !== "string") throw appError("INVALID");
    if (identityToken.length === 0 || identityToken.length > 8192 || nonce.length === 0 || nonce.length > 256) {
      throw appError("INVALID");
    }
    const name = typeof credentials.name === "string" ? credentials.name.trim().slice(0, 80) : "";
    // The one-time code Apple hands the app with the identity token (optional: older app builds omit it). Traded for a
    // refresh token after sign-in so a later Delete account can revoke it (DEL1, `rememberAppleSignIn`).
    const authorizationCode = credentials.authorizationCode;
    if (authorizationCode !== undefined && (typeof authorizationCode !== "string" || authorizationCode.length === 0 || authorizationCode.length > 2048)) {
      throw appError("INVALID");
    }
    // Shape first (no fetch, no token spent), then the flood cap, then Apple's cached keys (dcm-gdzi.6).
    let kid;
    try {
      kid = appleTokenKeyId(identityToken);
    } catch {
      throw appError("FORBIDDEN");
    }
    await enforceAppleSignInLimit(ctx);
    let keys;
    try {
      keys = await appleKeys.keysFor(kid);
    } catch {
      // Apple's keys could not be fetched: an outage, not a forged token, so the person may simply try again.
      throw appError("RATE_LIMITED", "Sign in with Apple is unavailable right now. Try again in a moment.");
    }
    let identity;
    try {
      identity = await verifyAppleIdentityToken({ identityToken, nonce, keys });
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw appError("FORBIDDEN");
    }
    const existing = await retrieveAccount(ctx, {
      provider: APPLE_PROVIDER_ID,
      account: { id: identity.subject },
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message === "InvalidAccountId") return null;
      throw error;
    });
    // The bundle id the verified token was issued to: the client id Apple wants when the code is traded and revoked.
    const clientId = verifiedAudience(identityToken);
    const remember = async (userId: Id<"users">) => {
      if (typeof authorizationCode !== "string" || clientId === null) return;
      await ctx.scheduler.runAfter(0, internal.accountSelfDelete.rememberAppleSignIn, { userId, clientId, authorizationCode });
    };
    // Convex Auth finishes an existing account's sign-in without createOrUpdateUser, so check suspension here (AD14).
    if (existing !== null) {
      const allowed = await refuseSuspendedSignIn(ctx as unknown as ActionCtx, { userId: existing.user._id });
      await remember(existing.user._id);
      return allowed;
    }
    const { user } = await createAccount(ctx, {
      provider: APPLE_PROVIDER_ID,
      account: { id: identity.subject },
      profile: {
        ...(identity.email !== undefined ? { email: identity.email } : {}),
        emailVerified: identity.emailVerified,
        ...(name ? { name } : {}),
      },
    });
    await remember(user._id);
    return { userId: user._id };
  },
});

/**
 * The `aud` of an identity token `verifyAppleIdentityToken` has already accepted (so it is one of `APPLE_AUDIENCES`):
 * the app's bundle id. Null when it cannot be read, which only skips remembering the refresh token.
 */
function verifiedAudience(identityToken: string): string | null {
  try {
    const segment = identityToken.split(".")[1] ?? "";
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (segment.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { aud?: unknown };
    const aud = Array.isArray(payload.aud) ? (payload.aud as unknown[])[0] : payload.aud;
    return typeof aud === "string" && aud.length > 0 ? aud : null;
  } catch {
    return null;
  }
}
/** `createOrUpdateUser` behind the self-deletion cancel (DEL1): an OAuth sign-in of an existing account. */
export async function signInCallback(ctx: MutationCtx, args: SignInArgs) {
  if (args.existingUserId !== null) await resumeSelfDeletedAccount(ctx, args.existingUserId);
  return createOrUpdateUser(ctx, args);
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
    appleNativeProvider,
    // Email + password. Sign-up follows the owner's sign-up mode (AD4); a new account works only after the emailed 6-digit code is entered
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
          // The join code of a /join/<code> link (AD4): read by `createOrUpdateUser` for invite mode, never stored.
          const joinCode = signUpJoinCode(params.joinCode);
          return { email, ...(name ? { name } : {}), ...(joinCode ? { joinCode } : {}) };
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
    async redirect({ redirectTo }) {
      const siteUrl = process.env.SITE_URL;
      if (siteUrl === undefined) throw new Error("Missing environment variable `SITE_URL`");
      return nativeRedirectTarget(redirectTo, siteUrl);
    },
    // The callback's ctx is typed for any data model; this app's schema is
    // the one in convex/schema.ts.
    // Signing in to an account that asked for its own deletion cancels it first (DEL1), so `createOrUpdateUser`'s
    // suspension check (AD14) refuses only what the owner set.
    createOrUpdateUser: (ctx, args) => signInCallback(ctx as unknown as MutationCtx, args as unknown as SignInArgs),
  },
});
