import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { closeRequest, loadOpenRequest } from "./lib/combatRequests";
import { keyedGmMutation } from "./lib/functions";

/**
 * dcm-bxp.99.32.27 (plan combat-hud H5.1, board CmpPromptsGM): the GM answers one stored GM prompt of an adversary
 * feature use (`combatRequests` kind `gmPrompt`; the read is `adversaryPromptsReads.pending`). The prompt is a step the
 * GM applies by hand (summon the Lackeys, tick the countdown, ...), so the answer only closes it: `done: true` marks it
 * applied (`resolved`), `done: false` dismisses it (`declined`). Nothing else is written; undoing the use closes its
 * prompts by itself. GM only, keyed. NOT_FOUND for another campaign's request or one that is not a GM prompt;
 * REQUEST_NOT_OPEN once answered, undone or closed with its encounter.
 */
export const answer = keyedGmMutation({
  args: { requestId: v.id("combatRequests"), done: v.boolean() },
  returns: v.object({ status: v.union(v.literal("resolved"), v.literal("declined")) }),
  handler: async (ctx, { requestId, done }) =>
    ctx.once("adversary_prompt_answer", { requestId, done }, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
      if (row.payload.kind !== "gmPrompt") throw appError("NOT_FOUND");
      const status = done ? ("resolved" as const) : ("declined" as const);
      await closeRequest(ctx, row._id, status, ctx.user._id);
      return { status };
    }),
});
