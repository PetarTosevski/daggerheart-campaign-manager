import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { seesFear } from "../campaigns";
import { hideFearNumbers } from "../feed";
import { campaignAccess, type CampaignPermission } from "./permissions";

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
