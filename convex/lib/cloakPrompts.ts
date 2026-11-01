/**
 * The GM's "Does <name>'s Cloaked end?" (plan lanes-2 wave 10, E1.4a; dcm-vx5n; user 2026-10-31). CB p.42 (Rogue,
 * Cloaked): "After you make an attack ... you are no longer Cloaked"; CB p.99: "When you make an action roll with the
 * intent to harm an adversary, you're making an attack roll". Attacks end an ordinary Cloaked by themselves
 * (`uncloakAfterAttack`); any other action roll by a Cloaked PC that targets an enemy asks the GM, who answers with
 * `cloakPrompts.answer` (yes ends Cloaked in the use's undo group, no declines).
 *
 * - `openCloakPrompt`: opens the request (combatRequests kind `cloakPrompt`, V4's payload) when the character is Cloaked
 *   with an ordinary Cloaked (Vanishing Act's sourced Cloaked ends only by its own endings, CB p.42) and the use names
 *   enemy tokens. Callers: the card and feature paths (`afterUse`, convex/combatCards.ts); exported so the roll paths
 *   (E1.4b) can call it too.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { readSheet } from "./characterSheet";
import { sourcedCloak } from "./combatMovement";
import type { CloakPromptPayload } from "./validators/combatRequests";

/** The most enemy tokens one prompt names (the payload's bound). */
export const MAX_CLOAK_PROMPT_TARGETS = 20;

export type CloakPromptInput = {
  campaign: Doc<"campaigns">;
  characterId: Id<"characters">;
  /** The Cloaked PC's token on the map. */
  tokenId: Id<"combatTokens">;
  mapId: Id<"combatMaps">;
  /** The running encounter of the enemies, if any (its end declines the request). */
  encounterId?: Id<"encounters">;
  /** The use's name ("Words of Discord"). */
  label: string;
  /** The use's actionLog group (yes ends Cloaked in it; undoing the use closes the request). */
  groupId: string;
  /** The enemy tokens the use targets. */
  targetTokenIds: readonly Id<"combatTokens">[];
  createdBy: Id<"users">;
};

/**
 * Opens the GM's Cloaked prompt for a non-attack action roll on an enemy, or does nothing (no enemy target, the character
 * is not Cloaked, or its Cloaked is Vanishing Act's). Returns the request id, or null.
 */
export async function openCloakPrompt(ctx: MutationCtx, input: CloakPromptInput): Promise<Id<"combatRequests"> | null> {
  if (input.targetTokenIds.length === 0) return null;
  const character = await ctx.db.get("characters", input.characterId);
  if (character === null || character.campaignId !== input.campaign._id) return null;
  const sheet = readSheet(character.sheet);
  if (!sheet.conditions.includes("cloaked") || sourcedCloak(sheet)) return null;
  const payload: CloakPromptPayload = {
    schemaVersion: 1,
    kind: "cloakPrompt",
    characterId: input.characterId,
    tokenId: input.tokenId,
    label: input.label.slice(0, 120),
    groupId: input.groupId,
    targetTokenIds: [...new Set(input.targetTokenIds)].slice(0, MAX_CLOAK_PROMPT_TARGETS),
  };
  return ctx.db.insert("combatRequests", {
    campaignId: input.campaign._id,
    ...(input.encounterId !== undefined ? { encounterId: input.encounterId } : {}),
    mapId: input.mapId,
    kind: "cloakPrompt",
    status: "open",
    createdBy: input.createdBy,
    createdAt: Date.now(),
    responses: [],
    payload,
  });
}

/** Whether every row of an actionLog group is undone (or the group has no rows): the use no longer stands. */
export async function groupUndone(ctx: QueryCtx, campaignId: Id<"campaigns">, groupId: string): Promise<boolean> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaignId).eq("groupId", groupId))
    .take(50);
  return rows.every((r) => r.undoneAt !== undefined);
}
