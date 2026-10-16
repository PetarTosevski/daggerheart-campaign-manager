import Google from "@auth/core/providers/google";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import {
  convexAuth,
  createAccount,
  retrieveAccount,
} from "@convex-dev/auth/server";

import type { MutationCtx } from "./_generated/server";
import { buildE2EProfile, isE2EDeployment } from "./lib/allowlist";
import { createOrUpdateGmUser, type SignInArgs } from "./lib/users";

const E2E_PROVIDER_ID = "e2e";

// Test-only sign-in. Registered only on a local backend with e2e auth enabled,
// and `buildE2EProfile` re-checks both conditions on every call.
const e2eProviders =
  isE2EDeployment(process.env) && process.env.E2E_AUTH_ENABLED === "true"
    ? [
        ConvexCredentials({
          id: E2E_PROVIDER_ID,
          authorize: async (credentials, ctx) => {
            const profile = buildE2EProfile(credentials, process.env);
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
        }),
      ]
    : [];

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
    ...e2eProviders,
  ],
  callbacks: {
    // The callback's ctx is typed for any data model; this app's schema is
    // the one in convex/schema.ts.
    createOrUpdateUser: (ctx, args) =>
      createOrUpdateGmUser(
        ctx as unknown as MutationCtx,
        args as unknown as SignInArgs,
        process.env,
      ),
  },
});
