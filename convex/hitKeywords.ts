/**
 * The GM's keyword ask on incoming hits (plan lanes-2, tracer E2.4, dcm-sk4r; docs/tasks/TASK-LN4-E2.md). User answer
 * 2026-10-31: "Fireproof on an untyped hit: the GM decides whether the hit is fire; a fire-tagged hit applies it
 * directly." A hit whose keyword the data can't settle, on a PC holding a keyword guard (Fireproof, HF p.22: "You are
 * immune to damage from magical or mundane flame"), waits for the GM's answer (`keywordAsk` on the hit, plan lanes-2 V4).
 * The logic is convex/lib/incomingHits.ts (`answerKeywordAsk`, `keywordAskView`); this module is its GM API: `answer` here,
 * the queue's `asks` in hitKeywordsReads.ts (dcm-uh6r).
 */
import { v } from "convex/values";
import { appError } from "../src/lib/errors/app-error";
import { afterHitTriggers } from "./lib/adversaryActions";
import { closeRequest, encounterRunning, loadOpenRequest } from "./lib/combatRequests";
import { keyedGmMutation } from "./lib/functions";
import { answerKeywordAsk, groupUndone, isHitRow, resolveIncomingHit } from "./lib/incomingHits";
import { keywordAnswerValidator } from "./lib/validators/combatRequests";

/**
 * The GM's answer to a hit's keyword ask (`answer.carries`: the hit was that keyword, so the guard applies). When the
 * window has nothing else to wait for, the hit resolves in the same mutation. NOT_FOUND for another campaign's request;
 * REQUEST_NOT_OPEN once resolved or answered; INVALID when the hit asks nothing or about another keyword. A hit whose
 * encounter ended or whose action the GM undid comes back `declined`.
 */
export const answer = keyedGmMutation({
  args: { requestId: v.id("combatRequests"), answer: keywordAnswerValidator },
  returns: v.object({ status: v.union(v.literal("open"), v.literal("resolved"), v.literal("declined")), requestId: v.id("combatRequests") }),
  handler: async (ctx, args) =>
    ctx.once("hit_keyword_answer", args, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, args.requestId);
      if (!isHitRow(row)) throw appError("NOT_FOUND");
      if (!(await encounterRunning(ctx, row)) || (await groupUndone(ctx, row))) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "declined" as const, requestId: row._id };
      }
      const { complete, row: fresh } = await answerKeywordAsk(ctx, { row, answer: args.answer, by: ctx.user._id });
      if (!complete) return { status: "open" as const, requestId: row._id };
      const res = await resolveIncomingHit(ctx, { row: fresh, by: ctx.user._id, early: false });
      await afterHitTriggers(ctx, res, row.createdBy);
      return { status: "resolved" as const, requestId: row._id };
    }),
});
