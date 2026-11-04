import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { AtLimitMode } from "../src/lib/admin/config";
import { env as typedEnv, internalAction, internalQuery } from "./_generated/server";
import { isE2EDeployment, type Env } from "./lib/allowlist";
import { readAppConfig } from "./lib/appConfig";
import { appOwnerId } from "./lib/appOwner";
import { fakeCodeMode, RESEND_URL } from "./lib/authEmail";
import { atLimitValidator } from "./lib/validators/admin";
import { escapeHtml } from "./lorekeeperLimitRequests";

/**
 * The 80% spend email (config AD7, Q32 a; docs/tasks/TASK-CONFIG-AD7.md). `caps.ts` detects the month's first
 * crossing of 80% of the deployment's monthly Lorekeeper limit in the booking mutation, sets
 * `appConfig.spendAlertMonth` there (so the email goes once a month) and schedules `send`. The owner's address is read
 * here on the server and never reaches a client; the email carries no key, id or address other than its recipient.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const dataValidator = v.object({
  to: v.string(),
  month: v.string(),
  spentMicros: v.number(),
  limitMicros: v.number(),
  atLimit: atLimitValidator,
});

export type SpendAlertData = {
  to: string;
  month: string;
  spentMicros: number;
  limitMicros: number;
  atLimit: AtLimitMode;
};

const emailDataRef = makeFunctionReference<"query", { month: string }, SpendAlertData | null>("spendAlert:emailData");

/** "2026-11" → "November 2026" (UTC month; no Intl dependency). */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const name = MONTHS[Number(m) - 1];
  return name && year ? `${name} ${year}` : month;
}

function usd(micros: number): string {
  return `$${(Math.max(0, micros) / 1_000_000).toFixed(2)}`;
}

const AT_LIMIT_TEXT: Record<AtLimitMode, string> = {
  pause: "At the limit the Lorekeeper pauses for everyone until the 1st.",
  gmOnly: "At the limit only GMs can ask, up to 120% of the limit.",
  short: "At the limit everyone gets shorter answers, up to 120% of the limit.",
};

/** The owner's email: the month's spend against the limit and what happens at the limit. No keys, ids or addresses. */
export function spendAlertEmail(data: Omit<SpendAlertData, "to">, adminUrl: string | null) {
  const label = monthLabel(data.month);
  const percent = data.limitMicros > 0 ? Math.floor((data.spentMicros / data.limitMicros) * 100) : 0;
  const subject = `Lorekeeper at ${percent}% of its monthly limit`;
  const intro = `The Lorekeeper has used ${usd(data.spentMicros)} of its ${usd(data.limitMicros)} limit for ${label} (${percent}%).`;
  const then = AT_LIMIT_TEXT[data.atLimit];
  const how = "You can change the limit in App admin. This email is sent once a month.";
  const text = `${intro}\n\n${then}\n\n${how}${adminUrl ? `\n${adminUrl}` : ""}\n`;
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:480px">` +
    `<p>${escapeHtml(intro)}</p>` +
    `<p>${escapeHtml(then)}</p>` +
    `<p>${escapeHtml(how)}</p>` +
    (adminUrl
      ? `<p><a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:12px 20px;background:#5b3cc4;color:#fff;` +
        `border-radius:6px;text-decoration:none;font-weight:600">Open App admin</a></p>`
      : "") +
    `</div>`;
  return { subject, text, html };
}

/** What the email needs. Null when the alert is not this month's, or the owner has no verified address. */
export const emailData = internalQuery({
  args: { month: v.string() },
  returns: v.union(v.null(), dataValidator),
  handler: async (ctx, { month }) => {
    const settings = await readAppConfig(ctx);
    if (settings.spendAlertMonth !== month) return null;
    const ownerId = await appOwnerId(ctx);
    if (ownerId === null) return null;
    const [owner, counter] = await Promise.all([
      ctx.db.get("users", ownerId),
      ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_kind_period", (q) => q.eq("kind", "deployment").eq("period", month))
        .first(),
    ]);
    if (owner?.email === undefined || owner.emailVerificationTime === undefined) return null;
    return {
      to: owner.email,
      month,
      spentMicros: counter?.costMicros ?? 0,
      limitMicros: Math.round(settings.lorekeeper.monthlyUsd * 1_000_000),
      atLimit: settings.lorekeeper.atLimit,
    };
  },
});

/**
 * Emails the owner the month's 80% alert. Never on the e2e backend. A failure is logged without key or address and
 * is not retried (the month is already marked; the Overview's 80% alert, AD2, still shows it).
 */
export const send = internalAction({
  args: { month: v.string() },
  returns: v.null(),
  handler: async (ctx, { month }) => {
    const env: Env = typedEnv;
    if (isE2EDeployment(env) || fakeCodeMode(env)) return null;
    try {
      const data = await ctx.runQuery(emailDataRef, { month });
      if (data === null) return null;
      const key = env.AUTH_RESEND_KEY?.trim();
      const from = env.MAIL_FROM?.trim();
      if (!key || !from) throw new Error("Email is not configured (AUTH_RESEND_KEY or MAIL_FROM).");
      const base = env.SITE_URL?.trim().replace(/\/+$/, "");
      const { to, ...rest } = data;
      const { subject, text, html } = spendAlertEmail(rest, base ? `${base}/admin` : null);
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}.`);
    } catch (error) {
      console.error("Spend alert email not sent:", error instanceof Error ? error.message : "unknown error");
    }
    return null;
  },
});
