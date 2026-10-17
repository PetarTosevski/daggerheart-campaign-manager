import { ConvexError } from "convex/values";

import { frameHasMechanic, type ExclusiveMechanic } from "../../src/lib/frames/index";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Loads a live campaign the GM owns, or throws `NOT_FOUND` (also for other owners). */
export async function loadOwnedCampaign(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  campaignId: Id<"campaigns">,
  { includeDeleted = false } = {},
): Promise<Doc<"campaigns">> {
  const campaign = await ctx.db.get(campaignId);
  if (
    campaign === null ||
    campaign.ownerId !== ownerId ||
    (!includeDeleted && campaign.deletedAt !== undefined)
  ) {
    throw new ConvexError("NOT_FOUND");
  }
  return campaign;
}

/** Frame-exclusive mechanics are enforced on the server, not only hidden in the UI. */
export function assertMechanicEnabled(campaign: Doc<"campaigns">, mechanic: ExclusiveMechanic): void {
  if (!frameHasMechanic(campaign.frameId, mechanic)) {
    throw new ConvexError("MECHANIC_DISABLED");
  }
}

/** Turns a domain rule error into a client-readable `{ code, message }`. */
export function ruleError(code: string, error: unknown): never {
  if (error instanceof Error) throw new ConvexError({ code, message: error.message });
  throw error;
}
