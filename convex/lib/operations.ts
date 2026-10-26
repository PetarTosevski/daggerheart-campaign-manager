import { appError } from "../../src/lib/errors/app-error";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type ScopeKey = `owner:${string}` | `campaign:${string}` | `countdown:${string}`;

export const ownerScope = (id: Id<"users">): ScopeKey => `owner:${id}`;
export const campaignScope = (id: Id<"campaigns">): ScopeKey => `campaign:${id}`;

/** Stable JSON: object keys sorted, so equal requests hash equally. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The stored `requestHash`: hex SHA-256 of the stable JSON, so request bodies are never kept. */
export async function requestHash(request: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableStringify(request)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type OnceArgs = {
  scopeKey: ScopeKey;
  key: string;
  kind: string;
  request: unknown;
  createdBy: Id<"users">;
  campaignId?: Id<"campaigns">;
};

/**
 * Runs `run` once per (scope, key). A replay by the same user with the same
 * kind and request returns the stored result; anything else with the same
 * key (another kind or request, or another user) gets `mismatch()`. Reading
 * the index puts it in the transaction's read set, so a concurrent duplicate
 * retries and replays.
 */
async function once<T>(ctx: MutationCtx, args: OnceArgs, run: () => Promise<T>, mismatch: () => Error): Promise<T> {
  if (args.key.length === 0 || args.key.length > 100) throw appError("INVALID", "Invalid request key.");
  const hash = await requestHash(args.request);
  const existing = await ctx.db
    .query("operations")
    .withIndex("by_scope_key", (q) => q.eq("scopeKey", args.scopeKey).eq("idempotencyKey", args.key))
    .unique();
  if (existing !== null) {
    if (existing.kind !== args.kind || existing.requestHash !== hash || existing.createdBy !== args.createdBy) {
      throw mismatch();
    }
    return existing.result as T;
  }
  const result = await run();
  await ctx.db.insert("operations", {
    scopeKey: args.scopeKey,
    idempotencyKey: args.key,
    kind: args.kind,
    requestHash: hash,
    result,
    campaignId: args.campaignId,
    createdBy: args.createdBy,
    createdAt: Date.now(),
  });
  return result;
}

/** The idempotency behind the keyed wrappers' `ctx.once` (lib/functions.ts): throws `ConvexError<AppError>`. */
export function runOnce<T>(ctx: MutationCtx, args: OnceArgs, run: () => Promise<T>): Promise<T> {
  return once(ctx, args, run, () => appError("IDEMPOTENCY_MISMATCH"));
}
