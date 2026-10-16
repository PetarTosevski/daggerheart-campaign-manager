import Google from "@auth/core/providers/google";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import {
  convexAuth,
  createAccount,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import type { MutationCtx } from "./_generated/server";

import {
  buildE2EProfile,
  isAllowedProfile,
  isE2EDeployment,
  normalizeEmail,
} from "./lib/allowlist";

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
    async createOrUpdateUser(ctx, args) {
      if (!isAllowedProfile(args.profile, process.env)) {
        throw new ConvexError("FORBIDDEN");
      }
      if (args.existingUserId !== null) return args.existingUserId;

      const email = normalizeEmail(args.profile.email as string);
      // The callback's ctx is typed for any data model; this app's schema is
      // the one in convex/schema.ts.
      const db = (ctx as unknown as MutationCtx).db;
      const existing = await db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
      if (existing !== null) return existing._id;

      return await db.insert("users", {
        email,
        emailVerificationTime: Date.now(),
        ...(typeof args.profile.name === "string"
          ? { name: args.profile.name }
          : {}),
        ...(typeof args.profile.image === "string"
          ? { image: args.profile.image }
          : {}),
      });
    },
  },
});
