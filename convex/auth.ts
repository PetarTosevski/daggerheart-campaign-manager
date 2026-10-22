import Google from "@auth/core/providers/google";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Password } from "@convex-dev/auth/providers/Password";
import {
  convexAuth,
  createAccount,
  retrieveAccount,
} from "@convex-dev/auth/server";

import { env, type MutationCtx } from "./_generated/server";
import { buildE2EProfile, normalizeEmail } from "./lib/allowlist";
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

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      // The default Google profile drops `email_verified`; keep it so the
      // allowlist can require a verified email.
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
    // Email + password sign-up and sign-in; the allowlist applies in
    // `createOrUpdateUser`. Passwords need at least 8 characters (default).
    Password({
      id: PASSWORD_PROVIDER_ID,
      profile(params) {
        const email = typeof params.email === "string" ? normalizeEmail(params.email) : "";
        const name = typeof params.name === "string" ? params.name.trim().slice(0, 80) : "";
        return { email, ...(name ? { name } : {}) };
      },
    }),
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
      createOrUpdateUser(
        ctx as unknown as MutationCtx,
        args as unknown as SignInArgs,
        env,
      ),
  },
});
