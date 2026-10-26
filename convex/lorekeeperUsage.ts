import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { campaignQuery } from "./lib/functions";
import { remaining } from "./lib/lorekeeper/caps";

/**
 * The Lorekeeper's cost caps as the composer shows them (D13 L5, Q9). Counting and booking happen in
 * `lib/lorekeeper/caps.ts`, inside `lorekeeper.ask` and the run.
 */

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const remainingValidator = v.object({
  questionsLeft: v.number(),
  campaignCapReached: v.boolean(),
  deploymentCapReached: v.boolean(),
});

/**
 * What the caller may still ask in this campaign: questions left today and whether the campaign's or the server's
 * monthly budget is reached. The client passes the current UTC `day` ("YYYY-MM-DD") and `month` ("YYYY-MM"), so the
 * query stays cached (CF10). Only the caller's own question count is read; budgets come back as booleans.
 */
export const mine = campaignQuery({
  need: "view",
  args: { day: v.string(), month: v.string() },
  returns: remainingValidator,
  handler: async (ctx, { day, month }) => {
    if (!DAY.test(day) || !MONTH.test(month) || !day.startsWith(`${month}-`)) throw appError("INVALID");
    return remaining(ctx, ctx.user, ctx.campaign, day, month);
  },
});
