import type { Doc, Id } from "../../_generated/dataModel";
import { env, type MutationCtx, type QueryCtx } from "../../_generated/server";
import type { Reservation } from "../validators/lorekeeper";

/**
 * Cost caps (Q9): questions per person per UTC day, dollars per campaign per calendar month and per deployment per
 * month, counted in `lorekeeperUsage`. The limits are env vars (convex.config.ts), so they change with
 * `npx convex env set` and no deploy. L0 stub with the final signatures: `reserve`, `settle` and `remaining` allow
 * everything; L5 replaces their bodies. `capLimits`, `usageDay` and `usageMonth` are final.
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

/** Stub: books nothing. */
export const reserve: Reserve = async (_ctx, _user, _campaign, _model, now) => ({ micros: 0, day: usageDay(now), month: usageMonth(now) });

/** Stub: no-op. */
export const settle: Settle = async () => {};

/** Stub: the full daily allowance. */
export const remaining: RemainingFor = async () => ({
  questionsLeft: capLimits().dailyQuestions,
  campaignCapReached: false,
  deploymentCapReached: false,
});
