import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { getDomainCard } from "../src/lib/srd/index";
import type { Doc, Id } from "./_generated/dataModel";
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
 * A player's Charge waiting for the GM's Difficulty (a `difficulty` request with `ask.kind: "charge"`, CB p.59 / p.104)
 * withdraws the same way (user answer 2026-11-02): nothing is rolled or paid before the GM sets the Difficulty. The
 * Cloaked `difficulty` ask follows a move that already happened and is not a use: it stays NOT_FOUND here.
 *
 * Status: `combatRequests.status` has no `withdrawn` value (open | resolved | declined); widening it is the vocabulary
 * lane's (bead filed, see docs/tasks/TASK-HUD-HD3.md). Until then a withdrawn request is `declined` with `resolvedBy`
 * the withdrawing user (a GM decline carries the GM's id), and the public feed line says "withdrew".
 */

const withdrawnValidator = v.object({ status: v.literal("withdrawn"), requestId: v.id("combatRequests") });

/** The withdrawable uses: an open sanction, or a Charge waiting for its Difficulty (the request kind check). */
function withdrawable(payload: Doc<"combatRequests">["payload"]): { characterId: Id<"characters">; action: SanctionAction | "charge" } | null {
  if (payload.kind === "sanction") return { characterId: payload.characterId, action: payload.action };
  if (payload.kind === "difficulty" && payload.ask.kind === "charge") return { characterId: payload.characterId, action: "charge" };
  return null;
}

/** The use's name for the feed line: the card's or feature's printed name, "a Charge", or "an attack". */
function useName(action: SanctionAction | "charge", sheet: ReturnType<typeof readSheet> | null, campaign: Doc<"campaigns">): string {
  if (action === "charge") return "a Charge";
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
