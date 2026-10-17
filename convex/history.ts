import { paginationOptsValidator, paginationResultValidator } from "convex/server";

import { gmQuery } from "./lib/functions";
import { historyRow } from "./tables/history";

/**
 * The campaign's change history (Fear, countdowns, campaign time), newest
 * first, one page at a time. GM only.
 */
export const list = gmQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(historyRow),
  handler: async (ctx, { paginationOpts }) =>
    ctx.db
      .query("history")
      .withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaign._id))
      .order("desc")
      .paginate(paginationOpts),
});
