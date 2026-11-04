/**
 * The e2e code rail (dcm-bxp.128.2). On the local e2e backend no email is sent, so the fake sender stores the random
 * code it generated in `e2eCodes`, and the specs read it back through `GET /e2e/code?email=...&secret=...`.
 *
 * Gated exactly like the test sign-in: `buildE2EProfile` answers null unless this is a local deployment
 * (`isE2EDeployment`), `E2E_AUTH_ENABLED=true` and the secret matches (constant time). Any failure is a plain 404,
 * so a cloud deployment never reveals the route. There is no public Convex function: the two functions below are
 * internal, and the route is an HTTP action (no authz-matrix entry; tests/convex/auth-signup.test.ts covers the gate).
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { env as typedEnv, httpAction, internalMutation, internalQuery } from "./_generated/server";
import { buildE2EProfile, isE2EDeployment, normalizeEmail, type Env } from "./lib/allowlist";
import { appConfigRow } from "./lib/appOwner";

/** The campaign caps on the e2e backend: far above what repeated runs of the suite create (AD5a). */
export const E2E_CAMPAIGN_CAP = 1_000_000;

/**
 * Raises the campaign caps (config AD5a) on the local e2e backend, where the shared test GM keeps every campaign every
 * run creates. `scripts/e2e-setup.mjs` runs it; it refuses on any other deployment. Keeps the other saved settings.
 */
export const raiseCampaignCaps = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!isE2EDeployment(typedEnv)) throw new Error("e2e:raiseCampaignCaps runs only on the local e2e backend");
    const caps = { campaignsPerGm: E2E_CAMPAIGN_CAP, campaignsApp: E2E_CAMPAIGN_CAP };
    const row = await appConfigRow(ctx);
    if (row === null) await ctx.db.insert("appConfig", { key: "app", caps, updatedAt: Date.now() });
    else await ctx.db.patch("appConfig", row._id, { caps: { ...row.caps, ...caps }, updatedAt: Date.now() });
    return null;
  },
});

/** Stores the code for the email, replacing any earlier one (one row per email). */
export const recordCode = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const old = await ctx.db
      .query("e2eCodes")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(10);
    for (const row of old) await ctx.db.delete(row._id);
    await ctx.db.insert("e2eCodes", { email, code: args.code, createdAt: Date.now() });
  },
});

export const latestCode = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("e2eCodes")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(args.email)))
      .first();
    return row?.code ?? null;
  },
});

/** `GET /e2e/code?email=&secret=` -> `{ code }`; 404 unless the e2e rails are open and a code exists. */
export const codeRoute = httpAction(async (ctx, request) => {
  const env: Env = typedEnv;
  const url = new URL(request.url);
  const email = url.searchParams.get("email") ?? undefined;
  const secret = url.searchParams.get("secret") ?? undefined;
  const profile = buildE2EProfile({ email, secret }, env);
  if (!profile) return new Response(null, { status: 404 });
  const code = await ctx.runQuery(internal.e2e.latestCode, { email: profile.email });
  if (!code) return new Response(null, { status: 404 });
  return Response.json({ code }, { headers: { "Cache-Control": "no-store" } });
});
