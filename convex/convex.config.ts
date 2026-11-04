import migrations from "@convex-dev/migrations/convex.config";
import presence from "@convex-dev/presence/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

/**
 * Environment variables the functions read through the typed `env` from
 * `_generated/server`. All optional: sign-up is open, so no email list is
 * read; the seed and e2e sign-in rails in `lib/allowlist.ts` stay off when
 * their variables are missing, and photo import (D5) is hidden without
 * `ANTHROPIC_API_KEY`; `ANTHROPIC_MODEL` overrides its pinned default model.
 *
 * Emailed sign-up codes (`lib/authEmail.ts`) and invite emails (`lib/inviteEmail.ts`): `AUTH_RESEND_KEY` (Resend API
 * key) and `MAIL_FROM` (sender on the verified dualityheart.com domain); invite emails also need `SITE_URL` (the app's
 * public URL, which Convex Auth uses as its redirect target too) for their sign-in link. Set them with
 * `npx convex env set`, never in Vercel or `.env.local`.
 *
 * The Lorekeeper (D13, `convex/lib/claude.ts`, `convex/lib/lorekeeper/caps.ts`):
 * `LOREKEEPER_MODEL` overrides the answer model (else `ANTHROPIC_MODEL`, else
 * Sonnet 5.5); `LOREKEEPER_FAKE_MODEL=true` replays canned answers, honoured
 * only on the local e2e deployment; the Q9 caps `LOREKEEPER_DAILY_QUESTIONS`
 * (default 40 per person per UTC day), `LOREKEEPER_CAMPAIGN_MONTHLY_USD`
 * (default 50) and `LOREKEEPER_MONTHLY_USD` (server-wide, default 150) change
 * with `npx convex env set`, no deploy needed.
 */
const app = defineApp({
  env: {
    SEED_ACCOUNTS: v.optional(v.string()),
    ALLOW_SEED_ACCOUNTS: v.optional(v.string()),
    E2E_AUTH_ENABLED: v.optional(v.string()),
    E2E_AUTH_SECRET: v.optional(v.string()),
    AUTH_RESEND_KEY: v.optional(v.string()),
    MAIL_FROM: v.optional(v.string()),
    SITE_URL: v.optional(v.string()),
    ANTHROPIC_API_KEY: v.optional(v.string()),
    ANTHROPIC_MODEL: v.optional(v.string()),
    LOREKEEPER_MODEL: v.optional(v.string()),
    LOREKEEPER_FAKE_MODEL: v.optional(v.string()),
    LOREKEEPER_DAILY_QUESTIONS: v.optional(v.string()),
    LOREKEEPER_CAMPAIGN_MONTHLY_USD: v.optional(v.string()),
    LOREKEEPER_MONTHLY_USD: v.optional(v.string()),
  },
});

app.use(rateLimiter);
app.use(migrations);
// Online / Away (config PR1, Q11 b): wrapped in convex/presence.ts; never called from the client directly.
app.use(presence);

export default app;
