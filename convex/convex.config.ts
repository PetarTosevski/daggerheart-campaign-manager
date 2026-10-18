import migrations from "@convex-dev/migrations/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

/**
 * Environment variables the functions read through the typed `env` from
 * `_generated/server`. All optional: the sign-in policy in `lib/allowlist.ts`
 * fails closed when one is missing, and photo import (D5) is hidden without
 * `ANTHROPIC_API_KEY`; `ANTHROPIC_MODEL` overrides its pinned default model.
 */
const app = defineApp({
  env: {
    ALLOWED_EMAILS: v.optional(v.string()),
    GM_EMAILS: v.optional(v.string()),
    SEED_ACCOUNTS: v.optional(v.string()),
    ALLOW_SEED_ACCOUNTS: v.optional(v.string()),
    E2E_AUTH_ENABLED: v.optional(v.string()),
    E2E_AUTH_SECRET: v.optional(v.string()),
    ANTHROPIC_API_KEY: v.optional(v.string()),
    ANTHROPIC_MODEL: v.optional(v.string()),
  },
});

app.use(rateLimiter);
app.use(migrations);

export default app;
