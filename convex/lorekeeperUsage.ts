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
  /** Config AD6: internet searches left today. */
  webSearchesLeft: v.number(),
  campaignCapReached: v.boolean(),
  deploymentCapReached: v.boolean(),
  /** Config AD6 (Q20 a): past the monthly limit with "Shorter answers", the next answer is a shorter one. */
  shortAnswers: v.boolean(),
});

/**
 * What the caller may still ask in this campaign: questions and internet searches left today and whether the
 * campaign's or the server's monthly budget is reached for this caller (config AD6: "GMs only" keeps it open for the
 * GM and co-GMs up to the 120% ceiling; "Shorter answers" for everyone, with `shortAnswers`). The client passes the
 * current UTC `day` ("YYYY-MM-DD") and `month` ("YYYY-MM"), so the query stays cached (CF10). Only the caller's own
 * counts are read; budgets come back as booleans, never amounts or limits.
 */
export const mine = campaignQuery({
  need: "view",
  // ctx.permission must be exact up to "owner": "GMs only" branches on it.
  enough: "owner",
  args: { day: v.string(), month: v.string() },
  returns: remainingValidator,
  handler: async (ctx, { day, month }) => {
    if (!DAY.test(day) || !MONTH.test(month) || !day.startsWith(`${month}-`)) throw appError("INVALID");
    return remaining(ctx, ctx.user, ctx.campaign, day, month, ctx.permission);
  },
});
