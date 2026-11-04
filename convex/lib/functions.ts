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
 * | `userMutation`          | -                           | `user`                                     | `rateLimit?`, `readOnly?`   |
 * | `keyedUserMutation`     | `idempotencyKey`            | `user`, `once` (scope: the user)           | `rateLimit?`, `readOnly?`   |
 * | `userAction`            | -                           | `user`                                     | `rateLimit?`                |
 * | `campaignQuery`         | `campaignId`                | `user`, `campaign`, `permission`, `ownerView` | `need`, `enough?`        |
 * | `campaignMutation`      | `campaignId`                | `user`, `campaign`, `permission`           | `need`, `enough?`, `rateLimit?`, `archived?`, `readOnly?` |
 * | `keyedCampaignMutation` | `campaignId`, `idempotencyKey` | the above + `once` (scope: the campaign) | `need`, `enough?`, `rateLimit?`, `archived?`, `readOnly?` |
 * | `gmQuery` / `gmMutation` / `keyedGmMutation` | as the campaign ones | as the campaign ones       | `need` is fixed to `"owner"`; mutations `rateLimit?`, `archived?`, `readOnly?` |
 * | `creatorQuery` / `creatorMutation` / `keyedCreatorMutation` | as the campaign ones | as the campaign ones | `need` is fixed to `"creator"`; mutations `rateLimit?`, `archived?`, `readOnly?` |
 * | `appOwnerQuery` / `appOwnerMutation` / `appOwnerAction` | -     | `user` (the app owner)                     | mutations and actions `rateLimit?` |
 *
 * Consumed args stay part of the public signature (the client still sends
 * them) but are removed from the handler's `args`: use `ctx.campaign._id`.
 *
 * - `need: "view" | "edit" | "owner" | "creator"` is the permission the caller
 *   must have on the campaign (`permissionFor`: the strongest of their campaign
 *   role and any grant). No access at all → `NOT_FOUND` (the campaign's
 *   existence is never revealed); some access but less than `need` →
 *   `FORBIDDEN`. A missing or soft-deleted campaign is `NOT_FOUND`. `owner`
 *   is the GM and every co-GM; `creator` (config G1, Q7 a) is the campaign's
 *   creator only, for what a co-GM must not do (delete, archive, co-GMs).
 * - `ctx.permission` is exact only up to `enough` (default: `need`), because
 *   `permissionFor` stops reading grants once that is reached. Pass
 *   `enough: "owner"` when the handler branches on GM versus player. It is at
 *   most `"owner"`: under `need: "creator"` the caller is the creator and
 *   `ctx.permission` is `"owner"`.
 * - Archived campaigns (Q9 a: read-only for everyone): every campaign
 *   mutation wrapper throws `CAMPAIGN_ARCHIVED` after the access check when
 *   `campaign.archivedAt` is set, unless the option `archived: "allow"` is
 *   given (opening, leaving, deleting). Queries read archived campaigns.
 * - Read-only mode (config AD10, Q31 a): every mutation builder and `userAction` read the tiny `appStatus` row once
 *   and throw `READ_ONLY_MODE` while it is on, after the sign-in, access and archived checks (so a stranger still gets
 *   `NOT_FOUND`) and before the rate limit. The app owner (`isAppOwner`) is exempt, and so are the `appOwner*`
 *   builders, which only the owner passes. `readOnly: "allow"` lets a mutation run anyway: only `campaigns.markOpened`
 *   and `presence.heartbeat` / `disconnect` use it (Q31 a), and `tests/convex/read-only-mode.test.ts` pins that list.
 *   Queries always run; `internal*` functions (crons, a Lorekeeper answer already started) keep running.
 * - App owner (superadmin, config AD0): the `appOwner*` builders let only the
 *   app owner through, decided by `isAppOwner` (`lib/appOwner.ts`, the only
 *   owner check: one stored user id, named with the deployment admin key).
 *   Signed out → `UNAUTHENTICATED`; anyone else → `FORBIDDEN`, before the
 *   handler runs. Never a client flag.
 * - The app owner's read-only view (config AD13, Q27 b, N1 changed): `campaignQuery` and `gmQuery`, and only they,
 *   ask `permissionFor` with `{ ownerView: true }`, so the app owner, in no role and with no grant, reads any
 *   campaign as its GM would (`ctx.permission` "owner", `ctx.ownerView` true), players' private notes and private
 *   Lorekeeper conversations included. `creatorQuery` and every mutation and action builder never pass it, so the
 *   owner stays an outsider (NOT_FOUND) for every write; a mutation that met an owner view would throw
 *   `OWNER_VIEW_READ_ONLY`. `appAdmin.openCampaign` logs each visit.
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
import { isAppOwner } from "./appOwner";
import { refuseArchived } from "./archived";
import { getUser } from "./auth";
import { campaignScope, ownerScope, runOnce, type ScopeKey } from "./operations";
import { atLeast, campaignAccess, type CampaignPermission, type Permission } from "./permissions";

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
  // Character creation (review M5): a GM setting up a party, 20 per hour, bursts of 30.
  createCharacter: { kind: "token bucket", rate: 20, period: HOUR, capacity: 30 },
  // Photo import (D5): one Messages API call per click (decision 14).
  photoImport: { kind: "token bucket", rate: 10, period: HOUR },
  // Combat map layouts (D9, Q5): one Messages API call per Generate / Another version, 10 per user per hour.
  combatMapGenerate: { kind: "token bucket", rate: 10, period: HOUR },
  // Sprite uploads (sprite packs P8): one URL per cut sprite; a sheet is up to 16, so 200 per hour, bursts of 64.
  spriteUpload: { kind: "token bucket", rate: 200, period: HOUR, capacity: 64 },
  // Lorekeeper questions (D13): each one is a Messages API call; 30 per hour, bursts of 10 (the caps in Q9 bound cost).
  lorekeeperAsk: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
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

// ---------------------------------------------------------------- read-only mode

/** The `appStatus` singleton (config AD10): read-only mode and its banner text. Off when no row exists. */
export async function readAppStatus(ctx: QueryCtx): Promise<{ readOnly: boolean; message: string | null }> {
  const row = await ctx.db
    .query("appStatus")
    .withIndex("by_key", (q) => q.eq("key", "app"))
    .unique();
  return { readOnly: row?.readOnly === true, message: row?.message ?? null };
}

/** Whether read-only mode refuses `user`'s write: on, not allowed by the function, and the user is not the app owner. */
async function readOnlyRefuses(ctx: QueryCtx, user: Doc<"users">, readOnly: "allow" | undefined): Promise<boolean> {
  if (readOnly === "allow") return false;
  if (!(await readAppStatus(ctx)).readOnly) return false;
  // Q31 a: the owner is exempt; checked only while read-only is on, so a normal write reads one tiny row.
  return !(await isAppOwner(ctx, user));
}

/** Throws READ_ONLY_MODE when read-only mode refuses this write (see "Read-only mode" above). */
async function refuseReadOnly(ctx: QueryCtx, user: Doc<"users">, readOnly: "allow" | undefined): Promise<void> {
  if (await readOnlyRefuses(ctx, user, readOnly)) throw appError("READ_ONLY_MODE");
}

// ---------------------------------------------------------------- shared steps

async function signedIn(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getUser(ctx);
  if (user === null) throw appError("UNAUTHENTICATED");
  return user;
}

type CampaignOptions = { need: CampaignPermission; enough?: Permission };

/** The user mutation builders' options: a named rate limit, and `readOnly: "allow"` to run in read-only mode (AD10). */
type UserMutationOptions = { rateLimit?: RateLimitName; readOnly?: "allow" };

/** Campaign mutation options: the user ones, and `archived: "allow"` to run on an archived campaign. */
type MutationOptions = UserMutationOptions & { archived?: "allow" };

/**
 * The access check of every campaign wrapper. `ownerView` (config AD13) is true only for the campaign query wrappers:
 * then the app owner, in no role, reads the campaign as its GM would (`permissionFor`'s owner view) and the result says
 * so. Mutation wrappers pass false, so the owner stays an outsider (NOT_FOUND) for every write.
 */
async function authorizedCampaign(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaignId: Id<"campaigns">,
  { need, enough }: CampaignOptions,
  ownerView: boolean,
): Promise<{ campaign: Doc<"campaigns">; permission: Permission; ownerView: boolean }> {
  // The function form of a builder skips the options; fail loudly, never open.
  if ((need as CampaignPermission | undefined) === undefined) throw new Error("Campaign wrappers require a `need` option.");
  const access = await campaignAccess(ctx, user, campaignId, enough !== undefined && atLeast(enough, need) ? enough : need, { ownerView });
  if (access === null) throw appError("NOT_FOUND");
  if (!atLeast(access.permission, need)) throw appError("FORBIDDEN");
  // `creator` is a check, never a ctx value: handlers see at most "owner".
  return { campaign: access.campaign, permission: access.permission === "creator" ? "owner" : access.permission, ownerView: access.ownerView };
}

/**
 * A campaign query's ctx additions. `ownerView` marks the app owner's read-only view (AD13): `lib/permissions.ts`
 * (`ownerViewing`) lets the query's later checks read with it, for this user and campaign only.
 */
async function campaignQueryInput(ctx: QueryCtx, campaignId: Id<"campaigns">, options: CampaignOptions) {
  const user = await signedIn(ctx);
  const { campaign, permission, ownerView } = await authorizedCampaign(ctx, user, campaignId, options, true);
  return { user, campaign, permission, ownerView };
}

/** The shared input of every campaign mutation wrapper: access, the archived guard, read-only mode, the rate limit. */
async function campaignMutationInput(ctx: MutationCtx, campaignId: Id<"campaigns">, options: CampaignOptions & MutationOptions) {
  const user = await signedIn(ctx);
  const { campaign, permission, ownerView } = await authorizedCampaign(ctx, user, campaignId, options, false);
  // AD13, defence in depth: a write never runs as the owner's read-only view (unreachable: the option is off above).
  if (ownerView) throw appError("OWNER_VIEW_READ_ONLY");
  // Q9 a (convex/lib/archived.ts): after the access check, so a stranger still gets NOT_FOUND.
  refuseArchived(campaign, options.archived);
  await refuseReadOnly(ctx, user, options.readOnly);
  await enforceRateLimit(ctx, user, options.rateLimit);
  return { user, campaign, permission };
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

/** A signed-in user's mutation: `ctx.user`; options `rateLimit`, `readOnly`. */
export const userMutation = customMutation(baseMutation, {
  args: {},
  input: async (ctx, _args, { rateLimit, readOnly }: UserMutationOptions) => {
    const user = await signedIn(ctx);
    await refuseReadOnly(ctx, user, readOnly);
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user }, args: {} };
  },
});

/** `userMutation` that consumes `idempotencyKey` and adds `ctx.once`, scoped to the user. */
export const keyedUserMutation = customMutation(baseMutation, {
  args: keyArgs,
  input: async (ctx, { idempotencyKey }, { rateLimit, readOnly }: UserMutationOptions) => {
    const user = await signedIn(ctx);
    await refuseReadOnly(ctx, user, readOnly);
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user, once: onceFor(ctx, idempotencyKey, ownerScope(user._id), user) }, args: {} };
  },
});

type ActionUser = { user: Doc<"users">; readOnlyRefused: boolean } | null;

/**
 * For `userAction`: the signed-in user and whether read-only mode refuses them (AD10), read in one query because
 * actions have no `ctx.db`.
 */
export const actionUser = internalQuery({
  args: {},
  handler: async (ctx): Promise<ActionUser> => {
    const user = await getUser(ctx);
    return user === null ? null : { user, readOnlyRefused: await readOnlyRefuses(ctx, user, undefined) };
  },
});

// `internal.lib.functions.actionUser`, referenced by name: going through
// `_generated/api` would make this module's types depend on themselves.
const actionUserRef = makeFunctionReference<"query", Record<string, never>, ActionUser>("lib/functions:actionUser");

/** A signed-in user's action: `ctx.user`; option `rateLimit`. Refused in read-only mode (AD10) unless the owner. */
export const userAction = customAction(baseAction, {
  args: {},
  input: async (ctx, _args, { rateLimit }: { rateLimit?: RateLimitName }) => {
    // Cheap session check first, then the user and read-only mode in one query.
    if ((await getAuthUserId(ctx)) === null) throw appError("UNAUTHENTICATED");
    const found = await ctx.runQuery(actionUserRef, {});
    if (found === null) throw appError("UNAUTHENTICATED");
    if (found.readOnlyRefused) throw appError("READ_ONLY_MODE");
    const { user } = found;
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user }, args: {} };
  },
});

// ---------------------------------------------------------------- app owner builders

/** The signed-in app owner (`isAppOwner`, the only owner check). Signed out → UNAUTHENTICATED; anyone else → FORBIDDEN. */
async function signedInAppOwner(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await signedIn(ctx);
  if (!(await isAppOwner(ctx, user))) throw appError("FORBIDDEN");
  return user;
}

/** The app owner's query (App admin, config AD0): `ctx.user` is the owner. */
export const appOwnerQuery = customQuery(baseQuery, {
  args: {},
  input: async (ctx) => ({ ctx: { user: await signedInAppOwner(ctx) }, args: {} }),
});

/** The app owner's mutation: `ctx.user` is the owner; option `rateLimit`. Every admin change writes an audit row. */
export const appOwnerMutation = customMutation(baseMutation, {
  args: {},
  input: async (ctx, _args, { rateLimit }: { rateLimit?: RateLimitName }) => {
    const user = await signedInAppOwner(ctx);
    await enforceRateLimit(ctx, user, rateLimit);
    return { ctx: { user }, args: {} };
  },
});

type ActionAppOwner = { user: Doc<"users">; owner: boolean } | null;

/** For `appOwnerAction`: the signed-in user and whether they are the app owner, in one query. */
export const actionAppOwner = internalQuery({
  args: {},
  handler: async (ctx): Promise<ActionAppOwner> => {
    const user = await getUser(ctx);
    return user === null ? null : { user, owner: await isAppOwner(ctx, user) };
  },
});

// `internal.lib.functions.actionAppOwner`, referenced by name for the same reason as `actionUserRef`.
const actionAppOwnerRef = makeFunctionReference<"query", Record<string, never>, ActionAppOwner>("lib/functions:actionAppOwner");

/** The app owner's action: `ctx.user` is the owner; option `rateLimit`. */
export const appOwnerAction = customAction(baseAction, {
  args: {},
  input: async (ctx, _args, { rateLimit }: { rateLimit?: RateLimitName }) => {
    if ((await getAuthUserId(ctx)) === null) throw appError("UNAUTHENTICATED");
    const found = await ctx.runQuery(actionAppOwnerRef, {});
    if (found === null) throw appError("UNAUTHENTICATED");
    if (!found.owner) throw appError("FORBIDDEN");
    await enforceRateLimit(ctx, found.user, rateLimit);
    return { ctx: { user: found.user }, args: {} };
  },
});

// ---------------------------------------------------------------- campaign builders

/** A campaign query: consumes `campaignId`; `ctx.user`, `ctx.campaign`, `ctx.permission`; options `need`, `enough`. */
export const campaignQuery = customQuery(baseQuery, {
  args: campaignArgs,
  input: async (ctx, { campaignId }, options: CampaignOptions) => ({ ctx: await campaignQueryInput(ctx, campaignId, options), args: {} }),
});

/** A campaign mutation: as `campaignQuery`, plus options `rateLimit` and `archived`. */
export const campaignMutation = customMutation(baseMutation, {
  args: campaignArgs,
  input: async (ctx, { campaignId }, options: CampaignOptions & MutationOptions) => ({
    ctx: await campaignMutationInput(ctx, campaignId, options),
    args: {},
  }),
});

/** `campaignMutation` that consumes `idempotencyKey` and adds `ctx.once`, scoped to the campaign. */
export const keyedCampaignMutation = customMutation(baseMutation, {
  args: keyedCampaignArgs,
  input: async (ctx, { campaignId, idempotencyKey }, options: CampaignOptions & MutationOptions) => {
    const { user, campaign, permission } = await campaignMutationInput(ctx, campaignId, options);
    const once = onceFor(ctx, idempotencyKey, campaignScope(campaign._id), user, campaign._id);
    return { ctx: { user, campaign, permission, once }, args: {} };
  },
});

const OWNER: CampaignOptions = { need: "owner" };
const CREATOR: CampaignOptions = { need: "creator" };

/** The GM's query (the GM, every co-GM and the app owner's read-only view): `campaignQuery` with `need: "owner"`. */
export const gmQuery = customQuery(baseQuery, {
  args: campaignArgs,
  input: async (ctx, { campaignId }) => ({ ctx: await campaignQueryInput(ctx, campaignId, OWNER), args: {} }),
});

/** The GM's mutation (the GM and every co-GM): `campaignMutation` with `need: "owner"`. */
export const gmMutation = customMutation(baseMutation, {
  args: campaignArgs,
  input: async (ctx, { campaignId }, options: MutationOptions) => ({
    ctx: await campaignMutationInput(ctx, campaignId, { ...options, ...OWNER }),
    args: {},
  }),
});

/** The GM's keyed mutation: `keyedCampaignMutation` with `need: "owner"`. */
export const keyedGmMutation = customMutation(baseMutation, {
  args: keyedCampaignArgs,
  input: async (ctx, { campaignId, idempotencyKey }, options: MutationOptions) => {
    const { user, campaign, permission } = await campaignMutationInput(ctx, campaignId, { ...options, ...OWNER });
    const once = onceFor(ctx, idempotencyKey, campaignScope(campaign._id), user, campaign._id);
    return { ctx: { user, campaign, permission, once }, args: {} };
  },
});

/**
 * The creator's query (never a co-GM; config G1): `campaignQuery` with `need: "creator"`. Not the app owner's
 * read-only view either (AD13 never answers `creator`): the owner gets NOT_FOUND, as an outsider.
 */
export const creatorQuery = customQuery(baseQuery, {
  args: campaignArgs,
  input: async (ctx, { campaignId }) => {
    const user = await signedIn(ctx);
    const { campaign, permission } = await authorizedCampaign(ctx, user, campaignId, CREATOR, false);
    return { ctx: { user, campaign, permission }, args: {} };
  },
});

/** The creator's mutation (delete, archive, co-GMs): `campaignMutation` with `need: "creator"`. */
export const creatorMutation = customMutation(baseMutation, {
  args: campaignArgs,
  input: async (ctx, { campaignId }, options: MutationOptions) => ({
    ctx: await campaignMutationInput(ctx, campaignId, { ...options, ...CREATOR }),
    args: {},
  }),
});

/** The creator's keyed mutation: `keyedCampaignMutation` with `need: "creator"`. */
export const keyedCreatorMutation = customMutation(baseMutation, {
  args: keyedCampaignArgs,
  input: async (ctx, { campaignId, idempotencyKey }, options: MutationOptions) => {
    const { user, campaign, permission } = await campaignMutationInput(ctx, campaignId, { ...options, ...CREATOR });
    const once = onceFor(ctx, idempotencyKey, campaignScope(campaign._id), user, campaign._id);
    return { ctx: { user, campaign, permission, once }, args: {} };
  },
});
