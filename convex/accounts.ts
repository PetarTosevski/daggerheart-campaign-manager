import { createAccount, retrieveAccount } from "@convex-dev/auth/server";

import { env, internalAction } from "./_generated/server";
import { seedAccountsFor } from "./lib/allowlist";
import { PASSWORD_PROVIDER_ID } from "./lib/users";

/**
 * Creates the env-defined test accounts (`SEED_ACCOUNTS`, `email:password`
 * pairs separated by `;`) as email + password logins. Idempotent; existing
 * accounts are left unchanged. Refuses to run unless this is a local e2e
 * deployment or `ALLOW_SEED_ACCOUNTS` is `"true"` (cloud dev only). Run with `npx convex run accounts:seed`.
 */
export const seed = internalAction({
  args: {},
  handler: async (ctx) => {
    const created: string[] = [];
    const skipped: string[] = [];
    for (const { email, password } of seedAccountsFor(env)) {
      const existing = await retrieveAccount(ctx, {
        provider: PASSWORD_PROVIDER_ID,
        account: { id: email },
      }).catch(() => null);
      if (existing !== null) continue;
      try {
        await createAccount(ctx, {
          provider: PASSWORD_PROVIDER_ID,
          account: { id: email, secret: password },
          profile: { email },
        });
        created.push(email);
      } catch {
        // Typically EMAIL_IN_USE: a Google user already owns this address.
        skipped.push(email);
      }
    }
    return { created, skipped };
  },
});
