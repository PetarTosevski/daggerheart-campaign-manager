import { v } from "convex/values";

import { resolveTableSettings } from "../../src/lib/config/campaign-settings";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { atLeast, campaignAccess, type CampaignPermission } from "./permissions";

// `fearValueValidator` and `seesFear` (from convex/campaigns.ts) and `hideFearNumbers` (from convex/feed.ts) live here
// since dcm-uh6r: a module that imported them from those entry modules loaded every function of both on each call.

/**
 * GM Fear as a member may receive it (config R1, user Q3 changed 2026-11-04): the number, or null when the campaign's
 * "Players see the GM's Fear" is off and the caller is below the GM (the creator and co-GMs always see it). Every read
 * that sends the pool, or a Fear change, to a member asks `seesFear`; the client shows "?" for null.
 */
export const fearValueValidator = v.union(v.number(), v.null());

/** The caller sees GM Fear numbers: the GM or a co-GM (owner or better), or any member while `playersSeeFear` is on. */
export function seesFear(campaign: Pick<Doc<"campaigns">, "tableSettings">, permission: CampaignPermission | null): boolean {
  return atLeast(permission, "owner") || resolveTableSettings(campaign.tableSettings).playersSeeFear;
}

/**
 * A feed summary without its GM Fear numbers (config R1, user Q3 changed): what a player reads while "Players see the
 * GM's Fear" is off. 'Fear 3 → 5' reads 'Fear changed'; 'GM gains 2 Fear (1d4 2)' reads 'GM gains Fear'; 'Spent 1
 * Fear: …', '+2 Fear (1 Fear lost)' lose their numbers. A roll's 'with Fear' and the Fear Die ('Fear 3', 'Fear Die 4')
 * are the dice, not the pool, and stay.
 */
export function hideFearNumbers(text: string): string {
  return text
    .replace(/\bFear \d+ → \d+/g, "Fear changed")
    .replace(/\bFear \(1d4[^)]*\)/g, "Fear")
    .replace(/[+\-−]?\d+ Fear\b/g, "Fear");
}

/**
 * Whether the caller of a mutation may receive GM Fear numbers in its result (bead dcm-jh6d.62, the follow-up of config
 * R1): the same rule as `seesFear`, for wrappers whose `ctx.permission` is capped below `owner` (or absent, as in a
 * `keyedUserMutation` on a character). With "Players see the GM's Fear" on, or a permission already known to be the
 * GM's, it reads nothing; otherwise it reads the caller's campaign permission up to `owner`.
 *
 * @example
 * if (!(await callerSeesFear(ctx, ctx.user, campaign))) return withoutFear(result, "fearGained");
 */
export async function callerSeesFear(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaign: Doc<"campaigns">,
  known?: CampaignPermission | null,
): Promise<boolean> {
  if (seesFear(campaign, known ?? null)) return true;
  const access = await campaignAccess(ctx, user, campaign._id, "owner");
  return seesFear(campaign, access?.permission ?? null);
}

/**
 * A mutation result as its caller may receive it (dcm-jh6d.62): whole for the GM, a co-GM, or anyone while "Players see
 * the GM's Fear" is on. For a player while it is off: without `key` (the Fear change), and its `summary` / `notes` lines
 * through `hideFearNumbers` ("GM gains 2 Fear" reads "GM gains Fear"; "with Fear" stays). Every `returns` validator that
 * carries such a key declares it optional (widened for dcm-jh6d.62), so older clients reading it see `undefined` and
 * treat it as no change. A result with none of them (a pending or declined use) passes through unread.
 *
 * @example
 * return fearFor(ctx, ctx.user, loaded.campaign, await duality(...), "fearGained"); // a player: { entryId, roll, prompts }
 */
export async function fearFor<R extends object>(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaign: Doc<"campaigns">,
  result: R,
  key: "fearGained" | "fearDelta" | "fearReverted" | null,
  known?: CampaignPermission | null,
): Promise<R> {
  const carries = (key !== null && key in result) || "summary" in result || "notes" in result;
  if (!carries || (await callerSeesFear(ctx, user, campaign, known))) return result;
  const rest = Object.fromEntries(Object.entries(result).filter(([k]) => k !== key));
  if (typeof rest.summary === "string") rest.summary = hideFearNumbers(rest.summary);
  if (Array.isArray(rest.notes)) rest.notes = rest.notes.map((n: unknown) => (typeof n === "string" ? hideFearNumbers(n) : n));
  // The validator declares `key` optional, so the result without it still matches the declared return.
  return rest as R;
}
