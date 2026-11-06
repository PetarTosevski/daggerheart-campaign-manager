import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { makeFunctionReference, paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import { v } from "convex/values";

import { LIMIT_REQUEST_REASON_MAX } from "../src/lib/admin/config";
import { appError } from "../src/lib/errors/app-error";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env as typedEnv, internalAction, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordAdminChange, type AuditValue } from "./lib/adminAudit";
import { readAppConfig } from "./lib/appConfig";
import { appOwnerId } from "./lib/appOwner";
import type { Env } from "./lib/allowlist";
import { fakeCodeMode, RESEND_URL } from "./lib/authEmail";
import { appOwnerMutation, appOwnerQuery, gmMutation, gmQuery } from "./lib/functions";
import { capLimits } from "./lib/lorekeeper/caps";
import { campaignLimitNumbersValidator, limitRequestStatusValidator } from "./lib/validators/admin";

/**
 * Lorekeeper limit requests (config AD12, Q21 changed, N10 b; docs/tasks/TASK-CONFIG-AD12.md). A GM or co-GM asks the
 * app owner for more questions per day, internet searches per day or book room, with a short reason; one pending
 * request per campaign, refused while the owner's `allowGmRequests` is off. The owner is emailed for every request
 * (scheduled internal action; the owner's address is read on the server and never reaches a client). The owner
 * approves with the numbers they choose, or declines, or sets a campaign's numbers directly; the numbers live in
 * `lorekeeperCampaignLimits`, which AD6's `capLimits` reads on the next question. No GM self-service.
 */

/** The four numbers a campaign can carry. */
export const LIMIT_FIELDS = ["dailyQuestions", "dailyWebSearches", "bookCount", "bookPages"] as const;
export type LimitField = (typeof LIMIT_FIELDS)[number];
type Numbers = Partial<Record<LimitField, number>>;

/** What a GM may ask for, per number. */
export const MAX_WANTED = 1000;
/** What the owner may set, per number (the same bound as the app's per-person daily counts, AD6). */
export const MAX_SET = 10_000;
/** Owner list page size bound. */
export const LIST_PAGE_MAX = 50;

/** Requests per GM per day: the one-pending rule bounds open requests; this bounds ask-cancel-ask (and the emails). */
const REQUEST_LIMITS = { lorekeeperLimitRequest: { kind: "fixed window", rate: 5, period: 24 * HOUR } } as const;
const limiter = new RateLimiter(components.rateLimiter, REQUEST_LIMITS);

// Typed references by name, so this module needs no regenerated `_generated/api` for its own internals.
const notifyRef = makeFunctionReference<"action", { requestId: Id<"lorekeeperLimitRequests"> }, null>(
  "lorekeeperLimitRequests:notifyOwner",
);
const emailDataRef = makeFunctionReference<"query", { requestId: Id<"lorekeeperLimitRequests"> }, OwnerEmailData | null>(
  "lorekeeperLimitRequests:ownerEmailData",
);

/** Whole numbers within 0..max, at least one given; INVALID otherwise. */
function checkedNumbers(numbers: Numbers, max: number): Numbers {
  const out: Numbers = {};
  for (const field of LIMIT_FIELDS) {
    const value = numbers[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > max) throw appError("INVALID");
    out[field] = value;
  }
  if (Object.keys(out).length === 0) throw appError("INVALID");
  return out;
}

async function limitsRow(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"lorekeeperCampaignLimits"> | null> {
  return ctx.db
    .query("lorekeeperCampaignLimits")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .first();
}

async function pendingFor(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"lorekeeperLimitRequests"> | null> {
  return ctx.db
    .query("lorekeeperLimitRequests")
    .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaignId).eq("status", "pending"))
    .first();
}

const currentValidator = v.object({
  /** The campaign's effective numbers: its own row, else the app's per-person defaults. */
  dailyQuestions: v.number(),
  dailyWebSearches: v.number(),
  /** Book room has no app default (N6 b): null until the owner sets one. */
  bookCount: v.union(v.number(), v.null()),
  bookPages: v.union(v.number(), v.null()),
  /** Whether the owner set any number for this campaign. */
  custom: v.boolean(),
});

async function currentNumbers(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  const [limits, row] = await Promise.all([capLimits(ctx, campaignId), limitsRow(ctx, campaignId)]);
  return {
    dailyQuestions: limits.dailyQuestions,
    dailyWebSearches: limits.dailyWebSearches,
    bookCount: row?.bookCount ?? null,
    bookPages: row?.bookPages ?? null,
    custom: row !== null && LIMIT_FIELDS.some((f) => row[f] !== undefined),
  };
}

/** Writes some of a campaign's numbers (`null` clears one back to the default) and audits each change. */
async function writeNumbers(
  ctx: MutationCtx & { user: Doc<"users"> },
  campaignId: Id<"campaigns">,
  numbers: Partial<Record<LimitField, number | null>>,
  audit: { action: "limits.request.approve" | "limits.campaign.set"; target: string },
): Promise<void> {
  const row = await limitsRow(ctx, campaignId);
  const next: Partial<Record<LimitField, number | undefined>> = {};
  for (const field of LIMIT_FIELDS) {
    if (!(field in numbers)) continue;
    const value = numbers[field];
    next[field] = value === null ? undefined : value;
    const from: AuditValue = row?.[field] ?? "default";
    const to: AuditValue = value ?? "default";
    await recordAdminChange(ctx, ctx.user._id, { action: audit.action, field, from, to, target: audit.target });
  }
  const now = Date.now();
  if (row === null) {
    const fields = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined));
    await ctx.db.insert("lorekeeperCampaignLimits", { campaignId, ...fields, setBy: ctx.user._id, updatedAt: now });
  } else {
    await ctx.db.patch("lorekeeperCampaignLimits", row._id, { ...next, setBy: ctx.user._id, updatedAt: now });
  }
}

// ---------------------------------------------------------------- the GM's side

/**
 * Asks the owner for higher limits for this campaign (GM and co-GM). LIMIT_REQUESTS_OFF while the owner's switch is
 * off; LIMIT_REQUEST_PENDING while the campaign has a pending request; RATE_LIMITED past 5 a day per GM. Emails the
 * owner (scheduled; a failed send never touches the request).
 */
export const request = gmMutation({
  args: { wants: campaignLimitNumbersValidator, reason: v.string() },
  returns: v.id("lorekeeperLimitRequests"),
  handler: async (ctx, { wants, reason }) => {
    const { lorekeeper } = await readAppConfig(ctx);
    if (!lorekeeper.allowGmRequests) throw appError("LIMIT_REQUESTS_OFF");
    const checked = checkedNumbers(wants, MAX_WANTED);
    const text = reason.trim();
    if (text.length === 0 || text.length > LIMIT_REQUEST_REASON_MAX) throw appError("INVALID");
    if ((await pendingFor(ctx, ctx.campaign._id)) !== null) throw appError("LIMIT_REQUEST_PENDING");
    const { ok } = await limiter.limit(ctx, "lorekeeperLimitRequest", { key: ctx.user._id });
    if (!ok) throw appError("RATE_LIMITED");
    const requestId = await ctx.db.insert("lorekeeperLimitRequests", {
      campaignId: ctx.campaign._id,
      requestedBy: ctx.user._id,
      wants: checked,
      reason: text,
      status: "pending",
      createdAt: Date.now(),
    });
    if (!fakeCodeMode(typedEnv)) await ctx.scheduler.runAfter(0, notifyRef, { requestId });
    return requestId;
  },
});

/**
 * Withdraws the campaign's pending request (the GM or any co-GM: they share the campaign's `owner` permission).
 * NOT_FOUND when it isn't this campaign's pending one.
 */
export const cancel = gmMutation({
  args: { requestId: v.id("lorekeeperLimitRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get("lorekeeperLimitRequests", requestId);
    if (row === null || row.campaignId !== ctx.campaign._id || row.status !== "pending") throw appError("NOT_FOUND");
    await ctx.db.delete("lorekeeperLimitRequests", requestId);
    return null;
  },
});

const gmRequestValidator = v.object({
  _id: v.id("lorekeeperLimitRequests"),
  wants: campaignLimitNumbersValidator,
  reason: v.string(),
  status: limitRequestStatusValidator,
  createdAt: v.number(),
  decidedAt: v.union(v.number(), v.null()),
  /** The caller asked it. */
  mine: v.boolean(),
});

function forGm(row: Doc<"lorekeeperLimitRequests">, userId: Id<"users">) {
  return {
    _id: row._id,
    wants: row.wants,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt ?? null,
    mine: row.requestedBy === userId,
  };
}

/**
 * The GM's view: the campaign's current numbers, whether the owner takes requests, the pending request and the last
 * decision (approved or declined). Never the owner's identity or address.
 */
export const forCampaign = gmQuery({
  args: {},
  returns: v.object({
    requestsOpen: v.boolean(),
    current: currentValidator,
    pending: v.union(gmRequestValidator, v.null()),
    lastDecision: v.union(gmRequestValidator, v.null()),
  }),
  handler: async (ctx) => {
    const campaignId = ctx.campaign._id;
    const latest = (status: "approved" | "declined") =>
      ctx.db
        .query("lorekeeperLimitRequests")
        .withIndex("by_campaign_status", (q) => q.eq("campaignId", campaignId).eq("status", status))
        .order("desc")
        .first();
    const [{ lorekeeper }, current, pending, approved, declined] = await Promise.all([
      readAppConfig(ctx),
      currentNumbers(ctx, campaignId),
      pendingFor(ctx, campaignId),
      latest("approved"),
      latest("declined"),
    ]);
    const decided = [approved, declined]
      .filter((row) => row !== null)
      .sort((a, b) => (b.decidedAt ?? b.createdAt) - (a.decidedAt ?? a.createdAt))[0];
    return {
      requestsOpen: lorekeeper.allowGmRequests,
      current,
      pending: pending === null ? null : forGm(pending, ctx.user._id),
      lastDecision: decided === undefined ? null : forGm(decided, ctx.user._id),
    };
  },
});

// ---------------------------------------------------------------- the owner's side

function clampPage(opts: PaginationOptions): PaginationOptions {
  return { ...opts, numItems: Math.min(LIST_PAGE_MAX, Math.max(1, Math.floor(opts.numItems) || 1)) };
}

/** A user's display name (never the email), or null. */
async function nameOf(ctx: QueryCtx, userId: Id<"users">): Promise<string | null> {
  const name = (await ctx.db.get("users", userId))?.name?.trim();
  return name ? name : null;
}

const ownerRowValidator = v.object({
  _id: v.id("lorekeeperLimitRequests"),
  campaignId: v.id("campaigns"),
  /** Null once the campaign is purged. */
  campaignName: v.union(v.string(), v.null()),
  requestedBy: v.id("users"),
  requesterName: v.union(v.string(), v.null()),
  wants: campaignLimitNumbersValidator,
  reason: v.string(),
  status: limitRequestStatusValidator,
  createdAt: v.number(),
  decidedAt: v.union(v.number(), v.null()),
  /** The campaign's numbers now (for the approve form). */
  current: currentValidator,
});

/**
 * The owner's list, one status at a time (the page asks for `pending` first, oldest first; decided ones newest first),
 * joined to the campaign name, the requester's name and the campaign's current numbers.
 */
export const list = appOwnerQuery({
  args: { status: limitRequestStatusValidator, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(ownerRowValidator),
  handler: async (ctx, { status, paginationOpts }) => {
    const page = await ctx.db
      .query("lorekeeperLimitRequests")
      .withIndex("by_status_createdAt", (q) => q.eq("status", status))
      .order(status === "pending" ? "asc" : "desc")
      .paginate(clampPage(paginationOpts));
    const rows = await Promise.all(
      page.page.map(async (row) => {
        const [campaign, requesterName, current] = await Promise.all([
          ctx.db.get("campaigns", row.campaignId),
          nameOf(ctx, row.requestedBy),
          currentNumbers(ctx, row.campaignId),
        ]);
        return {
          _id: row._id,
          campaignId: row.campaignId,
          campaignName: campaign?.name ?? null,
          requestedBy: row.requestedBy,
          requesterName,
          wants: row.wants,
          reason: row.reason,
          status: row.status,
          createdAt: row.createdAt,
          decidedAt: row.decidedAt ?? null,
          current,
        };
      }),
    );
    return { ...page, page: rows };
  },
});

/**
 * Approves (with `numbers`, the owner's choice, else the asked ones) or declines a pending request. Approving writes
 * the campaign's `lorekeeperCampaignLimits` (only the numbers given; the others stay), effective on the next question.
 * Audited: `limits.request.approve` per number, `limits.request.decline` once. NOT_FOUND for a missing request,
 * INVALID for one already decided.
 */
export const decide = appOwnerMutation({
  args: {
    requestId: v.id("lorekeeperLimitRequests"),
    approve: v.boolean(),
    numbers: v.optional(campaignLimitNumbersValidator),
  },
  returns: v.null(),
  handler: async (ctx, { requestId, approve, numbers }) => {
    const row = await ctx.db.get("lorekeeperLimitRequests", requestId);
    if (row === null) throw appError("NOT_FOUND");
    if (row.status !== "pending") throw appError("INVALID");
    const target = String(requestId);
    if (approve) {
      const chosen = checkedNumbers(numbers ?? row.wants, MAX_SET);
      await writeNumbers(ctx, row.campaignId, chosen, { action: "limits.request.approve", target });
    } else {
      await recordAdminChange(ctx, ctx.user._id, { action: "limits.request.decline", target });
    }
    await ctx.db.patch("lorekeeperLimitRequests", requestId, {
      status: approve ? "approved" : "declined",
      decidedAt: Date.now(),
      decidedBy: ctx.user._id,
    });
    return null;
  },
});

const fieldValidator = v.union(...LIMIT_FIELDS.map((f) => v.literal(f)));

/**
 * Sets one of a campaign's numbers directly (single-field intent); `value: null` clears it back to the default.
 * Audited `limits.campaign.set`. NOT_FOUND for a missing campaign.
 */
export const setCampaignLimits = appOwnerMutation({
  args: {
    campaignId: v.id("campaigns"),
    change: v.object({ field: fieldValidator, value: v.union(v.number(), v.null()) }),
  },
  returns: v.null(),
  handler: async (ctx, { campaignId, change }) => {
    if ((await ctx.db.get("campaigns", campaignId)) === null) throw appError("NOT_FOUND");
    const value = change.value === null ? null : checkedNumbers({ [change.field]: change.value }, MAX_SET)[change.field]!;
    await writeNumbers(ctx, campaignId, { [change.field]: value }, { action: "limits.campaign.set", target: String(campaignId) });
    return null;
  },
});

// ---------------------------------------------------------------- the owner's email (N10 b)

type OwnerEmailData = { to: string; gmName: string; campaignName: string; wants: Numbers; reason: string };

const LABELS: Record<LimitField, string> = {
  dailyQuestions: "Questions per day",
  dailyWebSearches: "Internet searches per day",
  bookCount: "Books",
  bookPages: "Book pages",
};

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The owner's email for one request: names the GM and the campaign, lists the asked numbers and quotes the reason
 * (escaped in the HTML; GM-written), with a link to App admin. No keys, ids or addresses.
 */
export function limitRequestEmail(data: Omit<OwnerEmailData, "to">, adminUrl: string | null) {
  const gm = oneLine(data.gmName) || "A game master";
  const campaign = oneLine(data.campaignName) || "a campaign";
  const subject = `Lorekeeper limit request: ${campaign}`.slice(0, 150);
  const intro = `${gm} asked for higher Lorekeeper limits for ${campaign}.`;
  const asked = LIMIT_FIELDS.filter((f) => data.wants[f] !== undefined).map((f) => `${LABELS[f]}: ${data.wants[f]}`);
  const how = "Approve with the numbers you choose, or decline, in App admin.";
  const text = `${intro}\n\n${asked.join("\n")}\n\nReason:\n${data.reason}\n\n${how}${adminUrl ? `\n${adminUrl}` : ""}\n`;
  const html =
    `<div style="font-family:system-ui,sans-serif;max-width:480px">` +
    `<p>${escapeHtml(intro)}</p>` +
    `<ul>${asked.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` +
    `<p><strong>Reason</strong></p><p style="white-space:pre-wrap">${escapeHtml(data.reason)}</p>` +
    `<p>${escapeHtml(how)}</p>` +
    (adminUrl
      ? `<p><a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:12px 20px;background:#5b3cc4;color:#fff;` +
        `border-radius:6px;text-decoration:none;font-weight:600">Open App admin</a></p>`
      : "") +
    `</div>`;
  return { subject, text, html };
}

/** What the email needs. Null when the request is gone or decided, or the owner has no verified address. */
export const ownerEmailData = internalQuery({
  args: { requestId: v.id("lorekeeperLimitRequests") },
  returns: v.union(
    v.null(),
    v.object({ to: v.string(), gmName: v.string(), campaignName: v.string(), wants: campaignLimitNumbersValidator, reason: v.string() }),
  ),
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get("lorekeeperLimitRequests", requestId);
    if (row === null || row.status !== "pending") return null;
    const ownerId = await appOwnerId(ctx);
    if (ownerId === null) return null;
    const [owner, campaign, gm] = await Promise.all([
      ctx.db.get("users", ownerId),
      ctx.db.get("campaigns", row.campaignId),
      ctx.db.get("users", row.requestedBy),
    ]);
    if (owner?.email === undefined || owner.emailVerificationTime === undefined || campaign === null) return null;
    return {
      to: owner.email,
      gmName: gm?.name?.trim() || gm?.email?.split("@")[0] || "",
      campaignName: campaign.name,
      wants: row.wants,
      reason: row.reason,
    };
  },
});

/** Emails the owner one request. A failure is logged without key or address and never touches the request. */
export const notifyOwner = internalAction({
  args: { requestId: v.id("lorekeeperLimitRequests") },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const env: Env = typedEnv;
    if (fakeCodeMode(env)) return null;
    try {
      const data = await ctx.runQuery(emailDataRef, { requestId });
      if (data === null) return null;
      const key = env.AUTH_RESEND_KEY?.trim();
      const from = env.MAIL_FROM?.trim();
      if (!key || !from) throw new Error("Email is not configured (AUTH_RESEND_KEY or MAIL_FROM).");
      const base = env.SITE_URL?.trim().replace(/\/+$/, "");
      const { subject, text, html } = limitRequestEmail(data, base ? `${base}/admin` : null);
      const res = await fetch(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [data.to], subject, text, html }),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}.`);
    } catch (error) {
      console.error("Limit request email not sent:", error instanceof Error ? error.message : "unknown error");
    }
    return null;
  },
});
