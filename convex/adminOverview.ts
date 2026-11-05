import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
  type PaginationResult,
} from "convex/server";
import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import { env, type QueryCtx } from "./_generated/server";
import { readAppConfig } from "./lib/appConfig";
import { appOwnerId } from "./lib/appOwner";
import { appOwnerQuery } from "./lib/functions";
import { adminAuditActionValidator, adminAuditValueValidator } from "./lib/validators/admin";

/**
 * App admin · Overview (config AD2, docs/tasks/TASK-CONFIG-AD2.md): the numbers, the alerts, the campaigns card and
 * Recent changes. Owner only: every function is an `appOwnerQuery` (FORBIDDEN for anyone else, the GMs included).
 *
 * What the owner sees: counts, names, campaign facts and setting values. Never an email, a key, a secret or an env
 * value (a missing key is reported as a boolean alert naming the service). Every read is indexed and bounded
 * (`ADMIN_READ_BOUND`; a count past it comes back with `more: true`, shown as "1000+"); lists paginate. Alerts carry a
 * code and parameters; the client writes the text. The client passes the UTC `day` / `month` (CF10).
 */

/** The most rows one Overview count reads; past it the count is shown as "1000+". */
export const ADMIN_READ_BOUND = 1000;

/** Rows per page of the campaigns card and Recent changes, whatever the client asks for. */
export const ADMIN_PAGE_MAX = 50;

/** Members counted per campaign on the campaigns card (the players cap is far lower); past it, "100+". */
export const PLAYER_COUNT_BOUND = 100;

/** A user at this share of the daily question cap today is an alert (90%). */
export const DAILY_ALERT_SHARE = 0.9;

/** The month's spend at this share of the monthly limit is an alert (80%). */
export const SPEND_ALERT_SHARE = 0.8;

/** Pending limit requests read for the alert; past 50 the alert says "50+" (Q21). */
export const LIMIT_REQUESTS_BOUND = 50;

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A bounded count: `more` when there were more rows than the bound. */
const boundedCount = v.object({ count: v.number(), more: v.boolean() });

const statsValidator = v.object({
  accounts: v.object({
    total: v.number(),
    owner: v.number(),
    gms: v.number(),
    players: v.number(),
    /** More than `ADMIN_READ_BOUND` accounts (or live campaigns): the numbers are lower bounds. */
    more: v.boolean(),
  }),
  campaigns: v.object({ live: boundedCount, cap: v.number() }),
  lorekeeper: v.object({ questions: v.number(), costMicros: v.number(), limitMicros: v.number() }),
});

/** The services whose key can be missing (the env var names stay on the server). */
const keyServiceValidator = v.union(v.literal("lorekeeper"), v.literal("email"));

const alertValidator = v.union(
  v.object({
    code: v.literal("userNearDailyCap"),
    params: v.object({ userId: v.id("users"), name: v.union(v.string(), v.null()), questions: v.number(), cap: v.number() }),
  }),
  v.object({ code: v.literal("spendNearLimit"), params: v.object({ costMicros: v.number(), limitMicros: v.number() }) }),
  v.object({ code: v.literal("spendAtLimit"), params: v.object({ costMicros: v.number(), limitMicros: v.number() }) }),
  v.object({ code: v.literal("readOnly"), params: v.object({}) }),
  v.object({ code: v.literal("keyMissing"), params: v.object({ service: keyServiceValidator }) }),
  v.object({ code: v.literal("limitRequestsWaiting"), params: v.object({ count: v.number(), more: v.boolean() }) }),
);

const campaignRowValidator = v.object({
  campaignId: v.id("campaigns"),
  name: v.string(),
  gmId: v.id("users"),
  gmName: v.union(v.string(), v.null()),
  /** Member rows (players and co-GMs; the creator has none), up to `PLAYER_COUNT_BOUND`. */
  players: boundedCount,
  archived: v.boolean(),
  liveNow: v.boolean(),
  /** The latest session end, or null when no session has ended. */
  lastPlayedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
});

const auditRowValidator = v.object({
  _id: v.id("adminAudit"),
  at: v.number(),
  actorId: v.id("users"),
  actorName: v.union(v.string(), v.null()),
  action: adminAuditActionValidator,
  field: v.optional(v.string()),
  from: v.optional(adminAuditValueValidator),
  to: v.optional(adminAuditValueValidator),
  target: v.optional(v.string()),
});

/** The client's page size, clamped to 1..`ADMIN_PAGE_MAX`. */
function clampPage(opts: PaginationOptions): PaginationOptions {
  const numItems = Math.min(ADMIN_PAGE_MAX, Math.max(1, Math.floor(opts.numItems) || 1));
  return { ...opts, numItems };
}

/** A user's display name (never the email), or null. */
async function nameOf(ctx: QueryCtx, userId: Id<"users">): Promise<string | null> {
  const user = await ctx.db.get("users", userId);
  const name = user?.name?.trim();
  return name ? name : null;
}

/** Live (not deleted) campaigns, up to the bound + 1. */
async function liveCampaigns(ctx: QueryCtx): Promise<Doc<"campaigns">[]> {
  return ctx.db
    .query("campaigns")
    .withIndex("by_deletedAt_archivedAt", (q) => q.eq("deletedAt", undefined))
    .take(ADMIN_READ_BOUND + 1);
}

/**
 * The Overview numbers: accounts by role (owner; GM = owns a live campaign; player = everyone else), live non-archived
 * campaigns against `caps.campaignsApp`, and the month's Lorekeeper questions and spend (the deployment counter of
 * `lib/lorekeeper/caps.ts`; Q22: a count, no question cap).
 */
export const stats = appOwnerQuery({
  args: { month: v.string() },
  returns: statsValidator,
  handler: async (ctx, { month }) => {
    if (!MONTH.test(month)) throw appError("INVALID");
    const [config, ownerId, users, campaigns, usage] = await Promise.all([
      readAppConfig(ctx),
      appOwnerId(ctx),
      ctx.db.query("users").withIndex("by_creation_time").take(ADMIN_READ_BOUND + 1),
      liveCampaigns(ctx),
      ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_kind_period", (q) => q.eq("kind", "deployment").eq("period", month))
        .first(),
    ]);
    const shownUsers = users.slice(0, ADMIN_READ_BOUND);
    const shownCampaigns = campaigns.slice(0, ADMIN_READ_BOUND);
    const gmIds = new Set(shownCampaigns.map((c) => c.ownerId));
    let owner = 0;
    let gms = 0;
    for (const user of shownUsers) {
      if (user._id === ownerId) owner += 1;
      else if (gmIds.has(user._id)) gms += 1;
    }
    const live = shownCampaigns.filter((c) => c.archivedAt === undefined).length;
    const campaignsMore = campaigns.length > ADMIN_READ_BOUND;
    return {
      accounts: {
        total: shownUsers.length,
        owner,
        gms,
        players: shownUsers.length - owner - gms,
        more: users.length > ADMIN_READ_BOUND || campaignsMore,
      },
      campaigns: { live: { count: live, more: campaignsMore }, cap: config.caps.campaignsApp },
      lorekeeper: {
        questions: usage?.questions ?? 0,
        costMicros: usage?.costMicros ?? 0,
        limitMicros: Math.round(config.lorekeeper.monthlyUsd * 1_000_000),
      },
    };
  },
});

/**
 * The Overview alerts, in this order: limit requests waiting (Q21 changed), read-only on, a missing key, spend at or
 * past 80% / 100% of the monthly limit, users at 90% or more of today's question cap (the owner is uncapped and never
 * listed). Codes and parameters only.
 */
export const alerts = appOwnerQuery({
  args: { day: v.string(), month: v.string() },
  returns: v.array(alertValidator),
  handler: async (ctx, { day, month }) => {
    if (!DAY.test(day) || !MONTH.test(month) || !day.startsWith(`${month}-`)) throw appError("INVALID");
    const [config, ownerId, requests, status, spend, users] = await Promise.all([
      readAppConfig(ctx),
      appOwnerId(ctx),
      ctx.db
        .query("lorekeeperLimitRequests")
        .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
        .take(LIMIT_REQUESTS_BOUND + 1),
      ctx.db
        .query("appStatus")
        .withIndex("by_key", (q) => q.eq("key", "app"))
        .unique(),
      ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_kind_period", (q) => q.eq("kind", "deployment").eq("period", month))
        .first(),
      ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_kind_period", (q) => q.eq("kind", "user").eq("period", day))
        .take(ADMIN_READ_BOUND),
    ]);
    const out: (typeof alertValidator.type)[] = [];
    if (requests.length > 0) {
      out.push({
        code: "limitRequestsWaiting",
        params: { count: Math.min(requests.length, LIMIT_REQUESTS_BOUND), more: requests.length > LIMIT_REQUESTS_BOUND },
      });
    }
    if (status?.readOnly === true) out.push({ code: "readOnly", params: {} });
    // Presence only: the value never leaves this function.
    if (!env.ANTHROPIC_API_KEY?.trim()) out.push({ code: "keyMissing", params: { service: "lorekeeper" } });
    if (!env.AUTH_RESEND_KEY?.trim()) out.push({ code: "keyMissing", params: { service: "email" } });
    const limitMicros = Math.round(config.lorekeeper.monthlyUsd * 1_000_000);
    const costMicros = spend?.costMicros ?? 0;
    if (limitMicros > 0 && costMicros >= limitMicros) out.push({ code: "spendAtLimit", params: { costMicros, limitMicros } });
    else if (limitMicros > 0 && costMicros >= limitMicros * SPEND_ALERT_SHARE) {
      out.push({ code: "spendNearLimit", params: { costMicros, limitMicros } });
    }
    const cap = config.lorekeeper.dailyQuestions;
    const near = users
      .flatMap((row) =>
        row.userId !== undefined && row.userId !== ownerId && row.questions > 0 && row.questions >= cap * DAILY_ALERT_SHARE
          ? [{ userId: row.userId, questions: row.questions }]
          : [],
      )
      .sort((a, b) => b.questions - a.questions);
    for (const { userId, questions } of near) {
      out.push({ code: "userNearDailyCap", params: { userId, name: await nameOf(ctx, userId), questions, cap } });
    }
    return out;
  },
});

/** The two phases of the campaigns card: live (not archived) campaigns, then archived ones. */
type CampaignPhase = "live" | "archived";

/** The card's cursor: the phase, a colon, then that phase's index cursor (empty = the start of its range). */
function encodeCampaignCursor(phase: CampaignPhase, cursor: string | null): string {
  return `${phase}:${cursor ?? ""}`;
}

function decodeCampaignCursor(cursor: string): { phase: CampaignPhase; cursor: string | null } {
  const at = cursor.indexOf(":");
  const phase = cursor.slice(0, at);
  if (at < 0 || (phase !== "live" && phase !== "archived")) throw appError("INVALID");
  const inner = cursor.slice(at + 1);
  return { phase, cursor: inner === "" ? null : inner };
}

/** One phase's index range: `archivedAt` unset (live), or set (archived; an unset field sorts below every number). */
function campaignPhaseQuery(ctx: QueryCtx, phase: CampaignPhase) {
  return ctx.db
    .query("campaigns")
    .withIndex("by_deletedAt_archivedAt", (q) =>
      phase === "live" ? q.eq("deletedAt", undefined).eq("archivedAt", undefined) : q.eq("deletedAt", undefined).gte("archivedAt", 0),
    )
    .order("desc");
}

/**
 * One page of the campaigns card (dcm-jh6d.65): live campaigns newest first, then archived ones, newest archived first.
 * `by_deletedAt_archivedAt` descending as one range would list every archived campaign first, so the card reads the two
 * ranges in turn, one `paginate` per call (Convex allows one). The cursor names the phase; the page that ends the live
 * range may be short and hands over to the archived range (or is the last page when nothing is archived). A null
 * cursor starts the live phase.
 */
async function campaignsPage(ctx: QueryCtx, opts: PaginationOptions): Promise<PaginationResult<Doc<"campaigns">>> {
  const start = opts.cursor === null ? { phase: "live" as const, cursor: null } : decodeCampaignCursor(opts.cursor);
  const end = opts.endCursor == null ? null : decodeCampaignCursor(opts.endCursor);
  // An end cursor in the next phase (a split at the hand-over) means "to the end of this range".
  const endCursor = end !== null && end.phase === start.phase ? (end.cursor ?? undefined) : undefined;
  const result = await campaignPhaseQuery(ctx, start.phase).paginate({ ...opts, cursor: start.cursor, endCursor });
  const wrap = (cursor: string) => encodeCampaignCursor(start.phase, cursor);
  const out = {
    ...result,
    continueCursor: wrap(result.continueCursor),
    ...(result.splitCursor ? { splitCursor: wrap(result.splitCursor) } : {}),
  };
  if (start.phase === "archived" || !result.isDone) return out;
  const anyArchived = await campaignPhaseQuery(ctx, "archived").first();
  return anyArchived === null ? out : { ...out, isDone: false, continueCursor: encodeCampaignCursor("archived", null) };
}

/**
 * The campaigns card: every live (not deleted) campaign, the non-archived ones newest first and then the archived ones
 * (`campaignsPage`), with its GM's name, member count, live now and last played. The id is for "Open" (Q27 b: the
 * read-only view is AD13's, the link AU1's).
 */
export const campaigns = appOwnerQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(campaignRowValidator),
  handler: async (ctx, { paginationOpts }) => {
    const page = await campaignsPage(ctx, clampPage(paginationOpts));
    const rows = await Promise.all(
      page.page.map(async (campaign) => {
        const [gmName, members, state, lastEnded] = await Promise.all([
          nameOf(ctx, campaign.ownerId),
          ctx.db
            .query("campaignMembers")
            .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id))
            .take(PLAYER_COUNT_BOUND + 1),
          ctx.db
            .query("campaignState")
            .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
            .first(),
          ctx.db
            .query("sessions")
            .withIndex("by_campaign_ended", (q) => q.eq("campaignId", campaign._id))
            .order("desc")
            .first(),
        ]);
        return {
          campaignId: campaign._id,
          name: campaign.name,
          gmId: campaign.ownerId,
          gmName,
          players: { count: Math.min(members.length, PLAYER_COUNT_BOUND), more: members.length > PLAYER_COUNT_BOUND },
          archived: campaign.archivedAt !== undefined,
          liveNow: state?.liveSessionId !== undefined,
          lastPlayedAt: lastEnded?.endedAt ?? null,
          createdAt: campaign.createdAt,
        };
      }),
    );
    return { ...page, page: rows };
  },
});

/** Recent changes (Q26 a): the audit log, newest first, with the actor's name. */
export const audit = appOwnerQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(auditRowValidator),
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("adminAudit").withIndex("by_at").order("desc").paginate(clampPage(paginationOpts));
    const names = new Map<Id<"users">, Promise<string | null>>();
    const rows = await Promise.all(
      page.page.map(async (row) => {
        if (!names.has(row.actorId)) names.set(row.actorId, nameOf(ctx, row.actorId));
        return {
          _id: row._id,
          at: row.at,
          actorId: row.actorId,
          actorName: await names.get(row.actorId)!,
          action: row.action,
          ...(row.field !== undefined ? { field: row.field } : {}),
          ...(row.from !== undefined ? { from: row.from } : {}),
          ...(row.to !== undefined ? { to: row.to } : {}),
          ...(row.target !== undefined ? { target: row.target } : {}),
        };
      }),
    );
    return { ...page, page: rows };
  },
});
