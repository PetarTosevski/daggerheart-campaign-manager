/**
 * The invite email (open-signup plan, OS7): when a GM invites an address, the address gets one email with a link to
 * sign in or create an account with that email, after which the campaign appears (`members.invite` stores the invite;
 * access is granted on sign-in with the verified email). Sent through Resend like OS1's codes (`AUTH_RESEND_KEY`,
 * `MAIL_FROM`); on the local e2e backend nothing is sent (`fakeCodeMode`).
 *
 * - The invite row is always stored first; a send runs later in a scheduled internal action, and a failed send is only
 *   logged (never the key, never the address), so it can never roll the invite back.
 * - Limits (fixed windows): 20 invite emails per hour per campaign and 3 per day per recipient. Past a limit the invite
 *   is still stored; only the email is skipped (`takeInviteEmailSlot`).
 * - An address that already has an unverified account gets no email (`hasUnverifiedAccount`).
 * - The email names the GM and the campaign only, never other players or their addresses.
 */
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { env as typedEnv, internalAction, internalQuery, type MutationCtx } from "../_generated/server";
import { normalizeEmail, type Env } from "./allowlist";
import { fakeCodeMode, RESEND_URL } from "./authEmail";

const DAY = 24 * HOUR;

export const INVITE_EMAIL_LIMITS = {
  inviteEmailCampaign: { kind: "fixed window", rate: 20, period: HOUR },
  inviteEmailRecipient: { kind: "fixed window", rate: 3, period: DAY },
} as const;

// Typed references by name, so this file needs no regenerated `_generated/api` (the module is `lib/inviteEmail`).
const sendRef = makeFunctionReference<"action", { inviteId: Doc<"campaignInvites">["_id"] }, null>("lib/inviteEmail:send");
const loadRef = makeFunctionReference<
  "query",
  { inviteId: Doc<"campaignInvites">["_id"] },
  { to: string; gmName: string; campaignName: string } | null
>("lib/inviteEmail:load");

const limiter = new RateLimiter(components.rateLimiter, INVITE_EMAIL_LIMITS);

export type InviteEmail = { subject: string; text: string; html: string };

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The email for one invite: subject, plain text and HTML, with a button to `signInUrl`. */
export function inviteEmail(gmName: string, campaignName: string, signInUrl: string): InviteEmail {
  const gm = oneLine(gmName) || "A game master";
  const campaign = oneLine(campaignName) || "a campaign";
  const subject = `${gm} invited you to ${campaign} on Duality Heart`;
  const intro = `${gm} invited you to join ${campaign} on Duality Heart.`;
  const how = "Sign in, or create an account, with this email address and the campaign will appear on your home page.";
  const outro = "If you were not expecting this, you can ignore this email.";
  const text = `${intro}\n\n${how}\n${signInUrl}\n\n${outro}\n`;
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:480px">` +
    `<p>${escapeHtml(intro)}</p><p>${escapeHtml(how)}</p>` +
    `<p><a href="${escapeHtml(signInUrl)}" style="display:inline-block;padding:12px 20px;background:#5b3cc4;color:#fff;` +
    `border-radius:6px;text-decoration:none;font-weight:600">Open Duality Heart</a></p>` +
    `<p>${escapeHtml(outro)}</p></div>`;
  return { subject, text, html };
}

/** `SITE_URL` is a Convex env var not (yet) declared in `convex.config.ts`, so it is read off the typed env loosely. */
export function signInLink(env: Env): string | null {
  const base = env.SITE_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}/signin` : null;
}

/** True when an account with this email exists but its address was never verified (such an address gets no email). */
export async function hasUnverifiedAccount(ctx: Pick<MutationCtx, "db">, email: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
  return user !== null && user.emailVerificationTime === undefined;
}

/**
 * Called by `members.invite` after it stored a new invite: consumes one slot of each limit and schedules the send.
 * Does nothing on the e2e backend, for an unverified account, or past a limit. Never throws for a limit.
 */
export async function scheduleInviteEmail(
  ctx: MutationCtx,
  invite: { inviteId: Doc<"campaignInvites">["_id"]; campaignId: Doc<"campaigns">["_id"]; email: string },
): Promise<boolean> {
  if (fakeCodeMode(typedEnv)) return false;
  if (await hasUnverifiedAccount(ctx, invite.email)) return false;
  const byCampaign = await limiter.limit(ctx, "inviteEmailCampaign", { key: invite.campaignId });
  if (!byCampaign.ok) return false;
  const byRecipient = await limiter.limit(ctx, "inviteEmailRecipient", { key: normalizeEmail(invite.email) });
  if (!byRecipient.ok) return false;
  await ctx.scheduler.runAfter(0, sendRef, { inviteId: invite.inviteId });
  return true;
}

/** What the send needs: recipient, GM and campaign names. Null when the invite was revoked in the meantime. */
export const load = internalQuery({
  args: { inviteId: v.id("campaignInvites") },
  returns: v.union(v.null(), v.object({ to: v.string(), gmName: v.string(), campaignName: v.string() })),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get("campaignInvites", inviteId);
    if (invite === null) return null;
    const [campaign, gm] = await Promise.all([
      ctx.db.get("campaigns", invite.campaignId),
      ctx.db.get("users", invite.invitedBy),
    ]);
    if (campaign === null) return null;
    return {
      to: invite.email,
      gmName: gm?.name?.trim() || gm?.email?.split("@")[0] || "",
      campaignName: campaign.name,
    };
  },
});

/** Sends one invite email. A failure is logged without key or address and never touches the stored invite. */
export const send = internalAction({
  args: { inviteId: v.id("campaignInvites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const env: Env = typedEnv;
    if (fakeCodeMode(env)) return null;
    try {
      const data = await ctx.runQuery(loadRef, { inviteId });
      if (data === null) return null;
      const key = env.AUTH_RESEND_KEY?.trim();
      const from = env.MAIL_FROM?.trim();
      const link = signInLink(env);
      if (!key || !from || !link) throw new Error("Email is not configured (AUTH_RESEND_KEY, MAIL_FROM or SITE_URL).");
      const { subject, text, html } = inviteEmail(data.gmName, data.campaignName, link);
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [data.to], subject, text, html }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}.`);
    } catch (error) {
      console.error("Invite email not sent:", error instanceof Error ? error.message : "unknown error");
    }
    return null;
  },
});
