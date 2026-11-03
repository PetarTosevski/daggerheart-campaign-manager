import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

/**
 * Who holds the spotlight (plan combat-hud H1.S, user answer 1c; CB p.89, p.100, p.149). The players pass it among
 * themselves until a PC rolls with Fear or fails an action roll, or the GM spends a Fear to interrupt; then it is the
 * GM's until the GM hands it back to a PC (CB p.100: "Once the GM has finished, play passes back to the PCs").
 */
export const spotlightHolderValidator = v.union(
  v.object({ kind: v.literal("gm") }),
  v.object({ kind: v.literal("pc"), characterId: v.id("characters") }),
);
export type SpotlightHolder = Infer<typeof spotlightHolderValidator>;

/**
 * Why the spotlight moved to its holder:
 * - `rollWithFear` / `failedRoll`: a PC's action roll (CB p.149 "When to make a move"; the engine calls `moveToGm`,
 *   bead dcm-bxp.99.32.4);
 * - `adversary`: the GM spotlighted an adversary (dcm-bxp.99.32.4, H5.2);
 * - `gmTook`: the GM took it by hand (`combatSpotlight.gmTake`, e.g. spending a Fear to interrupt, CB p.100);
 * - `handedBack`: the GM handed it to a PC (`combatSpotlight.handTo`).
 */
export const spotlightReasonValidator = v.union(
  v.literal("rollWithFear"),
  v.literal("failedRoll"),
  v.literal("adversary"),
  v.literal("gmTook"),
  v.literal("handedBack"),
);
export type SpotlightReason = Infer<typeof spotlightReasonValidator>;

export const combatSpotlightTables = {
  /**
   * The campaign's current spotlight (plan combat-hud H1.S): at most one row per campaign, the scene being played
   * now; no row means the players hold it with nobody in particular (the start of play). A table of its own, not a
   * campaign field (rule 6, CD10): it changes on many rolls and only the spotlight readers re-run. Written only through
   * `convex/lib/spotlight.ts`. Bounded (one row per campaign); campaign-scoped: purged with its campaign.
   *
   * - `by_campaign`: the campaign's row; the purge.
   */
  combatSpotlight: defineTable({
    campaignId: v.id("campaigns"),
    holder: spotlightHolderValidator,
    /** When the holder got it (ms). */
    since: v.number(),
    reason: spotlightReasonValidator,
    /** The PC whose roll moved it (`rollWithFear` / `failedRoll`), for "Moss rolled with Fear". */
    rollBy: v.optional(v.id("characters")),
    /**
     * The adversary token the GM spotlighted (`reason` "adversary", bead dcm-bxp.99.32.35): the token the map lights.
     * Widened (rule 7), absent on older rows and whenever the spotlight moved to the GM generally or to a PC.
     */
    adversaryTokenId: v.optional(v.id("combatTokens")),
  }).index("by_campaign", ["campaignId"]),

  /**
   * The adversary tokens the party has seen during the current scene (user 2026-11-03, docs/tasks/TASK-SPOTLIGHT-SEEN.md):
   * a player learns which adversary holds the spotlight (`combatSpotlight.state`'s `adversaryTokenId` and its name) only
   * when one of the party's characters has seen that token since the scene began. One row per (campaign, token), written
   * only through convex/lib/spotlightSeen.ts by `combatVision.markSeen` (a player's client reports the adversaries its
   * server view shows; the server keeps only those the character sees now). Deleted at End scene (`endScene`, the
   * session end) and with the campaign (purge). Rule 6: its own table, never an array on the spotlight row. Bounded: one
   * row per adversary token seen since the last scene end (`MAX_COMBAT_TOKENS` per map).
   *
   * - `by_campaign_token`: whether a token was seen (the spotlight's read, the upsert); the campaign prefix: the scene
   *   end, the purge and a view's "not yet recorded" list.
   */
  combatSeen: defineTable({
    campaignId: v.id("campaigns"),
    tokenId: v.id("combatTokens"),
    /** When a player's character first saw it this scene (ms). */
    seenAt: v.number(),
  }).index("by_campaign_token", ["campaignId", "tokenId"]),
};
