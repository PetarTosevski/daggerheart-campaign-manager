import { api } from "../../../convex/_generated/api";
import type { Area, Entry, World } from "./harness";
import { freshKey } from "./synth";

/**
 * Authz matrix: the Combat Map sheet drawer's features (plan sheet-drawer, tracer SD3; docs/tasks/TASK-SD-SD3.md).
 * `combatFeatures.*` act for a character the caller edits (campaign wrappers with `need: "view"`, then
 * `loadCharacter(..., "edit")`): another player is FORBIDDEN, the GM plays for anyone. Later sheet-drawer tracers add
 * their functions here too (analysis section 8).
 *
 * The worlds' characters are warriors with no flying feature and no Martial Artist state, so a player's row reaches the
 * domain checks past the access check: FEATURE_NOT_COMBAT / FEATURE_* for No Mercy (its effect entry may or may not be
 * merged yet), FEATURE_NOT_OWNED for Flying, FEATURE_STATE_MISSING for stances. Content: tests/convex/combat-features.test.ts.
 */

// Another player acting for characterA is refused by `loadCharacter` (edit on the character).
const NOT_THEIRS = { otherPlayer: "FORBIDDEN" } as const;
const USE_CODES = ["FEATURE_NOT_COMBAT", "FEATURE_COST_UNPAID", "FEATURE_EXHAUSTED", "FEATURE_NEEDS_MAP", "INVALID"];

/** A live map with characterA's token, and an open feature sanction of characterA's player (`requestId`). */
async function sanctioned(w: World) {
  const { mapId } = await w.as("gm").mutation(api.combatMaps.create, { campaignId: w.campaignId, size: "medium", idempotencyKey: freshKey() });
  const ids = await w.t.run(async (ctx) => {
    const tokenA = await ctx.db.insert("combatTokens", { campaignId: w.campaignId, mapId, size: 1, face: 0, light: "none", revealedTo: [], ref: { kind: "pc", characterId: w.characterA }, side: "pc", x: 5, y: 10 });
    const requestId = await ctx.db.insert("combatRequests", {
      campaignId: w.campaignId,
      mapId,
      kind: "sanction",
      status: "open",
      createdBy: w.users.player,
      createdAt: Date.now(),
      responses: [],
      payload: {
        schemaVersion: 1,
        kind: "sanction",
        characterId: w.characterA,
        action: { kind: "feature", featureId: "hope:warrior", useId: "main", targetTokenIds: [tokenA], choices: [] },
        outOfRange: [{ tokenId: tokenA, band: "far" }],
      },
    });
    return { requestId };
  });
  w.set("requestId", ids.requestId);
}

const entries: Entry[] = [
  // Hands shared (the default): another player reads the drawer; switch off / hidden is combat-features.test.ts.
  { fn: api.combatFeatures.drawer, access: "view", args: (w) => ({ characterId: w.characterA }), expect: { otherPlayer: "ok" } },
  {
    fn: api.combatFeatures.useFeature,
    access: "view",
    args: (w) => ({ characterId: w.characterA, featureId: "hope:warrior", targetTokenIds: [], choices: [] }),
    expect: NOT_THEIRS,
    okCodes: USE_CODES,
  },
  { fn: api.combatFeatures.pending, access: "view", setup: sanctioned, expect: { otherPlayer: "ok" } },
  { fn: api.combatFeatures.sanction, access: "gm", setup: sanctioned, args: (w) => ({ requestId: w.ids.requestId, approve: false }) },
  { fn: api.combatFeatures.setFlying, access: "view", args: (w) => ({ characterId: w.characterA, flying: true }), expect: NOT_THEIRS, okCodes: ["FEATURE_NOT_OWNED"] },
  { fn: api.combatFeatures.shiftStance, access: "view", args: (w) => ({ characterId: w.characterA, stance: "quick" }), expect: NOT_THEIRS, okCodes: ["FEATURE_STATE_MISSING"] },
  { fn: api.combatFeatures.refocus, access: "view", args: (w) => ({ characterId: w.characterA, calm: true }), expect: NOT_THEIRS, okCodes: ["FEATURE_STATE_MISSING"] },
];

const area: Area = { area: "features", entries };

export default area;
