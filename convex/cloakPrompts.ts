import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc } from "./_generated/dataModel";
import { logAction } from "./lib/actionLog";
import { withoutCondition } from "./lib/conditionMarkers";
import { readSheet, saveSheet } from "./lib/characterSheet";
import { groupUndone } from "./lib/cloakPrompts";
import { closeRequest, encounterRunning, loadOpenRequest } from "./lib/combatRequests";
import { sourcedCloak } from "./lib/combatMovement";
import { keyedGmMutation } from "./lib/functions";

/**
 * The GM's "Does <name>'s Cloaked end?" (plan lanes-2 wave 10, E1.4a; dcm-vx5n; user 2026-10-31; CB p.42, CB p.99). A
 * Cloaked PC's action roll that targets an enemy but is not an attack opens a `cloakPrompt` request
 * (convex/lib/cloakPrompts.ts). The GM only:
 *
 * - `pending` (cloakPromptsReads.ts, dcm-uh6r): the open prompts, with the character's, the use's and the enemies' names
 *   (the GM's column);
 * - `answer`: `ends: true` ends Cloaked (`withoutCondition`) in the use's undo group, one public row; `ends: false` declines.
 *   A use that was undone, or a character no longer Cloaked (or Cloaked by Vanishing Act now), closes it as `stale`.
 *   REQUEST_NOT_OPEN once answered; NOT_FOUND for another campaign's request or one that is not a Cloaked prompt.
 */

const answerResult = v.union(v.object({ status: v.literal("ended") }), v.object({ status: v.literal("declined") }), v.object({ status: v.literal("stale") }));

export const answer = keyedGmMutation({
  args: { requestId: v.id("combatRequests"), ends: v.boolean() },
  returns: answerResult,
  handler: async (ctx, { requestId, ends }) =>
    ctx.once("cloak_prompt_answer", { requestId, ends }, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
      const p = row.payload;
      if (p.kind !== "cloakPrompt") throw appError("NOT_FOUND");
      if (!ends) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "declined" as const };
      }
      const character: Doc<"characters"> | null = await ctx.db.get("characters", p.characterId);
      const stale = !(await encounterRunning(ctx, row)) || (await groupUndone(ctx, ctx.campaign._id, p.groupId)) || character === null || character.campaignId !== ctx.campaign._id;
      const sheet = character === null ? null : readSheet(character.sheet);
      if (stale || sheet === null || !sheet.conditions.includes("cloaked") || sourcedCloak(sheet)) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "stale" as const };
      }
      await saveSheet(ctx, character!._id, withoutCondition(sheet, "cloaked"));
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        characterId: character!._id,
        actorId: ctx.user._id,
        kind: "feature",
        visibility: "public",
        summary: `${sheet.name} is no longer Cloaked (${p.label})`.slice(0, 1000),
        before: sheet,
        groupId: p.groupId,
        undoable: true,
      });
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return { status: "ended" as const };
    }),
});
