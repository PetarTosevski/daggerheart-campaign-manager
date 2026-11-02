import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { getDomainCard } from "../src/lib/srd/index";
import type { Doc } from "./_generated/dataModel";
import { logAction } from "./lib/actionLog";
import { loadCharacter, readSheet } from "./lib/characterSheet";
import { closeRequest } from "./lib/combatRequests";
import { ownedHere } from "./lib/featureRunner";
import { keyedCampaignMutation } from "./lib/functions";
import type { SanctionAction } from "./lib/validators/combatRequests";

/**
 * Combat HUD HD3 (plan `.omc/plans/combat-hud.yaml`, user answer 8a 2026-11-01; board CmpPromptsPlayer): a player
 * withdraws their own attack, card or feature use that waits for the GM's approval (a `sanction` request, combat-actions
 * Q1). Nothing was rolled or paid for it (the use runs only when the GM approves), so withdrawing only closes the
 * request: the GM's queue item disappears (`combatRequests.mine`, `combatCards.pending` and `combatFeatures.pending`
 * read open rows only) and a later approve or decline answers REQUEST_NOT_OPEN.
 *
 * Status: `combatRequests.status` has no `withdrawn` value (open | resolved | declined); widening it is the vocabulary
 * lane's (bead filed, see docs/tasks/TASK-HUD-HD3.md). Until then a withdrawn request is `declined` with `resolvedBy`
 * the withdrawing user (a GM decline carries the GM's id), and the public feed line says "withdrew".
 */

const withdrawnValidator = v.object({ status: v.literal("withdrawn"), requestId: v.id("combatRequests") });

/** The use's name for the feed line: the card's or feature's printed name, or "an attack". */
function useName(action: SanctionAction, sheet: ReturnType<typeof readSheet> | null, campaign: Doc<"campaigns">): string {
  switch (action.kind) {
    case "attack":
      return "an attack";
    case "card":
      return getDomainCard(action.cardId)?.name ?? "a card";
    case "feature":
      return (sheet ? ownedHere(sheet, campaign).find((f) => f.featureId === action.featureId)?.name : undefined) ?? "a feature use";
  }
}

/**
 * Withdraws an open sanction. Access: edit on the request's character (`loadCharacter(..., "edit")`, i.e. its player, an
 * edit grantee or the GM; another player FORBIDDEN). NOT_FOUND for a bad id, another campaign's request or one that is
 * not a sanction; REQUEST_NOT_OPEN once it was answered (approved, declined, withdrawn, or closed with its encounter).
 * Idempotent per `idempotencyKey` (a retry returns the stored result); a second withdraw with a new key is
 * REQUEST_NOT_OPEN. Writes one public, non-undoable feed row without a `characterId` (so it never blocks undoing the
 * character's own earlier action).
 */
export const withdraw = keyedCampaignMutation({
  need: "view",
  args: { requestId: v.id("combatRequests") },
  returns: withdrawnValidator,
  handler: async (ctx, { requestId }) =>
    ctx.once("combat_withdraw", { requestId }, async () => {
      const row = await ctx.db.get("combatRequests", requestId);
      if (row === null || row.campaignId !== ctx.campaign._id || row.payload.kind !== "sanction") throw appError("NOT_FOUND");
      const { characterId, action } = row.payload;
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
      if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
      if (row.status !== "open") throw appError("REQUEST_NOT_OPEN");
      await closeRequest(ctx, row._id, "declined", ctx.user._id);
      let sheet: ReturnType<typeof readSheet> | null = null;
      try {
        sheet = readSheet(character.sheet);
      } catch {
        sheet = null;
      }
      const who = sheet?.name ?? "A character";
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        actorId: ctx.user._id,
        kind: "combat",
        visibility: "public",
        summary: `${who} withdrew ${useName(action, sheet, ctx.campaign)} waiting for the GM`,
        undoable: false,
      });
      return { status: "withdrawn" as const, requestId: row._id };
    }),
});
