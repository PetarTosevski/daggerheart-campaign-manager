import { ConvexError } from "convex/values";

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

/**
 * Runs `run` once per (scope, key). A replay with the same kind and
 * normalised request returns the stored result; anything else with the same
 * key throws `IDEMPOTENCY_MISMATCH`. Reading the index puts it in the
 * transaction's read set, so a concurrent duplicate retries and replays.
 */
export async function withIdempotency<T>(
  ctx: MutationCtx,
  args: {
    scopeKey: ScopeKey;
    key: string;
    kind: string;
    request: unknown;
    createdBy: Id<"users">;
    campaignId?: Id<"campaigns">;
  },
  run: () => Promise<T>,
): Promise<T> {
  if (args.key.length === 0 || args.key.length > 100) throw new ConvexError({ code: "INVALID", message: "Invalid request key." });
  const requestHash = stableStringify(args.request);
  const existing = await ctx.db
    .query("operations")
    .withIndex("by_scope_key", (q) =>
      q.eq("scopeKey", args.scopeKey).eq("idempotencyKey", args.key),
    )
    .unique();
  if (existing !== null) {
    if (existing.kind !== args.kind || existing.requestHash !== requestHash) {
      throw new ConvexError("IDEMPOTENCY_MISMATCH");
    }
    return existing.result as T;
  }
  const result = await run();
  await ctx.db.insert("operations", {
    scopeKey: args.scopeKey,
    idempotencyKey: args.key,
    kind: args.kind,
    requestHash,
    result,
    campaignId: args.campaignId,
    createdBy: args.createdBy,
    createdAt: Date.now(),
  });
  return result;
}
