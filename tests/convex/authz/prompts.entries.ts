import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Area, Entry, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: server-decided feature uses (plan drawer-answers, tracer DA12; docs/tasks/TASK-DA-DA12.md).
 * `featurePrompts.*` act for a character the caller edits (campaign wrappers with `need: "view"`, then
 * `loadCharacter(..., "edit")`): another player is FORBIDDEN, the GM plays for anyone.
 *
 * The worlds' characters are warriors without Warden's Protection or Charge, so an allowed row stops at a domain check:
 * `rollCount` FEATURE_NOT_OWNED, `targetCount` null, `charge` INVALID (no Difficulty). Content:
 * tests/convex/feature-prompts.test.ts.
 */

// Another player acting for characterA is refused by `loadCharacter` (edit on the character).
const NOT_THEIRS = { otherPlayer: "FORBIDDEN" } as const;
const WARDEN = "subclass:warden-of-renewal:wardens-protection";

/** A map with characterA's token and an enemy token (`mapId`, `tokenId`). */
async function board(w: World) {
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
  const tokenId = await w.t.run(async (ctx) => {
    await ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 2, y: 10 });
    return ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterB }, side: "enemy", x: 12, y: 10 });
  });
  w.set("mapId", mapId);
  w.set("tokenId", tokenId);
}

const entries: Entry[] = [
  {
    fn: api.featurePrompts.rollCount,
    access: "view",
    args: (w) => ({ characterId: w.characterA, featureId: WARDEN }),
    expect: NOT_THEIRS,
    okCodes: ["FEATURE_NOT_OWNED"],
  },
  { fn: api.featurePrompts.targetCount, access: "view", args: (w) => ({ characterId: w.characterA, featureId: WARDEN }), expect: NOT_THEIRS },
  {
    fn: api.featurePrompts.charge,
    access: "view",
    setup: board,
    args: (w) => ({
      characterId: w.characterA,
      mapId: w.ids.mapId as Id<"combatMaps">,
      targetTokenId: w.ids.tokenId as Id<"combatTokens">,
      square: { x: 11, y: 10 },
      stress: false,
      roll: {},
    }),
    expect: NOT_THEIRS,
    okCodes: ["INVALID"],
  },
];

const area: Area = { area: "prompts", entries };

export default area;
