/**
 * Forced PC attacks as roll requests (plan lanes-2 wave 10, tracer E7.4; dcm-uxsd, user 2026-10-31: "when an adversary
 * feature forces a PC to attack, send the player a roll request that opens their attack dialog with the forced target
 * locked in"). Beguiled (HF p.75 Tentacle Rays: "a Beguiled PC must mark a Stress or attack a target chosen by the
 * Gobstalker"), Words of Discord on a PC. Replaces E7.3's manual "must make an attack" prompt.
 *
 * The request is the V4 `forcedAttack` row (convex/lib/validators/combatRequests.ts). It is written in the forcing use's
 * actionLog group; the player's half (the query, the locked Attack bar, `combatActions.attack` resolving the row) is
 * E1.4b's. Targets are the live map's tokens of the creatures the plan named; with no live map (or no named target) the
 * list is empty and the player picks the target with the GM.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { closeRequest, openRequests } from "./combatRequests";
import type { ForcedAttackPayload } from "./validators/combatRequests";

/** The most targets one request locks (the validator's documented bound). */
export const MAX_FORCED_TARGETS = 20;

export type ForcedAttackInput = {
  campaignId: Id<"campaigns">;
  encounterId: Id<"encounters">;
  mapId?: Id<"combatMaps">;
  createdBy: Id<"users">;
  /** The forcing use's actionLog group (undo and the attack's resolution read it). */
  groupId: string;
  instance: Pick<Doc<"encounterAdversaries">, "_id" | "label">;
  /** The forcing feature's printed name. */
  feature: string;
  /** The PCs who must attack. */
  characterIds: readonly Id<"characters">[];
  /** The creatures they must attack (character or instance ids), as the plan named them. */
  againstIds: readonly string[];
  /** The live map's tokens (empty without a map). */
  tokens: readonly Doc<"combatTokens">[];
};

/** The tokens of the named creatures on the map (a PC never attacks itself), in the named order, deduplicated. */
export function forcedTargetTokens(tokens: readonly Doc<"combatTokens">[], againstIds: readonly string[], attackerId: string): Id<"combatTokens">[] {
  const out: Id<"combatTokens">[] = [];
  for (const id of againstIds) {
    if (id === attackerId) continue;
    const token = tokens.find((t) => (t.ref.kind === "pc" && t.ref.characterId === id) || (t.ref.kind === "adversary" && t.ref.adversaryId === id));
    if (token && !out.includes(token._id)) out.push(token._id);
  }
  return out.slice(0, MAX_FORCED_TARGETS);
}

/**
 * Opens one `forcedAttack` request per PC. A PC's older open forced attack from the same adversary is declined first (the
 * newer one replaces it). Returns the new rows' ids, in `characterIds` order.
 */
export async function openForcedAttacks(ctx: MutationCtx, input: ForcedAttackInput): Promise<Id<"combatRequests">[]> {
  const ids: Id<"combatRequests">[] = [];
  const open = await openRequests(ctx, input.campaignId);
  const now = Date.now();
  for (const characterId of [...new Set(input.characterIds)]) {
    for (const row of open) {
      if (row.payload.kind === "forcedAttack" && row.payload.characterId === characterId && row.payload.instanceId === input.instance._id) {
        await closeRequest(ctx, row._id, "declined", input.createdBy);
      }
    }
    const payload: ForcedAttackPayload = {
      schemaVersion: 1,
      kind: "forcedAttack",
      characterId,
      instanceId: input.instance._id,
      instanceLabel: input.instance.label.slice(0, 80),
      feature: input.feature.slice(0, 80),
      targetTokenIds: forcedTargetTokens(input.tokens, input.againstIds, characterId),
      groupId: input.groupId,
    };
    ids.push(
      await ctx.db.insert("combatRequests", {
        campaignId: input.campaignId,
        encounterId: input.encounterId,
        ...(input.mapId ? { mapId: input.mapId } : {}),
        kind: "forcedAttack",
        status: "open",
        createdBy: input.createdBy,
        createdAt: now,
        payload,
        responses: [],
      }),
    );
  }
  return ids;
}
