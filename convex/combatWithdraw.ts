import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { logAction } from "./lib/actionLog";
import { loadCharacter, readSheet } from "./lib/characterSheet";
import { closeRequest } from "./lib/combatRequests";
import { keyedCampaignMutation } from "./lib/functions";
import { withdrawalUseName, withdrawable } from "./lib/withdrawals";

/**
 * Combat HUD HD3 (plan `.omc/plans/combat-hud.yaml`, user answer 8a 2026-11-01; board CmpPromptsPlayer): a player
 * withdraws their own attack, card or feature use that waits for the GM's approval (a `sanction` request, combat-actions
 * Q1). Nothing was rolled or paid for it (the use runs only when the GM approves), so withdrawing only closes the
 * request: the GM's queue item disappears (`combatRequestsReads.mine`, `combatCardsReads.pending` and `combatFeaturesReads.pending`
 * read open rows only) and a later approve or decline answers REQUEST_NOT_OPEN.
 *
 * A player's Charge waiting for the GM's Difficulty (a `difficulty` request with `ask.kind: "charge"`, CB p.59 / p.104)
 * withdraws the same way (user answer 2026-11-02): nothing is rolled or paid before the GM sets the Difficulty. The
 * Cloaked `difficulty` ask follows a move that already happened and is not a use: it stays NOT_FOUND here.
 *
 * Status: a withdrawn request is stored `withdrawn` (dcm-bxp.99.32.17), `resolvedBy` the withdrawing user, and the
 * public feed line says "withdrew". Before that widening it was stored `declined`; `migrations/combatRequestWithdrawn`
 * moves those sanction rows. dcm-bxp.99.32.40: the GM's toast reads `combatRequestsReads.withdrawn`.
 */

const withdrawnValidator = v.object({ status: v.literal("withdrawn"), requestId: v.id("combatRequests") });


/**
 * Withdraws an open sanction or a Charge's Difficulty request. Access: edit on the request's character (`loadCharacter(..., "edit")`, i.e. its player, an
 * edit grantee or the GM; another player FORBIDDEN). NOT_FOUND for a bad id, another campaign's request or one that is
 * neither (`withdrawable`); REQUEST_NOT_OPEN once it was answered (approved, declined, withdrawn, or closed with its encounter).
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
      const use = row === null || row.campaignId !== ctx.campaign._id ? null : withdrawable(row.payload);
      if (row === null || use === null) throw appError("NOT_FOUND");
      const { characterId, action } = use;
      const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
      if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
      if (row.status !== "open") throw appError("REQUEST_NOT_OPEN");
      await closeRequest(ctx, row._id, "withdrawn", ctx.user._id);
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
        summary: `${who} withdrew ${withdrawalUseName(action, sheet, ctx.campaign)} waiting for the GM`,
        undoable: false,
      });
      return { status: "withdrawn" as const, requestId: row._id };
    }),
});
