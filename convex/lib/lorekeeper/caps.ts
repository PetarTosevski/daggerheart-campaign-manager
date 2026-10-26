import { appError } from "../../../src/lib/errors/app-error";
import { reserveMicros } from "../../../src/lib/lorekeeper/pricing";
import type { Doc, Id } from "../../_generated/dataModel";
import { env, type MutationCtx, type QueryCtx } from "../../_generated/server";
import { modelFor } from "../claude";
import type { Reservation, UsageKind } from "../validators/lorekeeper";

/**
 * Cost caps (Q9): questions per person per UTC day, dollars per campaign per calendar month and per deployment per
 * month, counted in `lorekeeperUsage`. The limits are env vars (convex.config.ts), so they change with
 * `npx convex env set` and no deploy.
 *
 * Money is booked per model pass (Q2: Sonnet, then maybe the Opus retry, then maybe the web pass):
 *
 * 1. `ask` calls `reserve` in its own transaction: it counts the question (+1 on all three counters) and books the
 *    primary pass's worst case (`reserveMicros(model)`), or throws a cap code. The answer row stores the
 *    `Reservation`.
 * 2. Before the Opus retry and before the web pass, the run calls `reservePass` (from an internal mutation): it books
 *    that pass's worst case against the campaign and deployment budgets, or returns null when either would go over,
 *    and the run keeps the answer it has. The caller adds the returned micros to the row's `reserved.micros`.
 * 3. `settle` replaces a booked amount with the real cost (`costMicros(usage, model)`): once per pass, or once for
 *    the whole answer with the summed amounts; the caller lowers `reserved.micros` by what it settled, so the
 *    stale-run sweep never settles twice. On error or stop it settles the usage received so far (0 before any token).
 *
 * Every function reads and writes the counter rows in the caller's mutation. Convex mutations are serializable, so
 * two concurrent asks never both pass a cap: the second one's read conflicts with the first one's write and retries.
 */

const DEFAULT_DAILY_QUESTIONS = 40;
const DEFAULT_CAMPAIGN_MONTHLY_USD = 50;
const DEFAULT_DEPLOYMENT_MONTHLY_USD = 150;

export type CapLimits = { dailyQuestions: number; campaignMonthlyMicros: number; deploymentMonthlyMicros: number };

/** A non-negative number from an env var, else the default (a typo never opens or closes the gate). */
function nonNegative(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** The current limits, read in the call (CF19). */
export function capLimits(): CapLimits {
  return {
    dailyQuestions: Math.floor(nonNegative(env.LOREKEEPER_DAILY_QUESTIONS, DEFAULT_DAILY_QUESTIONS)),
    campaignMonthlyMicros: Math.round(nonNegative(env.LOREKEEPER_CAMPAIGN_MONTHLY_USD, DEFAULT_CAMPAIGN_MONTHLY_USD) * 1_000_000),
    deploymentMonthlyMicros: Math.round(nonNegative(env.LOREKEEPER_MONTHLY_USD, DEFAULT_DEPLOYMENT_MONTHLY_USD) * 1_000_000),
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
 * transaction, or throws LOREKEEPER_CAP_USER / _CAMPAIGN / _DEPLOYMENT. Returns what to store on the answer row
 * (`reserved`).
 */
export type Reserve = (ctx: MutationCtx, user: Doc<"users">, campaign: Doc<"campaigns">, model: string, now: number) => Promise<Reservation>;

/** Replaces a reservation with the real cost (also on error and stop; 0 before any token). */
export type Settle = (ctx: MutationCtx, scopes: UsageScopes, reservedMicros: number, actualMicros: number) => Promise<void>;

export type Remaining = { questionsLeft: number; campaignCapReached: boolean; deploymentCapReached: boolean };

/** What the caller may still ask (coarse `day` / `month` from the client, CF10); never another user's numbers. */
export type RemainingFor = (ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">, day: string, month: string) => Promise<Remaining>;

/** Options of a later pass's worst case (`reserveMicros`): the web pass passes its `webSearches` (max_uses). */
export type PassOptions = { maxTokens?: number; inputTokens?: number; webSearches?: number };

/**
 * Books a later pass (the Opus retry, the web pass) of an answer whose question `reserve` already counted, against
 * the counters in `scopes` (the answer's `reserved` periods). Returns the micros booked, to add to the row's
 * `reserved.micros`, or null when the campaign or deployment budget would go over: then nothing is booked and the run
 * keeps the answer it has. The daily question cap does not apply (the question is already counted).
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

/** Adds to one counter, creating it when missing and `create` is set; never below 0. */
async function bump(
  ctx: MutationCtx,
  kind: UsageKind,
  row: Doc<"lorekeeperUsage"> | null,
  scopes: UsageScopes,
  delta: { questions: number; micros: number },
  now: number,
  create: boolean,
): Promise<void> {
  if (row) {
    await ctx.db.patch("lorekeeperUsage", row._id, {
      questions: Math.max(0, row.questions + delta.questions),
      costMicros: Math.max(0, row.costMicros + delta.micros),
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
    updatedAt: now,
  });
}

/** Which money cap `micros` more would break, if any (a cap of 0 refuses everything). */
function moneyCapHit(rows: Counters, micros: number, limits: CapLimits): "LOREKEEPER_CAP_CAMPAIGN" | "LOREKEEPER_CAP_DEPLOYMENT" | null {
  if ((rows.campaign?.costMicros ?? 0) + micros > limits.campaignMonthlyMicros) return "LOREKEEPER_CAP_CAMPAIGN";
  if ((rows.deployment?.costMicros ?? 0) + micros > limits.deploymentMonthlyMicros) return "LOREKEEPER_CAP_DEPLOYMENT";
  return null;
}

/** Counts the question and books the primary pass's worst case, or throws the first cap it would break. */
export const reserve: Reserve = async (ctx, user, campaign, model, now) => {
  const limits = capLimits();
  const scopes: UsageScopes = { userId: user._id, campaignId: campaign._id, day: usageDay(now), month: usageMonth(now) };
  const micros = reserveMicros(model);
  const rows = await counters(ctx, scopes);
  if ((rows.user?.questions ?? 0) >= limits.dailyQuestions) throw appError("LOREKEEPER_CAP_USER");
  const hit = moneyCapHit(rows, micros, limits);
  if (hit) throw appError(hit);
  for (const kind of KINDS) await bump(ctx, kind, rows[kind], scopes, { questions: 1, micros }, now, true);
  return { micros, day: scopes.day, month: scopes.month };
};

/** Books a later pass's worst case, or returns null (nothing booked) when a budget would go over. */
export const reservePass: ReservePass = async (ctx, scopes, model, now, opts = {}) => {
  const micros = reserveMicros(model, opts.maxTokens, { inputTokens: opts.inputTokens, webSearches: opts.webSearches });
  const rows = await counters(ctx, scopes);
  if (moneyCapHit(rows, micros, capLimits())) return null;
  for (const kind of KINDS) await bump(ctx, kind, rows[kind], scopes, { questions: 0, micros }, now, true);
  return micros;
};

/**
 * Replaces `reservedMicros` booked on the three counters with `actualMicros` (the real cost). Counters never go
 * below 0, and a counter that is gone (expired) is left alone. The question stays counted.
 */
export const settle: Settle = async (ctx, scopes, reservedMicros, actualMicros) => {
  const delta = wholeMicros(actualMicros) - wholeMicros(reservedMicros);
  if (delta === 0) return;
  const rows = await counters(ctx, scopes);
  const now = Date.now();
  for (const kind of KINDS) await bump(ctx, kind, rows[kind], scopes, { questions: 0, micros: delta }, now, false);
};

/**
 * What the caller may still ask: questions left today (the caller's own counter), and whether the next question's
 * primary worst case would break the campaign or deployment budget (exactly what `reserve` would refuse), as booleans.
 */
export const remaining: RemainingFor = async (ctx, user, campaign, day, month) => {
  const limits = capLimits();
  const rows = await counters(ctx, { userId: user._id, campaignId: campaign._id, day, month });
  const next = reserveMicros(modelFor("answer"));
  const over = (row: Doc<"lorekeeperUsage"> | null, cap: number) => (row?.costMicros ?? 0) + next > cap;
  return {
    questionsLeft: Math.max(0, limits.dailyQuestions - (rows.user?.questions ?? 0)),
    campaignCapReached: over(rows.campaign, limits.campaignMonthlyMicros),
    deploymentCapReached: over(rows.deployment, limits.deploymentMonthlyMicros),
  };
};
