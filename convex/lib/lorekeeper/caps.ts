import { makeFunctionReference } from "convex/server";

import type { AtLimitMode } from "../../../src/lib/admin/config";
import { appError } from "../../../src/lib/errors/app-error";
import { PRIMARY_MODEL, reserveMicros, SHORT_MAX_TOKENS, webReserveMicros } from "../../../src/lib/lorekeeper/pricing";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { readAppConfig } from "../appConfig";
import { appConfigRow, isAppOwner } from "../appOwner";
import { modelFor } from "../claude";
import { permissionFor, type Permission } from "../permissions";
import type { Reservation, ReservationMode, UsageKind } from "../validators/lorekeeper";

/**
 * Cost caps (Q9, config AD6): questions and internet passes per person per UTC day, dollars per campaign per
 * calendar month and per deployment per month, counted in `lorekeeperUsage`. The limits come from the owner's admin
 * settings (`appConfig.lorekeeper`), then today's env vars, then the code defaults (`readAppConfig`, read in the
 * call), and a campaign's own per-person numbers (`lorekeeperCampaignLimits`, set by the owner) go on top.
 *
 * At the deployment's monthly limit the owner's `atLimit` decides (Q20 a): `pause` refuses everyone with
 * LOREKEEPER_CAP_DEPLOYMENT (as before AD6); `gmOnly` lets callers with `owner` on the campaign (GM, co-GM) keep
 * asking; `short` lets everyone ask for shorter answers (Sonnet only, half the length, no retry, no internet). Both
 * stop at a hard ceiling of 120% of the limit (LOREKEEPER_PAUSED). The app owner is never capped (`isAppOwner`), but
 * their questions are still counted and booked.
 *
 * Money is booked per model pass (Q2: Sonnet, then maybe the Opus retry, then maybe the web pass):
 *
 * 1. `ask` calls `reserve` in its own transaction: it counts the question (+1 on all three counters) and books the
 *    primary pass's worst case (`reserveMicros(model)`), or throws a cap code. The answer row stores the
 *    `Reservation` (with its `mode` when it was let through past a limit).
 * 2. Before the Opus retry and before the web pass, the run calls `reservePass` (from an internal mutation): it books
 *    that pass's worst case against the campaign and deployment budgets, or returns null when either would go over,
 *    and the run keeps the answer it has. The web pass also books one internet search on the asker's day row and is
 *    refused past the daily searches. The caller adds the returned micros to the row's `reserved.micros`.
 * 3. `settle` replaces a booked amount with the real cost (`costMicros(usage, model)`): once per pass, or once for
 *    the whole answer with the summed amounts; the caller lowers `reserved.micros` by what it settled, so the
 *    stale-run sweep never settles twice. On error or stop it settles the usage received so far (0 before any token).
 *
 * The month's first crossing of 80% of the deployment's limit emails the owner once (AD7, Q32 a): `reserve` and
 * `reservePass` check the spend before their own worst case, `settle` the spend after it; see `spendAlert`.
 *
 * Every function reads and writes the counter rows in the caller's mutation. Convex mutations are serializable, so
 * two concurrent asks never both pass a cap: the second one's read conflicts with the first one's write and retries.
 */

/** "GMs only" and "Shorter answers" stop at this multiple of the monthly limit (Q20 a). */
export const AT_LIMIT_CEILING = 1.2;

export type CapLimits = {
  dailyQuestions: number;
  dailyWebSearches: number;
  campaignMonthlyMicros: number;
  deploymentMonthlyMicros: number;
  atLimit: AtLimitMode;
};

/** A campaign override when it is a finite non-negative number, else the app value. */
function override(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

/**
 * The current limits for one campaign, read in the call (CF19): the admin settings over the env vars and defaults,
 * then the campaign's per-person numbers set by the owner (Q21 changed; no row or no field = the app's number).
 */
export async function capLimits(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<CapLimits> {
  const [{ lorekeeper }, campaignRow] = await Promise.all([
    readAppConfig(ctx),
    ctx.db
      .query("lorekeeperCampaignLimits")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .first(),
  ]);
  return {
    dailyQuestions: override(campaignRow?.dailyQuestions, lorekeeper.dailyQuestions),
    dailyWebSearches: override(campaignRow?.dailyWebSearches, lorekeeper.dailyWebSearches),
    campaignMonthlyMicros: Math.round(lorekeeper.campaignMonthlyUsd * 1_000_000),
    deploymentMonthlyMicros: Math.round(lorekeeper.monthlyUsd * 1_000_000),
    atLimit: lorekeeper.atLimit,
  };
}

/** The per-user counter's period: the UTC day "YYYY-MM-DD". */
export function usageDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The campaign and deployment counters' period: the UTC month "YYYY-MM". */
export function usageMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

/** The counters one answer touches. */
export type UsageScopes = { userId: Id<"users">; campaignId: Id<"campaigns">; day: string; month: string };

/**
 * Books one question's worst-case cost (model, max_tokens) against the three counters, in the caller's
 * transaction, or throws LOREKEEPER_CAP_USER / _CAMPAIGN / _DEPLOYMENT / LOREKEEPER_PAUSED. Returns what to store on
 * the answer row (`reserved`).
 */
export type Reserve = (ctx: MutationCtx, user: Doc<"users">, campaign: Doc<"campaigns">, model: string, now: number) => Promise<Reservation>;

/** Replaces a reservation with the real cost (also on error and stop; 0 before any token). */
export type Settle = (ctx: MutationCtx, scopes: UsageScopes, reservedMicros: number, actualMicros: number) => Promise<void>;

/**
 * The caller's own allowance. `questionsLeft` and `webSearchesLeft` are today's counts (UNCAPPED_LEFT for the app
 * owner); the budgets are booleans that say exactly what `reserve` would do for this caller; `shortAnswers` = the
 * next answer would be a shorter one (Q20 a).
 */
export type Remaining = {
  questionsLeft: number;
  webSearchesLeft: number;
  campaignCapReached: boolean;
  deploymentCapReached: boolean;
  shortAnswers: boolean;
};

/** What `remaining` reports as left for the never-capped app owner. */
export const UNCAPPED_LEFT = 9999;

/**
 * What the caller may still ask (coarse `day` / `month` from the client, CF10); never another user's numbers.
 * `permission` is the caller's exact permission up to `owner` (the wrapper's `ctx.permission`); read when omitted.
 */
export type RemainingFor = (
  ctx: QueryCtx,
  user: Doc<"users">,
  campaign: Doc<"campaigns">,
  day: string,
  month: string,
  permission?: Permission | null,
) => Promise<Remaining>;

/**
 * Options of a later pass's worst case (`reserveMicros`): the web pass passes its `webSearches` (max_uses), which
 * also makes it count against the daily internet searches and books `webReserveMicros` unless `maxTokens` or
 * `inputTokens` is given. `mode` is the answer's `reserved.mode`.
 */
export type PassOptions = { maxTokens?: number; inputTokens?: number; webSearches?: number; mode?: ReservationMode };

/**
 * Books a later pass (the Opus retry, the web pass) of an answer whose question `reserve` already counted, against
 * the counters in `scopes` (the answer's `reserved` periods). Returns the micros booked, to add to the row's
 * `reserved.micros`, or null when the campaign or deployment budget (or, for the web pass, the asker's daily internet
 * searches) would go over: then nothing is booked and the run keeps the answer it has. The daily question cap does
 * not apply (the question is already counted). A `short` answer has no later pass (always null).
 */
export type ReservePass = (ctx: MutationCtx, scopes: UsageScopes, model: string, now: number, opts?: PassOptions) => Promise<number | null>;

const KINDS = ["user", "campaign", "deployment"] as const satisfies readonly UsageKind[];

type Counters = Record<UsageKind, Doc<"lorekeeperUsage"> | null>;

/** One period's counter row, by point read on its index. */
async function counter(ctx: QueryCtx, kind: UsageKind, scopes: UsageScopes): Promise<Doc<"lorekeeperUsage"> | null> {
  if (kind === "user") {
    return ctx.db
      .query("lorekeeperUsage")
      .withIndex("by_user_period", (q) => q.eq("userId", scopes.userId).eq("period", scopes.day))
      .first();
  }
  if (kind === "campaign") {
    return ctx.db
      .query("lorekeeperUsage")
      .withIndex("by_campaign_period", (q) => q.eq("campaignId", scopes.campaignId).eq("period", scopes.month))
      .first();
  }
  return ctx.db
    .query("lorekeeperUsage")
    .withIndex("by_kind_period", (q) => q.eq("kind", "deployment").eq("period", scopes.month))
    .first();
}

async function counters(ctx: QueryCtx, scopes: UsageScopes): Promise<Counters> {
  const [user, campaign, deployment] = await Promise.all(KINDS.map((kind) => counter(ctx, kind, scopes)));
  return { user, campaign, deployment };
}

/** A whole, non-negative number of micros (a bad amount never corrupts a counter). */
function wholeMicros(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

type Delta = { questions: number; micros: number; webSearches?: number };

/** Adds to one counter, creating it when missing and `create` is set; never below 0. Searches go on user rows only. */
async function bump(
  ctx: MutationCtx,
  kind: UsageKind,
  row: Doc<"lorekeeperUsage"> | null,
  scopes: UsageScopes,
  delta: Delta,
  now: number,
  create: boolean,
): Promise<void> {
  const searches = kind === "user" && delta.webSearches !== undefined && delta.webSearches > 0 ? delta.webSearches : 0;
  if (row) {
    await ctx.db.patch("lorekeeperUsage", row._id, {
      questions: Math.max(0, row.questions + delta.questions),
      costMicros: Math.max(0, row.costMicros + delta.micros),
      ...(searches > 0 ? { webSearches: (row.webSearches ?? 0) + searches } : {}),
      updatedAt: now,
    });
    return;
  }
  if (!create) return;
  await ctx.db.insert("lorekeeperUsage", {
    kind,
    ...(kind === "user" ? { userId: scopes.userId } : {}),
    ...(kind === "campaign" ? { campaignId: scopes.campaignId } : {}),
    period: kind === "user" ? scopes.day : scopes.month,
    questions: Math.max(0, delta.questions),
    costMicros: Math.max(0, delta.micros),
    ...(searches > 0 ? { webSearches: searches } : {}),
    updatedAt: now,
  });
}

/** The share of the deployment's monthly limit at which the owner is emailed, once a month (AD7, Q32 a). */
export const SPEND_ALERT_SHARE = 0.8;

// By name, so this module needs no regenerated `_generated/api` for the new action.
const spendAlertRef = makeFunctionReference<"action", { month: string }, null>("spendAlert:send");

/**
 * Emails the owner (scheduled) when the deployment's `spentMicros` for the current `month` has reached 80% of a
 * positive limit and this month's email has not gone yet; marks the month in `appConfig.spendAlertMonth` in the same
 * mutation, so a second crossing (or a concurrent one: serializable) sends nothing. A past month (the stale-run sweep
 * settling last month's answer) never sends. Nothing happens while no owner is set, or while the owner has turned
 * "Email me at 80%" off (`lorekeeper.emailAt80`, default on): then the month is not marked either, so turning it back
 * on can still send this month.
 */
async function spendAlert(ctx: MutationCtx, month: string, spentMicros: number, limitMicros: number, now: number): Promise<void> {
  if (limitMicros <= 0 || spentMicros < limitMicros * SPEND_ALERT_SHARE || month !== usageMonth(now)) return;
  const row = await appConfigRow(ctx);
  if (row === null || row.ownerId === undefined || row.spendAlertMonth === month) return;
  if (row.lorekeeper?.emailAt80 === false) return;
  await ctx.db.patch("appConfig", row._id, { spendAlertMonth: month });
  await ctx.scheduler.runAfter(0, spendAlertRef, { month });
}

/** The 120% ceiling in micros. */
function ceilingMicros(limits: CapLimits): number {
  return Math.floor(limits.deploymentMonthlyMicros * AT_LIMIT_CEILING);
}

/** What the deployment's monthly limit does with the next question: let it through (mode, worst case) or refuse. */
type DeploymentDecision =
  | { ok: true; mode?: "gmOnly" | "short"; micros: number }
  | { ok: false; code: "LOREKEEPER_CAP_DEPLOYMENT" | "LOREKEEPER_PAUSED" };

/**
 * The deployment decision shared by `reserve` and `remaining`, so the composer never says yes where `reserve` says
 * no. Under the limit: the normal worst case. Past it: `atLimit` (Q20 a); `isGm` is read only when "GMs only" needs it.
 */
async function deploymentDecision(rows: Counters, limits: CapLimits, model: string, isGm: () => Promise<boolean>): Promise<DeploymentDecision> {
  const normal = reserveMicros(model);
  const spent = rows.deployment?.costMicros ?? 0;
  if (spent + normal <= limits.deploymentMonthlyMicros) return { ok: true, micros: normal };
  if (limits.atLimit === "short") {
    const micros = reserveMicros(PRIMARY_MODEL, SHORT_MAX_TOKENS);
    return spent + micros <= ceilingMicros(limits) ? { ok: true, mode: "short", micros } : { ok: false, code: "LOREKEEPER_PAUSED" };
  }
  if (limits.atLimit === "gmOnly" && (await isGm())) {
    return spent + normal <= ceilingMicros(limits) ? { ok: true, mode: "gmOnly", micros: normal } : { ok: false, code: "LOREKEEPER_PAUSED" };
  }
  return { ok: false, code: "LOREKEEPER_CAP_DEPLOYMENT" };
}

/** Whether `micros` more would break the campaign's monthly budget (a cap of 0 refuses everything). */
function campaignOver(rows: Counters, limits: CapLimits, micros: number): boolean {
  return (rows.campaign?.costMicros ?? 0) + micros > limits.campaignMonthlyMicros;
}

/** Whether `user` has `owner` (GM, co-GM) on the campaign: the "GMs only" test (rule 2: `permissionFor` decides). */
async function gmOf(ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">): Promise<boolean> {
  return (await permissionFor(ctx, user, { type: "campaign", campaign }, "owner")) === "owner";
}

/**
 * Counts the question and books the primary pass's worst case, or throws the first cap it would break: the daily
 * questions, then the campaign's budget, then the deployment's (as before AD6). The app owner skips every check.
 */
export const reserve: Reserve = async (ctx, user, campaign, model, now) => {
  const scopes: UsageScopes = { userId: user._id, campaignId: campaign._id, day: usageDay(now), month: usageMonth(now) };
  const [limits, owner, rows] = await Promise.all([capLimits(ctx, campaign._id), isAppOwner(ctx, user), counters(ctx, scopes)]);
  let micros = reserveMicros(model);
  let mode: ReservationMode | undefined = "owner";
  if (!owner) {
    if ((rows.user?.questions ?? 0) >= limits.dailyQuestions) throw appError("LOREKEEPER_CAP_USER");
    const decision = await deploymentDecision(rows, limits, model, () => gmOf(ctx, user, campaign));
    if (campaignOver(rows, limits, decision.ok ? decision.micros : micros)) throw appError("LOREKEEPER_CAP_CAMPAIGN");
    if (!decision.ok) throw appError(decision.code);
    micros = decision.micros;
    mode = decision.mode;
  }
  await spendAlert(ctx, scopes.month, rows.deployment?.costMicros ?? 0, limits.deploymentMonthlyMicros, now);
  for (const kind of KINDS) await bump(ctx, kind, rows[kind], scopes, { questions: 1, micros }, now, true);
  return { micros, day: scopes.day, month: scopes.month, ...(mode === undefined ? {} : { mode }) };
};

/** Books a later pass's worst case, or returns null (nothing booked) when a budget would go over. */
export const reservePass: ReservePass = async (ctx, scopes, model, now, opts = {}) => {
  if (opts.mode === "short") return null;
  const web = (opts.webSearches ?? 0) > 0;
  // The web pass books its own worst case (search results as input, output summed over its turns; dcm-5n07) unless
  // the caller names the numbers.
  const micros =
    web && opts.maxTokens === undefined && opts.inputTokens === undefined
      ? webReserveMicros(model, opts.webSearches ?? 0)
      : reserveMicros(model, opts.maxTokens, { inputTokens: opts.inputTokens, webSearches: opts.webSearches });
  const [rows, limits] = await Promise.all([counters(ctx, scopes), capLimits(ctx, scopes.campaignId)]);
  if (opts.mode !== "owner") {
    if (web && (rows.user?.webSearches ?? 0) >= limits.dailyWebSearches) return null;
    if ((rows.campaign?.costMicros ?? 0) + micros > limits.campaignMonthlyMicros) return null;
    const deploymentCap = opts.mode === "gmOnly" ? ceilingMicros(limits) : limits.deploymentMonthlyMicros;
    if ((rows.deployment?.costMicros ?? 0) + micros > deploymentCap) return null;
  }
  await spendAlert(ctx, scopes.month, rows.deployment?.costMicros ?? 0, limits.deploymentMonthlyMicros, now);
  for (const kind of KINDS) await bump(ctx, kind, rows[kind], scopes, { questions: 0, micros, ...(web ? { webSearches: 1 } : {}) }, now, true);
  return micros;
};

/**
 * Replaces `reservedMicros` booked on the three counters with `actualMicros` (the real cost). Counters never go
 * below 0, and a counter that is gone (expired) is left alone. The question (and any search) stays counted.
 */
export const settle: Settle = async (ctx, scopes, reservedMicros, actualMicros) => {
  const delta = wholeMicros(actualMicros) - wholeMicros(reservedMicros);
  if (delta === 0) return;
  const rows = await counters(ctx, scopes);
  const now = Date.now();
  for (const kind of KINDS) await bump(ctx, kind, rows[kind], scopes, { questions: 0, micros: delta }, now, false);
  if (rows.deployment !== null) {
    const { lorekeeper } = await readAppConfig(ctx);
    const spent = Math.max(0, rows.deployment.costMicros + delta);
    await spendAlert(ctx, scopes.month, spent, Math.round(lorekeeper.monthlyUsd * 1_000_000), now);
  }
};

/**
 * What the caller may still ask: questions and internet searches left today (the caller's own counter), and whether
 * the next question would be refused by the campaign or deployment budget (exactly what `reserve` would do for this
 * caller), as booleans; never the amounts.
 */
export const remaining: RemainingFor = async (ctx, user, campaign, day, month, permission) => {
  const scopes: UsageScopes = { userId: user._id, campaignId: campaign._id, day, month };
  const [limits, owner, rows] = await Promise.all([capLimits(ctx, campaign._id), isAppOwner(ctx, user), counters(ctx, scopes)]);
  if (owner) {
    return { questionsLeft: UNCAPPED_LEFT, webSearchesLeft: UNCAPPED_LEFT, campaignCapReached: false, deploymentCapReached: false, shortAnswers: false };
  }
  const isGm = async () => (permission === undefined ? gmOf(ctx, user, campaign) : permission === "owner");
  const model = modelFor("answer");
  const decision = await deploymentDecision(rows, limits, model, isGm);
  const campaignCapReached = campaignOver(rows, limits, decision.ok ? decision.micros : reserveMicros(model));
  return {
    questionsLeft: Math.max(0, limits.dailyQuestions - (rows.user?.questions ?? 0)),
    webSearchesLeft: Math.max(0, limits.dailyWebSearches - (rows.user?.webSearches ?? 0)),
    campaignCapReached,
    deploymentCapReached: !decision.ok,
    shortAnswers: decision.ok && decision.mode === "short" && !campaignCapReached,
  };
};
