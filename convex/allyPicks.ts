import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { answerAllyPick, isAllyPickRow, sendAllyPicks } from "./lib/allyPicks";
import { loadCharacter } from "./lib/characterSheet";
import { loadOpenRequest } from "./lib/combatRequests";
import { keyedCampaignMutation } from "./lib/functions";
import { atLeast } from "./lib/permissions";
import { MAX_ALLY_PICK_CHOOSERS } from "./lib/validators/combatRequests";

/**
 * Per-ally picks (plan finish-hud-lk FH-AP; bead dcm-bxp.99.32.24; user 2026-11-05; convex/lib/allyPicks.ts): one
 * chooser's own pick of a card or feature whose choosers each pick (Rousing Strike, Critical Inspiration, Locust Swarm,
 * Awesome Size, the Fire head). Only that chooser's player or the GM may answer: a chooser with a character is checked by
 * `loadCharacter` (edit, `permissionFor`), one without (a creature that isn't a PC) by the wrapper's permission (owner).
 * The GM answers any outstanding pick (a no-show) from the queue. The last pick runs the use in the same mutation.
 * NOT_FOUND for another campaign's request or one that isn't a pick; REQUEST_NOT_OPEN once run, undone or closed with its
 * encounter; NOT_A_RESPONDER for a chooser the request doesn't list or one that already picked; INVALID for an option
 * the chooser wasn't offered; FORBIDDEN for another player. Keyed; the read is `allyPicksReads.open`.
 */
export const answer = keyedCampaignMutation({
  need: "view",
  enough: "owner",
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), stepId: v.string(), chooserId: v.string(), options: v.array(v.string()) },
  returns: v.object({ status: v.union(v.literal("open"), v.literal("resolved"), v.literal("declined")) }),
  handler: async (ctx, args) =>
    ctx.once("ally_pick_answer", args, async () => {
      if (args.options.length > 4 || args.stepId.length > 80 || args.chooserId.length > 80) throw appError("INVALID");
      const row = await loadOpenRequest(ctx, ctx.campaign._id, args.requestId);
      if (!isAllyPickRow(row)) throw appError("NOT_FOUND");
      const chooser = row.payload.choosers.find((c) => c.stepId === args.stepId && c.chooserId === args.chooserId);
      if (!atLeast(ctx.permission, "owner")) {
        if (chooser?.characterId === undefined) throw appError(chooser === undefined ? "NOT_A_RESPONDER" : "FORBIDDEN");
        await loadCharacter(ctx, ctx.user, chooser.characterId, "edit", "owner");
      }
      return { status: await answerAllyPick(ctx, row, args, ctx.user._id) };
    }),
});

/**
 * The acting player's review before the picks go out (plan rule-switches CU2, bead dcm-bxp.99.32.46, user 2026-11-06:
 * "the acting player can deselect allies from the computed list (can't see/hear) before the picks go out";
 * `convex/lib/allyPicks.ts` `sendAllyPicks`). `drop` names the choosers unticked (allies who can't see or hear the
 * actor). Only the rider's player (`loadCharacter`, edit, `permissionFor`) or the GM sends it; another player FORBIDDEN.
 * NOT_FOUND for another campaign's request or one that isn't a pick; REQUEST_NOT_OPEN once closed; NOT_A_RESPONDER once
 * the picks went out (or for an adversary's use, which never waits for a review); INVALID for the actor's own pick or a
 * chooser the row doesn't list. Every ally dropped and no own pick left: `declined` (the rider doesn't happen). Keyed.
 */
export const send = keyedCampaignMutation({
  need: "view",
  enough: "owner",
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), drop: v.array(v.string()) },
  returns: v.object({ status: v.union(v.literal("open"), v.literal("declined")) }),
  handler: async (ctx, args) =>
    ctx.once("ally_pick_send", args, async () => {
      if (args.drop.length > MAX_ALLY_PICK_CHOOSERS || args.drop.some((id) => id.length > 80)) throw appError("INVALID");
      const row = await loadOpenRequest(ctx, ctx.campaign._id, args.requestId);
      if (!isAllyPickRow(row)) throw appError("NOT_FOUND");
      if (!atLeast(ctx.permission, "owner")) {
        // An adversary's use has no acting player: only the GM gets past here (and is told it never waits for a review).
        if (row.payload.source.kind !== "rider") throw appError("FORBIDDEN");
        await loadCharacter(ctx, ctx.user, row.payload.source.characterId, "edit", "owner");
      }
      return { status: await sendAllyPicks(ctx, row, args.drop, ctx.user._id) };
    }),
});
