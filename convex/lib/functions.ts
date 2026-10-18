/**
 * The only builders for client-callable Convex functions (CF1). Each one
 * authenticates, authorizes through `permissionFor` (CF2), and puts the
 * already-checked values on `ctx`, so handlers never re-read ids from `args`
 * (CF4). Raw `query`/`mutation`/`action` are imported only here (ESLint warns
 * elsewhere); `internal*` builders stay raw.
 *
 * Built as "wrappers as middleware" with convex-helpers' customQuery /
 * customMutation / customAction:
 * https://stack.convex.dev/wrappers-as-middleware-authentication
 *
 * ## Builders
 *
 * | Builder                 | Consumes from args          | Adds to ctx                                | Options                     |
 * |-------------------------|-----------------------------|--------------------------------------------|-----------------------------|
 * | `userQuery`             | -                           | `user`                                     | -                           |
 * | `maybeUserQuery`        | -                           | `user` (null when signed out)              | -                           |
 * | `userMutation`          | -                           | `user`                                     | `rateLimit?`                |
 * | `keyedUserMutation`     | `idempotencyKey`            | `user`, `once` (scope: the user)           | `rateLimit?`                |
 * | `userAction`            | -                           | `user`                                     | `rateLimit?`                |
 * | `campaignQuery`         | `campaignId`                | `user`, `campaign`, `permission`           | `need`, `enough?`           |
 * | `campaignMutation`      | `campaignId`                | `user`, `campaign`, `permission`           | `need`, `enough?`, `rateLimit?` |
 * | `keyedCampaignMutation` | `campaignId`, `idempotencyKey` | the above + `once` (scope: the campaign) | `need`, `enough?`, `rateLimit?` |
 * | `gmQuery` / `gmMutation` / `keyedGmMutation` | as the campaign ones | as the campaign ones       | `need` is fixed to `"owner"` |
 *
 * Consumed args stay part of the public signature (the client still sends
 * them) but are removed from the handler's `args`: use `ctx.campaign._id`.
 *
 * - `need: "view" | "edit" | "owner"` is the permission the caller must have
 *   on the campaign (`permissionFor`: the strongest of their campaign role and
 *   any grant). No access at all → `NOT_FOUND` (the campaign's existence is
 *   never revealed); some access but less than `need` → `FORBIDDEN`. A
 *   missing or soft-deleted campaign is `NOT_FOUND`.
 * - `ctx.permission` is exact only up to `enough` (default: `need`), because
 *   `permissionFor` stops reading grants once that is reached. Pass
 *   `enough: "owner"` when the handler branches on GM versus player.
 * - `rateLimit: RateLimitName` consumes one token of that named limit (see
 *   `RATE_LIMITS`), keyed by the user, before the handler runs; past the limit
 *   the call fails with `RATE_LIMITED`. Mutations and actions only.
 * - `ctx.once(kind, request, run)` (keyed builders) runs `run` once per
 *   idempotency key: a retry by the same user with the same `kind` and
 *   `request` returns the stored result; another request, kind or user with
 *   that key gets `IDEMPOTENCY_MISMATCH`. The request is stored as a SHA-256
 *   hash (`lib/operations.ts`). Call it at most once per invocation.
 *
 * ## Errors (CF13, CF14)
 *
 * Every builder throws `ConvexError<AppError>` (`{ code, message? }`, from
 * `src/lib/errors/app-error.ts`). A `RuleError` thrown by the handler becomes
 * `{ code, message }`, a `ZodError` becomes `{ code: "INVALID", message }`, a
 * `ConvexError` passes through, and anything else (a `TypeError`, a failed
 * invariant) is rethrown unchanged so it surfaces as a bug.
 *
 * ## Examples
 *
 * ```ts
 * // Any signed-in user.
 * export const mine = userQuery({
 *   args: {},
 *   handler: async (ctx) => ({ email: ctx.user.email ?? null }),
 * });
 *
 * // Null instead of throwing when signed out or when the campaign is gone.
 * export const get = maybeUserQuery({
 *   args: { campaignId: v.string() },
 *   handler: async (ctx, { campaignId }) => {
 *     const id = ctx.db.normalizeId("campaigns", campaignId);
 *     if (ctx.user === null || id === null) return null;
 *     const access = await campaignAccess(ctx, ctx.user, id, "owner");
 *     return access && { name: access.campaign.name, gm: access.permission === "owner" };
 *   },
 * });
 *
 * // Players and GM read; the handler tells them apart, so it asks for owner precision.
 * export const roster = campaignQuery({
 *   need: "view",
 *   enough: "owner",
 *   args: {},
 *   handler: async (ctx) => listRoster(ctx, ctx.campaign, ctx.permission === "owner"),
 * });
 *
 * // GM only, retry-safe: the client sends { campaignId, value, idempotencyKey }.
 * export const set = keyedGmMutation({
 *   args: { value: v.number() },
 *   handler: async (ctx, { value }) =>
 *     ctx.once("fear_set", { value }, async () => {
 *       const state = await campaignFearState(ctx, ctx.campaign._id);
 *       await ctx.db.patch("campaignState", state._id, { fear: value });
 *       return { previousValue: state.fear, newValue: value };
 *     }),
 * });
 *
 * // Rate-limited per user.
 * export const join = userMutation({
 *   rateLimit: "joinByCode",
 *   args: { code: v.string() },
 *   handler: async (ctx, { code }) => joinCampaign(ctx, ctx.user, code),
 * });
 * ```
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { customAction, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { ZodError } from "zod";

import { appError, RuleError } from "../../src/lib/errors/app-error";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  action,
  env,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { isE2EDeployment } from "./allowlist";
import { getUser } from "./auth";
import { campaignScope, ownerScope, runOnce, type ScopeKey } from "./operations";
import { atLeast, campaignAccess, type Permission } from "./permissions";

// ---------------------------------------------------------------- errors

/** CF14: only expected errors become `ConvexError<AppError>`; everything else is returned as is. */
export function normaliseError(error: unknown): unknown {
  if (error instanceof RuleError) return appError(error.code, error.message);
  if (error instanceof ZodError) return appError("INVALID", error.issues[0]?.message);
  return error;
}

type AnyHandler = (ctx: unknown, args: unknown) => unknown;

/** A raw builder whose handler (wrapper `input` included) rethrows through `normaliseError`. */
function normalised<Builder>(builder: Builder): Builder {
  const build = builder as unknown as (definition: { handler: AnyHandler }) => unknown;
  return ((definition: { handler: AnyHandler }) =>
    build({
      ...definition,
      handler: async (ctx, args) => {
        try {
          return await definition.handler(ctx, args);
        } catch (error) {
          throw normaliseError(error);
        }
      },
    })) as unknown as Builder;
}

const baseQuery = normalised(query);
const baseMutation = normalised(mutation);
const baseAction = normalised(action);

// ---------------------------------------------------------------- rate limits

/** Named limits (CF15), each per user. A wrapper's `rateLimit` option names one. */
const RATE_LIMITS = {
  uploadUrl: { kind: "token bucket", rate: 20, period: HOUR },
  joinByCode: { kind: "token bucket", rate: 10, period: MINUTE },
  // A GM setting up a table may create several at once: 10 per hour, bursts of 30.
  createCampaign: { kind: "token bucket", rate: 10, period: HOUR, capacity: 30 },
  invite: { kind: "token bucket", rate: 30, period: HOUR },
  // Dice rolls (D5): a steady minute of play, with room for a burst of quick rolls.
  roll: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 120 },
  // Photo import (D5): one Messages API call per click (decision 14).
  photoImport: { kind: "token bucket", rate: 10, period: HOUR },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

const rateLimiter = new RateLimiter(components.rateLimiter, RATE_LIMITS);

async function enforceRateLimit(ctx: MutationCtx | ActionCtx, user: Doc<"users">, name: RateLimitName | undefined) {
  if (name === undefined) return;
  // The local e2e backend signs every spec in as the same GM; limits are covered by convex-test.
  if (isE2EDeployment(env) && env.E2E_AUTH_ENABLED === "true") return;
  const { ok } = await rateLimiter.limit(ctx, name, { key: user._id });
  if (!ok) throw appError("RATE_LIMITED");
}

// ---------------------------------------------------------------- shared steps

async function signedIn(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getUser(ctx);
  if (user === null) throw appError("UNAUTHENTICATED");
  return user;
}

type CampaignOptions = { need: Permission; enough?: Permission };

async function authorizedCampaign(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaignId: Id<"campaigns">,
  { need, enough }: CampaignOptions,
): Promise<{ campaign: Doc<"campaigns">; permission: Permission }> {
  // The function form of a builder skips the options; fail loudly, never open.
  if ((need as Permission | undefined) === undefined) throw new Error("Campaign wrappers require a `need` option.");
  const access = await campaignAccess(ctx, user, campaignId, enough !== undefined && atLeast(enough, need) ? enough : need);
  if (access === null) throw appError("NOT_FOUND");
  if (!atLeast(access.permission, need)) throw appError("FORBIDDEN");
  return access;
}

/** Runs `run` once per idempotency key (see `ctx.once` above). */
export type Once = <T>(kind: string, request: unknown, run: () => Promise<T>) => Promise<T>;

function onceFor(ctx: MutationCtx, key: string, scopeKey: ScopeKey, user: Doc<"users">, campaignId?: Id<"campaigns">): Once {
  let used = false;
  return (kind, request, run) => {
    if (used) throw new Error("ctx.once may run only once per function call.");
    used = true;
    return runOnce(ctx, { scopeKey, key, kind, request, createdBy: user._id, campaignId }, run);
  };
}

const campaignArgs = { campaignId: v.id("campaigns") };
const keyArgs = { idempotencyKey: v.string() };
const keyedCampaignArgs = { ...campaignArgs, ...keyArgs };

// ---------------------------------------------------------------- user builders

/** A signed-in user's query: `ctx.user`. Signed out → `UNAUTHENTICATED`. */
export const userQuery = customQuery(baseQuery, {
  args: {},
  input: async (ctx) => ({ ctx: { user: await signedIn(ctx) }, args: {} }),
});

/** A query that also runs signed out: `ctx.user` is null then. For "null when signed out / not found" reads. */
export const maybeUserQuery = customQuery(baseQuery, {
  args: {},
  input: async (ctx) => ({ ctx: { user: await getUser(ctx) }, args: {} }),
});

/** A signed-in user's mutation: `ctx.user`; option `rateLimit`. */
export const userMutation = customMutation(baseMutation, {
  args: {},
  input: async (ctx, _args, { rateLimit }: { rateLimit?: RateLimitName }) => {
    const user = await signedIn(ctx);
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user }, args: {} };
  },
});

/** `userMutation` that consumes `idempotencyKey` and adds `ctx.once`, scoped to the user. */
export const keyedUserMutation = customMutation(baseMutation, {
  args: keyArgs,
  input: async (ctx, { idempotencyKey }, { rateLimit }: { rateLimit?: RateLimitName }) => {
    const user = await signedIn(ctx);
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user, once: onceFor(ctx, idempotencyKey, ownerScope(user._id), user) }, args: {} };
  },
});

/** For `userAction`: the signed-in user, read in a query because actions have no `ctx.db`. */
export const actionUser = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"users"> | null> => getUser(ctx),
});

// `internal.lib.functions.actionUser`, referenced by name: going through
// `_generated/api` would make this module's types depend on themselves.
const actionUserRef = makeFunctionReference<"query", Record<string, never>, Doc<"users"> | null>("lib/functions:actionUser");

/** A signed-in user's action: `ctx.user`; option `rateLimit`. */
export const userAction = customAction(baseAction, {
  args: {},
  input: async (ctx, _args, { rateLimit }: { rateLimit?: RateLimitName }) => {
    // Cheap session check first, then the allowlist check in one query.
    if ((await getAuthUserId(ctx)) === null) throw appError("UNAUTHENTICATED");
    const user = await ctx.runQuery(actionUserRef, {});
    if (user === null) throw appError("UNAUTHENTICATED");
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user }, args: {} };
  },
});

// ---------------------------------------------------------------- campaign builders

/** A campaign query: consumes `campaignId`; `ctx.user`, `ctx.campaign`, `ctx.permission`; options `need`, `enough`. */
export const campaignQuery = customQuery(baseQuery, {
  args: campaignArgs,
  input: async (ctx, { campaignId }, options: CampaignOptions) => {
    const user = await signedIn(ctx);
    const { campaign, permission } = await authorizedCampaign(ctx, user, campaignId, options);
    return { ctx: { user, campaign, permission }, args: {} };
  },
});

/** A campaign mutation: as `campaignQuery`, plus option `rateLimit`. */
export const campaignMutation = customMutation(baseMutation, {
  args: campaignArgs,
  input: async (ctx, { campaignId }, { rateLimit, ...options }: CampaignOptions & { rateLimit?: RateLimitName }) => {
    const user = await signedIn(ctx);
    const { campaign, permission } = await authorizedCampaign(ctx, user, campaignId, options);
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user, campaign, permission }, args: {} };
  },
});

/** `campaignMutation` that consumes `idempotencyKey` and adds `ctx.once`, scoped to the campaign. */
export const keyedCampaignMutation = customMutation(baseMutation, {
  args: keyedCampaignArgs,
  input: async (ctx, { campaignId, idempotencyKey }, { rateLimit, ...options }: CampaignOptions & { rateLimit?: RateLimitName }) => {
    const user = await signedIn(ctx);
    const { campaign, permission } = await authorizedCampaign(ctx, user, campaignId, options);
    await enforceRateLimit(ctx, user, rateLimit);
    const once = onceFor(ctx, idempotencyKey, campaignScope(campaign._id), user, campaign._id);
    return { ctx: { user, campaign, permission, once }, args: {} };
  },
});

const OWNER: CampaignOptions = { need: "owner" };

/** The GM's query: `campaignQuery` with `need: "owner"`. */
export const gmQuery = customQuery(baseQuery, {
  args: campaignArgs,
  input: async (ctx, { campaignId }) => {
    const user = await signedIn(ctx);
    const { campaign, permission } = await authorizedCampaign(ctx, user, campaignId, OWNER);
    return { ctx: { user, campaign, permission }, args: {} };
  },
});

/** The GM's mutation: `campaignMutation` with `need: "owner"`. */
export const gmMutation = customMutation(baseMutation, {
  args: campaignArgs,
  input: async (ctx, { campaignId }, { rateLimit }: { rateLimit?: RateLimitName }) => {
    const user = await signedIn(ctx);
    const { campaign, permission } = await authorizedCampaign(ctx, user, campaignId, OWNER);
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user, campaign, permission }, args: {} };
  },
});

/** The GM's keyed mutation: `keyedCampaignMutation` with `need: "owner"`. */
export const keyedGmMutation = customMutation(baseMutation, {
  args: keyedCampaignArgs,
  input: async (ctx, { campaignId, idempotencyKey }, { rateLimit }: { rateLimit?: RateLimitName }) => {
    const user = await signedIn(ctx);
    const { campaign, permission } = await authorizedCampaign(ctx, user, campaignId, OWNER);
    await enforceRateLimit(ctx, user, rateLimit);
    const once = onceFor(ctx, idempotencyKey, campaignScope(campaign._id), user, campaign._id);
    return { ctx: { user, campaign, permission, once }, args: {} };
  },
});
